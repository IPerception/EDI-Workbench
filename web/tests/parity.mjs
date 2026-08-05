// Lifts the engine out of EDIWorkbench.html and checks it against the
// Python edi_engine's behaviour + the assertions in tests/test_rules.py.
import { readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { APP, FIXTURE, MAKE_REF, REF_DIR } from "./paths.mjs";

const html = readFileSync(APP, "utf8");

// The reference output has to come from the Python engine itself -- that is
// the whole point of this suite. Generate it on demand so the harness is a
// single command; pass a path as argv[2] to reuse an existing one instead.
function pythonReference() {
  if (process.argv[2]) return readFileSync(process.argv[2], "utf8");

  rmSync(REF_DIR, { recursive: true, force: true }); // stale runs leave dated files behind
  let printed;
  try {
    printed = execFileSync("python", [MAKE_REF, REF_DIR], { encoding: "utf8" }).trim();
  } catch (e) {
    throw new Error(
      "Could not run the Python engine to produce a reference output.\n" +
      "Install Python, or pass a pre-generated reference: node parity.mjs <path>\n" +
      "Underlying error: " + (e.stderr || e.message)
    );
  }
  return readFileSync(printed, "utf8");
}

const start = html.indexOf("/* ---- document ---");
const end = html.indexOf("/* engine:end */");
if (start === -1 || end === -1) throw new Error("engine markers not found");
const source = html.slice(start, end);

const engine = await import(
  "data:text/javascript;base64," +
  Buffer.from(source + "\nexport { parse, serialize, detectDelimiters, splitComponents, processText, buildOutputName, Dtp472ServiceLineShiftRule, StringReplaceRule, shiftDate8 };").toString("base64")
);

const {
  parse, serialize, processText, buildOutputName, splitComponents,
  Dtp472ServiceLineShiftRule, StringReplaceRule,
} = engine;

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       expected ${JSON.stringify(expected)}\n       actual   ${JSON.stringify(actual)}`); }
}

const raw = readFileSync(FIXTURE, "utf8");
const pythonOut = pythonReference();

console.log("\n[1] round trip + delimiter detection");
const doc = parse(raw);
check("serialize(parse(raw)) is byte-faithful", serialize(doc) === raw, true);
check("segment count", doc.segments.length, 31);
check("delimiters", [doc.elementSep, doc.componentSep, doc.segmentTerminator], ["*", ":", "~"]);
check("leading whitespace preserved on segment 2", JSON.stringify(doc.segments[1].leadingWs), JSON.stringify(raw.includes("\r\n") ? "\r\n" : "\n"));

console.log("\n[2] parity with Python process() on the fixture");
const shifted = processText(raw, [new Dtp472ServiceLineShiftRule(1)]);
check("output matches Python byte for byte", shifted.output === pythonOut, true);
check("segments changed", shifted.changes.length, 2);
check("DTP*472*D8*20230102 count", (shifted.output.match(/DTP\*472\*D8\*20230102~/g) || []).length, 2);
check("no un-shifted service dates remain", shifted.output.includes("DTP*472*D8*20230101~"), false);

console.log("\n[3] ported assertions from tests/test_rules.py");
const seg = (id, ...elements) => ({ id, elements, leadingWs: "" });

let s = [seg("CLM", "ACCT", "150"), seg("DTP", "472", "D8", "20230101"), seg("LX", "1"),
         seg("DTP", "472", "D8", "20230101"), seg("SE", "10", "0001")];
let r = new Dtp472ServiceLineShiftRule(1).apply(s);
check("only shifts inside a service line: count", r.segments, 1);
check("claim-level DTP untouched", s[1].elements[2], "20230101");
check("service-line DTP shifted", s[3].elements[2], "20230102");

s = [seg("LX", "1"), seg("DTP", "434", "D8", "20230101"), seg("DTP", "472", "RD8", "20230101-20230102")];
check("ignores other qualifiers and formats", new Dtp472ServiceLineShiftRule(1).apply(s).segments, 0);

s = [seg("LX", "1"), seg("DTP", "472", "D8", "20231231")];
new Dtp472ServiceLineShiftRule(1).apply(s);
check("year rollover", s[1].elements[2], "20240101");

s = [seg("LX", "1"), seg("DTP", "472", "D8", "20240228")];
new Dtp472ServiceLineShiftRule(1).apply(s);
check("leap year", s[1].elements[2], "20240229");

s = [seg("LX", "1"), seg("DTP", "472", "D8", "20230101"), seg("SE", "10", "0001"), seg("DTP", "472", "D8", "20230101")];
r = new Dtp472ServiceLineShiftRule(1).apply(s);
check("SE closes the loop: count", r.segments, 1);
check("after SE untouched", s[3].elements[2], "20230101");

console.log("\n[4] date-shift edge cases beyond the Python suite");
s = [seg("LX", "1"), seg("DTP", "472", "D8", "20230230")];
check("impossible date (Feb 30) is skipped", new Dtp472ServiceLineShiftRule(1).apply(s).segments, 0);
check("impossible date left as-is", s[1].elements[2], "20230230");

s = [seg("LX", "1"), seg("DTP", "472", "D8", "2023010")];
check("short date skipped", new Dtp472ServiceLineShiftRule(1).apply(s).segments, 0);

s = [seg("LX", "1"), seg("DTP", "472", "D8", "20230301")];
new Dtp472ServiceLineShiftRule(-1).apply(s);
check("negative shift crosses month backwards", s[1].elements[2], "20230228");

s = [seg("LX", "1"), seg("DTP", "472", "D8", "20240101")];
new Dtp472ServiceLineShiftRule(-1).apply(s);
check("negative shift crosses year backwards", s[1].elements[2], "20231231");

console.log("\n[5] string replace");
let out = processText(raw, [new StringReplaceRule({ find: "DOE", replace: "SMITH" })]);
check("replaces subscriber last name", out.output.includes("NM1*IL*1*SMITH*JOHN****MI*123456789A~"), true);
check("one segment changed", out.changes.length, 1);
check("one occurrence", out.summary[0].occurrences, 1);

out = processText(raw, [new StringReplaceRule({ find: "anytown", replace: "METROPOLIS", caseSensitive: false })]);
check("case-insensitive hits both N4 segments", out.changes.length, 2);
check("case-insensitive result", (out.output.match(/METROPOLIS/g) || []).length, 2);

out = processText(raw, [new StringReplaceRule({ find: "ANYTOWN", replace: "X", caseSensitive: true })]);
check("case-sensitive still matches uppercase", out.changes.length, 2);

out = processText(raw, [new StringReplaceRule({ find: "anytown", replace: "X", caseSensitive: true })]);
check("case-sensitive misses lowercase needle", out.changes.length, 0);

out = processText(raw, [new StringReplaceRule({ find: "90210", replace: "10001", segmentIds: ["N4"] })]);
check("segment scope limits the blast radius", out.changes.length, 2);
out = processText(raw, [new StringReplaceRule({ find: "90210", replace: "10001", segmentIds: ["REF"] })]);
check("scope that matches nothing changes nothing", out.changes.length, 0);

out = processText(raw, [new StringReplaceRule({ find: "1", replace: "9", wholeElement: true, segmentIds: ["LX"] })]);
check("whole-element replaces LX*1 only", out.output.includes("LX*9~"), true);
check("whole-element leaves LX*2 alone", out.output.includes("LX*2~"), true);
check("whole-element does not touch substrings", out.output.includes("SV1*HC:99213*100*UN*1***1~"), true);

// The ISA header is fixed-width: a length change there breaks the interchange.
out = processText(raw, [new StringReplaceRule({ find: "SUBMITTERID", replace: "NEWID" })]);
check("ISA line untouched", out.output.split("\n")[0], raw.split("\n")[0].replace(/\r$/, ""));
// SUBMITTERID appears twice outside the ISA header: GS02 and the NM1*41 loop.
check("GS and NM1 still updated", (out.output.match(/NEWID/g) || []).length, 2);
// The one left behind is ISA06, the fixed-width sender ID.
check("ISA occurrence deliberately skipped", (out.output.match(/SUBMITTERID/g) || []).length, 1);

console.log("\n[6] delimiter guards");
function expectThrow(name, fn, fragment) {
  try { fn(); fail++; console.log(`  FAIL ${name} — no error thrown`); }
  catch (e) {
    if (e.message.includes(fragment)) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name} — wrong error: ${e.message}`); }
  }
}
expectThrow("replacement containing '*' is rejected",
  () => processText(raw, [new StringReplaceRule({ find: "DOE", replace: "A*B" })]), "element separator");
