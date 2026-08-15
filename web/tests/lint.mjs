// Static checks on the single-file app: JS parses, markup nests correctly,
// every CSS class used in the HTML is defined, and nothing reaches the network.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { APP, FIXTURE, PACDR_FIXTURE, TESTS_DIR, appVersion } from "./paths.mjs";

const html = readFileSync(APP, "utf8");
let problems = 0;
const bad = (m) => { problems++; console.log("  FAIL " + m); };
const ok = (m) => console.log("  ok   " + m);

/* --- 1. JS parses --------------------------------------------------- */
const script = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
const tmp = join(TESTS_DIR, "_check.js"); // git-ignored scratch file
writeFileSync(tmp, script, "utf8");
try { execFileSync(process.execPath, ["--check", tmp]); ok("script block parses"); }
catch (e) { bad("script block has a syntax error:\n" + e.stderr.toString()); }

/* --- 2. markup nesting ---------------------------------------------- */
const VOID = new Set(["input", "br", "hr", "img", "meta", "link", "path", "circle", "rect", "use"]);
const markup = html.slice(0, html.indexOf("<script>"));
const stack = [];
const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
let m;
while ((m = tagRe.exec(markup))) {
  const [, closing, name, attrs, selfClose] = m;
  const tag = name.toLowerCase();
  if (tag === "style") { // skip stylesheet body
    tagRe.lastIndex = markup.indexOf("</style>", m.index) + 8;
    continue;
  }
  if (VOID.has(tag) || selfClose) continue;
  if (closing) {
    const open = stack.pop();
    if (open !== tag) bad(`</${tag}> closes <${open || "nothing"}> at char ${m.index}`);
  } else {
    stack.push(tag);
  }
  if (/\s[a-zA-Z-]+=[^"'\s>]/.test(" " + attrs)) bad(`unquoted attribute on <${tag}>: ${attrs.trim()}`);
}
if (stack.length) bad("unclosed at EOF: " + stack.join(" > "));
else ok("markup nests correctly, all attributes quoted");

/* --- 3. every class used is defined --------------------------------- */
const defined = new Set();
const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
for (const c of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) defined.add(c[1]);
const used = new Set();
const IDENT = /^[a-zA-Z][\w-]*$/; // skips ${...} fragments in template literals
// Scans the whole file, not just the markup: classes inside the script's
// template literals are markup too, and they reach the page the same way.
for (const attr of html.matchAll(/class="([^"]*)"/g)) {
  for (const c of attr[1].split(/\s+/)) if (IDENT.test(c)) used.add(c);
}
for (const c of script.matchAll(/classList\.(?:add|toggle|remove)\("([^"]+)"/g)) used.add(c[1]);
// Classes built by string concatenation, which the scan above can't see.
["touched-shift", "touched-swap", "touched-deid", "depth-0", "depth-1", "depth-2",
 "trow", "tgroup", "tseg", "tel", "tsub", "open-able", "alt", "sel",
 "tguide", "on", "tcar", "open", "shut", "leaf", "last",
 "lp-head", "lp-hier", "lp-claim", "lp-line"].forEach((c) => used.add(c));
const orphans = [...used].filter((c) => !defined.has(c));
if (orphans.length) bad("classes used but never styled: " + orphans.join(", "));
else ok(`all ${used.size} classes used are defined in the stylesheet`);

/* --- 4. every getElementById target exists -------------------------- */
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((x) => x[1]));
const looked = new Set([...script.matchAll(/\$\("([^"]+)"\)/g)].map((x) => x[1]));
const missing = [...looked].filter((i) => !ids.has(i));
if (missing.length) bad("script looks up ids that don't exist: " + missing.join(", "));
else ok(`all ${looked.size} element ids referenced by the script exist`);

/* --- 5. fully self-contained ---------------------------------------- */
const net = [...html.matchAll(/(?:src|href)="(?!#)([^"]*)"/g)].map((x) => x[1])
  .concat([...html.matchAll(/\b(fetch|XMLHttpRequest|WebSocket|importScripts)\s*\(/g)].map((x) => x[1]));
if (net.length) bad("external references found: " + net.join(", "));
else ok("no external requests: no src/href, fetch, XHR, or sockets");

/* --- 6. both themes define the same tokens -------------------------- */
const blocks = {
  ":root": css.match(/:root \{([\s\S]*?)\n  \}/),
  "media dark": css.match(/@media \(prefers-color-scheme: dark\) \{[\s\S]*?:root \{([\s\S]*?)\n    \}/),
  'data-theme="dark"': css.match(/:root\[data-theme="dark"\] \{([\s\S]*?)\n  \}/),
  'data-theme="light"': css.match(/:root\[data-theme="light"\] \{([\s\S]*?)\n  \}/),
};
const colorTokens = (body) =>
  new Set([...body.matchAll(/(--[\w-]+):/g)].map((x) => x[1]).filter((t) => !t.startsWith("--step") && t !== "--mono" && t !== "--sans"));
const base = colorTokens(blocks[":root"][1]);
for (const [name, match] of Object.entries(blocks)) {
  if (name === ":root") continue;
  if (!match) { bad(`theme block missing: ${name}`); continue; }
  const here = colorTokens(match[1]);
  const gaps = [...base].filter((t) => !here.has(t));
  if (gaps.length) bad(`${name} does not redefine: ${gaps.join(", ")}`);
  else ok(`${name} redefines all ${base.size} themed tokens`);
}

/* --- 7. the outline cannot set the document grid's height ----------- */
// Uncapped, a 600-claim outline runs to tens of thousands of pixels and
// becomes the taller of the two columns, so it sets the grid row height.
// Narrowing the scope to one claim then strands a 15-row list at the top of
// a page that is still enormous, and sticky never engages because the
// element already fills its row. It has to cap and scroll itself.
const outlineRule = css.match(/\.outline \{([\s\S]*?)\n  \}/);
if (!outlineRule) bad("no .outline rule found");
else if (!/max-height:/.test(outlineRule[1])) bad(".outline must cap its height, or it sets the doc-view row height");
else if (!/overflow-y:\s*auto/.test(outlineRule[1])) bad(".outline caps its height but cannot scroll to its own bottom");
else ok(".outline caps its height and scrolls itself");

/* --- 8. the rail masthead stays pinned ------------------------------ */
// The mask and theme toggles act on whatever is on screen at the time, so
// they have to be reachable at any scroll position. They were inside the
// scroll container until the rail was split, and reaching the mask button
// meant scrolling the rules back up first. Two invariants keep that fixed:
// the masthead sits outside .rail-body, and .rail-body is what scrolls.
const railBody = markup.slice(markup.indexOf('class="rail-body"'), markup.indexOf("</aside>"));
if (markup.indexOf('class="rail-body"') === -1) bad("no .rail-body found: the rail no longer splits head from body");
else if (railBody.includes('class="masthead"')) bad("the masthead is inside .rail-body, so it scrolls out of reach");
else if (!markup.includes('class="rail-head"')) bad("no .rail-head wrapper around the masthead");
else ok("the masthead sits outside the rail's scroll container");

const railBodyRule = css.match(/\.rail-body \{([\s\S]*?)\n  \}/);
if (!railBodyRule) bad("no .rail-body rule found");
else if (!/overflow-y:\s*auto/.test(railBodyRule[1])) bad(".rail-body must scroll, or the rail overflows the viewport");
else if (!/min-height:\s*0/.test(railBodyRule[1])) bad(".rail-body needs min-height: 0, or a grid row refuses to shrink and it never scrolls");
else ok(".rail-body scrolls and can shrink to do it");

/* --- 9. the app states exactly one version -------------------------- */
// release.mjs derives the tag and the asset filename from this string, so a
// second copy of it, or none, breaks the one place the release process reads.
// It only pins the shape here; that the string matches the tag being cut is a
// release-time question, and release.mjs is where it gets asked.
try {
  const v = appVersion(html);
  const shown = markup.includes(`class="version">v${v}<`);
  if (!shown) bad(`version v${v} is not rendered in the markup`);
  else ok(`app states one version, v${v}`);
} catch (e) {
  bad(e.message);
}

/* --- 10. each embedded sample is its committed fixture -------------- */
// The sample buttons ship a copy of each fixture inside the HTML, so the two
// can drift silently -- and every other suite asserts against the file on
// disk, so a button that loads something else makes all of them meaningless.
// The declarations are evaluated rather than pattern-matched, which is what
// makes this compare the string the button actually hands to loadFile.
for (const [name, path] of [["SAMPLE_837P", FIXTURE], ["SAMPLE_PACDR", PACDR_FIXTURE]]) {
  const decl = html.match(new RegExp(`^const ${name} = \\[[\\s\\S]*?^\\]\\.join\\("\\\\n"\\) \\+ "\\\\n";$`, "m"));
  if (!decl) { bad(`${name} is not declared as an array of segments joined with newlines`); continue; }
  const embedded = new Function(`${decl[0]}\nreturn ${name};`)();
  const committed = readFileSync(path, "utf8");
  if (embedded !== committed) bad(`${name} differs from ${path}`);
  else ok(`${name} is byte-identical to its committed fixture (${committed.length} bytes)`);
}

console.log(problems ? `\n${problems} problem(s)` : "\nclean");
process.exit(problems ? 1 : 0);
