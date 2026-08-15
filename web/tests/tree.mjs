// Tests the structure tree behind the Tree tab: how the interchange's
// nesting is recovered from ISA/GS/ST/HL/CLM/LX, and how that tree is
// flattened into the fixed-height rows the virtual list paints.
//
// The flattener is where the correctness that matters lives: every row it
// emits must be exactly one ROW_H tall, so an expanded segment becomes one
// row per element rather than a taller card.
import { readFileSync } from "node:fs";

import { APP, FIXTURE, PACDR_FIXTURE } from "./paths.mjs";

const html = readFileSync(APP, "utf8");

// Lift a top-level function or brace-delimited const by brace matching.
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

// Scalar consts have no braces to match on, so take the declaration up to
// its semicolon -- these carry trailing comments, so the line doesn't end there.
function liftLine(name) {
  const m = html.match(new RegExp("^const " + name + " = [^\\n]*?;", "m"));
  if (!m) throw new Error("not found: " + name);
  return m[0];
}

const src = [
  lift("SEGMENT_NAMES", "const SEGMENT_NAMES = {") + ";",
  lift("QUALIFIERS", "const QUALIFIERS = {") + ";",
  lift("COMPOSITES", "const COMPOSITES = {") + ";",
  lift("PHI_FIELDS", "const PHI_FIELDS = {") + ";",
  lift("GROUP_RANK", "const GROUP_RANK = {") + ";",
  lift("TRAILER_RANK", "const TRAILER_RANK = {") + ";",
  liftLine("HL_RANK"),
  liftLine("HL_RANK_MAX"),
  liftLine("ENTITY_RANK"),
  liftLine("ROW_H"),
  liftLine("GUIDE_PACDR"),
  lift("guideOf", "function guideOf(segments, stIndex)"),
  lift("HL_LOOPS", "const HL_LOOPS = {") + ";",
  lift("ENTITY_LOOPS", "const ENTITY_LOOPS = {") + ";",
  lift("GUIDE_LOOP_LABELS", "const GUIDE_LOOP_LABELS = {") + ";",
  lift("loopLabel", "function loopLabel(guide, loop, name)"),
  lift("ANCHOR_LOOPS", "const ANCHOR_LOOPS = {") + ";",
  liftLine("REPEATED_ANCHORS"),
  lift("enclosingLoop", "function enclosingLoop(stack)"),
  lift("compositeSpec", "function compositeSpec(segId, index)"),
  lift("segmentRole", "function segmentRole(seg)"),
  lift("isPhiField", "function isPhiField(seg, index)"),
  lift("splitN", "function splitN(text, sep, maxsplit)"),
  lift("detectDelimiters", "function detectDelimiters(raw)"),
  lift("splitComponents", "function splitComponents(value, componentSep)"),
  lift("parse", "function parse(raw)"),
  lift("buildTree", "function buildTree(segments)"),
  lift("defaultExpanded", "function defaultExpanded(root)"),
  lift("allGroupKeys", "function allGroupKeys(root)"),
  lift("treeMatches", "function treeMatches(root, segments, needle)"),
  lift("flattenTree", "function flattenTree(root, opts)"),
  lift("loopTint", "function loopTint(loop)"),
  lift("STRUCTURAL_LOOPS", "const STRUCTURAL_LOOPS = [", "[", "]") + ";",
  lift("LOOP_CONTEXTS", "const LOOP_CONTEXTS = [", "[", "]") + ";",
  lift("contextLabel", "function contextLabel(key)"),
  lift("referenceLoops", "function referenceLoops()"),
  "export { buildTree, defaultExpanded, allGroupKeys, treeMatches, flattenTree, loopTint, parse, referenceLoops, contextLabel, LOOP_CONTEXTS, ROW_H, HL_RANK, HL_RANK_MAX, GROUP_RANK, guideOf, GUIDE_PACDR, GUIDE_LOOP_LABELS };",
].join("\n");

const m = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));

let pass = 0, fail = 0;
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log(`  FAIL ${name}\n       expected ${JSON.stringify(expected)}\n       actual   ${JSON.stringify(actual)}`); }
};

const raw = readFileSync(FIXTURE, "utf8");
const doc = m.parse(raw);
const root = m.buildTree(doc.segments);