expectThrow("replacement containing '~' is rejected",
  () => processText(raw, [new StringReplaceRule({ find: "DOE", replace: "A~B" })]), "segment terminator");
expectThrow("search text containing '*' is rejected",
  () => processText(raw, [new StringReplaceRule({ find: "IL*1", replace: "X" })]), "element separator");
expectThrow("non-ISA file is rejected",
  () => processText("GS*HC*A*B~", []), "does not start with an ISA segment");
expectThrow("truncated ISA is rejected",
  () => processText("ISA*00*  *00*~", []), "expected 16 elements");

// Component separator is legal inside an element value, so it must be allowed.
out = processText(raw, [new StringReplaceRule({ find: "J209", replace: "E11:9" })]);
check("component separator allowed in replacement", out.output.includes("HI*ABK:E11:9~"), true);

console.log("\n[7] non-standard delimiters");
const pipe = "ISA|00|          |00|          |ZZ|SUB            |ZZ|RCV            |230101|1200|^|00501|000000001|0|T|>\nLX|1\nDTP|472|D8|20230101\nSE|4|0001\n";
const pd = parse(pipe);
check("element separator detected", pd.elementSep, "|");
check("component separator detected", pd.componentSep, ">");
check("segment terminator detected", pd.segmentTerminator, "\n");
check("pipe/newline file round trips", serialize(pd) === pipe, true);
const pipeOut = processText(pipe, [new Dtp472ServiceLineShiftRule(1)]);
check("rules work on pipe-delimited file", pipeOut.output.includes("DTP|472|D8|20230102"), true);
expectThrow("newline terminator is guarded in replacements",
  () => processText(pipe, [new StringReplaceRule({ find: "SUB", replace: "A\nB" })]), "segment terminator");

