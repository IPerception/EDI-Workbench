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

console.log("\n[2] windowRange covers the fold at every scroll position");
const src = html.slice(html.indexOf("function windowRange"), html.indexOf("function paintWindow"));
const { windowRange } = await import(
  "data:text/javascript;base64," +
  Buffer.from(`const ROW_H=${rowH},OVERSCAN=${overscan};\n${src}\nexport {windowRange};`).toString("base64")
);

const VIEW = 900;
for (const total of [1, 7, 100, 1200, 60000]) {
  const listHeight = total * rowH;
  let worst = null;
  // Sweep the whole scroll range, plus overscroll in both directions.
  for (let top = VIEW + 40; top >= -listHeight - 40; top -= 7) {
    const { first, last } = windowRange(top, VIEW, total);

    if (first < 0 || last > total || first > last) { worst = `bad range ${first}..${last} at top=${top}`; break; }

    // Which rows genuinely intersect the fold [0, VIEW]?
    const firstOnScreen = Math.max(0, Math.floor(-top / rowH));
    const lastOnScreen = Math.min(total, Math.ceil((-top + VIEW) / rowH));
    if (firstOnScreen >= total || lastOnScreen <= 0) continue; // list entirely off screen

    if (first > firstOnScreen || last < lastOnScreen) {
      worst = `gap at top=${top}: rendered ${first}..${last}, on screen ${firstOnScreen}..${lastOnScreen}`;
      break;
    }
  }
  check(`${total.toLocaleString()} rows: window always covers the fold`, worst, null);
}

console.log("\n[3] the window stays small no matter how long the list is");
const big = windowRange(-500000, VIEW, 60000);
check("60,000 rows still render a bounded window", big.last - big.first <= Math.ceil(VIEW / rowH) + overscan * 2, true);
check("window is far from the start when scrolled deep", big.first > 20000, true);
const atEnd = windowRange(-(60000 * rowH) + VIEW, VIEW, 60000);
check("scrolled to the end, last row is included", atEnd.last, 60000);

console.log("\n[4] edge cases");
check("empty list yields an empty window", windowRange(0, VIEW, 0), { first: 0, last: 0 });
check("list shorter than the fold renders whole", windowRange(0, VIEW, 5), { first: 0, last: 5 });
check("overscrolled above the list clamps to 0", windowRange(400, VIEW, 100).first, 0);
check("tiny viewport still renders overscan", windowRange(0, 0, 100).last, overscan * 2);

console.log("\n[5] striping is positional, not :nth-child");
check("no nth-child striping left in the stylesheet", /\.row:nth-child/.test(html), false);
check("alt class is applied by absolute index", /\(first \+ n\) % 2 === 1/.test(html), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
