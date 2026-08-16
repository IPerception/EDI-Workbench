// Tests the claim table: the service-line index, the column accessors that
// read through it, PHI masking, and CSV export quoting.
import { readFileSync } from "node:fs";

import { APP, FIXTURE, PACDR_FIXTURE, X221_FIXTURE } from "./paths.mjs";

const html = readFileSync(APP, "utf8");

// Lift a top-level declaration by matching whichever bracket opens it, so
// this works for `function f() {`, `const X = {`, and `const X = [` alike.
function lift(name, opener) {
  const at = html.indexOf(opener);
  if (at === -1) throw new Error("not found: " + name);
  const curly = html.indexOf("{", at);
  const square = html.indexOf("[", at);
  const start = square !== -1 && square < curly ? square : curly;
  const open = html[start], close = open === "[" ? "]" : "}";

  let depth = 0;
  for (let i = start; i < html.length; i++) {
    if (html[i] === open) depth++;
    else if (html[i] === close) { depth--; if (depth === 0) return html.slice(at, i + 1); }
  }
  throw new Error("unbalanced: " + name);
}

// Scalar consts have no bracket to match on, so take the declaration up to
// its semicolon -- these carry trailing comments, so the line doesn't end there.
function liftLine(name) {
  const m = html.match(new RegExp("^const " + name + " = [^\\n]*?;", "m"));
  if (!m) throw new Error("not found: " + name);
  return m[0];
}

const src = [
  lift("splitN", "function splitN(text, sep, maxsplit)"),
  lift("detectDelimiters", "function detectDelimiters(raw)"),
  lift("splitComponents", "function splitComponents(value, componentSep)"),
  lift("parse", "function parse(raw)"),
  lift("COMPOSITES", "const COMPOSITES = {") + ";",
  lift("compositeSpec", "function compositeSpec(segId, index)"),
  lift("PHI_FIELDS", "const PHI_FIELDS = {") + ";",
  lift("isPhiField", "function isPhiField(seg, index)"),
  lift("maskText", "function maskText(value)"),
  lift("HL_CLEARS", "const HL_CLEARS = {") + ";",
  liftLine("GUIDE_PACDR"),
  lift("guideOf", "function guideOf(segments, stIndex)"),
  lift("buildClaimIndex", "function buildClaimIndex(segments)"),
  lift("elAt", "function elAt(index, n)"),
  lift("nameAt", "function nameAt(index)"),
  lift("date8", "function date8(value)"),
  lift("procParts", "function procParts(index)"),
  lift("diagnosesAt", "function diagnosesAt(row)"),
  lift("posAt", "function posAt(row)"),
  lift("toCents", "function toCents(value)"),
  lift("centsToAmount", "function centsToAmount(cents)"),
  lift("primaryPayer", "function primaryPayer(row)"),
  lift("payerAdj", "function payerAdj(row, payer)"),
  lift("CLAIM_COLUMNS", "const CLAIM_COLUMNS = [") + ";",
  lift("nameAt2330B", "function nameAt2330B(row)"),
  lift("PACDR_CLAIM_COLUMNS", "const PACDR_CLAIM_COLUMNS = [") + ";",
  lift("casAmounts", "function casAmounts(adj)"),
  lift("claimColumns", "function claimColumns(rows)"),
  lift("csvCell", "function csvCell(value)"),
  "const state = { doc: null, mask: false };",
  "export { parse, buildClaimIndex, HL_CLEARS, CLAIM_COLUMNS, PACDR_CLAIM_COLUMNS, claimColumns, csvCell, maskText, isPhiField, nameAt, procParts, posAt, diagnosesAt, date8, state, guideOf, GUIDE_PACDR, primaryPayer, payerAdj, toCents, centsToAmount };",
].join("\n");

const m = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));

let pass = 0, fail = 0;
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log(`  FAIL ${name}\n       expected ${JSON.stringify(expected)}\n       actual   ${JSON.stringify(actual)}`); }
};

const raw = readFileSync(FIXTURE, "utf8");
const doc = m.parse(raw);
m.state.doc = doc;

// Column values by label, for the row at `i`.
const row = (rows, i) =>
  Object.fromEntries(m.CLAIM_COLUMNS.map((c) => [c.label, c.get(rows[i])]));

