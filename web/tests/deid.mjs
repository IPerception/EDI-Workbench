// Tests the rule behind the Create Limited Data Set button.
//
// Two properties carry the whole feature and are what most of this file is
// about:
//
//   1. One person keeps one identity. Two claims for the same member must
//      come out with the same fake name AND the same fake member id -- the
//      failure this guards against is mapping each field independently,
//      which silently breaks the patient matching the feature exists to
//      protect while still looking de-identified.
//   2. Providers are not patients. NM1*82 and NM1*DN name real people, so a
//      "looks like a human name" test would scramble them. Targeting is by
//      837P loop instead, and these tests fail if that regresses.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { APP, SAMPLES_DIR } from "./paths.mjs";

const html = readFileSync(APP, "utf8");

// The engine block is taken whole, the way validate.mjs takes it: it is
// marked off for exactly this, and it carries parse, serialize, shiftDate8
// and validateDocument together. The tree and de-identification code sits
// outside that block -- the rule depends on buildTree, which is a UI-side
// function -- so those pieces are lifted by name below.
const engineStart = html.indexOf("/* ---- document ---");
const engineEnd = html.indexOf("/* engine:end */");
if (engineStart === -1 || engineEnd === -1) throw new Error("engine markers not found");

// Lift a top-level declaration by matching its delimiters. Functions and
// classes are brace-delimited; the fake-name pools are multi-line arrays, so
// the pair is a parameter rather than hard-coded.
function lift(name, opener, open = "{", close = "}") {
  const at = html.indexOf(opener);
  if (at === -1) throw new Error("not found: " + name);
  let depth = 0, i = html.indexOf(open, at);
  for (; i < html.length; i++) {
    if (html[i] === open) depth++;
    else if (html[i] === close) { depth--; if (depth === 0) return html.slice(at, i + 1); }
  }
  throw new Error("unbalanced: " + name);
}

const liftArray = (name) => lift(name, `const ${name} = [`, "[", "]");

function liftLine(name) {
  const m = html.match(new RegExp("^const " + name + " = [^\\n]*?;", "m"));
  if (!m) throw new Error("not found: " + name);
  return m[0];
}

const src = [
  html.slice(engineStart, engineEnd),
  lift("GROUP_RANK", "const GROUP_RANK = {") + ";",
  lift("TRAILER_RANK", "const TRAILER_RANK = {") + ";",
  liftLine("HL_RANK"),
  liftLine("HL_RANK_MAX"),
  liftLine("ENTITY_RANK"),
  lift("HL_LOOPS", "const HL_LOOPS = {") + ";",
  lift("ENTITY_LOOPS", "const ENTITY_LOOPS = {") + ";",
  lift("ANCHOR_LOOPS", "const ANCHOR_LOOPS = {") + ";",
  lift("SEGMENT_NAMES", "const SEGMENT_NAMES = {") + ";",
  lift("QUALIFIERS", "const QUALIFIERS = {") + ";",
  lift("enclosingLoop", "function enclosingLoop(stack)"),
  lift("segmentRole", "function segmentRole(seg)"),
  lift("buildTree", "function buildTree(segments)"),
  liftLine("PERSON_LOOPS"),
  liftArray("FAKE_SURNAMES") + ";",
  liftArray("FAKE_GIVEN") + ";",
  liftArray("FAKE_STREETS") + ";",
  liftLine("STREET_TYPES"),
  lift("mulberry32", "function mulberry32(seed)"),
  lift("reshapeId", "function reshapeId(value, rand)"),
  lift("DeidentifyRule", "class DeidentifyRule {"),
  "export { DeidentifyRule, parse, serialize, validateDocument, buildTree, reshapeId, mulberry32, PERSON_LOOPS };",
].join("\n");

const m = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));

let pass = 0, fail = 0;
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log(`  FAIL ${name}\n       expected ${JSON.stringify(expected)}\n       actual   ${JSON.stringify(actual)}`); }
};

/* --- fixture ---------------------------------------------------------
 * Written out here rather than read from a sample file because these tests
 * are about specific adversarial shapes: the same member appearing in two
 * claims, a patient distinct from the subscriber, providers who are natural
 * persons, and an other-payer loop naming the same human a third time.
 */
