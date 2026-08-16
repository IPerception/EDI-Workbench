// Exercises the app's load path end to end, against a throwaway DOM.
//
// Every other suite tests a pure function. This one tests the thing those
// cannot see: what happens when the app is *driven* -- a file loaded, then a
// second one loaded over the top of it. That sequence is where state left over
// from the previous document gets read against the current one, and it has
// produced two bugs that were invisible to the other eight suites and to every
// static check in lint.mjs.
//
// The shim is deliberately thin. It is not a browser and does not try to be:
// it models identity (getElementById returns a stable object per id), text and
// innerHTML, the hidden flag, and the one piece of geometry the app actually
// computes with -- the row viewport's position relative to the pane's scroll
// offset, which is what windowRange is handed. Anything the app only writes and
// never reads back is a no-op.
import { readFileSync } from "node:fs";

import { APP } from "./paths.mjs";

let pass = 0, fail = 0;
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log(`  FAIL ${name}\n       expected ${JSON.stringify(expected)}\n       actual   ${JSON.stringify(actual)}`); }
};

const html = readFileSync(APP, "utf8");
const script = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));

const PANE_TOP = 150;   // where .panes sits on screen
const TOOLBAR = 46;     // the sticky filter, above the rows
const byId = new Map();
const listeners = new Map();
let viewportHeight = 0; // the row viewport's declared height, tracked from its markup

const panes = {
  scrollTop: 0,
  clientHeight: 700,
  get scrollHeight() { return Math.max(700, viewportHeight); },
  scrollIntoView() {}, addEventListener() {},
  getBoundingClientRect: () => ({ top: PANE_TOP, bottom: 850, height: 700 }),
};

function makeEl(id) {
  return {
    id, _html: "", hidden: false, textContent: "", value: "", dataset: {},
    style: { setProperty() {}, removeProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    get innerHTML() { return this._html; },
    set innerHTML(v) {
      this._html = String(v);
      const m = /id="docViewport" style="height:(\d+)px"/.exec(this._html);
      if (m) viewportHeight = +m[1];
    },
    addEventListener(type, fn) {
      const key = `${id}:${type}`;
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push(fn);
    },
    getBoundingClientRect() {
      // The only geometry that matters: the row list moves under the pane as
      // it scrolls, and windowRange turns that offset into a slice.
      if (this.id === "docViewport") {
        return { top: PANE_TOP + TOOLBAR - panes.scrollTop, bottom: 0, height: viewportHeight };
      }
      return { top: PANE_TOP, bottom: 850, left: 0, right: 1200, width: 1200, height: 700 };
    },
    removeEventListener() {}, setAttribute() {}, getAttribute: () => null,
    querySelector: () => null, querySelectorAll: () => [],
    scrollIntoView() {}, focus() {}, closest: () => null,
    appendChild() {}, insertAdjacentHTML() {},
    scrollTop: 0, scrollHeight: 1000, clientHeight: 700,
  };
}

globalThis.document = {
  documentElement: makeEl("html"),
  body: makeEl("body"),
  getElementById(id) {
    if (!byId.has(id)) byId.set(id, makeEl(id));
    return byId.get(id);
  },
  querySelector(sel) { return sel === ".panes" ? panes : this.getElementById(sel.replace(/^[.#]/, "")); },
  querySelectorAll: () => [],
  createElement: makeEl, addEventListener() {}, createTextNode: () => ({}),
};
globalThis.window = {
  innerHeight: 900, innerWidth: 1440, addEventListener() {}, scrollTo() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  getComputedStyle: () => ({ getPropertyValue: () => "" }),
  location: { href: "" },
};
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.cancelAnimationFrame = () => {};
Object.defineProperty(globalThis, "navigator", {
  value: { clipboard: { writeText: async () => {} }, userAgent: "node" }, configurable: true,
});
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.Blob = class {};
globalThis.URL = { createObjectURL: () => "blob:x", revokeObjectURL() {} };
globalThis.getComputedStyle = globalThis.window.getComputedStyle;
globalThis.matchMedia = globalThis.window.matchMedia;

const app = new Function(
  `${script}\nreturn { loadFile, SAMPLE_837P, SAMPLE_PACDR, SAMPLE_835, state };`
)();

const paintedRows = () => (byId.get("docWindow").innerHTML.match(/class="row/g) || []).length;

// A stand-in for a production file: long enough that the pane scrolls a long way.
const long = ["ISA*00*          *00*          *ZZ*S              *ZZ*R              *230101*1200*^*00501*000000001*0*T*:"];
for (let i = 0; i < 3000; i++) long.push(`REF*EA*ID${i}`);
long.push("IEA*1*000000001");
const LONG_FILE = long.join("~") + "~";

console.log("\n[1] a file loads and paints");
app.loadFile("long.edi", LONG_FILE);
check("every segment is indexed", app.state.doc.segments.length, 3002);
check("rows are painted", paintedRows() > 0, true);
check("the readout strip is filled", byId.get("readouts").innerHTML.includes("Segments"), true);

console.log("\n[2] a short file loaded over a long one, scrolled deep");
// The reported bug. selectTab() paints the document list on the way in, which
// runs before renderDocument() rebuilds it -- so a `visible` left over from the
// long file was indexed against the short one's segments and threw out of
// renderRow. loadFile aborted there, before renderDocument and updateReadouts:
// the file name changed, nothing else did, and no error reached the screen.
panes.scrollTop = 60000;
let threw = null;
try { app.loadFile("sample_837p.edi", app.SAMPLE_837P); } catch (err) { threw = err.message; }
check("loading over a scrolled document does not throw", threw, null);
check("the new document is the one indexed", app.state.doc.segments.length, 31);
check("the pane is returned to the top", panes.scrollTop, 0);
check("rows are painted for the new file", paintedRows() > 0, true);
check("the window is a slice of the new file", app.state.window.last <= 31, true);
check("readouts describe the new file", byId.get("readouts").innerHTML.includes(">31<"), true);

console.log("\n[3] every transaction the samples cover survives the same sequence");
for (const [name, raw] of [["PACDR", app.SAMPLE_PACDR], ["835", app.SAMPLE_835], ["837P", app.SAMPLE_837P]]) {
  panes.scrollTop = 40000;
  let err = null;
  try { app.loadFile(`sample_${name}.edi`, raw); } catch (e) { err = e.message; }
  check(`${name} loads over the previous file`, err, null);
  check(`${name} paints rows`, paintedRows() > 0, true);
}

console.log("\n[4] a file that will not parse is reported, not thrown");
let parseThrew = null;
try { app.loadFile("broken.edi", "this is not an interchange"); } catch (e) { parseThrew = e.message; }
check("a bad file does not throw out of loadFile", parseThrew, null);
check("the workspace is hidden", byId.get("workspace").hidden, true);
check("an error is shown", byId.get("parseError").innerHTML.length > 0, true);
check("stale readouts are cleared", byId.get("readouts").innerHTML, "");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
console.log("clean");
