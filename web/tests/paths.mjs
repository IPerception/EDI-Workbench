// Shared paths and small helpers for the browser-app test harnesses.
//
// Resolved from this file's own location rather than the working directory,
// so `node web/tests/parity.mjs` and `cd web/tests && node parity.mjs` both
// work, on any machine, without the absolute paths these harnesses carried
// while they lived in a session scratchpad.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
export const PROJECT = join(TESTS_DIR, "..", "..");

export const APP = join(PROJECT, "web", "EDIWorkbench.html");
export const FIXTURE = join(PROJECT, "tests", "fixtures", "sample_837p.edi");
// The post-adjudicated report, 005010X298. A separate fixture rather than a
// variant of the one above: the 837P fixture is what parity and half the
// assertions in every other suite are pinned to, and it has to stay put.
export const PACDR_FIXTURE = join(PROJECT, "tests", "fixtures", "sample_837_pacdr.edi");
// The 835 remittance advice, 005010X221A1. Own fixture, same reasoning as
// PACDR_FIXTURE: the 837P fixture is what parity and half of every other
// suite's assertions are pinned to, and an 835 is a different transaction
// entirely, not a variant of it.
export const X221_FIXTURE = join(PROJECT, "tests", "fixtures", "sample_835.edi");
export const MAKE_REF = join(TESTS_DIR, "make_ref.py");

// Committed manual-test samples. Generated, but kept in the repo so a UI
// change can be checked without first working out which generator to run.
export const SAMPLES_DIR = join(TESTS_DIR, "samples");

// Scratch space for generated reference output. Git-ignored: the Python
// engine regenerates it on demand, and processed EDI may carry PHI.
export const REF_DIR = join(TESTS_DIR, "ref");

// The app's version, read out of the rail footer.
//
// That string is the single source of truth, and it is deliberately the one a
// user can see: the HTML file gets copied to desktops and shared drives, cut
// off from the repo, so whatever it says on screen is the only version anyone
// can establish. Everything else is derived from it — the git tag and the
// release asset filename are computed in release.mjs, never typed a second
// time, so they cannot drift from what the downloaded file reports.
export function appVersion(html = readFileSync(APP, "utf8")) {
  const hits = [...html.matchAll(/class="version">v(\d+\.\d+\.\d+)</g)];
  if (hits.length !== 1) {
    throw new Error(`expected exactly one version string in the app, found ${hits.length}`);
  }
  return hits[0][1];
}