const SEGMENTS = [
  "ISA*00*          *00*          *ZZ*SUBMITTERID    *ZZ*RECEIVERID     *230101*1200*^*00501*000000001*0*T*:",
  "GS*HC*SENDER*RECEIVER*20230101*1200*1*X*005010X222A1",
  "ST*837*0001*005010X222A1",
  "BHT*0019*00*REF01*20230101*1200*CH",
  // 1000A / 1000B: submitter and receiver, both provider-side
  "NM1*41*2*BIG CLINIC BILLING*****46*SUBMITTERID",
  "PER*IC*JANE ADMIN*TE*5551234567*EM*jane.admin@bigclinic.example",
  "NM1*40*2*ACME PAYER*****46*RECEIVERID",
  // 2000A / 2010AA: billing provider -- a real person, must survive
  "HL*1**20*1",
  "NM1*85*1*WHITFIELD*ANNA*R***XX*1234567893",
  "N3*500 MEDICAL PARKWAY",
  "N4*COLUMBUS*OH*43215",
  "REF*EI*123456789",
  // 2000B / 2010BA: subscriber -- a patient, must be replaced
  "HL*2*1*22*1",
  "SBR*P*18*******CI",
  "NM1*IL*1*MACDONALD*ROBERT*T***MI*W123456789",
  "N3*42 CHERRY TREE LANE*APT 3B",
  "N4*COLUMBUS*OH*43215",
  "DMG*D8*19800115*M",
  "REF*SY*123456789",
  "PER*IC*ROBERT MACDONALD*TE*6145550101*EM*rmacdonald@example.com",
  "NM1*PR*2*ACME PAYER*****PI*12345",
  // claim 1 for the subscriber
  "CLM*ACCT0001*250***11:B:1*Y*A*Y*Y",
  "REF*EA*MRN0099887",
  "DTP*431*D8*20230103",
  "NM1*DN*1*FEATHERSTONE*MARCUS****XX*1987654321",
  "LX*1",
  "SV1*HC:99213*150*UN*1***1",
  "DTP*472*D8*20230105",
  "LX*2",
  "SV1*HC:99214*100*UN*1***1",
  "DTP*472*RD8*20230105-20230107",
  // claim 2 for the SAME subscriber: the consistency test
  "CLM*ACCT0002*80***11:B:1*Y*A*Y*Y",
  "DTP*431*D8*20230201",
  "NM1*82*1*OKONKWO*ADAEZE****XX*1122334455",
  "LX*1",
  "SV1*HC:99212*80*UN*1***1",
  "DTP*472*D8*20230210",
  // 2000C / 2010CA: a patient who is not the subscriber
  "HL*3*2*23*0",
  "PAT*19",
  "NM1*QC*1*MACDONALD*SUZETTE*Q",
  "N3*42 CHERRY TREE LANE",
  "N4*COLUMBUS*OH*43215",
  "DMG*D8*20140620*F",
  "CLM*ACCT0003*40***11:B:1*Y*A*Y*Y",
  "DTP*431*D8*20230301",
  // 2320 / 2330A: the subscriber named a third time, under another payer.
  // 2320 precedes the service lines in 837P, which is what puts it inside
  // the claim rather than inside loop 2400.
  "SBR*S*18*******CI",
  "NM1*IL*1*MACDONALD*ROBERT*T***MI*W123456789",
  "NM1*PR*2*OTHER PAYER*****PI*67890",
  "DTP*573*D8*20230315",
  "LX*1",
  "SV1*HC:99391*40*UN*1***1",
  "DTP*472*D8*20230305",
  "SE*52*0001",
  "GE*1*1",
  "IEA*1*000000001",
];
const RAW = SEGMENTS.join("~") + "~";

// Runs the rule and hands back both the original and the rewritten document,
// paired by index -- the rule only ever rewrites element values, so the two
// stay aligned segment for segment.
function runDeid(seed = 7, raw = RAW) {
  const before = m.parse(raw);
  const after = m.parse(raw);
  const rule = new m.DeidentifyRule(seed);
  const result = rule.apply(after.segments);
  return { before: before.segments, after: after.segments, result, rule, doc: after };
}

// Every segment matching an id, as arrays of elements.
const allOf = (segments, id, where = () => true) =>
  segments.filter((s) => s.id === id && where(s)).map((s) => s.elements);

const { before, after, result } = runDeid();

console.log("\n[1] the file still parses and keeps its shape");
check("segment count is unchanged", after.length, before.length);
check("segment ids are unchanged", after.map((s) => s.id), before.map((s) => s.id));
check("element counts are unchanged", after.map((s) => s.elements.length), before.map((s) => s.elements.length));
const reparsed = m.parse(m.serialize({
  segments: after,
  elementSep: "*", componentSep: ":", segmentTerminator: "~", repetitionSep: "^",
}));
check("output re-parses to the same segments", reparsed.segments.length, after.length);
check("no value picked up a delimiter",
  after.flatMap((s) => s.elements).filter((v) => /[*~]/.test(v)).length, 0);