// Convenience: walk down a chain of group ids from the root.
const child = (node, id) => node.children.find((c) => c.kind === "group" && c.id === id);
const groups = (node) => node.children.filter((c) => c.kind === "group");
const leaves = (node) => node.children.filter((c) => c.kind === "segment");
const flatten = (opts) => m.flattenTree(root, Object.assign({
  segments: doc.segments,
  expanded: new Set(),
  componentSep: doc.componentSep,
}, opts));

console.log("\n[1] the envelope nests as the segments imply");
const isa = child(root, "ISA");
const gs = child(isa, "GS");
const st = child(gs, "ST");
check("one interchange at the top", root.children.map((c) => c.id), ["ISA"]);
check("interchange is labelled", isa.label, "Interchange");
check("interchange counts every segment in the file", isa.count, doc.segments.length);
check("functional group nests in the interchange", gs.label, "Functional group");
check("transaction nests in the functional group", st.label, "Transaction 0001");
check("transaction detail is the set identifier", st.detail, "837");

console.log("\n[2] a group's opening segment is also its first child");
check("ISA group opens on segment 0", isa.seg, 0);
check("its first child is that same ISA segment", isa.children[0].seg, 0);
check("the first child is a leaf, not a group", isa.children[0].kind, "segment");
// Every segment must appear exactly once as a leaf, or the flattened list
// would either duplicate rows or silently drop some.
const seen = [];
(function collect(node) {
  if (node.kind === "segment") { seen.push(node.seg); return; }
  node.children.forEach(collect);
})(root);
check("every segment appears exactly once", seen, doc.segments.map((_, i) => i));

console.log("\n[3] HL loops nest through their parent pointers");
const hl1 = child(st, "HL");
const hl2 = child(hl1, "HL");
check("first HL sits under the transaction", hl1.label, "Information source");
check("second HL nests inside the first, not beside it", hl2.label, "Subscriber");
check("first HL is labelled with its own id", hl1.detail, "HL 1");
check("transaction has exactly one HL child",
  groups(st).filter((g) => g.id === "HL").length, 1);

console.log("\n[4] claims and service lines");
const clm = child(hl2, "CLM");
check("claim nests inside the subscriber loop", clm.label, "Claim 1");
check("claim detail is the patient account number", clm.detail, "PATIENTACCTNUM");
const lines = groups(clm).filter((g) => g.id === "LX");
check("two service lines under the claim", lines.map((g) => g.label), ["Line 1", "Line 2"]);
check("claim covers CLM, HI, NM1 and both lines", clm.count, 9);
check("line 1 holds LX, SV1, DTP", lines[0].count, 3);

console.log("\n[5] trailers close their own group, not the last one open");
check("SE is a child of the transaction", leaves(st).map((l) => doc.segments[l.seg].id).includes("SE"), true);
check("SE is not a child of the claim", leaves(clm).map((l) => doc.segments[l.seg].id).includes("SE"), false);
check("GE is a child of the functional group", leaves(gs).map((l) => doc.segments[l.seg].id), ["GS", "GE"]);
check("IEA is a child of the interchange", leaves(isa).map((l) => doc.segments[l.seg].id), ["ISA", "IEA"]);

console.log("\n[6] default and preset expansions");
const byDefault = m.defaultExpanded(root);
check("default opens the envelope and the HL loops", byDefault.has(isa.key) && byDefault.has(st.key) && byDefault.has(hl2.key), true);
check("default stops above the claims", byDefault.has(clm.key), false);
check("default stops above the service lines", byDefault.has(lines[0].key), false);
check("default opens the entity loops, which are small", byDefault.has(child(hl2, "NM1").key), true);
const everyGroup = m.allGroupKeys(root);
check("expand-all covers claims and lines too", everyGroup.has(clm.key) && everyGroup.has(lines[0].key), true);
check("expand-all opens groups only, never segments",
  [...everyGroup].filter((k) => k[0] === "s").length, 0);

console.log("\n[7] flattening to fixed-height rows");
check("collapsed to nothing leaves the interchange visible", flatten({}).length, 1);
check("that one row is the interchange header", flatten({})[0].type, "group");
// 31 segments + 14 group headers: ISA, GS, ST, 1000A, 1000B, 2000A, 2010AA,
// 2000B, 2010BA, 2010BB, 2300, 2310A and both 2400s.
check("every group open shows every segment plus its headers",
  flatten({ expanded: everyGroup }).length, doc.segments.length + 14);