console.log("\n[8] both rules together");
out = processText(raw, [
  new Dtp472ServiceLineShiftRule(7),
  new StringReplaceRule({ find: "DOE", replace: "SMITH" }),
]);
check("changes from both rules", out.changes.length, 3);
check("date shifted a week", (out.output.match(/DTP\*472\*D8\*20230108~/g) || []).length, 2);
check("name replaced", out.output.includes("*SMITH*"), true);
check("summary has both rules", out.summary.map((x) => x.name), ["dtp472_service_line_shift", "string_replace"]);

console.log("\n[9] output naming");
check("matches naming.py pattern", /^sample_837p_processed_\d{8}-\d{6}\.edi$/.test(buildOutputName("sample_837p.edi")), true);
check("extensionless input gets .edi", /^claims_processed_\d{8}-\d{6}\.edi$/.test(buildOutputName("claims")), true);
check("dotfile is treated as a stem", /^\.ediignore_processed_\d{8}-\d{6}\.edi$/.test(buildOutputName(".ediignore")), true);

console.log("\n[10] composite elements");
check("splitComponents returns null for a simple element", splitComponents("99213", ":"), null);
check("splitComponents splits a composite", splitComponents("HC:99213:25", ":"), ["HC", "99213", "25"]);
check("splitComponents tolerates a null separator", splitComponents("HC:99213", null), null);
check("trailing empty component is preserved", splitComponents("ABK:", ":"), ["ABK", ""]);

// Composites must survive parse -> serialize untouched: they are stored as
// plain strings precisely so the round trip cannot disturb them.
check("composite survives the round trip", serialize(parse(raw)) === raw, true);
const hi = parse(raw).segments.find((s) => s.id === "HI");
check("HI composite is one element, not split", hi.elements, ["ABK:J209"]);
check("HI composite splits on demand", splitComponents(hi.elements[0], ":"), ["ABK", "J209"]);

console.log("\n[11] whole-component matching");
// The point of the mode: 99213 is a component of SV1-01, not the whole
// element, so whole-element can never match it and substring is too broad.
out = processText(raw, [new StringReplaceRule({ find: "99213", replace: "99214", wholeElement: true })]);
check("whole-element cannot match inside a composite", out.changes.length, 0);

out = processText(raw, [new StringReplaceRule({ find: "99213", replace: "99214", wholeComponent: true })]);
check("whole-component matches inside a composite", out.output.includes("SV1*HC:99214*100*UN*1***1~"), true);
check("only the one segment changed", out.changes.length, 1);
check("sibling components untouched", out.output.includes("SV1*HC:87070*50*UN*1***1~"), true);

// A whole-component match on a simple element behaves like whole-element.
out = processText(raw, [new StringReplaceRule({ find: "1", replace: "9", wholeComponent: true, segmentIds: ["LX"] })]);
check("simple element still matched exactly", out.output.includes("LX*9~"), true);
check("and LX*2 left alone", out.output.includes("LX*2~"), true);

// Substring mode would also hit the "1" inside other values; component mode must not.
out = processText(raw, [new StringReplaceRule({ find: "ABK", replace: "BK", wholeComponent: true })]);
check("leading component replaced", out.output.includes("HI*BK:J209~"), true);
check("case-insensitive component match", processText(raw, [
  new StringReplaceRule({ find: "abk", replace: "BK", wholeComponent: true, caseSensitive: false }),
]).output.includes("HI*BK:J209~"), true);

expectThrow("a search spanning components is rejected",
  () => processText(raw, [new StringReplaceRule({ find: "HC:99213", replace: "X", wholeComponent: true })]),
  "component separator");

console.log("\n[12] repetition separator (ISA11, version-dependent)");
check("5010 fixture exposes the repetition separator", parse(raw).repetitionSep, "^");
check("version is read from ISA12", parse(raw).version, "00501");

// Through 4010 ISA11 is the standards identifier 'U', not a separator.
const v4010 = raw
  .replace("*^*00501*", "*U*00401*")
  .replace("005010X222A1", "004010X098A1");
check("4010 reports no repetition separator", parse(v4010).repetitionSep, null);
check("4010 version is read", parse(v4010).version, "00401");
check("4010 file still round trips", serialize(parse(v4010)) === v4010, true);

// A 5010 file is allowed to carry the 'U' placeholder too.
check("5010 with a 'U' placeholder reports none",
  parse(raw.replace("*^*00501*", "*U*00501*")).repetitionSep, null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