console.log("\n[2] the envelope is untouched");
for (const id of ["ISA", "GS", "ST", "BHT", "SE", "GE", "IEA"]) {
  const i = before.findIndex((s) => s.id === id);
  check(`${id} is byte-identical`, after[i].elements, before[i].elements);
}

console.log("\n[3] providers are left real");
// 2010AA billing provider: a natural person with a name, address and tax id.
const billingBefore = before.find((s) => s.id === "NM1" && s.elements[0] === "85");
const billingAfter = after.find((s) => s.id === "NM1" && s.elements[0] === "85");
check("billing provider name is untouched", billingAfter.elements, billingBefore.elements);
check("billing provider street is untouched",
  after[before.indexOf(billingBefore) + 1].elements,
  before[before.indexOf(billingBefore) + 1].elements);
check("provider tax id (REF*EI) is untouched",
  allOf(after, "REF", (s) => s.elements[0] === "EI"),
  allOf(before, "REF", (s) => s.elements[0] === "EI"));
// The two that a name-shape heuristic would get wrong.
check("referring provider NM1*DN is untouched",
  allOf(after, "NM1", (s) => s.elements[0] === "DN"),
  allOf(before, "NM1", (s) => s.elements[0] === "DN"));
check("rendering provider NM1*82 is untouched",
  allOf(after, "NM1", (s) => s.elements[0] === "82"),
  allOf(before, "NM1", (s) => s.elements[0] === "82"));
check("submitter and receiver are untouched",
  allOf(after, "NM1", (s) => s.elements[0] === "41" || s.elements[0] === "40"),
  allOf(before, "NM1", (s) => s.elements[0] === "41" || s.elements[0] === "40"));
check("the submitter's PER contact is untouched",
  after[5].elements, before[5].elements);
check("the payer NM1*PR is untouched",
  allOf(after, "NM1", (s) => s.elements[0] === "PR"),
  allOf(before, "NM1", (s) => s.elements[0] === "PR"));

console.log("\n[4] patients are replaced");
const subBefore = before.find((s) => s.id === "NM1" && s.elements[0] === "IL");
const subAfter = after.find((s) => s.id === "NM1" && s.elements[0] === "IL");
check("subscriber surname is replaced", subAfter.elements[2] !== subBefore.elements[2], true);
check("subscriber given name is replaced", subAfter.elements[3] !== subBefore.elements[3], true);
check("subscriber member id is replaced", subAfter.elements[8] !== subBefore.elements[8], true);
check("subscriber qualifier and entity type are kept",
  [subAfter.elements[0], subAfter.elements[1], subAfter.elements[7]],
  [subBefore.elements[0], subBefore.elements[1], subBefore.elements[7]]);
const patAfter = after.find((s) => s.id === "NM1" && s.elements[0] === "QC");
check("patient name is replaced",
  patAfter.elements[2] !== "MACDONALD" && patAfter.elements[3] !== "SUZETTE", true);
check("SSN (REF*SY) is replaced",
  allOf(after, "REF", (s) => s.elements[0] === "SY")[0][1] !== "123456789", true);
check("medical record number (REF*EA) is replaced",
  allOf(after, "REF", (s) => s.elements[0] === "EA")[0][1] !== "MRN0099887", true);
check("patient account numbers are replaced",
  allOf(after, "CLM").map((e) => e[0]).some((v) => v.startsWith("ACCT")), false);
const perAfter = after.find((s, i) => s.id === "PER" && i > before.indexOf(subBefore));
check("patient phone is replaced", perAfter.elements[3] !== "6145550101", true);
check("patient email is replaced and is unroutable",
  perAfter.elements[5] !== "rmacdonald@example.com" && perAfter.elements[5].endsWith("@example.invalid"), true);
check("PER contact-type qualifiers are kept",
  [perAfter.elements[0], perAfter.elements[2], perAfter.elements[4]], ["IC", "TE", "EM"]);

console.log("\n[5] identifiers keep their shape");
check("member id keeps its length", subAfter.elements[8].length, subBefore.elements[8].length);
check("member id keeps its letter/digit pattern",
  subAfter.elements[8].replace(/[A-Z]/g, "A").replace(/\d/g, "9"),
  subBefore.elements[8].replace(/[A-Z]/g, "A").replace(/\d/g, "9"));