const openRows = flatten({ expanded: everyGroup });
check("no element rows until a segment is opened",
  openRows.filter((r) => r.type === "element" || r.type === "component").length, 0);
check("rows carry the depth the indent is drawn from",
  openRows.slice(0, 4).map((r) => r.depth), [0, 1, 1, 2]);
check("default view hides the claim's contents",
  flatten({ expanded: byDefault }).some((r) => r.seg === clm.seg && r.type === "segment"), false);

console.log("\n[8] an opened segment becomes one row per element");
// SV1*HC:99213*100*UN*1***1 -- seven elements, the first a two-part composite.
const sv1 = doc.segments.findIndex((s) => s.id === "SV1");
const withSv1 = new Set([...everyGroup, "s" + sv1]);
const sv1Rows = flatten({ expanded: withSv1 });
check("row count grows by the elements plus their components",
  sv1Rows.length - openRows.length, doc.segments[sv1].elements.length + 2);
const elementRows = sv1Rows.filter((r) => r.type === "element");
check("one element row per element", elementRows.length, doc.segments[sv1].elements.length);
check("element rows know which element they are", elementRows.map((r) => r.el), [0, 1, 2, 3, 4, 5, 6]);
const componentRows = sv1Rows.filter((r) => r.type === "component");
check("the composite splits into two component rows", componentRows.map((r) => r.part), [0, 1]);
check("components sit one level below their element",
  componentRows[0].depth - elementRows[0].depth, 1);
check("component rows point back at the element", componentRows.map((r) => r.el), [0, 0]);

console.log("\n[9] masking changes the row count, not just the paint");
// A masked value shows no component breakdown -- splitting one would hand
// back exactly what the mask hides -- so the flattener has to know about it.
const phiDoc = m.parse(raw.replace("N3*456 ELM ST~", "N3*456 ELM ST:APT 2~"));
const phiRoot = m.buildTree(phiDoc.segments);
const n3 = phiDoc.segments.findIndex((s, i) => s.id === "N3" && i > 10);
const phiOpts = (mask) => ({
  segments: phiDoc.segments,
  expanded: new Set([...m.allGroupKeys(phiRoot), "s" + n3]),
  componentSep: phiDoc.componentSep,
  mask,
});
const clear = m.flattenTree(phiRoot, phiOpts(false));
const masked = m.flattenTree(phiRoot, phiOpts(true));
check("unmasked, the address splits into components",
  clear.filter((r) => r.type === "component" && r.seg === n3).length, 2);
check("masked, the breakdown disappears",
  masked.filter((r) => r.type === "component" && r.seg === n3).length, 0);
check("masked list is exactly two rows shorter", clear.length - masked.length, 2);

console.log("\n[10] filtering keeps matches and the path down to them");
const keep = m.treeMatches(root, doc.segments, "99213");
const filtered = flatten({ match: keep, expanded: new Set() });
check("a filter forces the path open even from a collapsed tree",
  filtered.map((r) => doc.segments[r.seg].id), ["ISA", "GS", "ST", "HL", "HL", "CLM", "LX", "SV1"]);
check("the only leaf shown is the match itself",
  filtered.filter((r) => r.type === "segment").map((r) => r.seg), [sv1]);
check("the other service line is gone",
  filtered.filter((r) => doc.segments[r.seg].id === "LX").length, 1);
check("a filter matching nothing empties the list",
  flatten({ match: m.treeMatches(root, doc.segments, "zzzznotthere") }).length, 0);
check("a segment ID is matchable on its own",
  flatten({ match: m.treeMatches(root, doc.segments, "dmg") })
    .filter((r) => r.type === "segment").length, 1);

console.log("\n[11] HL hierarchies with several children and broken pointers");
const seg = (line) => {
  const [id, ...elements] = line.split("*");
  return { id, elements };
};
const twoSubs = [
  "ST*837*0001", "HL*1**20*1", "NM1*85*2*PROVIDER",
  "HL*2*1*22*0", "CLM*A*100", "HL*3*1*22*0", "CLM*B*200", "SE*7*0001",
].map(seg);
const t2 = m.buildTree(twoSubs);
const billing = child(child(t2, "ST"), "HL");
const subs = groups(billing).filter((g) => g.id === "HL");
check("both subscribers hang off the same billing provider",
  subs.map((g) => g.label), ["Subscriber", "Subscriber"]);
