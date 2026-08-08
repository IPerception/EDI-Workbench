// Tests the document-browser logic (outline building + qualifier decoding),
// which lives in the UI half of the file and so isn't covered by parity.mjs.
import { readFileSync } from "node:fs";

import { APP, FIXTURE } from "./paths.mjs";

const html = readFileSync(APP, "utf8");

// Lift a top-level function or const by brace/paren matching.
function lift(name, opener) {
  const at = html.indexOf(opener);
  if (at === -1) throw new Error("not found: " + name);
  let depth = 0, i = html.indexOf("{", at);
  for (; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") { depth--; if (depth === 0) return html.slice(at, i + 1); }
  }
  throw new Error("unbalanced: " + name);
}

const src = [
  lift("SEGMENT_NAMES", "const SEGMENT_NAMES = {") + ";",
  lift("QUALIFIERS", "const QUALIFIERS = {") + ";",
  lift("COMPOSITES", "const COMPOSITES = {") + ";",
  lift("compositeSpec", "function compositeSpec(segId, index)"),
  lift("buildOutline", "function buildOutline(segments)"),
  lift("claimStarts", "function claimStarts(outline)"),
  lift("segmentRole", "function segmentRole(seg)"),
  lift("splitN", "function splitN(text, sep, maxsplit)"),
  lift("detectDelimiters", "function detectDelimiters(raw)"),
  lift("splitComponents", "function splitComponents(value, componentSep)"),
  lift("parse", "function parse(raw)"),
  lift("escapeHtml", "function escapeHtml(text)"),
  lift("highlight", "function highlight(value, needle)"),
  lift("componentHtml", "function componentHtml(value, needle)"),
  lift("versionLabel", "function versionLabel(code)"),
  // componentHtml reads the live document off `state`; the app builds that
  // at load time, so the harness supplies one it can point at a fixture.
  "const state = { doc: null };",
  "export { buildOutline, claimStarts, segmentRole, parse, SEGMENT_NAMES, COMPOSITES, compositeSpec, componentHtml, versionLabel, state };",
].join("\n");

const m = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));

let pass = 0, fail = 0;
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log(`  FAIL ${name}\n       expected ${JSON.stringify(expected)}\n       actual   ${JSON.stringify(actual)}`); }
};

const raw = readFileSync(FIXTURE, "utf8");
const doc = m.parse(raw);

console.log("\n[1] outline over the sample 837P");
const outline = m.buildOutline(doc.segments);
check("nodes found", outline.map((n) => n.label), ["Transaction 0001", "Claim 1", "Line 1", "Line 2"]);
check("depths", outline.map((n) => n.depth), [0, 1, 2, 2]);
check("transaction starts at the ST segment", doc.segments[outline[0].start].id, "ST");
check("claim starts at the CLM segment", doc.segments[outline[1].start].id, "CLM");
check("line 1 starts at first LX", doc.segments[outline[2].start].id, "LX");
check("line 1 covers LX, SV1, DTP", outline[2].end - outline[2].start, 3);
check("line 2 ends at SE", doc.segments[outline[3].end].id, "SE");
check("claim range covers both service lines", outline[1].end > outline[3].start, true);
check("claim detail is the patient account number", outline[1].detail, "PATIENTACCTNUM");

console.log("\n[2] ranges are well formed");
for (const n of outline) {
  if (n.end <= n.start) { fail++; console.log(`  FAIL ${n.label} has empty range`); }
}
check("every range is non-empty", true, true);
check("every range is inside the document", outline.every((n) => n.end <= doc.segments.length), true);
// A node's children must sit inside it.
check("service lines nest inside the claim",
  outline.filter((n) => n.depth === 2).every((n) => n.start >= outline[1].start && n.end <= outline[1].end), true);

console.log("\n[3] multi-claim / multi-transaction files");
const two = raw.replace(
  "SE*27*0001~",
  "CLM*SECONDACCT*300***11:B:1*Y*A*Y*Y~\nLX*1~\nSV1*HC:99214*300*UN*1***1~\nDTP*472*D8*20230105~\nSE*32*0001~"
);
const o2 = m.buildOutline(m.parse(two).segments);
check("two claims detected", o2.filter((n) => n.depth === 1).map((n) => n.label), ["Claim 1", "Claim 2"]);
check("claim 1 closes where claim 2 opens",
  o2.find((n) => n.label === "Claim 1").end, o2.find((n) => n.label === "Claim 2").start);
check("service lines split across claims", o2.filter((n) => n.depth === 2).length, 3);

const twoSt = raw.replace("GE*1*1~", "ST*837*0002*005010X222A1~\nCLM*THIRDACCT*75***11:B:1*Y*A*Y*Y~\nSE*4*0002~\nGE*2*1~");
const o3 = m.buildOutline(m.parse(twoSt).segments);
check("two transactions detected", o3.filter((n) => n.depth === 0).map((n) => n.label), ["Transaction 0001", "Transaction 0002"]);
check("claim numbering restarts per transaction", o3.filter((n) => n.depth === 1).map((n) => n.label), ["Claim 1", "Claim 1"]);
check("transaction 1 closes at transaction 2",
  o3.filter((n) => n.depth === 0)[0].end, o3.filter((n) => n.depth === 0)[1].start);