check("a 9-digit SSN stays 9 digits",
  /^\d{9}$/.test(allOf(after, "REF", (s) => s.elements[0] === "SY")[0][1]), true);
check("reshapeId preserves punctuation and case classes",
  m.reshapeId("AB-123", m.mulberry32(1)).replace(/[A-Z]/g, "A").replace(/\d/g, "9"), "AA-999");
check("reshapeId never emits the letter O, which reads as a zero",
  m.reshapeId("X".repeat(400), m.mulberry32(3)).includes("O"), false);

console.log("\n[6] one person, one identity -- the property that matters");
// The same member appears three times: as the subscriber, and again in the
// 2330A other-subscriber loop. All three must agree, in name AND in id.
const ils = allOf(after, "NM1", (s) => s.elements[0] === "IL");
check("the same member appears twice in the fixture", ils.length, 2);
check("both get the same fake surname", ils[0][2], ils[1][2]);
check("both get the same fake given name", ils[0][3], ils[1][3]);
check("both get the same fake member id -- not just the same name", ils[0][8], ils[1][8]);
check("the other-subscriber loop was actually rewritten", ils[1][2] !== "MACDONALD", true);
// The patient is a different person and must not collapse into the subscriber.
check("the patient gets a different identity from the subscriber",
  patAfter.elements[2] !== ils[0][2] || patAfter.elements[3] !== ils[0][3], true);
// Distinct claims must stay distinct: folding CLM-01 into the persona would
// give one patient's three claims a single account number.
const accounts = allOf(after, "CLM").map((e) => e[0]);
check("three claims come out with three distinct account numbers",
  new Set(accounts).size, 3);
check("account numbers keep their shape",
  accounts.every((a) => a.length === "ACCT0001".length), true);

console.log("\n[7] dates shift together, and keep their intervals");
const dtpBefore = allOf(before, "DTP");
const dtpAfter = allOf(after, "DTP");
check("every claim date moved", dtpAfter.every((e, i) => e[2] !== dtpBefore[i][2]), true);
const days = (a, b) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(4, 6) - 1, +b.slice(6, 8)) -
  Date.UTC(+a.slice(0, 4), +a.slice(4, 6) - 1, +a.slice(6, 8))) / 86400000);
// Claim 1: onset 20230103, line 1 service 20230105 -- two days apart.
check("interval between onset and service date is preserved",
  days(dtpAfter[0][2], dtpAfter[1][2]), days(dtpBefore[0][2], dtpBefore[1][2]));
// Every date inside one claim must move by the SAME offset, which is what
// freezing the owner at the claim buys.
const offsetsInClaim1 = [0, 1].map((i) => days(dtpBefore[i][2], dtpAfter[i][2]));
check("one offset across the whole claim", new Set(offsetsInClaim1).size, 1);
check("the offset is not zero", offsetsInClaim1[0] !== 0, true);
check("date format qualifiers are kept", dtpAfter.map((e) => e[1]), dtpBefore.map((e) => e[1]));
// RD8 ranges: shiftDate8 rejects them outright, so both halves are handled
// explicitly. Left alone, an unshifted range would sit next to shifted dates.
const rd8Before = dtpBefore.find((e) => e[1] === "RD8")[2];
const rd8After = dtpAfter.find((e) => e[1] === "RD8")[2];
check("an RD8 range is still a range", /^\d{8}-\d{8}$/.test(rd8After), true);
check("both halves of the range moved by the same offset",
  days(rd8Before.split("-")[0], rd8After.split("-")[0]),
  days(rd8Before.split("-")[1], rd8After.split("-")[1]));
check("the range moved by the claim's offset",
  days(rd8Before.split("-")[0], rd8After.split("-")[0]), offsetsInClaim1[0]);
check("date of birth moved too",
  allOf(after, "DMG")[0][1] !== allOf(before, "DMG")[0][1], true);
check("date of birth is still a valid D8", /^\d{8}$/.test(allOf(after, "DMG")[0][1]), true);
check("DMG qualifiers and gender are kept",
  [allOf(after, "DMG")[0][0], allOf(after, "DMG")[0][2]], ["D8", "M"]);
