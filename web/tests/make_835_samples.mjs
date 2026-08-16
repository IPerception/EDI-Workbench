// Writes 835 remittance advice files (005010X221A1) for testing by hand.
//
//   node web/tests/make_835_samples.mjs [outputDir]
//
// Defaults to web/tests/samples/835/, which is committed. The clean report is
// a copy of the fixture, and each of the others is derived from it by one
// edit, so each trips exactly one of the three balancing findings. Every
// automated equivalent lives in validate.mjs -- these exist for the Tree and
// Checks tabs, which no suite looks at.
//
// The mutations are the same ones validate.mjs makes, deliberately: a sample
// that trips a different finding from the one its name claims is worse than
// no sample. Everything here is invented; nothing derives from a real file.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { X221_FIXTURE, TESTS_DIR } from "./paths.mjs";

const outDir = process.argv[2] || join(TESTS_DIR, "samples", "835");
mkdirSync(outDir, { recursive: true });

const raw = readFileSync(X221_FIXTURE, "utf8");

const SAMPLES = [
  ["clean_remittance.edi", "two lines, a reversal claim, and a PLB -- everything reconciles",
    (s) => s],

  ["line_does_not_reconcile.edi", "claim 1 line 1's SVC-03 states 150.00; SVC-02 minus its CAS comes to 160.00",
    (s) => s.replace("SVC*HC:99213*200*160**1~", "SVC*HC:99213*200*150**1~")],

  ["claim_does_not_reconcile.edi",
    "claim 1's CLP-04 states 250.00 (CLP-03 minus its CAS comes to 240.00) -- and since BPR-02 is " +
    "computed from CLP-04, the transaction total is now wrong too",
    (s) => s.replace("*300*240*60*CI*QF98001234*11~", "*300*250*60*CI*QF98001234*11~")],

  ["total_does_not_reconcile.edi", "BPR-02 states 145.00; every CLP-04 minus every PLB-04 comes to 135.00",
    (s) => s.replace("BPR*I*135*C*", "BPR*I*145*C*")],
];

console.log(`Writing ${SAMPLES.length} samples to ${outDir}\n`);
for (const [name, why, transform] of SAMPLES) {
  writeFileSync(join(outDir, name), transform(raw), "utf8");
  console.log(`  ${name.padEnd(28)} ${why}`);
}
console.log(`\nclean_remittance.edi is a copy of ${X221_FIXTURE}, which the app also ships` +
  "\nas its 835 sample button -- lint.mjs holds those two byte-identical.");
