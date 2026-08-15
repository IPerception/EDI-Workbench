// Tests the structural validator and the control-count repair.
//
// These matter disproportionately: a file whose SE/GE/IEA counts disagree
// with what it contains is rejected by the receiver before anyone reads a
// claim, and the failure is invisible locally.
import { readFileSync } from "node:fs";

import { APP, FIXTURE, PACDR_FIXTURE } from "./paths.mjs";

const html = readFileSync(APP, "utf8");
const start = html.indexOf("/* ---- document ---");
const end = html.indexOf("/* engine:end */");
if (start === -1 || end === -1) throw new Error("engine markers not found");

const m = await import(
  "data:text/javascript;base64," +
  Buffer.from(
    html.slice(start, end) +
    "\nexport { parse, serialize, validateDocument, repairControlCounts, toCents, centsToAmount, processText };"
  ).toString("base64")
);

let pass = 0, fail = 0;
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log(`  FAIL ${name}\n       expected ${JSON.stringify(expected)}\n       actual   ${JSON.stringify(actual)}`); }
};

const raw = readFileSync(FIXTURE, "utf8");
const titles = (text) => m.validateDocument(m.parse(text)).map((f) => f.title);

console.log("\n[1] amounts are compared as integer cents");
check("whole number", m.toCents("150"), 15000);
check("two decimal places", m.toCents("150.25"), 15025);
check("one decimal place", m.toCents("150.2"), 15020);
check("zero", m.toCents("0"), 0);
check("negative", m.toCents("-12.50"), -1250);
// The reason this exists: 0.1 + 0.2 !== 0.3 in binary floating point, so a
// float comparison would invent a discrepancy in a file that balances.
check("a sum that floats get wrong", m.toCents("0.10") + m.toCents("0.20"), m.toCents("0.30"));
check("letters are rejected", m.toCents("12A"), null);
check("empty is rejected", m.toCents(""), null);
check("a lone dot is rejected", m.toCents("."), null);
check("formatting round trips", m.centsToAmount(15025), "150.25");
check("formatting pads cents", m.centsToAmount(15000), "150.00");
check("formatting handles negatives", m.centsToAmount(-1250), "-12.50");

console.log("\n[2] the sample fixture is clean");
check("no findings at all", m.validateDocument(m.parse(raw)), []);

console.log("\n[3] transaction-level counts");
check("wrong SE-01 is caught",
  titles(raw.replace("SE*27*0001~", "SE*26*0001~")), ["Transaction segment count is wrong"]);
check("the detail names both numbers",
  m.validateDocument(m.parse(raw.replace("SE*27*0001~", "SE*26*0001~")))[0].detail,
  "SE-01 states 26 segments, but 27 are present between ST and SE inclusive.");
check("mismatched SE-02 is caught",
  titles(raw.replace("SE*27*0001~", "SE*27*0002~")), ["Transaction control numbers do not match"]);
check("a non-numeric SE-01 is caught",
  titles(raw.replace("SE*27*0001~", "SE*XX*0001~")), ["SE-01 is not a number"]);
// GE-01 counts transaction sets, which means ST segments -- removing the SE
// leaves that count correct, so the missing trailer is the only fault.
check("an unclosed transaction is caught",
  titles(raw.replace("SE*27*0001~\n", "")), ["Transaction is never closed"]);

console.log("\n[4] group and interchange counts");
check("wrong GE-01 is caught",
  titles(raw.replace("GE*1*1~", "GE*2*1~")), ["Transaction set count is wrong"]);
check("mismatched GE-02 is caught",
  titles(raw.replace("GE*1*1~", "GE*1*9~")), ["Group control numbers do not match"]);
check("wrong IEA-01 is caught",
  titles(raw.replace("IEA*1*000000001~", "IEA*3*000000001~")), ["Functional group count is wrong"]);
check("mismatched IEA-02 is caught",
  titles(raw.replace("IEA*1*000000001~", "IEA*1*000000002~")), ["Interchange control numbers do not match"]);
check("an unclosed interchange is caught",
  titles(raw.replace("IEA*1*000000001~\n", "")), ["Interchange is never closed"]);

console.log("\n[5] claim balance");
check("a balanced claim passes", titles(raw), []);
check("an unbalanced claim is caught",
  titles(raw.replace("CLM*PATIENTACCTNUM*150*", "CLM*PATIENTACCTNUM*175*")),
  ["Claim total does not match its service lines"]);
check("the detail names both totals",
  m.validateDocument(m.parse(raw.replace("CLM*PATIENTACCTNUM*150*", "CLM*PATIENTACCTNUM*175*")))[0].detail,
  "CLM-02 on claim PATIENTACCTNUM states 175.00, but its 2 service lines add up to 150.00.");