// The subscriber's two claims share one offset; the patient's claim has its
// own, because it belongs to a different person.
const subscriberOffset = days(dtpBefore[0][2], dtpAfter[0][2]);
const patientClaimIdx = dtpBefore.findIndex((e) => e[2] === "20230301");
check("the patient's claim shifts by the patient's own offset, not the subscriber's",
  days(dtpBefore[patientClaimIdx][2], dtpAfter[patientClaimIdx][2]) !== subscriberOffset, true);

console.log("\n[8] a Limited Data Set keeps what an LDS is allowed to keep");
check("city, state and ZIP (N4) are all untouched",
  allOf(after, "N4"), allOf(before, "N4"));
check("street lines (N3) are all replaced",
  allOf(after, "N3").filter((e, i) => e[0] === allOf(before, "N3")[i][0]).length,
  1); // only the billing provider's, which is not a patient
check("a second address line is dropped rather than kept",
  allOf(after, "N3").find((e) => e.length > 1)[1], "");
check("procedure codes and charges are untouched",
  allOf(after, "SV1"), allOf(before, "SV1"));
check("diagnosis and claim amounts are untouched",
  allOf(after, "CLM").map((e) => e.slice(1)), allOf(before, "CLM").map((e) => e.slice(1)));

console.log("\n[9] the change record the UI paints from");
check("every mark points at a segment that really changed",
  result.marks.every(({ segment, elements }) =>
    elements.every((el) => after[segment].elements[el] !== before[segment].elements[el])), true);
check("every changed segment is marked",
  after.map((s, i) => i).filter((i) => JSON.stringify(after[i].elements) !== JSON.stringify(before[i].elements))
    .every((i) => result.marks.some((mk) => mk.segment === i)), true);
check("marks are in document order",
  result.marks.map((mk) => mk.segment).every((v, i, a) => i === 0 || a[i - 1] < v), true);
check("segments count matches the marks", result.segments, result.marks.length);
check("occurrences counts elements, not segments",
  result.occurrences, result.marks.reduce((n, mk) => n + mk.elements.length, 0));
check("no element is marked twice", result.marks.every((mk) => new Set(mk.elements).size === mk.elements.length), true);

console.log("\n[10] the mapping is per-run, and nothing is kept");
const a = runDeid(7), b = runDeid(7), c = runDeid(99);
check("the same seed reproduces the same file",
  a.after.map((s) => s.elements.join("*")), b.after.map((s) => s.elements.join("*")));
check("a different seed produces different people",
  c.after.find((s) => s.id === "NM1" && s.elements[0] === "IL").elements[2] !==
  a.after.find((s) => s.id === "NM1" && s.elements[0] === "IL").elements[2], true);
check("the rule exposes no mapping once it has run",
  Object.keys(new m.DeidentifyRule(1)).filter((k) => k === "people" || k === "accounts").length, 2);
check("and that mapping is local to the rule object, not a module global",
  typeof globalThis.people, "undefined");

console.log("\n[11] identity keying falls back when there is no member id");
// A patient with no NM1-09 must still be recognised as one person across
// appearances -- name plus date of birth is the fallback key.
const noIdRaw = [
  "ISA*00*          *00*          *ZZ*S              *ZZ*R              *230101*1200*^*00501*000000001*0*T*:",
  "GS*HC*S*R*20230101*1200*1*X*005010X222A1",
  "ST*837*0001*005010X222A1",
  "HL*1**20*1",
  "NM1*85*2*CLINIC*****XX*1234567893",
  "HL*2*1*22*0",
  "SBR*P*18*******CI",
  "NM1*IL*1*BLAKE*HENRY",
  "DMG*D8*19750808*M",
  "CLM*A1*100***11:B:1*Y*A*Y*Y",
  "LX*1",
  "SV1*HC:99213*100*UN*1***1",
  "DTP*472*D8*20230105",
  "SE*11*0001",
  "GE*1*1",
  "IEA*1*000000001",
].join("~") + "~";
const noId = runDeid(5, noIdRaw);
const blake = noId.after.find((s) => s.id === "NM1" && s.elements[0] === "IL");
check("a subscriber with no member id is still replaced", blake.elements[2] !== "BLAKE", true);
check("and no empty member id is invented", blake.elements.length, 4);
check("their date of birth still shifts",
  noId.after.find((s) => s.id === "DMG").elements[1] !== "19750808", true);