check("each subscriber keeps its own claim",
  subs.map((g) => groups(g)[0].detail), ["A", "B"]);
check("claim numbering runs across the transaction",
  subs.map((g) => groups(g)[0].label), ["Claim 1", "Claim 2"]);
check("the billing provider name opened its own entity loop",
  groups(billing).filter((g) => g.id === "NM1").map((g) => g.loop), ["2010AA"]);

const dangling = ["ST*837*0001", "HL*1**20*1", "HL*9*7*22*0", "SE*3*0001"].map(seg);
const t3 = m.buildTree(dangling);
const stt = child(t3, "ST");
check("an HL pointing at a parent that never opened falls back to the transaction",
  groups(stt).length, 2);
check("it is not swallowed by the previous HL", groups(groups(stt)[0]).length, 0);

console.log("\n[12] degenerate documents still build");
check("no segments at all", m.buildTree([]).children, []);
const bare = "ISA*00*          *00*          *ZZ*A              *ZZ*B              *230101*1200*^*00501*000000001*0*T*:~\nIEA*1*000000001~\n";
const bareRoot = m.buildTree(m.parse(bare).segments);
check("an envelope with nothing in it", bareRoot.children.map((c) => c.id), ["ISA"]);
check("both its segments are leaves of the interchange", bareRoot.children[0].count, 2);
// A fragment with no envelope at all: everything hangs off the root rather
// than being dropped.
const orphan = m.buildTree(["NM1*IL*1*DOE", "N3*1 MAIN ST"].map(seg));
check("segments with no envelope stay reachable", orphan.children.length, 2);
check("and they are leaves", orphan.children.map((c) => c.kind), ["segment", "segment"]);
// LX before any CLM, which malformed files do produce.
const looseLx = m.buildTree(["ST*837*1", "LX*1", "SV1*HC:1*5", "SE*4*1"].map(seg));
check("a service line with no claim attaches to the transaction",
  groups(child(looseLx, "ST")).map((g) => g.label), ["Line 1"]);

console.log("\n[13] loop identifiers on the sample 837P");
check("HL levels map to the 2000 series", [hl1.loop, hl2.loop], ["2000A", "2000B"]);
check("claim is 2300", clm.loop, "2300");
check("service lines are 2400", lines.map((g) => g.loop), ["2400", "2400"]);
check("submitter and receiver are the 1000 series",
  groups(st).filter((g) => g.id === "NM1").map((g) => g.loop), ["1000A", "1000B"]);
check("billing provider name is 2010AA", child(hl1, "NM1").loop, "2010AA");
check("subscriber and payer names are the 2010B series",
  groups(hl2).filter((g) => g.id === "NM1").map((g) => g.loop), ["2010BA", "2010BB"]);
check("the referring provider inside the claim is 2310A",
  groups(clm).filter((g) => g.id === "NM1").map((g) => g.loop), ["2310A"]);
check("the envelope carries no loop id", [isa.loop, gs.loop, st.loop], ["", "", ""]);
check("plain segments carry no loop id",
  leaves(hl2).every((l) => !l.loop), true);

console.log("\n[14] the same segment names different loops in different places");
// NM1*82 is the rendering provider at 2310B in a claim and 2420A in a line;
// NM1*IL is the subscriber at 2010BA but the other subscriber at 2330A.
const cob = [
  "ST*837*0001", "HL*1**20*1", "NM1*85*2*PROVIDER",
  "HL*2*1*22*0", "SBR*P*18", "NM1*IL*1*SUB", "NM1*PR*2*PAYER",
  "CLM*A*100", "NM1*82*1*RENDERING",
  "SBR*S*18", "NM1*IL*1*OTHERSUB", "NM1*PR*2*OTHERPAYER",
  "LX*1", "SV1*HC:1*5", "NM1*82*1*LINERENDER", "LIN**N4*12345", "SVD*PAYER*50*HC:1",
  "SE*18*0001",
].map(seg);
const cobRoot = m.buildTree(cob);
const cobSt = child(cobRoot, "ST");
const cobClaim = child(child(child(cobSt, "HL"), "HL"), "CLM");
check("a claim holds the rendering provider, the COB block and the line",
  groups(cobClaim).map((g) => g.loop), ["2310B", "2320", "2400"]);