console.log("\n[1] index over the sample 837P");
let rows = m.buildClaimIndex(doc.segments);
check("one row per service line", rows.length, 2);
check("both rows belong to claim 1", rows.map((r) => r.claimNo), [1, 1]);
check("rows point at the LX segments", rows.map((r) => doc.segments[r.lx].id), ["LX", "LX"]);
check("rows point at the SV1 segments", rows.map((r) => doc.segments[r.sv].id), ["SV1", "SV1"]);
check("rows point at the service-date DTP", doc.segments[rows[0].dtp].elements[0], "472");

console.log("\n[2] column accessors");
const r0 = row(rows, 0);
check("claim id", r0.Claim, "PATIENTACCTNUM");
check("patient falls back to the subscriber", r0.Patient, "DOE, JOHN");
check("line number", r0.Line, "1");
check("service date is formatted", r0["Service date"], "2023-01-01");
check("procedure code comes out of the composite", r0.Procedure, "99213");
check("units", r0.Units, "1");
check("line charge", r0.Charge, "100");
check("diagnosis code comes out of the HI composite", r0.Diagnoses, "J209");
check("place of service is decoded", r0["Place of service"], "11 Office");
check("billing provider is an organisation name", r0["Billing provider"], "BILLING PROVIDER NAME");
check("payer", r0.Payer, "INSURANCE COMPANY");
check("claim total repeats on every line", r0["Claim total"], "150");
check("second line has its own procedure", row(rows, 1).Procedure, "87070");
check("second line has its own charge", row(rows, 1).Charge, "50");

console.log("\n[3] modifiers");
const withMods = m.parse(raw.replace("SV1*HC:99213*", "SV1*HC:99213:25:59*"));
m.state.doc = withMods;
rows = m.buildClaimIndex(withMods.segments);
check("modifiers are split off the composite", row(rows, 0).Modifiers, "25 59");
check("the code is still just the code", row(rows, 0).Procedure, "99213");
m.state.doc = doc;

console.log("\n[4] claims with no service lines still appear");
const noLines = m.parse(
  raw.replace(/LX\*1~[\s\S]*?DTP\*472\*D8\*20230101~\n/, "")
     .replace(/LX\*2~[\s\S]*?DTP\*472\*D8\*20230101~\n/, "")
);
m.state.doc = noLines;
const bare = m.buildClaimIndex(noLines.segments);
check("the claim still produces one row", bare.length, 1);
check("with no line number", bare[0].lx, -1);
check("but the claim fields still read", m.CLAIM_COLUMNS[0].get(bare[0]), "PATIENTACCTNUM");
check("and empty line fields don't throw", m.CLAIM_COLUMNS[4].get(bare[0]), "");
m.state.doc = doc;

console.log("\n[5] multiple claims and transactions");
const two = m.parse(raw.replace(
  "SE*27*0001~",
  "CLM*SECOND*300***21:B:7*Y*A*Y*Y~\nHI*ABK:E119~\nLX*1~\nSV1*HC:99214*300*UN*2***1~\nDTP*472*D8*20230105~\nSE*33*0001~"
));
m.state.doc = two;
rows = m.buildClaimIndex(two.segments);
check("three service lines across two claims", rows.length, 3);
check("claim numbers advance", rows.map((r) => r.claimNo), [1, 1, 2]);
check("claim 2 has its own total", row(rows, 2)["Claim total"], "300");
check("claim 2 has its own place of service", row(rows, 2)["Place of service"], "21 Inpatient hospital");
check("claim 2 has its own diagnosis", row(rows, 2).Diagnoses, "E119");
check("claim 1 diagnoses did not leak forward", row(rows, 0).Diagnoses, "J209");
check("claim 2 service date", row(rows, 2)["Service date"], "2023-01-05");
m.state.doc = doc;

