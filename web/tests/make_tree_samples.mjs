// Writes 837P files that exercise the Tree tab's structural cases.
//
//   node web/tests/make_tree_samples.mjs [outputDir]
//
// Defaults to web/tests/samples/tree/, which is committed: these are the
// shapes the single committed fixture doesn't have -- HL loops nesting more
// than two deep, several siblings at one level, a broken parent pointer,
// coordination of benefits, and a file big enough that virtualization has to
// earn its keep. tree.mjs covers the same structures automatically; these
// exist for looking at the UI, which no suite covers.
//
// Every name, address and identifier here is invented. Nothing in this
// directory derives from a production file.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { TESTS_DIR } from "./paths.mjs";

const outDir = process.argv[2] || join(TESTS_DIR, "samples", "tree");
mkdirSync(outDir, { recursive: true });

const ISA = "ISA*00*          *00*          *ZZ*SUBMITTERID    *ZZ*RECEIVERID     *230101*1200*^*00501*000000001*0*T*:";
const GS = "GS*HC*SUBMITTERID*RECEIVERID*20230101*1200*1*X*005010X222A1";

// Wraps transaction bodies in an envelope, filling in every control count so
// the Checks tab stays quiet and the Tree tab is the only thing under test.
// The deliberately broken files live next door, in samples/checks/.
function envelope(bodies) {
  const out = [ISA, GS];
  bodies.forEach((body, i) => {
    const ctrl = String(i + 1).padStart(4, "0");
    const segments = ["ST*837*" + ctrl + "*005010X222A1", ...body];
    out.push(...segments, `SE*${segments.length + 1}*${ctrl}`);
  });
  out.push(`GE*${bodies.length}*1`, "IEA*1*000000001");
  return out.map((s) => s + "~").join("\n") + "\n";
}

const line = (n, code, charge) => [`LX*${n}`, `SV1*HC:${code}*${charge}*UN*1***${n}`, "DTP*472*D8*20230101"];
const claim = (acct, total, lines) => ["CLM*" + acct + "*" + total + "***11:B:1*Y*A*Y*Y", "HI*ABK:J209",
  ...lines.flatMap((l, i) => line(i + 1, l[0], l[1]))];

const subscriber = (hlId, parent, name, memberId, claims) => [
  `HL*${hlId}*${parent}*22*${claims.dependent ? 1 : 0}`,
  "SBR*P*18*******CI",
  `NM1*IL*1*${name}*JOHN****MI*${memberId}`,
  "N3*456 ELM ST",
  "N4*ANYTOWN*CA*90210",
  "DMG*D8*19800101*M",
  "NM1*PR*2*INSURANCE COMPANY*****PI*987654321",
  ...claims.list.flatMap((c) => claim(c[0], c[1], c[2])),
];

const billing = (hlId, childCode) => [
  `HL*${hlId}**20*${childCode}`,
  "NM1*85*2*BILLING PROVIDER NAME*****XX*1234567893",
  "N3*123 MAIN ST",
  "N4*ANYTOWN*CA*90210",
  "REF*EI*123456789",
];

const header = ["BHT*0019*00*0001*20230101*1200*CH",
  "NM1*41*2*SUBMITTER NAME*****46*SUBMITTERID",
  "PER*IC*CONTACT NAME*TE*5551234567",
  "NM1*40*2*RECEIVER NAME*****46*RECEIVERID"];

const SAMPLES = [];

/* Several siblings at each level, and a dependent nested three HLs deep. */
SAMPLES.push(["multi_hl.edi", "2000A > 2000B > 2000C, with sibling loops at each level",
  envelope([[
    ...header,
    ...billing(1, 1),
    ...subscriber(2, 1, "SMITH", "111111111A", { list: [["ACCT-A1", "300", [["99213", "100"], ["87070", "200"]]]] }),
    ...subscriber(3, 1, "JONES", "222222222B", { dependent: true, list: [["ACCT-B1", "150", [["99214", "150"]]]] }),
    // A patient under that subscriber: HL level 23, three deep.
    "HL*4*3*23*0",
    "PAT*19",
    "NM1*QC*1*JONES*TIMMY",
    "N3*456 ELM ST",
    "DMG*D8*20150612*M",
    ...claim("ACCT-B2-CHILD", "75", [["99392", "75"]]),
    ...billing(5, 1),
    ...subscriber(6, 5, "OKONKWO", "333333333C", { list: [
      ["ACCT-C1", "500", [["99215", "250"], ["93000", "250"]]],
      ["ACCT-C2", "80", [["36415", "80"]]],
    ] }),
  ]])]);

/* A subscriber whose parent pointer names an HL that never opened. The tree
   must attach it to the transaction rather than lose it. */
SAMPLES.push(["dangling_hl.edi", "an HL-02 pointing at a parent that does not exist",
  envelope([[
    ...header,
    ...billing(1, 1),
    ...subscriber(2, 1, "VALID", "444444444D", { list: [["ACCT-OK", "100", [["99213", "100"]]]] }),
    ...subscriber(3, 9, "ORPHAN", "555555555E", { list: [["ACCT-ORPHAN", "60", [["99212", "60"]]]] }),
  ]])]);