check("decimals balance too",
  titles(raw.replace("CLM*PATIENTACCTNUM*150*", "CLM*PATIENTACCTNUM*150.00*")), []);
check("a non-numeric claim total is a warning",
  titles(raw.replace("CLM*PATIENTACCTNUM*150*", "CLM*PATIENTACCTNUM*ABC*")),
  ["Claim total is not a number"]);
// An unreadable line charge makes the sum unknowable, so the total check is
// suppressed rather than reported against a total that can't be computed.
check("a non-numeric line charge warns and suppresses the total check",
  titles(raw.replace("SV1*HC:99213*100*", "SV1*HC:99213*XX*")),
  ["Service line charge is not a number"]);
check("a claim with no service lines is not flagged",
  titles(raw.replace(/LX\*1~[\s\S]*?DTP\*472\*D8\*20230101~\n/, "")
            .replace(/LX\*2~[\s\S]*?DTP\*472\*D8\*20230101~\n/, "")
            .replace("SE*27*0001~", "SE*21*0001~")), []);

console.log("\n[6] findings point at the right segment");
const seFinding = m.validateDocument(m.parse(raw.replace("SE*27*0001~", "SE*26*0001~")))[0];
check("SE finding points at the SE segment",
  m.parse(raw).segments[seFinding.segment].id, "SE");
const clmFinding = m.validateDocument(m.parse(raw.replace("CLM*PATIENTACCTNUM*150*", "CLM*PATIENTACCTNUM*175*")))[0];
check("claim finding points at the CLM segment",
  m.parse(raw).segments[clmFinding.segment].id, "CLM");

console.log("\n[7] levels");
const levels = (text) => m.validateDocument(m.parse(text)).map((f) => f.level);
check("count mismatches are errors", levels(raw.replace("SE*27*0001~", "SE*26*0001~")), ["error"]);
check("unreadable amounts are warnings",
  levels(raw.replace("CLM*PATIENTACCTNUM*150*", "CLM*PATIENTACCTNUM*ABC*")), ["warning"]);

console.log("\n[8] control-count repair");
let doc = m.parse(raw);
check("repairing a correct file changes nothing", m.repairControlCounts(doc), 0);
check("and leaves it byte-identical", m.serialize(doc) === raw, true);

doc = m.parse(raw.replace("SE*27*0001~", "SE*99*0001~"));
check("a wrong SE-01 is repaired", m.repairControlCounts(doc), 1);
check("to the real count", doc.segments.find((s) => s.id === "SE").elements[0], "27");
check("and the file then validates", m.validateDocument(doc), []);

doc = m.parse(raw.replace("SE*27*0001~", "SE*99*0001~").replace("GE*1*1~", "GE*4*1~").replace("IEA*1*000000001~", "IEA*7*000000001~"));
check("all three trailers are repaired", m.repairControlCounts(doc), 3);
check("SE-01", doc.segments.find((s) => s.id === "SE").elements[0], "27");
check("GE-01", doc.segments.find((s) => s.id === "GE").elements[0], "1");
check("IEA-01", doc.segments.find((s) => s.id === "IEA").elements[0], "1");
check("the repaired file validates clean", m.validateDocument(doc), []);
// Repair fixes counts only. A control number that disagrees with its header
// is a different fault and is deliberately left to be reported.
check("mismatched control numbers are not silently rewritten",
  m.validateDocument(m.parse(raw.replace("SE*27*0001~", "SE*27*0009~"))).length, 1);

console.log("\n[9] a run leaves the counts valid");
// Nothing in the current rule set changes the segment count, so this is the
// property that has to keep holding rather than something to be repaired.
const out = m.processText(raw, []);
check("no repair was needed", out.countsRepaired, 0);
check("output still validates", m.validateDocument(m.parse(out.output)), []);

console.log("\n[10] post-adjudicated reporting (005010X298)");
// The three checks a PACDR file adds, and -- just as important -- the two
// shapes that must NOT be reported.
const pacdr = readFileSync(PACDR_FIXTURE, "utf8");
check("the PACDR fixture is clean", m.validateDocument(m.parse(pacdr)), []);
check("a payer's claim total that disagrees with its own lines is caught",
  titles(pacdr.replace("AMT*D*240~", "AMT*D*250~")),
  ["Payer paid amount does not match its service lines"]);
check("the detail names both totals",
  m.validateDocument(m.parse(pacdr.replace("AMT*D*240~", "AMT*D*250~")))[0].detail,
  "AMT*D for payer QFHP0001 on claim PATIENTACCTNUM states 250.00, " +
  "but its 2 line adjudications add up to 240.00.");