console.log("\n[4] a file with no ST/CLM at all still browses");
const bare = "ISA*00*          *00*          *ZZ*A              *ZZ*B              *230101*1200*^*00501*000000001*0*T*:~\nIEA*1*000000001~\n";
check("outline is empty, not broken", m.buildOutline(m.parse(bare).segments), []);

console.log("\n[5] qualifier decoding");
const role = (id, ...els) => m.segmentRole({ id, elements: els });
check("NM1 subscriber", role("NM1", "IL", "1", "DOE", "JOHN"), "Subscriber");
check("NM1 billing provider", role("NM1", "85", "2", "PROVIDER"), "Billing provider");
check("NM1 payer", role("NM1", "PR", "2", "INSURANCE"), "Payer");
check("HL subscriber level", role("HL", "2", "1", "22", "0"), "Subscriber");
check("HL information source", role("HL", "1", "", "20", "1"), "Information source");
check("DTP service date", role("DTP", "472", "D8", "20230101"), "Service date");
check("DTP statement period", role("DTP", "434", "RD8", "20230101-20230131"), "Statement period");
check("REF employer id", role("REF", "EI", "123456789"), "Employer ID");
check("SBR primary", role("SBR", "P", "18"), "Primary");
check("unknown qualifier decodes to nothing", role("NM1", "ZZ", "1", "X"), "");
check("segment with no qualifier table", role("N3", "123 MAIN ST"), "");
check("segment with no elements", role("NM1"), "");
check("names cover the sample's segments",
  [...new Set(doc.segments.map((s) => s.id))].filter((id) => !m.SEGMENT_NAMES[id]), []);

console.log("\n[6] composite specs");
const spec = (id, i) => m.compositeSpec(id, i);
check("SV1-01 is the procedure composite", spec("SV1", 0).label, "Procedure");
check("SV1-02 is not a composite", spec("SV1", 1), null);
check("CLM-05 is place of service", spec("CLM", 4).label, "Place of service");
check("CLM-01 is not a composite", spec("CLM", 0), null);
check("N3 has no composites at all", spec("N3", 0), null);
// HI uses the "*" wildcard: every element is the same kind of composite.
check("HI-01 resolves via the wildcard", spec("HI", 0).label, "Diagnosis / procedure");
check("HI-08 resolves via the wildcard too", spec("HI", 7).label, "Diagnosis / procedure");

check("SV1 qualifier HC decodes", spec("SV1", 0).codes[0].HC, "HCPCS/CPT");
check("HI qualifier ABK decodes", spec("HI", 0).codes[0].ABK, "ICD-10-CM principal diagnosis");
check("CLM place of service 11 decodes", spec("CLM", 4).codes[0]["11"], "Office");
check("CLM claim frequency 7 decodes", spec("CLM", 4).codes[2]["7"], "Replacement");
check("component names are ordered", spec("SV1", 0).parts.slice(0, 3),
  ["Qualifier", "Procedure code", "Modifier"]);

console.log("\n[7] composite rendering");
m.state.doc = doc; // componentHtml reads the separator off the live document

check("a simple value renders unchanged", m.componentHtml("99213", ""), "99213");
check("a composite gets its separators marked",
  m.componentHtml("HC:99213:25", ""),
  'HC<span class="csep">:</span>99213<span class="csep">:</span>25');
check("html in a value is still escaped",
  m.componentHtml("A<B:C", ""), 'A&lt;B<span class="csep">:</span>C');
check("the filter needle highlights inside a component",
  m.componentHtml("HC:99213", "99213"),
  'HC<span class="csep">:</span><mark>99213</mark>');
// A needle spanning the separator can't survive the split, so it falls back.
check("a needle spanning components falls back to whole-value matching",
  m.componentHtml("HC:99213", "hc:99213"),
  "<mark>HC:99213</mark>");
check("empty trailing component renders",
  m.componentHtml("ABK:", ""), 'ABK<span class="csep">:</span>');

console.log("\n[8] claim separators in the outline");
// Purely presentational, but the one rule that is easy to get wrong: the
// first claim under a transaction heading must NOT get a rule above it, or
// the line reads as cutting the claim off from its own transaction.
const depths = (list) => m.claimStarts(list.map((d) => ({ depth: d })));
check("the sample's only claim is left bare", [...m.claimStarts(outline)], []);
check("second and third claims are separated, the first is not",
  [...depths([0, 1, 2, 2, 1, 2, 1])], [4, 6]);
check("service lines are never separated",
  [...depths([0, 1, 2, 2, 2, 2])], []);
check("the rule resets at each transaction",
  [...depths([0, 1, 1, 0, 1, 1])], [2, 5]);
check("a transaction with one claim each gets no separators at all",
  [...depths([0, 1, 0, 1, 0, 1])], []);
check("an empty outline is not a special case", [...m.claimStarts([])], []);

console.log("\n[9] version label");
check("5010 code", m.versionLabel("00501"), "5010");
check("4010 code", m.versionLabel("00401"), "4010");
check("unrecognised code shown raw", m.versionLabel("00301"), "00301");
check("missing code", m.versionLabel(""), "unknown");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