const other = child(cobClaim, "SBR");
check("2320 is opened by the SBR inside the claim", other.loop, "2320");
check("the names inside it are the 2330 series",
  groups(other).map((g) => g.loop), ["2330A", "2330B"]);
const cobLine = child(cobClaim, "LX");
check("the same NM1*82 is 2420A inside a service line",
  groups(cobLine).map((g) => g.loop), ["2420A", "2410", "2430"]);
// The SBR in 2000B names no loop, and must not be mistaken for a 2320.
const cobSub = child(child(cobSt, "HL"), "HL");
check("the subscriber's own SBR stays a plain segment",
  leaves(cobSub).map((l) => cob[l.seg].id), ["HL", "SBR"]);
check("2320 did not swallow the service line",
  groups(other).filter((g) => g.id === "LX").length, 0);

// Regression, and not a PACDR-only one: a claim adjudicated by two payers
// carries one 2320 each, and the second SBR used to land as a leaf of the
// first payer's 2330B -- dragging that payer's own AMT in with it, so the
// tree showed one payer's money inside another's loop. 2320 is the only
// anchored loop that other loops nest inside, which is why it alone had to
// be taught to repeat.
const twoPayers = m.buildTree([
  "ST*837*0001", "HL*1**20*1", "NM1*85*2*PROVIDER",
  "HL*2*1*22*0", "SBR*P*18", "NM1*IL*1*SUB", "NM1*PR*2*PAYER",
  "CLM*A*100",
  "SBR*P*18", "AMT*D*60", "NM1*IL*1*SUB", "NM1*PR*2*FIRSTPAYER",
  "SBR*S*18", "AMT*D*30", "NM1*IL*1*SUB", "NM1*PR*2*SECONDPAYER",
  "LX*1", "SV1*HC:1*100", "SE*18*0001",
].map(seg));
const twoClaim = child(child(child(child(twoPayers, "ST"), "HL"), "HL"), "CLM");
check("both 2320 loops are children of the claim",
  groups(twoClaim).map((g) => g.loop), ["2320", "2320", "2400"]);
check("each keeps its own subscriber and payer",
  groups(twoClaim).filter((g) => g.loop === "2320").map((g) => groups(g).map((n) => n.loop)),
  [["2330A", "2330B"], ["2330A", "2330B"]]);
check("and its own AMT, rather than the previous payer's loop keeping it",
  groups(twoClaim).filter((g) => g.loop === "2320").map((g) => g.count), [4, 4]);

// 2000C: a patient hierarchical level under a subscriber.
const withPatient = m.buildTree([
  "ST*837*0001", "HL*1**20*1", "HL*2*1*22*1", "NM1*IL*1*SUB",
  "HL*3*2*23*0", "NM1*QC*1*CHILD", "CLM*P*50", "SE*8*0001",
].map(seg));
const patient = child(child(child(child(withPatient, "ST"), "HL"), "HL"), "HL");
check("the patient level is 2000C", patient.loop, "2000C");
check("and the name inside it is 2010CA", child(patient, "NM1").loop, "2010CA");

console.log("\n[15] filtering by loop id");
const loopKeep = m.treeMatches(root, doc.segments, "2010ba");
const loopRows = flatten({ match: loopKeep, expanded: new Set() });
check("a loop id pulls its whole contents through, not just the header",
  loopRows.map((r) => doc.segments[r.seg].id),
  ["ISA", "GS", "ST", "HL", "HL", "NM1", "NM1", "N3", "N4", "DMG"]);
check("the payer loop beside it is not dragged in",
  loopRows.filter((r) => r.type === "group" && r.node.loop === "2010BB").length, 0);
check("a loop id that isn't in the file matches nothing",
  flatten({ match: m.treeMatches(root, doc.segments, "2420a") }).length, 0);
check("partial loop ids still match",
  flatten({ match: m.treeMatches(root, doc.segments, "2400") })
    .filter((r) => r.type === "group" && r.node.loop === "2400").length, 2);

