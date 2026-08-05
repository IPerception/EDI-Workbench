# EDI Workbench (browser) — performance findings

**Measured 2026-08-03.** Status: findings recorded, no fixes applied yet.

## Recommendation

| Range | Verdict |
|---|---|
| **up to 25 MB** | Comfortable. Sub-second load, ~1.3 s to run rules. |
| **25–50 MB** | Usable. Noticeable freeze (1–3 s) but nothing breaks. |
| **50–100 MB** | Degraded. 3–7 s frozen tab; Chrome may offer to kill the page. |
| **100–125 MB** | Hard edge. 15 s and ~2 GB heap at 125 MB. |
| **150 MB+** | Out of memory on a 4 GB tab. |

For scale, 25 MB of 837P is roughly 30,000 claims. Most real batches sit well under
that, so the current build is fine for ordinary work — the improvements below are
about headroom and about not freezing the tab, not about unblocking normal use.

## Measurements

Synthetic 837P, ~41k segments per MB, ~42 bytes per segment (close to real
professional claims). Two rules active: service date shift + find/replace.

| File | Segments | Load & browse | Heap | Run rules | Peak heap |
|---:|---:|---:|---:|---:|---:|
| 1 MB | 41k | 17 ms | 8 MB | 57 ms | 15 MB |
| 5 MB | 206k | 83 ms | 39 MB | 230 ms | 74 MB |
| 10 MB | 410k | 144 ms | 79 MB | 446 ms | 148 MB |
| 25 MB | 1.0M | 351 ms | 195 MB | 1.3 s | 367 MB |
| 50 MB | 2.0M | 642 ms | 392 MB | 2.6 s | 736 MB |
| 64 MB | 2.6M | 855 ms | 495 MB | 3.1 s | 934 MB |
| 80 MB | 3.3M | 1.0 s | 624 MB | 5.0 s | 1.17 GB |
| 100 MB | 4.2M | 1.4 s | 883 MB | 6.9 s | 1.58 GB |
| 125 MB | 5.2M | 1.8 s | 1.11 GB | 15.3 s | 1.99 GB |
| 150 MB | — | — | — | out of memory | — |

Re-run with `node web/bench/bench.mjs` (see that file's header for options).

### Caveats on these numbers

- **Measured in Node, not a browser.** Same V8, so the arithmetic transfers, but a
  browser adds the `file.text()` decode and the download `Blob`, and a slower
  machine scales every time up.
- **Mobile and low-memory devices are far tighter.** Mobile Safari caps a tab well
  under 1 GB — divide the ceiling by roughly four.
- **512 MB is an absolute stop** regardless of RAM: V8's maximum string length. The
  file has to exist as a single string before anything else happens.
- Synthetic input is uniform; real files vary in segment length and mix.

## Why memory is the constraint, not CPU

Parsing costs about **8x the file size** in heap; running rules about **16x**. CPU is
comparatively cheap — the memory wall arrives first. The 16x is five full-size copies
of the same data:

| # | Copy | Where |
|---|---|---|
| 1 | Parsed segment objects | `parse()` — unavoidable, this is the working set |
| 2 | Before-snapshot clone of every segment | `processText()` → `snapshot(doc.segments)` |
| 3 | Serialized output string | `serialize(doc)` |
| 4 | `changes[]` holding before + after per changed segment | `processText()` |
| 5 | Re-parse of the output so the UI can browse the edited doc | `render()` → `state.doc = parse(result.output)` |

Copies 2 and 5 are pure waste and are the cheapest to remove.

## Already handled

Not on the backlog — these were dealt with when the browser was built:

- **Document list is virtualized.** Only rows near the fold exist in the DOM, so
  rendering is O(viewport) regardless of file size. Rendering is not a cost factor.
- **Changes tab caps at 500 rendered segments**, output preview at 400k characters.
  Both note the truncation; the download is always complete.

## Improvement backlog

In the order I'd do them.

### 1. Get processing off the main thread, and show progress

**Problem:** `run()` calls `processText()` synchronously, so the tab is frozen with no
feedback for the entire run — 2.6 s at 50 MB, 6.9 s at 100 MB. This is the worst part
of the current behaviour and it is a UX problem, not a throughput one.

**Fix:** move the engine into a Web Worker. The engine block in `EDIWorkbench.html`
(between the `engine:start` and `engine:end` markers) has no DOM access precisely so
it can be lifted out — that was deliberate. A worker in a single-file app means a
Blob URL worker, or `type="text/js-worker"` script tag read at runtime; confirm this
survives the artifact CSP before committing to it.

**Also:** a disabled Run button and a "Working on N segments…" state, at minimum,
even before the worker lands.

**Expected gain:** no change to the ceiling; the tab stays responsive throughout.

### 2. Stop re-parsing the output

**Problem:** `render()` does `state.doc = parse(result.output)` so the document
browser shows edited values. That's a second full parse and a second full set of
segment objects.

**Fix:** `processText()` already holds the mutated document. Return it, and have
`render()` use it directly. Segment indices already align (no rule adds or removes
segments), which is the assumption `state.touched` relies on today — worth an
explicit comment when this changes.

**Expected gain:** removes copy #5, roughly a third of peak heap.

### 3. Snapshot only what changes

**Problem:** `processText()` clones *every* segment up front to diff against. On a
5M-segment file that's a second full working set to detect ~1M changes.

**Fix:** rules already return `marks` naming the segments and elements they touched.
Capture the before-values inside the rule at mutation time and carry them in the
mark, then drop `snapshot()` and the full comparison sweep entirely.

**Watch:** the current diff is what makes the change list correct even if a rule
reports its marks inaccurately. Removing it moves that trust to the rules, so the
parity tests need to cover both rules' mark accuracy directly.

**Expected gain:** removes copy #2, plus the O(n) comparison sweep.

### 4. Guard rail for oversized files

After 1–3, put a soft warning in front of files over ~100 MB: state the expected time
and let the user proceed. Better than an unexplained multi-second freeze or an
out-of-memory crash.

### 5. Only if still needed: streaming parse

Chunked parsing with progress reporting would push past 125 MB, but it's a large
change to a currently simple and well-tested parser. Don't start here — 1–3 should
move the ceiling far enough that this stays unnecessary.

## How to verify an improvement

1. `node web/bench/bench.mjs` before and after; compare peak heap and run time.
2. Re-run the correctness suites — the engine must stay byte-for-byte identical to
   the Python `edi_engine` output. Items 2 and 3 both touch `processText()`, which is
   exactly what those tests pin down.

## Test harnesses

All committed. `node web/tests/all.mjs` runs the four correctness suites
(engine/Python parity, outline and qualifier decoding, virtual-list windowing math,
static self-containment lint); `node web/bench/bench.mjs` runs the benchmark that
produced the numbers above.
