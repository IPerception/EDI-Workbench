// Verifies the virtual list's arithmetic: that the rendered window always
// covers what is actually on screen, at every scroll position, and that the
// row height it multiplies by matches the stylesheet.
import { readFileSync } from "node:fs";

import { APP } from "./paths.mjs";

const html = readFileSync(APP, "utf8");

let pass = 0, fail = 0;
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log(`  FAIL ${name}\n       expected ${JSON.stringify(expected)}\n       actual   ${JSON.stringify(actual)}`); }
};

console.log("\n[1] ROW_H agrees with the stylesheet");
const rowH = +html.match(/const ROW_H = (\d+)/)[1];
const overscan = +html.match(/const OVERSCAN = (\d+)/)[1];
const cssH = +html.match(/\.row \{[\s\S]*?height: (\d+)px;/)[1];
check("ROW_H matches .row height", rowH, cssH);
check("row uses border-box so padding can't inflate it", /\* \{ box-sizing: border-box; \}/.test(html), true);
// The tree runs at its own height. Same contract, separate constant: if these
// drift, its rows overlap or leave gaps exactly as the ledger's would.
const treeH = +html.match(/const TREE_ROW_H = (\d+)/)[1];
const cssTreeH = +html.match(/\.trow \{[\s\S]*?height: (\d+)px;/)[1];
check("TREE_ROW_H matches .trow height", treeH, cssTreeH);
check("the tree is looser than the ledger", treeH > rowH, true);

console.log("\n[2] windowRange covers the fold at every scroll position");
const src = html.slice(html.indexOf("function windowRange"), html.indexOf("function paintWindow"));
const { windowRange } = await import(
  "data:text/javascript;base64," +
  Buffer.from(`const ROW_H=${rowH},OVERSCAN=${overscan};\n${src}\nexport {windowRange};`).toString("base64")
);

const VIEW = 900;

// Sweeps the whole scroll range, plus overscroll in both directions, and
// reports the first position where the rendered window fails to cover what
// is actually on screen. `h` is passed explicitly: both lists share this
// arithmetic but run at different row heights.
function sweep(total, h) {
  const listHeight = total * h;
  for (let top = VIEW + 40; top >= -listHeight - 40; top -= 7) {
    const { first, last } = windowRange(top, VIEW, total, h);

    if (first < 0 || last > total || first > last) return `bad range ${first}..${last} at top=${top}`;

    // Which rows genuinely intersect the fold [0, VIEW]?
    const firstOnScreen = Math.max(0, Math.floor(-top / h));
    const lastOnScreen = Math.min(total, Math.ceil((-top + VIEW) / h));
    if (firstOnScreen >= total || lastOnScreen <= 0) continue; // list entirely off screen

    if (first > firstOnScreen || last < lastOnScreen) {
      return `gap at top=${top}: rendered ${first}..${last}, on screen ${firstOnScreen}..${lastOnScreen}`;
    }
  }
  return null;
}

for (const total of [1, 7, 100, 1200, 60000]) {
  check(`${total.toLocaleString()} rows: window always covers the fold`, sweep(total, rowH), null);
}

console.log("\n[2b] the same arithmetic at the tree's row height");
for (const total of [1, 7, 100, 1200, 60000]) {
  check(`${total.toLocaleString()} tree rows: window always covers the fold`, sweep(total, treeH), null);
}
// The default exists so the document list's three-argument calls keep working.
check("omitting the height falls back to the ledger's",
  windowRange(-5000, VIEW, 60000), windowRange(-5000, VIEW, 60000, rowH));
check("a taller row means fewer rows cover the same fold",
  windowRange(0, VIEW, 60000, treeH).last < windowRange(0, VIEW, 60000, rowH).last, true);

console.log("\n[3] the window stays small no matter how long the list is");
const big = windowRange(-500000, VIEW, 60000);
check("60,000 rows still render a bounded window", big.last - big.first <= Math.ceil(VIEW / rowH) + overscan * 2, true);
// Derived from the scroll offset rather than written down: the point is that
// the window tracks the fold, which is true at any row height.
check("window is far from the start when scrolled deep",
  big.first, Math.floor(500000 / rowH) - overscan);
const atEnd = windowRange(-(60000 * rowH) + VIEW, VIEW, 60000);
check("scrolled to the end, last row is included", atEnd.last, 60000);

console.log("\n[4] edge cases");
check("empty list yields an empty window", windowRange(0, VIEW, 0), { first: 0, last: 0 });
check("list shorter than the fold renders whole", windowRange(0, VIEW, 5), { first: 0, last: 5 });
check("overscrolled above the list clamps to 0", windowRange(400, VIEW, 100).first, 0);
// A short file loaded while the pane is still scrolled deep into a long one.
// Unclamped this returned first 8325 against a total of 31, so the slice came
// back empty and the pane rendered nothing at all.
const past = windowRange(-200000, VIEW, 31);
check("scrolled past a short list still yields a usable window", past.first < past.last, true);
check("scrolled past a short list ends at the last row", past.last, 31);
check("tiny viewport still renders overscan", windowRange(0, 0, 100).last, overscan * 2);

console.log("\n[5] striping is positional, not :nth-child");
// Matches the selector, not the comment that explains why it isn't used.
check("no nth-child striping left in the stylesheet", /:nth-child\s*\(/.test(html), false);
check("alt class is applied by absolute index", /\(first \+ n\) % 2 === 1/.test(html), true);
// The tree bands by structure instead: only group headers are tinted, so
// there is no alternating class to get out of step with the window.
check("the tree does not stripe by row", /\.trow\.alt/.test(html), false);
check("it tints group headers instead", /\.tgroup \{ background/.test(html), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