check("an unreadable payer amount is a warning of its own",
  titles(pacdr.replace("AMT*D*45~", "AMT*D*ABC~")), ["Payer paid amount is not a number"]);
// A payer with no 2430 on some line adjudicated at claim level only, which is
// legal -- so the sum check has to stand down rather than report a shortfall.
check("a payer that did not report every line is not measured against them",
  titles(pacdr.replace("SVD*LBP0002*15*HC:87070**1~\nCAS*PR*2*5~\nDTP*573*D8*20230225~", "")
              .replace("SE*55*0001~", "SE*52*0001~")), []);
check("a line adjudication naming an unknown payer is caught",
  titles(pacdr.replace("SVD*LBP0002*30*", "SVD*NOSUCH01*30*")),
  ["Line adjudication names a payer the claim does not identify"]);
check("the detail lists the payers the claim does identify",
  m.validateDocument(m.parse(pacdr.replace("SVD*LBP0002*30*", "SVD*NOSUCH01*30*")))[0].detail,
  `SVD-01 on claim PATIENTACCTNUM is "NOSUCH01", which matches no 2330B payer id ` +
  "on this claim (QFHP0001, LBP0002).");
// Changing one adjustment breaks both 2430s on that line: the first no longer
// makes up the line charge, and the second no longer matches the patient
// responsibility the first left behind.
check("a line that no longer reconciles is caught",
  titles(pacdr.replace("CAS*PR*2*40~", "CAS*PR*2*35~")),
  ["Line adjudication does not reconcile", "Line adjudication does not reconcile"]);
check("the detail names the total, the charge, and what else it was measured against",
  m.validateDocument(m.parse(pacdr.replace("CAS*PR*2*40~", "CAS*PR*2*35~")))[0].detail,
  "SVD for payer QFHP0001 on claim PATIENTACCTNUM pays 160.00 and adjusts 35.00, " +
  "totalling 195.00, which is neither the line charge of 200.00 nor a patient " +
  "responsibility on the line (10.00).");
check("everything PACDR reports is a warning, never an error",
  levels(pacdr.replace("AMT*D*240~", "AMT*D*250~").replace("SVD*LBP0002*30*", "SVD*NOSUCH01*30*")),
  ["warning", "warning"]);

// Regression, and the reason the line rule is a choice of two rather than a
// chain from payer to payer. Both payers here adjudicate the whole charge
// independently, and the only adjustment is contractual -- so there is no
// patient responsibility to chain from, and a chained rule computes an
// expected 0 for the second payer and reports a valid file.
const independent = pacdr
  .replace("SVD*QFHP0001*160*HC:99213**1~\nCAS*PR*2*40~", "SVD*QFHP0001*0*HC:99213**1~\nCAS*CO*45*200~")
  .replace("SVD*LBP0002*30*HC:99213**1~\nCAS*PR*2*10~", "SVD*LBP0002*200*HC:99213**1~")
  .replace("AMT*D*240~", "AMT*D*80~")
  .replace("AMT*D*45~", "AMT*D*215~")
  .replace("SE*55*0001~", "SE*54*0001~");
check("two payers each adjudicating the full charge is not a discrepancy",
  titles(independent), []);

// The other half of "detected -> do more": these segments are legal in an
// ordinary 837P, where nothing about them should be looked at.
check("2430s in a file that is not a PACDR report are not checked",
  titles(raw
    .replace("DTP*472*D8*20230101~\nLX*2~",
      "DTP*472*D8*20230101~\nSVD*987654321*10*HC:99213**1~\nCAS*PR*2*1~\nLX*2~")
    .replace("SE*27*0001~", "SE*29*0001~")), []);

console.log("\n[11] amounts a PACDR file states but cannot be read");
// CAS used to be the only money field in the file that failed silently: an
// unreadable amount was dropped from the total it belonged to, and the
// shortfall then surfaced as a reconciliation failure somewhere else.
const badCas = pacdr.replace("CAS*PR*2*40~", "CAS*PR*2*XX~");
check("an unreadable adjustment is reported on its own", titles(badCas),
  ["Line adjustment amount is not a number"]);
check("the detail names the value and the claim",
  m.validateDocument(m.parse(badCas))[0].detail,
  `CAS on claim PATIENTACCTNUM reads "XX".`);
check("it points at the CAS segment",
  m.parse(badCas).segments[m.validateDocument(m.parse(badCas))[0].segment].id, "CAS");
