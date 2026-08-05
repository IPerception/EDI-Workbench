// Tests the claim table: the service-line index, the column accessors that
// read through it, PHI masking, and CSV export quoting.
import { readFileSync } from "node:fs";

import { APP, FIXTURE } from "./paths.mjs";

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
  lift("buildClaimIndex", "function buildClaimIndex(segments)"),
  lift("elAt", "function elAt(index, n)"),
  lift("nameAt", "function nameAt(index)"),
  lift("date8", "function date8(value)"),
  lift("procParts", "function procParts(index)"),
  lift("diagnosesAt", "function diagnosesAt(row)"),
  lift("posAt", "function posAt(row)"),
  lift("CLAIM_COLUMNS", "const CLAIM_COLUMNS = [") + ";",
  lift("csvCell", "function csvCell(value)"),
  "const state = { doc: null, mask: false };",
  "export { parse, buildClaimIndex, CLAIM_COLUMNS, csvCell, maskText, isPhiField, nameAt, procParts, posAt, diagnosesAt, date8, state };",
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