console.log("\n[12] nothing to do is not an error");
const noPatients = runDeid(5, [
  "ISA*00*          *00*          *ZZ*S              *ZZ*R              *230101*1200*^*00501*000000001*0*T*:",
  "GS*HC*S*R*20230101*1200*1*X*005010X222A1",
  "ST*837*0001*005010X222A1",
  "HL*1**20*1",
  "NM1*85*2*CLINIC*****XX*1234567893",
  "SE*4*0001",
  "GE*1*1",
  "IEA*1*000000001",
].join("~") + "~");
check("a file with no patient loops comes out unchanged", noPatients.result.marks, []);
check("and reports no occurrences", noPatients.result.occurrences, 0);

console.log("\n[13] the loops the rule targets");
check("exactly the three patient-side name loops", [...m.PERSON_LOOPS].sort(), ["2010BA", "2010CA", "2330A"]);

console.log("\n[14] the committed manual-test samples");
// These are what someone runs the Limited Data Set on by hand, so they have to be
// worth clicking: clean before the run, and still clean after it. A file that
// starts reporting findings once de-identified would send whoever is testing
// looking for a bug in the wrong place.
const sampleDir = join(SAMPLES_DIR, "deid");
const sampleFiles = readdirSync(sampleDir).filter((f) => f.endsWith(".edi")).sort();
check("all four samples are present", sampleFiles,
  ["awkward_values.edi", "no_patient_loops.edi", "patient_and_cob.edi", "repeat_patient.edi"]);

const samples = {};
for (const name of sampleFiles) {
  const text = readFileSync(join(sampleDir, name), "utf8");
  check(`${name} validates cleanly before the run`,
    m.validateDocument(m.parse(text)).map((f) => f.title), []);

  const doc = m.parse(text);
  const res = new m.DeidentifyRule(42).apply(doc.segments);
  samples[name] = { doc, res };

  const round = m.parse(m.serialize(doc));
  check(`${name} still parses after the run`, round.segments.length, doc.segments.length);
  check(`${name} validates cleanly after the run`,
    m.validateDocument(round).map((f) => f.title), []);
  check(`${name} keeps its segment count`, round.segments.length, m.parse(text).segments.length);
}

// Each file exists for one property; assert the property, not just that the
// file loads, or the samples can quietly stop exercising what they name.
const repeat = samples["repeat_patient.edi"];
check("repeat_patient: four claims, four distinct account numbers",
  new Set(allOf(repeat.doc.segments, "CLM").map((e) => e[0])).size, 4);
check("repeat_patient: still exactly one subscriber identity",
  new Set(allOf(repeat.doc.segments, "NM1", (s) => s.elements[0] === "IL")
    .map((e) => e[2] + "|" + e[3] + "|" + e[8])).size, 1);
check("repeat_patient: the one medical record number maps to one value",
  new Set(allOf(repeat.doc.segments, "REF", (s) => s.elements[0] === "EA").map((e) => e[1])).size, 1);
check("repeat_patient: the billing provider is untouched",
  repeat.doc.segments.find((s) => s.id === "NM1" && s.elements[0] === "85").elements[2], "WHITFIELD");

const cob = samples["patient_and_cob.edi"];
const cobIls = allOf(cob.doc.segments, "NM1", (s) => s.elements[0] === "IL");
check("patient_and_cob: the subscriber appears twice", cobIls.length, 2);
check("patient_and_cob: both appearances agree", cobIls[0], cobIls[1]);
check("patient_and_cob: the patient is a different person",
  cob.doc.segments.find((s) => s.id === "NM1" && s.elements[0] === "QC").elements[2] !== cobIls[0][2], true);
check("patient_and_cob: referring and rendering providers are untouched",
  allOf(cob.doc.segments, "NM1", (s) => s.elements[0] === "DN" || s.elements[0] === "82")
    .map((e) => e[2]), ["FEATHERSTONE", "OKONKWO", "FEATHERSTONE", "OKONKWO"]);

check("no_patient_loops: nothing is changed", samples["no_patient_loops.edi"].res.marks, []);

const awkward = samples["awkward_values.edi"];
check("awkward_values: the member-id-less subscriber is still replaced",
  awkward.doc.segments.find((s) => s.id === "NM1" && s.elements[0] === "IL").elements[2] !== "BLAKE", true);
const awkwardDtps = allOf(awkward.doc.segments, "DTP");
check("awkward_values: the RD8 range is still a range",
  /^\d{8}-\d{8}$/.test(awkwardDtps.find((e) => e[1] === "RD8")[2]), true);
// An impossible date is skipped rather than failing the file -- the same
// contract the service-date shift rule has kept since round 1.
check("awkward_values: the impossible date is left alone",
  awkwardDtps.some((e) => e[2] === "20231301"), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