console.log("\n[5b] a claim's last line keeps its own patient");
// Regression. A service line is not flushed until something closes it, so a
// claim's LAST line used to be emitted after the walk had already entered the
// following HL loop and read its NM1*QC -- attributing the subscriber's final
// line to the dependent who happened to come next. Spotted in a screenshot of
// the Claims tab, where one claim showed two different patients.
const withDependent = m.parse([
  "ISA*00*          *00*          *ZZ*S              *ZZ*R              *230101*1200*^*00501*000000001*0*T*:",
  "GS*HC*S*R*20230101*1200*1*X*005010X222A1",
  "ST*837*0001*005010X222A1",
  "HL*1**20*1",
  "NM1*85*2*CLINIC*****XX*1234567893",
  "HL*2*1*22*1",
  "SBR*P*18*******CI",
  "NM1*IL*1*SUBSCRIBER*SAM****MI*S1",
  // Two lines. The second is the one that used to be misattributed.
  "CLM*SUBCLAIM*200***11:B:1*Y*A*Y*Y",
  "LX*1", "SV1*HC:99213*100*UN*1***1", "DTP*472*D8*20230105",
  "LX*2", "SV1*HC:99214*100*UN*1***2", "DTP*472*D8*20230112",
  // A dependent follows, with its own claim.
  "HL*3*2*23*0",
  "PAT*19",
  "NM1*QC*1*DEPENDENT*DANA",
  "CLM*DEPCLAIM*50***11:B:1*Y*A*Y*Y",
  "LX*1", "SV1*HC:99391*50*UN*1***1", "DTP*472*D8*20230305",
  "SE*21*0001", "GE*1*1", "IEA*1*000000001",
].join("~") + "~");
m.state.doc = withDependent;
const dep = m.buildClaimIndex(withDependent.segments);
check("three rows", dep.length, 3);
check("both of the subscriber's lines name the subscriber",
  dep.slice(0, 2).map((r) => m.nameAt(r.patient)),
  ["SUBSCRIBER, SAM", "SUBSCRIBER, SAM"]);
check("only the dependent's claim names the dependent",
  m.nameAt(dep[2].patient), "DEPENDENT, DANA");
check("and the subscriber column is the subscriber throughout",
  dep.map((r) => m.nameAt(r.subscriber)),
  ["SUBSCRIBER, SAM", "SUBSCRIBER, SAM", "SUBSCRIBER, SAM"]);

console.log("\n[5c] entity context does not carry past its scope");
// 2310B/2420A live inside the claim, so a claim that omits a rendering
// provider must not inherit the previous claim's.
const renderLeak = m.parse([
  "ISA*00*          *00*          *ZZ*S              *ZZ*R              *230101*1200*^*00501*000000001*0*T*:",
  "GS*HC*S*R*20230101*1200*1*X*005010X222A1",
  "ST*837*0001*005010X222A1",
  "HL*1**20*1", "NM1*85*2*CLINIC*****XX*1234567893",
  "HL*2*1*22*0", "SBR*P*18*******CI", "NM1*IL*1*SUBSCRIBER*SAM****MI*S1",
  "CLM*HASRENDER*100***11:B:1*Y*A*Y*Y",
  "NM1*82*1*RENDER*RITA****XX*1122334455",
  "LX*1", "SV1*HC:99213*100*UN*1***1", "DTP*472*D8*20230105",
  "CLM*NORENDER*100***11:B:1*Y*A*Y*Y",
  "LX*1", "SV1*HC:99213*100*UN*1***1", "DTP*472*D8*20230106",
  "SE*18*0001", "GE*1*1", "IEA*1*000000001",
].join("~") + "~");
m.state.doc = renderLeak;
const leak = m.buildClaimIndex(renderLeak.segments);
check("the claim that names a rendering provider has one",
  m.nameAt(leak[0].rendering), "RENDER, RITA");
check("the claim that does not, does not", leak[1].rendering, -1);
// A new subscriber must not inherit the previous one's dependent either.
check("HL levels clear everything at or below them",
  [m.HL_CLEARS["22"].includes("patient"), m.HL_CLEARS["23"].includes("subscriber")],
  [true, false]);
m.state.doc = doc;

console.log("\n[6] PHI masking");
const nm1 = { id: "NM1", elements: ["IL", "1", "DOE", "JOHN", "", "", "", "MI", "123456789A"] };
const org = { id: "NM1", elements: ["PR", "2", "INSURANCE COMPANY", "", "", "", "", "PI", "987654321"] };
check("a person's last name is PHI", m.isPhiField(nm1, 2), true);
check("a person's member id is PHI", m.isPhiField(nm1, 8), true);
check("the entity qualifier is not", m.isPhiField(nm1, 0), false);
check("an organisation's name is not PHI", m.isPhiField(org, 2), false);
check("an organisation's id is not PHI", m.isPhiField(org, 8), false);
check("street address is PHI", m.isPhiField({ id: "N3", elements: ["456 ELM ST"] }, 0), true);
check("date of birth is PHI", m.isPhiField({ id: "DMG", elements: ["D8", "19800101"] }, 1), true);
check("REF is PHI only for the SSN qualifier",
  m.isPhiField({ id: "REF", elements: ["SY", "123456789"] }, 1), true);
check("REF employer id is not PHI",
  m.isPhiField({ id: "REF", elements: ["EI", "123456789"] }, 1), false);
check("segments with no PHI fields", m.isPhiField({ id: "LX", elements: ["1"] }, 0), false);

