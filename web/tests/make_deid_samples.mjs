// Writes 837P files for exercising the Create Limited Data Set button by hand.
//
//   node web/tests/make_deid_samples.mjs [outputDir]
//
// Defaults to web/tests/samples/deid/, which is committed. deid.mjs covers
// the same properties automatically; these exist because the thing worth
// checking -- that one person reads as one person after the run, and that the
// providers still read as the same providers -- is something you confirm by
// looking at the Changes tab, which no suite does.
//
// Every name, address, member id, NPI and account number here is invented.
// Nothing in this directory derives from a production file.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { TESTS_DIR } from "./paths.mjs";

const outDir = process.argv[2] || join(TESTS_DIR, "samples", "deid");
mkdirSync(outDir, { recursive: true });

const ISA = "ISA*00*          *00*          *ZZ*SUBMITTERID    *ZZ*RECEIVERID     *230101*1200*^*00501*000000001*0*T*:";
const GS = "GS*HC*SUBMITTERID*RECEIVERID*20230101*1200*1*X*005010X222A1";

// Control counts are filled in, so the Checks tab stays quiet and anything it
// reports while looking at these is a real regression.
function envelope(body) {
  const segments = ["ST*837*0001*005010X222A1", "BHT*0019*00*REF01*20230101*1200*CH", ...body];
  return [ISA, GS, ...segments, `SE*${segments.length + 1}*0001`, "GE*1*1", "IEA*1*000000001"]
    .map((s) => s + "~").join("\n") + "\n";
}

// 2000A / 2010AA. A natural person on purpose: a billing provider called
// ANNA WHITFIELD is exactly what a "looks like a human name" rule would
// wrongly scramble, and she must come out untouched.
const billing = (childCode) => [
  `HL*1**20*${childCode}`,
  "NM1*85*1*WHITFIELD*ANNA*R***XX*1234567893",
  "N3*500 MEDICAL PARKWAY*SUITE 200",
  "N4*COLUMBUS*OH*43215",
  "REF*EI*123456789",
  "PER*IC*BILLING OFFICE*TE*6145559000",
];

const line = (n, code, charge, date) => [
  `LX*${n}`,
  `SV1*HC:${code}*${charge}*UN*1***${n}`,
  `DTP*472*D8*${date}`,
];

// 2300. The referring and rendering providers inside are natural persons too,
// and are the second half of the "providers stay real" check.
const claim = (acct, total, onset, lines, extra = []) => [
  `CLM*${acct}*${total}***11:B:1*Y*A*Y*Y`,
  "HI*ABK:J209",
  `DTP*431*D8*${onset}`,
  ...extra,
  "NM1*DN*1*FEATHERSTONE*MARCUS****XX*1987654321",
  "NM1*82*1*OKONKWO*ADAEZE****XX*1122334455",
  ...lines.flatMap((l, i) => line(i + 1, l[0], l[1], l[2])),
];

/* --- 1. one member, several claims ------------------------------------
 * The consistency case, and the reason the mapping is keyed on the person
 * rather than on each field. ROBERT MACDONALD appears once as the subscriber
 * and carries four claims; after a run all four must still belong to one
 * person with one name and one member id.
 */
writeFileSync(join(outDir, "repeat_patient.edi"), envelope([
  ...billing(1),
  "HL*2*1*22*0",
  "SBR*P*18*******CI",
  "NM1*IL*1*MACDONALD*ROBERT*T***MI*W123456789",
  "N3*42 CHERRY TREE LANE*APT 3B",
  "N4*COLUMBUS*OH*43215",
  "DMG*D8*19800115*M",
  "REF*SY*123456789",
  "PER*IC*ROBERT MACDONALD*TE*6145550101*EM*rmacdonald@example.com",
  "NM1*PR*2*ACME PAYER*****PI*12345",
  ...claim("ACCT0001", "250", "20230103", [["99213", "150", "20230105"], ["99214", "100", "20230112"]],
    ["REF*EA*MRN0099887"]),
  ...claim("ACCT0002", "80", "20230201", [["99212", "80", "20230210"]], ["REF*EA*MRN0099887"]),
  ...claim("ACCT0003", "120", "20230305", [["99215", "120", "20230310"]], ["REF*EA*MRN0099887"]),
  ...claim("ACCT0004", "95", "20230402", [["99213", "95", "20230409"]], ["REF*EA*MRN0099887"]),
]), "utf8");

