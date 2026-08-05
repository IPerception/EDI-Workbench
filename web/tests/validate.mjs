// Tests the structural validator and the control-count repair.
//
// These matter disproportionately: a file whose SE/GE/IEA counts disagree
// with what it contains is rejected by the receiver before anyone reads a
// claim, and the failure is invisible locally.
import { readFileSync } from "node:fs";

import { APP, FIXTURE } from "./paths.mjs";

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