check("masking preserves shape", m.maskText("DOE"), "###");
check("masking preserves punctuation", m.maskText("456 ELM ST"), "### ### ##");
check("masking covers digits", m.maskText("123456789A"), "##########");

console.log("\n[7] masked columns");
m.state.mask = true;
rows = m.buildClaimIndex(doc.segments);
const phiCols = m.CLAIM_COLUMNS.filter((c) => c.phi).map((c) => c.label);
check("only claim id and patient are flagged PHI", phiCols, ["Claim", "Patient"]);
// The flag is what the renderer and the exporter both consult; the accessor
// itself always returns the real value.
check("accessors are unaffected by the mask flag", m.CLAIM_COLUMNS[1].get(rows[0]), "DOE, JOHN");
check("the exporter masks a flagged column", m.maskText(m.CLAIM_COLUMNS[1].get(rows[0])), "###, ####");
m.state.mask = false;

console.log("\n[8] CSV quoting");
check("plain value passes through", m.csvCell("99213"), "99213");
check("empty value", m.csvCell(""), "");
check("null becomes empty", m.csvCell(null), "");
check("a comma forces quoting", m.csvCell("DOE, JOHN"), '"DOE, JOHN"');
check("a quote is doubled", m.csvCell('SAY "HI"'), '"SAY ""HI"""');
check("a newline forces quoting", m.csvCell("A\nB"), '"A\nB"');
// A cell starting with a formula character is text, not a formula: without
// this a crafted claim value would execute when the CSV is opened.
check("= is neutralised", m.csvCell("=1+1"), "'=1+1");
check("+ is neutralised", m.csvCell("+X"), "'+X");
check("- is neutralised", m.csvCell("-X"), "'-X");
check("@ is neutralised", m.csvCell("@X"), "'@X");
check("a hyphen inside a value is left alone", m.csvCell("2023-01-01"), "2023-01-01");

console.log("\n[9] header and rows line up");
rows = m.buildClaimIndex(doc.segments);
const header = m.CLAIM_COLUMNS.map((c) => m.csvCell(c.label));
const line = m.CLAIM_COLUMNS.map((c) => m.csvCell(c.get(rows[0])));
check("every column produces a cell", line.length, header.length);
check("no column returns undefined", line.every((v) => v !== undefined), true);

console.log("\n[10] the CSV header is a published interface");
// Pinned exactly, in order. Something downstream reads these by name, so a
// label may be added at the end but never renamed or reordered -- and the
// 837P header in particular must not have grown when PACDR did.
check("the 837P columns are exactly what they have always been",
  m.claimColumns(rows).map((c) => c.label),
  ["Claim", "Patient", "Line", "Service date", "Procedure", "Modifiers", "Units",
   "Charge", "Diagnoses", "Place of service", "Billing provider", "Payer", "Claim total"]);
check("and the adjudication columns are appended, never substituted",
  m.CLAIM_COLUMNS.concat(m.PACDR_CLAIM_COLUMNS).map((c) => c.label).slice(13),
  ["Claim paid", "Line paid", "Line adjustments", "Adjustment codes", "Paid date",
   "Payers", "Data receiver", "Contract code (CN1-04)"]);
check("none of them is flagged PHI: they are amounts, codes and organisations",
  m.PACDR_CLAIM_COLUMNS.filter((c) => c.phi), []);

console.log("\n[11] the post-adjudicated report");
const pacdrRaw = readFileSync(PACDR_FIXTURE, "utf8");
const pacdrDoc = m.parse(pacdrRaw);
m.state.doc = pacdrDoc;
const padj = m.buildClaimIndex(pacdrDoc.segments);
const pcols = m.claimColumns(padj);
const prow = (i) => Object.fromEntries(pcols.map((c) => [c.label, c.get(padj[i])]));

check("the transaction is recognised from ST-03",
  m.guideOf(pacdrDoc.segments, pacdrDoc.segments.findIndex((s) => s.id === "ST")), m.GUIDE_PACDR);
check("still one row per service line", padj.length, 2);
check("the columns grow only for a file that has a PACDR transaction",
  pcols.length, m.CLAIM_COLUMNS.length + m.PACDR_CLAIM_COLUMNS.length);

const p0 = prow(0);
// The payer column is the point of the whole exercise: NM1*PR at 2010BB is
// the agency the report goes to, and it has paid nothing.
check("payer is the 2330B that adjudicated the claim", p0.Payer, "QUILLFEATHER HEALTH PLAN");
check("and 2010BB is reported separately as the data receiver",
  p0["Data receiver"], "STATE HEALTH DATA AGENCY");
