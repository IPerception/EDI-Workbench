// Writes deliberately broken 837P files for testing the Checks tab by hand.
//
//   node web/tests/make_samples.mjs [outputDir]
//
// Defaults to web/tests/samples/checks/, which is committed: each file is
// derived from the fixture and exists to trip exactly one finding. The
// automated equivalents live in validate.mjs -- this is for looking at the
// UI, which no suite covers. Structurally interesting but valid files are
// next door, in samples/tree/.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { FIXTURE, TESTS_DIR } from "./paths.mjs";

const outDir = process.argv[2] || join(TESTS_DIR, "samples", "checks");
mkdirSync(outDir, { recursive: true });

const raw = readFileSync(FIXTURE, "utf8");

const SAMPLES = [
  ["bad_se_count.edi", "SE-01 states 26 segments; 27 are present",
    (s) => s.replace("SE*27*0001~", "SE*26*0001~")],

  ["bad_control_number.edi", "SE-02 is 0009 but ST-02 is 0001",
    (s) => s.replace("SE*27*0001~", "SE*27*0009~")],

  ["unbalanced_claim.edi", "CLM-02 states 175.00; the lines total 150.00",
    (s) => s.replace("CLM*PATIENTACCTNUM*150*", "CLM*PATIENTACCTNUM*175*")],

  ["unclosed_envelope.edi", "the ISA has no IEA",
    (s) => s.replace("IEA*1*000000001~\n", "")],

  ["bad_amount.edi", "a line charge that isn't a number -- warning, not error",
    (s) => s.replace("SV1*HC:99213*100*", "SV1*HC:99213*ABC*")],

  // Several faults at once, so the tab badge and the claim table get
  // exercised together: two claims, modifiers on a line, and an inpatient
  // place of service.
  ["multi_problem.edi", "two findings, plus a second claim and modifiers",
    (s) => s
      .replace("SV1*HC:99213*100*", "SV1*HC:99213:25:59*100*")
      .replace("SE*27*0001~",
        "CLM*SECOND*300***21:B:7*Y*A*Y*Y~\nHI*ABK:E119~\nLX*1~\n" +
        "SV1*HC:99214*250*UN*2***1~\nDTP*472*D8*20230105~\nSE*26*0001~")
      .replace("IEA*1*000000001~", "IEA*2*000000001~")],
];

console.log(`Writing ${SAMPLES.length} samples to ${outDir}\n`);
for (const [name, why, transform] of SAMPLES) {
  writeFileSync(join(outDir, name), transform(raw), "utf8");
  console.log(`  ${name.padEnd(24)} ${why}`);
}
console.log(`\nThe clean original is at ${FIXTURE} -- it should report no problems.`);
