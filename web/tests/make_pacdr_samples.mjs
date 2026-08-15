// Writes post-adjudicated report files (005010X298) for testing by hand.
//
//   node web/tests/make_pacdr_samples.mjs [outputDir]
//
// Defaults to web/tests/samples/pacdr/, which is committed. The clean report
// is a copy of the fixture, and each of the others is derived from it by one
// edit, so each trips exactly one of the three adjudication findings. Every
// automated equivalent lives in validate.mjs and claims.mjs -- these exist
// for the Claims and Tree tabs, which no suite looks at.
//
// The mutations are the same ones validate.mjs makes, deliberately: a sample
// that trips a different finding from the one its name claims is worse than
// no sample. Everything here is invented; nothing derives from a real file.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { PACDR_FIXTURE, TESTS_DIR } from "./paths.mjs";

const outDir = process.argv[2] || join(TESTS_DIR, "samples", "pacdr");
mkdirSync(outDir, { recursive: true });

const raw = readFileSync(PACDR_FIXTURE, "utf8");

const SAMPLES = [
  ["clean_report.edi", "two payers, two lines, everything reconciles",
    (s) => s],

  ["payer_total_off.edi", "the primary payer's AMT*D states 250.00; its own lines pay 240.00",
    (s) => s.replace("AMT*D*240~", "AMT*D*250~")],

  // Both 2430s on line 1 stop reconciling: the first no longer makes up the
  // line charge, and the second no longer matches what it left behind.
  ["line_does_not_reconcile.edi", "an altered CAS breaks both adjudications on line 1",
    (s) => s.replace("CAS*PR*2*40~", "CAS*PR*2*35~")],

  ["unknown_payer.edi", "an SVD-01 naming a payer no 2330B on the claim identifies",
    (s) => s.replace("SVD*LBP0002*30*", "SVD*NOSUCH01*30*")],
];

console.log(`Writing ${SAMPLES.length} samples to ${outDir}\n`);
for (const [name, why, transform] of SAMPLES) {
  writeFileSync(join(outDir, name), transform(raw), "utf8");
  console.log(`  ${name.padEnd(28)} ${why}`);
}
console.log(`\nclean_report.edi is a copy of ${PACDR_FIXTURE}, which the app also ships` +
  "\nas its PACDR sample button -- lint.mjs holds those two byte-identical.");