check("claim paid is the primary payer's AMT*D", p0["Claim paid"], "240");
check("line paid is that payer's SVD-02 on this line", p0["Line paid"], "160");
check("line adjustments sum the CAS amounts in that 2430", p0["Line adjustments"], "40.00");
check("adjustment codes pair group with reason", p0["Adjustment codes"], "PR-2");
check("paid date comes from the line's own DTP*573", p0["Paid date"], "2023-02-10");
check("payers counts the 2320 loops on the claim", p0.Payers, "2");
check("the contract code is raw and undecoded", p0["Contract code (CN1-04)"], "CT9910");
check("the second line has its own adjudication",
  [prow(1)["Line paid"], prow(1)["Line adjustments"]], ["80", "20.00"]);
check("the claim-level columns repeat on it",
  [prow(1)["Claim paid"], prow(1).Payers], ["240", "2"]);

// A 2430 whose SVD-01 names nobody on the claim leaves the columns empty
// rather than reading someone else's adjudication.
const noMatch = m.parse(pacdrRaw.replace(/SVD\*QFHP0001/g, "SVD*NOSUCH01"));
m.state.doc = noMatch;
const orphan = m.buildClaimIndex(noMatch.segments);
check("an unmatched line adjudication reports nothing rather than the wrong payer's",
  [m.payerAdj(orphan[0], m.primaryPayer(orphan[0]))], [null]);

// Payer order is not document order: a report may emit the secondary payer's
// 2320 first, and real ones do.
const swapped = m.parse(pacdrRaw
  .replace("SBR*P*18*******CI~\nAMT*D*240~", "SBR*S*18*******CI~\nAMT*D*240~")
  .replace("SBR*S*18*******CI~\nAMT*D*45~", "SBR*P*18*******CI~\nAMT*D*45~"));
m.state.doc = swapped;
const bySbr = m.buildClaimIndex(swapped.segments);
check("the primary payer is the one SBR-01 names, not the first reported",
  m.nameAt(m.primaryPayer(bySbr[0]).nm1), "LARKSPUR BENEFIT PLAN");
check("and its own amounts follow it",
  Object.fromEntries(m.claimColumns(bySbr).slice(13, 15).map((c) => [c.label, c.get(bySbr[0])])),
  { "Claim paid": "45", "Line paid": "30" });

console.log("\n[12] a PACDR claim with no service lines");
// Regression. The per-line array is shared by reference with the rows that
// hold it, and closeClaim replaced only the payers -- so the row given to a
// claim with no LX kept the live array and watched the NEXT claim's SVDs push
// into it. That claim's line adjudication then showed against this one, in
// the CSV export as much as in the table.
const withLineless = m.parse(pacdrRaw
  .replace("CLM*PATIENTACCTNUM*300*", "CLM*NOLINES*0***11:B:1*Y*A*Y*Y~\nCLM*PATIENTACCTNUM*300*")
  .replace("SE*55*0001~", "SE*56*0001~"));
m.state.doc = withLineless;
const lineless = m.buildClaimIndex(withLineless.segments);
const lcols = m.claimColumns(lineless);
const lcell = (r, label) => lcols.find((c) => c.label === label).get(r);
check("the lineless claim still gets a row", lineless.map((r) => lcell(r, "Claim")),
  ["NOLINES", "PATIENTACCTNUM", "PATIENTACCTNUM"]);
check("and carries none of the next claim's line adjudication",
  [lineless[0].adj.length, lcell(lineless[0], "Line paid"), lcell(lineless[0], "Line adjustments")],
  [0, "", ""]);
check("nor its payers", [lineless[0].payers.length, lcell(lineless[0], "Payers")], [0, "0"]);
check("while the claim that does have lines is unaffected",
  lineless.slice(1).map((r) => lcell(r, "Line paid")), ["160", "80"]);
// The Payer column must not fall back to the NM1*PR the other columns read
// when a PACDR claim names no payer of its own: under this guide that is the
// 2010BB data receiver, which paid nothing, and a row showing it named the
// same organisation in Payer and Data receiver both.
check("and names no payer rather than naming the data receiver",
  [lcell(lineless[0], "Payer"), lcell(lineless[0], "Data receiver")],
  ["", "STATE HEALTH DATA AGENCY"]);