console.log("\n[16] indent rails");
// Each row carries one flag per ancestor: does that ancestor still have a
// sibling below? That is what decides whether its rail keeps going past this
// row. Every row draws only its own slice, so the list can be cut anywhere.
const railed = flatten({ expanded: everyGroup });
check("a rail flag per ancestor level",
  railed.every((r) => r.guides.length === r.depth), true);
check("the top-level interchange has no rails", railed[0].guides, []);
check("it is also the only thing at its level, so it is last", railed[0].last, true);
// ISA holds the ISA segment, the GS group and the IEA segment: the first two
// have more to come, the last does not.
const inIsa = railed.filter((r) => r.depth === 1);
check("last child of the interchange is flagged last",
  inIsa.map((r) => r.last), [false, false, true]);
check("children of a last-child parent draw no rail at its level",
  inIsa.every((r) => r.guides[0] === false), true);

// Inside the transaction, which is not its parent's last child, every
// descendant must keep the rail at the functional group's level alive.
const stRow = railed.find((r) => r.type === "group" && r.node.label === "Transaction 0001");
const clmRow = railed.find((r) => r.type === "group" && r.node.loop === "2300");
check("the transaction sits two levels in, under ISA and GS", stRow.depth, 2);
check("the claim's rails run the whole way back up",
  clmRow.guides.length, clmRow.depth);
// The claim is the last thing in the subscriber loop, but the subscriber
// loop is not the last thing in the billing-provider loop, so the rail at
// that outer level has to keep going past the claim.
check("the claim closes its own loop", clmRow.last, true);
const lineRows = railed.filter((r) => r.type === "group" && r.node.loop === "2400");
check("line 1 keeps its rail alive for line 2", lineRows.map((r) => r.last), [false, true]);
// SV1 sits inside line 1. The rail at line 1's own level must still be drawn
// beside it, because line 2 is coming; the rail at the claim's level must not,
// because the claim ends there.
const sv1Row = railed.find((r) => r.type === "segment" && r.seg === sv1);
check("a segment inside line 1 keeps line 1's rail beside it",
  sv1Row.guides[lineRows[0].depth], true);
check("but not the rail of a loop that has already closed",
  sv1Row.guides[clmRow.depth], false);

// An opened segment's element rows hang off it, and the last element ends
// the rail. Components hang off their element the same way.
check("only the final element is flagged last",
  elementRows.map((r) => r.last), [false, false, false, false, false, false, true]);
check("elements sit one level below their segment",
  elementRows[0].depth, sv1Rows.find((r) => r.type === "segment" && r.seg === sv1).depth + 1);
check("components hang off a still-continuing element",
  componentRows[0].guides[componentRows[0].depth - 1], true);
check("and the final component closes its own rail",
  componentRows.map((r) => r.last), [false, true]);

console.log("\n[17] loop ids are coloured by what they describe");
const tint = (loop) => m.loopTint(loop).trim();
check("header parties", [tint("1000A"), tint("1000B")], ["lp-head", "lp-head"]);
check("hierarchy and the names inside it",
  ["2000A", "2000B", "2000C", "2010AA", "2010BA", "2010CA"].map(tint),
  ["lp-hier", "lp-hier", "lp-hier", "lp-hier", "lp-hier", "lp-hier"]);
check("everything hanging off the claim",
  ["2300", "2310A", "2310F", "2320", "2330A", "2330G"].map(tint),
  ["lp-claim", "lp-claim", "lp-claim", "lp-claim", "lp-claim", "lp-claim"]);
check("everything hanging off the service line",
  ["2400", "2410", "2420A", "2420H", "2430", "2440"].map(tint),
  ["lp-line", "lp-line", "lp-line", "lp-line", "lp-line", "lp-line"]);
check("the envelope has no loop and so no tint", m.loopTint(""), "");
// Every loop the builder can actually produce must land in a band, or it
// renders in the default grey and looks like an oversight.
const everyLoop = new Set();
for (const file of [root, cobRoot, withPatient]) {
  (function walk(n) {
    if (n.kind !== "group") return;
    if (n.loop) everyLoop.add(n.loop);
    n.children.forEach(walk);
  })(file);
}
check("every loop the samples produce is banded",
  [...everyLoop].filter((l) => !m.loopTint(l)), []);
