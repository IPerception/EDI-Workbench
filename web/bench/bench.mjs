/**
 * Benchmarks the shipped browser engine on synthetic 837P interchanges.
 *
 *   node web/bench/bench.mjs                 # default size ladder
 *   node web/bench/bench.mjs 10 25 50        # specific sizes, in MB
 *
 * Each size runs in its own child process capped at 4 GB -- roughly the JS
 * heap a 64-bit desktop Chrome/Edge tab gets -- so an out-of-memory abort
 * costs one data point instead of the whole run.
 *
 * Reports two costs separately, because they are the two things a user
 * actually does and they have very different budgets:
 *
 *   load  -- parse only, i.e. open a file and browse it
 *   run   -- snapshot + rules + diff + serialize + the UI's re-parse
 *
 * Numbers come from Node, not a browser. Same V8, so the arithmetic
 * transfers; a real tab additionally pays for file.text() and the download
 * Blob, and a slower machine scales every time up. See ../PERFORMANCE.md
 * for the recorded baseline and what to do about it.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import v8 from "node:v8";

const SELF = fileURLToPath(import.meta.url);
const APP = join(dirname(SELF), "..", "EDIWorkbench.html");
const MB = 1024 * 1024;
const mb = (bytes) => (bytes / MB).toFixed(0);

const DEFAULT_SIZES = [1, 5, 10, 25, 50, 64, 80, 100, 125, 150];

/* ---------------- parent: drive one child per size ---------------- */

if (!process.env.BENCH_SIZE) {
  const sizes = process.argv.slice(2).map(Number).filter((n) => n > 0);
  const ladder = sizes.length ? sizes : DEFAULT_SIZES;

  console.log("\n  file     segments     load    browse heap      run    run heap peak   verdict");
  console.log("  " + "-".repeat(84));

  for (const size of ladder) {
    try {
      process.stdout.write(execFileSync(
        process.execPath,
        ["--expose-gc", "--max-old-space-size=4096", SELF],
        {
          encoding: "utf8",
          env: { ...process.env, BENCH_SIZE: String(size) },
          stdio: ["ignore", "pipe", "pipe"],
          maxBuffer: 8 * MB,
        }
      ));
    } catch (err) {
      const noise = (err.stderr || "") + (err.stdout || "");
      const oom = /heap out of memory|Allocation failed|Invalid string length/i.test(noise);
      console.log(`  ${(size + " MB").padEnd(8)}${" ".repeat(44)}${oom ? "OUT OF MEMORY" : "FAILED"}`);
    }
  }
  console.log("");
  process.exit(0);
}

/* ---------------- child: measure one size ---------------- */

const target = Number(process.env.BENCH_SIZE) * MB;

// Lift the engine straight out of the shipped file, so the benchmark can
// never drift from what actually runs in the browser.
const html = readFileSync(APP, "utf8");
const source = html.slice(html.indexOf("/* ---- document ---"), html.indexOf("/* engine:end */"));
if (!source) throw new Error("engine markers not found in " + APP);

const { parse, processText, Dtp472ServiceLineShiftRule, StringReplaceRule } = await import(
  "data:text/javascript;base64," +
  Buffer.from(
    source + "\nexport { parse, processText, Dtp472ServiceLineShiftRule, StringReplaceRule };"
  ).toString("base64")
);

const HEADER = [
  "ISA*00*          *00*          *ZZ*SUBMITTERID    *ZZ*RECEIVERID     *230101*1200*^*00501*000000001*0*T*:~",
  "GS*HC*SUBMITTERID*RECEIVERID*20230101*1200*1*X*005010X222A1~",
  "ST*837*0001*005010X222A1~",
  "BHT*0019*00*0001*20230101*1200*CH~",
  "NM1*41*2*SUBMITTER NAME*****46*SUBMITTERID~",
  "HL*1**20*1~",
  "NM1*85*2*BILLING PROVIDER NAME*****XX*1234567893~",
  "N3*123 MAIN ST~",
  "N4*ANYTOWN*CA*90210~",
].join("\n");

// One subscriber + claim + 6 service lines: ~35 segments averaging ~42
// bytes, which is close to a real 837P on the wire.
function claim(n) {
  return [
    `HL*${n + 2}*1*22*0~`,
    "SBR*P*18*******CI~",
    `NM1*IL*1*DOESUBSCRIBER${n}*JONATHAN****MI*${100000000 + n}A~`,
    `N3*${n} ELM STREET APARTMENT 4B~`,
    "N4*SPRINGFIELD*CA*902101234~",
    "DMG*D8*19800101*M~",
    "NM1*PR*2*BIG NATIONAL INSURANCE COMPANY*****PI*987654321~",
    `CLM*PATIENTACCOUNT${n}*${150 + (n % 900)}.00***11:B:1*Y*A*Y*Y*P*OA~`,
    "HI*ABK:J209*ABF:E1165*ABF:I10*ABF:Z79899~",
    "NM1*DN*1*REFERRINGPROVIDER*JANE****XX*1122334455~",
    "REF*EI*123456789~",
    ...[1, 2, 3, 4, 5, 6].flatMap((line) => [
      `LX*${line}~`,
      `SV1*HC:9921${line}:25*${50 * line}.00*UN*1***1:2:3:4~`,
      "DTP*472*D8*20230101~",
      `REF*6R*LINE${n}${line}~`,
    ]),
  ].join("\n");
}

// Build ~1 MB of varied claims once, then repeat it. One large allocation,
// so the harness does not compete with the engine for heap the way an
// array-of-millions-of-strings join would.
function buildInput(bytes) {
  const block = [];
  let size = 0, n = 0;
  while (size < MB) { const c = claim(n++); block.push(c); size += c.length + 1; }
  const chunk = block.join("\n") + "\n";
  const copies = Math.max(1, Math.round(bytes / chunk.length));
  return HEADER + "\n" + chunk.repeat(copies) + "SE*99*0001~\nGE*1*1~\nIEA*1*000000001~\n";
}

const heap = () => { global.gc(); return process.memoryUsage().heapUsed; };
const time = (fn) => { const at = performance.now(); const out = fn(); return [performance.now() - at, out]; };
const ms = (n) => Math.round(n) + " ms";

const raw = buildInput(target);
const base = heap();

const [loadTime, doc] = time(() => parse(raw));
const browseHeap = heap() - base;

const [runTime] = time(() => {
  const result = processText(raw, [
    new Dtp472ServiceLineShiftRule(1),
    new StringReplaceRule({ find: "SPRINGFIELD", replace: "METROPOLIS" }),
  ]);
  parse(result.output); // the UI re-parses so you can browse the edited doc; count it
  return result;
});
const runHeap = heap() - base;

const limit = v8.getHeapStatistics().heap_size_limit;
const verdict =
  runHeap > limit * 0.75 ? "at the edge" :
  runTime > 3000 ? "slow, usable" :
  runTime > 1000 ? "brief freeze" : "comfortable";

console.log(
  `  ${(process.env.BENCH_SIZE + " MB").padEnd(8)} ${doc.segments.length.toLocaleString().padStart(9)} ` +
  `${ms(loadTime).padStart(8)} ${(mb(browseHeap) + " MB").padStart(12)} ` +
  `${ms(runTime).padStart(9)} ${(mb(runHeap) + " MB").padStart(12)}    ${verdict}`
);