// The whole line stands down, not just that 2430. Payers on a line are
// measured against each other's totals, so a partial one fails a payer that
// balances -- here LBP0002, whose 40.00 is exactly what QFHP0001 left behind.
check("and no payer on that line is measured against a partial total",
  m.validateDocument(m.parse(badCas)).filter((f) => f.title.startsWith("Line adjudication")), []);
// Per line, though: the rest of the claim is still checked.
check("a different line is still reconciled",
  titles(badCas.replace("CAS*PR*2*20~", "CAS*PR*2*15~")),
  ["Line adjustment amount is not a number",
   "Line adjudication does not reconcile", "Line adjudication does not reconcile"]);
check("a claim-level 2320 CAS is still not read as a line's",
  titles(pacdr.replace("AMT*D*240~", "AMT*D*240~\nCAS*CO*45*XX~").replace("SE*55*0001~", "SE*56*0001~")), []);

// SVD-02 was the last money field in the file that failed silently, and the
// consequential one: both adjudication checks stand down on a paid amount
// they cannot read, so the file reported clean while the summary went on
// claiming it had compared the very figure nothing ever read.
const badSvd = pacdr.replace("SVD*QFHP0001*160*", "SVD*QFHP0001*ABC*");
check("an unreadable paid amount is reported on its own", titles(badSvd),
  ["Line paid amount is not a number"]);
check("the detail names the payer, the claim and the value",
  m.validateDocument(m.parse(badSvd))[0].detail,
  `SVD-02 for payer QFHP0001 on claim PATIENTACCTNUM reads "ABC".`);
check("it points at the SVD segment",
  m.parse(badSvd).segments[m.validateDocument(m.parse(badSvd))[0].segment].id, "SVD");
// Unlike CAS this does not stand the whole line down: the patient
// responsibility a sibling payer is measured against comes from CAS, not
// from SVD-02, so it is still sound and LBP0002 is still answerable for it.
check("a sibling payer on the same line is still reconciled",
  titles(badSvd.replace("CAS*PR*2*40~", "CAS*PR*2*35~")),
  ["Line paid amount is not a number", "Line adjudication does not reconcile"]);

console.log("\n[12] a service line whose charge never arrives");
// The line record is opened by LX rather than by SV1, so a line missing its
// SV1 still holds its 2430s. Before that it held none, and an unknown payer
// on such a line went unreported entirely.
const noCharge = pacdr
  .replace("LX*2~\nSV1*HC:87070*100*UN*1***1~\nDTP*472*D8*20230101~\n", "LX*2~")
  .replace("CLM*PATIENTACCTNUM*300*", "CLM*PATIENTACCTNUM*200*")
  .replace("SE*55*0001~", "SE*53*0001~");
check("the line charge disjunct is dropped rather than reported against",
  m.validateDocument(m.parse(noCharge)).map((f) => f.detail),
  ["SVD for payer QFHP0001 on claim PATIENTACCTNUM pays 80.00 and adjusts 20.00, " +
   "totalling 100.00, which is not a patient responsibility on the line (5.00)."]);
check("an unknown payer on that line is still caught",
  titles(noCharge.replace("SVD*LBP0002*15*", "SVD*NOSUCH01*15*")).sort(),
  ["Line adjudication does not reconcile",
   "Line adjudication names a payer the claim does not identify"]);
// With neither a charge nor a sibling to compare against there is nothing to
// measure, so the check stands down rather than reporting against nothing.
check("a lone adjudication on a chargeless line is not reported",
  titles(noCharge.replace("SVD*LBP0002*15*HC:87070**1~\nCAS*PR*2*5~\nDTP*573*D8*20230225~", "")
                 .replace("SE*53*0001~", "SE*50*0001~"))
    .filter((t) => t === "Line adjudication does not reconcile"), []);
// A line nobody adjudicated means the claim-total comparison has no complete
// set to sum, so P1 stands down -- better than a confident wrong figure.
check("a line no payer reported stands the claim-total check down",
  titles(pacdr
    .replace("SE*55*0001~", "LX*3~\nSV1*HC:36415*50*UN*1***1~\nDTP*472*D8*20230101~\nSE*58*0001~")
    .replace("CLM*PATIENTACCTNUM*300*", "CLM*PATIENTACCTNUM*350*")), []);

console.log("\n[13] a 2320 ends where its claim's service lines begin");
// An AMT inside a service line is that line's, and used to overwrite the open
// 2320's claim-level paid amount -- which then failed against its own lines.
check("an AMT after LX does not overwrite the payer's claim-level amount",
  titles(pacdr.replace("SVD*QFHP0001*160*HC:99213**1~", "AMT*D*999~\nSVD*QFHP0001*160*HC:99213**1~")
              .replace("SE*55*0001~", "SE*56*0001~")), []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
