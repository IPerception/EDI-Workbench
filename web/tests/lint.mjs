// Static checks on the single-file app: JS parses, markup nests correctly,
// every CSS class used in the HTML is defined, and nothing reaches the network.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { APP, TESTS_DIR } from "./paths.mjs";

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
// classes applied at runtime from the script
for (const c of script.matchAll(/class="([^"]+)"/g)) c[1].split(/\s+/).forEach((x) => x && defined.has(x));
const used = new Set();
const IDENT = /^[a-zA-Z][\w-]*$/; // skips ${...} fragments in template literals
for (const attr of html.matchAll(/class="([^"]*)"/g)) {
  for (const c of attr[1].split(/\s+/)) if (IDENT.test(c)) used.add(c);
}
for (const c of script.matchAll(/classList\.(?:add|toggle|remove)\("([^"]+)"/g)) used.add(c[1]);
// Classes built by string concatenation, which the scan above can't see.
["touched-shift", "touched-swap", "depth-0", "depth-1", "depth-2"].forEach((c) => used.add(c));
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

console.log(problems ? `\n${problems} problem(s)` : "\nclean");
process.exit(problems ? 1 : 0);