check("and there are enough of them for that to mean something", everyLoop.size >= 19, true);

console.log("\n[18] the guide's loop reference is generated, not written");
// The point of generating it: the guide cannot claim a loop the tree doesn't
// resolve, and cannot omit one it does. If this fails, the reference has
// drifted from the app -- which is the exact failure generating it prevents.
const refGroups = m.referenceLoops();
const listed = new Set(refGroups.flatMap(([, rows]) => rows.map((r) => r.loop)));
check("every loop the samples produce is in the reference",
  [...everyLoop].filter((l) => !listed.has(l)), []);
check("the reference lists no loop twice",
  refGroups.flatMap(([, rows]) => rows.map((r) => r.loop)).length, listed.size);
const known = new Set(m.LOOP_CONTEXTS.map(([key]) => key));
check("every group has a context heading",
  refGroups.map(([parent]) => parent).filter((p) => !known.has(p)), []);
// Pinned because it silently broke once: LOOP_CONTEXTS used to be an object,
// and `Object.keys` hoists integer-like keys ahead of the rest in ascending
// numeric order, so "2300"/"2320"/"2400" sorted above "ST" and "2000A" and
// the reference opened on the claim loops instead of the envelope.
check("sections run in the order a file presents them",
  refGroups.map(([parent]) => parent),
  ["ST", "2000A", "2000B", "2000C", "2300", "2320", "2400"]);
check("the context label falls back to the raw key when unknown",
  m.contextLabel("9999"), "9999");
check("every row names the segment that opens it",
  refGroups.flatMap(([, rows]) => rows).filter((r) => !r.opener || !r.name).length, 0);
// The claim and service line are opened by CLM and LX directly, so they are
// in no qualifier table and have to be added by hand -- the one place the
// reference isn't purely derived, and the easiest thing to lose.
check("the claim and service line loops are present",
  ["2300", "2400"].filter((l) => !listed.has(l)), []);
check("the reference covers more than the samples happen to reach",
  listed.size > everyLoop.size, true);

console.log("\n[19] which implementation guide a transaction is written to");
const stOf = (lines) => lines.map(seg);
check("ST-03 is the primary signal",
  m.guideOf(stOf(["ST*837*0001*005010X298A1"]), 0), m.GUIDE_PACDR);
check("and it matches on the prefix, so X298 and X298A1 both resolve",
  m.guideOf(stOf(["ST*837*0001*005010X298"]), 0), m.GUIDE_PACDR);
check("an 837P ST-03 resolves to nothing at all",
  m.guideOf(stOf(["ST*837*0001*005010X222A1"]), 0), "");
check("a blank ST-03 falls back to the GS-08 above it",
  m.guideOf(stOf(["GS*HC*S*R*20230101*1200*1*X*005010X298A1", "ST*837*0001"]), 1), m.GUIDE_PACDR);
check("and to the nearest GS, not the first in the file",
  m.guideOf(stOf(["GS*HC*S*R*20230101*1200*1*X*005010X298A1", "SE*2*0001", "GE*1*1",
    "GS*HC*S*R*20230101*1200*2*X*005010X222A1", "ST*837*0002"]), 4), "");
check("with neither stated, BHT-06 corroborates",
  m.guideOf(stOf(["ST*837*0001", "BHT*0019*00*0001*20230101*1200*RP"]), 0), m.GUIDE_PACDR);
check("a submission's BHT-06 does not",
  m.guideOf(stOf(["ST*837*0001", "BHT*0019*00*0001*20230101*1200*CH"]), 0), "");
// RP is legal in 837P too, so on its own it must never overrule a stated
// version -- the whole point of reading BHT last.
check("BHT-06 never overrules an explicit 005010X222A1",
  m.guideOf(stOf(["ST*837*0001*005010X222A1", "BHT*0019*00*0001*20230101*1200*RP"]), 0), "");
check("a transaction that states nothing at all is nothing",
  m.guideOf(stOf(["ST*837*0001", "NM1*41*2*SUBMITTER"]), 0), "");