/* Two transactions, so the tree shows more than one ST branch and restarts
   its claim numbering inside each. */
SAMPLES.push(["two_transactions.edi", "two ST branches under one functional group",
  envelope([
    [...header, ...billing(1, 1),
      ...subscriber(2, 1, "ALPHA", "666666666F", { list: [["T1-ACCT", "120", [["99213", "120"]]]] })],
    [...header, ...billing(1, 1),
      ...subscriber(2, 1, "BETA", "777777777G", { list: [["T2-ACCT", "240", [["99214", "240"]]]] })],
  ])]);

/* Coordination of benefits: the case where the same segment names a
   different loop depending on where it sits. NM1*82 is 2310B under the claim
   and 2420A under the service line; NM1*IL is 2010BA in the subscriber loop
   and 2330A inside the other-subscriber block. */
SAMPLES.push(["cob_loops.edi", "context-sensitive loop ids: 2310B vs 2420A, 2010BA vs 2330A",
  envelope([[
    ...header,
    ...billing(1, 1),
    "HL*2*1*22*0",
    "SBR*P*18*******CI",
    "NM1*IL*1*PRIMARY*PAT****MI*999999999X",
    "N3*12 FIRST ST",
    "N4*ANYTOWN*CA*90210",
    "DMG*D8*19700101*F",
    "NM1*PR*2*PRIMARY PAYER*****PI*111111111",
    "CLM*COB-ACCT*400***11:B:1*Y*A*Y*Y",
    "HI*ABK:J209",
    // Claim-level providers: 2310A, 2310B, 2310C.
    "NM1*DN*1*REFERRING*RAY****XX*1122334455",
    "NM1*82*1*RENDERING*ROB****XX*2233445566",
    "NM1*77*2*SERVICE FACILITY*****XX*3344556677",
    // Other subscriber information: 2320, holding 2330A and 2330B.
    "SBR*S*18*******CI",
    "CAS*CO*45*50",
    "AMT*D*350",
    "OI***Y***Y",
    "NM1*IL*1*SECONDARY*PAT****MI*888888888Y",
    "N3*34 SECOND ST",
    "NM1*PR*2*SECONDARY PAYER*****PI*222222222",
    // Service line, then line-level versions of the same providers.
    "LX*1",
    "SV1*HC:99215*400*UN*1***1",
    "DTP*472*D8*20230101",
    "NM1*82*1*LINE RENDERING*LEE****XX*4455667788",
    "NM1*DK*1*ORDERING*OLA****XX*5566778899",
    "LIN**N4*00093721410",
    "CTP****5*UN",
    "SVD*222222222*350*HC:99215**1",
    "CAS*CO*45*50",
    "DTP*573*D8*20230115",
  ]])]);

/* Wide composites, so element rows split into many component rows. */
SAMPLES.push(["wide_composites.edi", "composites deep enough to fill the element breakdown",
  envelope([[
    ...header,
    ...billing(1, 1),
    "HL*2*1*22*0",
    "SBR*P*18*******CI",
    "NM1*IL*1*COMPOSITE*TESTER****MI*888888888H",
    "N3*789 OAK AVE:SUITE 400",
    "N4*ANYTOWN*CA*90210",
    "DMG*D8*19750304*F",
    "NM1*PR*2*INSURANCE COMPANY*****PI*987654321",
    "CLM*WIDE-ACCT*450***11:B:1*Y*A*Y*Y",
    "HI*ABK:J209:::::::*ABF:E119*ABF:I10*ABF:Z79899",
    "LX*1",
    "SV1*HC:99215:25:59:GT:XU:Comprehensive visit*450*UN*1***1:2:3:4",
    "DTP*472*RD8*20230101-20230131",
  ]])]);

/* Big enough that the flattened row list has to be virtualized. */
const bulk = [...header];
let hl = 1;
bulk.push(...billing(hl++, 1));
for (let i = 0; i < 600; i++) {
  bulk.push(...subscriber(hl, 1, "PATIENT" + String(i).padStart(4, "0"), `9${String(i).padStart(8, "0")}`, {
    list: [["ACCT-" + String(i).padStart(5, "0"), "300", [["99213", "100"], ["87070", "200"]]]],
  }));
  hl++;
}
SAMPLES.push(["large.edi", "600 subscribers, ~9,000 segments -- for scrolling the expanded tree",
  envelope([bulk])]);

console.log(`Writing ${SAMPLES.length} samples to ${outDir}\n`);
for (const [name, why, text] of SAMPLES) {
  writeFileSync(join(outDir, name), text, "utf8");
  console.log(`  ${name.padEnd(22)} ${why}`);
}
console.log("\nAll six report no problems in the Checks tab; deliberately broken files are in ../checks/.");
