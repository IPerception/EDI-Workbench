// Runs every correctness harness for the browser app and reports one verdict.
//
//   node web/tests/all.mjs
//
// parity.mjs additionally shells out to Python to regenerate the reference
// output from edi_engine; the rest are pure Node.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { TESTS_DIR } from "./paths.mjs";

const SUITES = [
  ["parity", "engine matches the Python edi_engine byte for byte"],
  ["outline", "document outline + qualifier decoding"],
  ["claims", "claim/service-line index, PHI masking, CSV export"],
  ["virtual", "virtual list windowing arithmetic"],
  ["lint", "single-file self-containment and markup"],
];

const failed = [];
for (const [name, blurb] of SUITES) {
  console.log(`\n${"=".repeat(66)}\n${name}.mjs — ${blurb}\n${"=".repeat(66)}`);
  try {
    console.log(execFileSync(process.execPath, [join(TESTS_DIR, `${name}.mjs`)], { encoding: "utf8" }));
  } catch (e) {
    // execFileSync throws on non-zero exit; the suite's own output is on stdout.
    console.log(e.stdout || "");
    console.log(e.stderr || "");
    failed.push(name);
  }
}

console.log("=".repeat(66));
if (failed.length) {
  console.log(`FAILED: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(`All ${SUITES.length} suites passed.`);
