// Cuts a release from the version the app states about itself.
//
//   node web/release.mjs              # dry run: check everything, publish nothing
//   node web/release.mjs --publish    # actually create the tag and the release
//
// The point of this script is that the version is written down once, in the
// rail footer of EDIWorkbench.html. The tag and the asset filename are derived
// from that string here, so the three can never disagree — which matters
// because the single HTML file circulates detached from the repo, and the
// version it shows on screen is the only thing a holder of a stray copy can go
// on. Typing the tag by hand at `gh release create` is exactly how that breaks.
//
// Needs `gh` authenticated. Notes are read from the tag message if you pass
// --notes-file, otherwise GitHub generates them from the commit log.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APP, PROJECT, TESTS_DIR, appVersion } from "./tests/paths.mjs";

const publish = process.argv.includes("--publish");
const notesAt = process.argv.indexOf("--notes-file");
const notesFile = notesAt === -1 ? null : process.argv[notesAt + 1];

const git = (...args) => execFileSync("git", args, { cwd: PROJECT, encoding: "utf8" }).trim();
const step = (m) => console.log(`  ${m}`);
const die = (m) => { console.error(`\nFAILED: ${m}`); process.exit(1); };

console.log(`\n${"=".repeat(66)}\nrelease.mjs — ${publish ? "publishing" : "dry run"}\n${"=".repeat(66)}`);

/* --- 1. what version does the app claim to be? ---------------------- */
let version;
try { version = appVersion(); } catch (e) { die(e.message); }
const tag = `v${version}`;
const asset = `EDIWorkbench-${tag}.html`;
step(`app states ${tag} -> tag ${tag}, asset ${asset}`);

/* --- 2. that version must not already be released ------------------- */
// Re-cutting a tag silently strands everyone who downloaded the first one
// with a file that says the same version but isn't the same bytes.
//
// Fetch first, and this is the whole reason why: `gh release create` makes the
// tag on the server, so a repo that published a release from this machine can
// still have no local tag for it. `git tag -l` alone reported v1.0.0 free
// while it was live on GitHub.
git("fetch", "--tags", "--quiet", "origin");
const tags = git("tag", "-l").split(/\r?\n/).filter(Boolean);
if (tags.includes(tag)) {
  die(`${tag} already exists. Bump the version in the rail footer of\n        web/EDIWorkbench.html, commit, then run this again.`);
}
step(`${tag} is not taken`);

/* --- 3. the tree must be clean and pushed --------------------------- */
// The asset is a copy of the working-tree file. If the tree is dirty, the
// bytes people download are ones that were never committed anywhere.
if (git("status", "--porcelain")) die("working tree is dirty. Commit or stash first.");
step("working tree is clean");

const branch = git("rev-parse", "--abbrev-ref", "HEAD");
git("fetch", "--quiet", "origin", branch);
if (git("rev-parse", "HEAD") !== git("rev-parse", `origin/${branch}`)) {
  die(`${branch} and origin/${branch} disagree. Push first, so the tag points at a commit that exists on the remote.`);
}
step(`${branch} matches origin/${branch}`);

/* --- 4. the suites must pass ---------------------------------------- */
try {
  execFileSync(process.execPath, [join(TESTS_DIR, "all.mjs")], { encoding: "utf8" });
  step("all 8 suites pass");
} catch (e) {
  console.log(e.stdout || "");
  die("the test suites do not pass");
}

/* --- 5. stage the asset under its derived name ---------------------- */
// Copied to a temp dir rather than renamed in place: the repo keeps one
// unversioned EDIWorkbench.html, and only the download carries the version
// in its name.
const staged = join(mkdtempSync(join(tmpdir(), "ediwb-")), asset);
copyFileSync(APP, staged);
if (!readFileSync(staged, "utf8").includes(`class="version">v${version}<`)) {
  die("the staged asset does not state the version it is named for");
}
step(`staged ${asset} (${readFileSync(staged).length} bytes), version confirmed inside it`);

if (!publish) {
  console.log(`\nDry run only. Re-run with --publish to create ${tag}.`);
  process.exit(0);
}

/* --- 6. publish ----------------------------------------------------- */
const args = ["release", "create", tag, staged, "--title", tag, "--target", branch];
args.push(...(notesFile ? ["--notes-file", notesFile] : ["--generate-notes"]));
console.log(execFileSync("gh", args, { cwd: PROJECT, encoding: "utf8" }));
step(`published ${tag}`);