// The same fallback leaked across claims: ctx.payer took every NM1*PR it saw,
// including a 2330B, and survives to the next claim in the same hierarchy --
// so a claim adjudicated by nobody inherited the previous claim's payer, in
// the CSV export as much as on screen.
const trailing = m.parse(pacdrRaw
  .replace("SE*55*0001~", "CLM*NOPAYER*0***11:B:1*Y*A*Y*Y~\nSE*56*0001~"));
m.state.doc = trailing;
const trows = m.buildClaimIndex(trailing.segments);
const tcols = m.claimColumns(trows);
const tcell = (r, label) => tcols.find((c) => c.label === label).get(r);
const noPayer = trows.find((r) => tcell(r, "Claim") === "NOPAYER");
check("a claim after one that was adjudicated inherits none of its payer",
  [tcell(noPayer, "Payer"), tcell(noPayer, "Payers")], ["", "0"]);
check("and the adjudicated claim ahead of it still names its own",
  tcell(trows[0], "Payer"), "QUILLFEATHER HEALTH PLAN");
// The column no longer reads this under PACDR, so pin it directly: the field
// means the 2010BB, and a 2330B taking it would leave that stale meaning for
// whatever reads it next.
check("and the field the column stopped reading still means the 2010BB",
  m.nameAt(noPayer.payer), "STATE HEALTH DATA AGENCY");

console.log("\n[13] an adjustment amount that is not a number");
// The display twin of the same problem: read as a contributing zero, an
// unreadable amount silently understated the total beside it. A missing
// figure is honest where a wrong one is not -- and Checks reports the value.
const badCas = m.parse(pacdrRaw.replace("CAS*PR*2*40~", "CAS*PR*2*XX~"));
m.state.doc = badCas;
const badRows = m.buildClaimIndex(badCas.segments);
const bcols = m.claimColumns(badRows);
const bcell = (r, label) => bcols.find((c) => c.label === label).get(r);
check("the total is left empty rather than quietly short",
  bcell(badRows[0], "Line adjustments"), "");
check("but the reason code is still readable, so it is still shown",
  bcell(badRows[0], "Adjustment codes"), "PR-2");
check("and the other line still totals normally",
  bcell(badRows[1], "Line adjustments"), "20.00");

console.log("\n[14] the 837P path is untouched by any of it");
m.state.doc = doc;
rows = m.buildClaimIndex(doc.segments);
check("an 837P row carries no guide", rows.map((r) => r.guide), ["", ""]);
check("its payer column still reads NM1*PR", row(rows, 0).Payer, "INSURANCE COMPANY");
check("and its rows report no payers or adjudication",
  [rows[0].payers.length, rows[0].adj.length, rows[0].receiver], [0, 0, -1]);
// One file, both kinds: the columns appear, and the 837P rows fill in the
// ones they have rather than reading the report's.
const mixed = m.parse(pacdrRaw.replace("IEA*1*000000001~\n", "") +
  raw.split("\n").slice(1).join("\n").replace("IEA*1*000000001~", "IEA*2*000000001~"));
m.state.doc = mixed;
const both = m.buildClaimIndex(mixed.segments);
check("four rows across the two transactions", both.length, 4);
check("only the report's rows carry a guide", both.map((r) => !!r.guide), [true, true, false, false]);
check("the 837P rows do not inherit the report's payers",
  both.slice(2).map((r) => r.payers.length), [0, 0]);
check("nor its line adjudication",
  Object.fromEntries(m.claimColumns(both).slice(13, 16).map((c) => [c.label, c.get(both[2])])),
  { "Claim paid": "", "Line paid": "", "Line adjustments": "" });
m.state.doc = doc;

console.log("\n[15] an 835 produces no claim rows at all");
// No code change was made for this -- audited, not assumed. emitLine
// returns early on clm === -1, and an 835 never carries a CLM, so clm never
// leaves -1 for the whole walk: CLP, SVC, N1 and PLB all match none of
// buildClaimIndex's cases and are silently skipped.
const x221Raw = readFileSync(X221_FIXTURE, "utf8");
const x221Doc = m.parse(x221Raw);
m.state.doc = x221Doc;
const x221Rows = m.buildClaimIndex(x221Doc.segments);
check("zero rows, not a throw", x221Rows.length, 0);
check("the 837P header stays the 13 labels it has always had -- an 835 does not add columns",
  m.claimColumns(x221Rows).map((c) => c.label),
  ["Claim", "Patient", "Line", "Service date", "Procedure", "Modifiers", "Units",
   "Charge", "Diagnoses", "Place of service", "Billing provider", "Payer", "Claim total"]);
m.state.doc = doc;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