/* --- 2. patient distinct from subscriber, plus a COB block ------------
 * Three different people in one transaction: the subscriber, their child as
 * the patient in a 2000C loop, and the subscriber again inside the 2330A
 * other-subscriber block. The two MACDONALD ROBERT entries must come out
 * identical to each other and different from SUZETTE's.
 */
writeFileSync(join(outDir, "patient_and_cob.edi"), envelope([
  ...billing(1),
  "HL*2*1*22*1",
  "SBR*P*18*******CI",
  "NM1*IL*1*MACDONALD*ROBERT*T***MI*W123456789",
  "N3*42 CHERRY TREE LANE",
  "N4*COLUMBUS*OH*43215",
  "DMG*D8*19800115*M",
  "REF*SY*123456789",
  "NM1*PR*2*ACME PAYER*****PI*12345",
  ...claim("ACCT1001", "250", "20230103", [["99213", "150", "20230105"], ["99214", "100", "20230112"]]),
  "HL*3*2*23*0",
  "PAT*19",
  "NM1*QC*1*MACDONALD*SUZETTE*Q",
  "N3*42 CHERRY TREE LANE",
  "N4*COLUMBUS*OH*43215",
  "DMG*D8*20140620*F",
  ...claim("ACCT2001", "40", "20230301", [["99391", "40", "20230305"]], [
    "REF*EA*MRN0044556",
    // 2320/2330A: the subscriber named a third time. Precedes the service
    // lines, which is what puts it in the claim rather than in loop 2400.
    "SBR*S*18*******CI",
    "NM1*IL*1*MACDONALD*ROBERT*T***MI*W123456789",
    "NM1*PR*2*OTHER PAYER*****PI*67890",
    "DTP*573*D8*20230315",
  ]),
]), "utf8");

/* --- 3. nothing to strip ---------------------------------------------
 * A transaction whose only names are a provider and a payer. The run must
 * complete and report no changes rather than inventing any.
 */
writeFileSync(join(outDir, "no_patient_loops.edi"), envelope([
  ...billing(0),
  "NM1*87*2*PAY TO CLINIC*****XX*9988776655",
  "N3*500 MEDICAL PARKWAY",
  "N4*COLUMBUS*OH*43215",
]), "utf8");

/* --- 4. odd shapes the rule has to survive ----------------------------
 * A subscriber with no member id at all (keyed on name + date of birth
 * instead), an RD8 date range that shiftDate8 rejects outright, a claim whose
 * dates run backwards, and a malformed date that must be skipped rather than
 * failing the file.
 */
writeFileSync(join(outDir, "awkward_values.edi"), envelope([
  ...billing(1),
  "HL*2*1*22*0",
  "SBR*P*18*******CI",
  "NM1*IL*1*BLAKE*HENRY",
  "N3*9 THE LIMES",
  "N4*COLUMBUS*OH*43215",
  "DMG*D8*19750808*M",
  "CLM*ACCT9001*300***11:B:1*Y*A*Y*Y",
  "HI*ABK:J209",
  "DTP*431*D8*20230103",
  "LX*1",
  "SV1*HC:99213*150*UN*1***1",
  "DTP*472*RD8*20230105-20230109",
  "LX*2",
  "SV1*HC:99214*150*UN*1***1",
  "DTP*472*D8*20231301", // month 13: impossible, must be left alone
]), "utf8");

console.log(`wrote 4 files to ${outDir}`);