// A GS-08 naming the standard's version but no implementation guide settles
// nothing, and used to pre-empt BHT-06 anyway -- leaving a report that says
// RP read as an ordinary 837P, against what the app's own guide promises.
check("a GS-08 stating a version but no guide still lets BHT-06 corroborate",
  m.guideOf(stOf(["GS*HC*S*R*20230101*1200*1*X*005010", "ST*837*0001",
    "BHT*0019*00*0001*20230101*1200*RP"]), 1), m.GUIDE_PACDR);
check("while an explicit 837P GS-08 overrules BHT-06 as before",
  m.guideOf(stOf(["GS*HC*S*R*20230101*1200*1*X*005010X222A1", "ST*837*0001",
    "BHT*0019*00*0001*20230101*1200*RP"]), 1), "");
// The same rule one level up: a bare ST-03 blocked the GS-08 below it as well
// as BHT-06, so a transaction stating only the standard's version was read as
// nothing even where the envelope above it named the guide outright.
check("a bare ST-03 falls through to a GS-08 that does name the guide",
  m.guideOf(stOf(["GS*HC*S*R*20230101*1200*1*X*005010X298A1", "ST*837*0001*005010"]), 1),
  m.GUIDE_PACDR);
check("and with no GS either, on to BHT-06",
  m.guideOf(stOf(["ST*837*0001*005010", "BHT*0019*00*0001*20230101*1200*RP"]), 0),
  m.GUIDE_PACDR);

console.log("\n[20] the two loops a post-adjudicated report renames");
const pacdrDoc = m.parse(readFileSync(PACDR_FIXTURE, "utf8"));
const pacdrRoot = m.buildTree(pacdrDoc.segments);
const pacdrSt = child(child(child(pacdrRoot, "ISA"), "GS"), "ST");
const pacdrSub = child(child(pacdrSt, "HL"), "HL");
const pacdrClaim = child(pacdrSub, "CLM");
check("the transaction node records the guide it resolved to", pacdrSt.guide, m.GUIDE_PACDR);
check("and says so in its detail line", pacdrSt.detail, "837 PACDR 005010X298");
check("2010BB is the data receiver, not a payer",
  groups(pacdrSub).filter((g) => g.loop === "2010BB").map((g) => g.label), ["Data receiver"]);
const twenty320 = groups(pacdrClaim).filter((g) => g.loop === "2320");
check("both 2320 loops resolved", twenty320.length, 2);
check("and the 2330B inside each is the payer that adjudicated the claim",
  twenty320.flatMap((g) => groups(g).filter((n) => n.loop === "2330B").map((n) => n.label)),
  ["Adjudicating payer", "Adjudicating payer"]);
check("2330A keeps its 837P name, which PACDR does not change",
  twenty320.flatMap((g) => groups(g).filter((n) => n.loop === "2330A").map((n) => n.label)),
  ["Other subscriber", "Other subscriber"]);
check("each service line holds two 2430s, one per payer",
  groups(pacdrClaim).filter((g) => g.loop === "2400")
    .map((g) => groups(g).filter((n) => n.loop === "2430").length), [2, 2]);
// The same loops on an 837P must read exactly as they did before.
check("the 837P file's 2010BB is still the payer", child(hl2, "NM1").loop, "2010BA");
check("its transaction node carries no guide", [st.guide, st.detail], ["", "837"]);
check("and the labels are the 837P ones",
  groups(hl2).filter((g) => g.id === "NM1").map((g) => g.label), ["Subscriber", "Payer"]);
check("the reference lists the alternate name beside the 837P one",
  m.referenceLoops().flatMap(([, rs]) => rs).filter((r) => r.alt).map((r) => [r.loop, r.name, r.alt]),
  [["2010BB", "Payer", "Data receiver"], ["2330B", "Other payer", "Adjudicating payer"]]);
check("and the override table names only the loops that genuinely differ",
  Object.keys(m.GUIDE_LOOP_LABELS[m.GUIDE_PACDR]), ["2010BB", "2330B"]);

console.log("\n[21] the row height the virtual list depends on");
check("ROW_H is the fixed height every tree row is drawn at", m.ROW_H, 24);
check("HL ranks sit between the transaction and the claim",
  m.HL_RANK > m.GROUP_RANK.ST && m.HL_RANK_MAX < m.GROUP_RANK.CLM, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
