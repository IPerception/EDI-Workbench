// Shared path resolution for the browser-app test harnesses.
//
// Resolved from this file's own location rather than the working directory,
// so `node web/tests/parity.mjs` and `cd web/tests && node parity.mjs` both
// work, on any machine, without the absolute paths these harnesses carried
// while they lived in a session scratchpad.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
export const PROJECT = join(TESTS_DIR, "..", "..");

export const APP = join(PROJECT, "web", "EDIWorkbench.html");
export const FIXTURE = join(PROJECT, "tests", "fixtures", "sample_837p.edi");
export const MAKE_REF = join(TESTS_DIR, "make_ref.py");

// Committed manual-test samples. Generated, but kept in the repo so a UI
// change can be checked without first working out which generator to run.
export const SAMPLES_DIR = join(TESTS_DIR, "samples");

// Scratch space for generated reference output. Git-ignored: the Python
// engine regenerates it on demand, and processed EDI may carry PHI.
export const REF_DIR = join(TESTS_DIR, "ref");
