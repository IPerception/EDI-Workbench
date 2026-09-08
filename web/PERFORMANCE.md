# EDI Workbench (browser) — performance findings

**First measured 2026-08-03. Re-measured 2026-09-07** after backlog items 2 and 3
landed. Status: those two are done; the rest of the backlog stands.

## Recommendation

| Range | Verdict |
|---|---|
| **up to 25 MB** | Comfortable. Sub-second load, under a second to run rules. |
| **25–50 MB** | Usable. Brief freeze (1–2 s) but nothing breaks. |
| **50–100 MB** | Degraded. 2–4 s frozen tab; Chrome may offer to kill the page. |
| **100–125 MB** | Hard edge. 6 s and ~2.9 GB heap at 125 MB. |
| **150 MB+** | Out of memory on a 4 GB tab. |

For scale, 25 MB of 837P is roughly 30,000 claims. Most real batches sit well under
that, so the current build is fine for ordinary work — the improvements below are
about headroom and about not freezing the tab, not about unblocking normal use.

## Measurements

Synthetic 837P, ~41k segments per MB, ~42 bytes per segment (close to real
professional claims). Two rules active: service date shift + find/replace.

| File | Segments | Load & browse | Heap | Run rules | Heap after run |
|---:|---:|---:|---:|---:|---:|
| 1 MB | 42k | 15 ms | 8 MB | 50 ms | 22 MB |
| 5 MB | 208k | 76 ms | 43 MB | 174 ms | 115 MB |
| 10 MB | 415k | 133 ms | 88 MB | 332 ms | 232 MB |
| 25 MB | 1.0M | 366 ms | 221 MB | 862 ms | 579 MB |
| 50 MB | 2.1M | 769 ms | 446 MB | 1.8 s | 1.17 GB |
| 64 MB | 2.7M | 953 ms | 565 MB | 2.2 s | 1.48 GB |
| 80 MB | 3.3M | 1.2 s | 712 MB | 3.3 s | 1.86 GB |
| 100 MB | 4.2M | 1.4 s | 882 MB | 4.0 s | 2.31 GB |
| 125 MB | 5.2M | 2.0 s | 1.11 GB | 6.2 s | 2.90 GB |
| 150 MB | — | — | — | out of memory | — |

Re-run with `node web/bench/bench.mjs` (see that file's header for options).

### Two corrections to the first round of numbers

**The heap column was understating the app, and is now larger.** It is not a
regression. The benchmark used to throw away its copy of the browsable document
the instant it built it, while the app keeps that document in `state.doc` for as
long as the file is open. So the old column measured a state the app is never in.
The 125 MB row reading 1.99 GB before and 2.90 GB now is that correction, not a
change in what the code does.

**It is also "heap after the run", not peak heap, and used to be labelled peak.**
The measurement is taken after a forced GC, so it reports what is still reachable
when the run finishes — it cannot see a copy that is built and discarded during
the run. That is exactly what made the original predictions for items 2 and 3
wrong: both removed transient copies, so both moved this column barely at all
while cutting the time substantially. Bear it in mind before predicting a memory
saving from a copy that does not outlive `processText`.

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

Parsing costs about **8x the file size** in heap; running rules about **23x** of what
survives the run. CPU is comparatively cheap — the memory wall arrives first. What is
still reachable when a run finishes is three full-size copies of the same data:

| # | Copy | Where |
|---|---|---|
| 1 | Parsed segment objects, as the rules left them | `parse()` — unavoidable, this is the working set, and it is what the UI browses |
| 2 | Serialized output string | `serialize(doc)` |
| 3 | `changes[]` holding before + after per changed segment | `processText()` |

Two more used to be built and thrown away during the run — a clone of every segment
taken before the rules ran, and a re-parse of the output so the UI had something to
browse. Both are gone; see below. Neither was reachable at the end of a run, which is
why removing them cut the time without moving the heap column much.

Copy 3 is the one left with any slack in it: it holds a before and an after for every
changed segment, so a rule that rewrites most of a file approaches a second working
set. It is also the only record of what a run changed, so it cannot simply be dropped.

## Already handled

Not on the backlog — these were dealt with when the browser was built, or have since
been done:

- **Document list is virtualized.** Only rows near the fold exist in the DOM, so
  rendering is O(viewport) regardless of file size. Rendering is not a cost factor.
- **Changes tab caps at 500 rendered segments**, output preview at 400k characters.
  Both note the truncation; the download is always complete.
- **The output is no longer re-parsed** so the UI can browse it (was backlog item 2).
  `processText()` returns the document it already mutated and `render()` takes it.
  Cut run time by 26–37%.
- **Only changed segments are copied** (was backlog item 3). Each rule copies a
  segment on its first write to it and carries the copy in the mark it already
  reported, replacing a clone of the whole document taken up front. Cut run time by a
  further 26% at 100 MB and 36% at 125 MB — the gain grows with the file, because the
  extra copy was crowding the heap limit and paying for it in GC.

  This moved the correctness of the change list onto the accuracy of each rule's
  `marks`. That is not free, and it is why `web/tests/_marks.mjs` exists: it audits,
  for every rule, that nothing changes without being marked. `sameSegment` was kept
  as a filter over marked segments — a rule marks what it *touched*, not what it
  managed to change, and `StringReplaceRule` counts a match even when the replacement
  equals it.

## Improvement backlog

In the order I'd do them.

### 1. Get processing off the main thread, and show progress

**Problem:** `run()` calls `processText()` synchronously, so the tab is frozen with no
feedback for the entire run — 1.8 s at 50 MB, 4.0 s at 100 MB. Items 2 and 3 roughly
halved those, which makes this the worst remaining part of the behaviour by a wide
margin. It is a UX problem, not a throughput one, and no further copy-removal fixes
it: a 4 s freeze with no progress indication reads as a hung tab whatever the number.

**Fix:** move the engine into a Web Worker. The engine block in `EDIWorkbench.html`
(between the `engine:start` and `engine:end` markers) has no DOM access precisely so
it can be lifted out — that was deliberate. A worker in a single-file app means a
Blob URL worker, or `type="text/js-worker"` script tag read at runtime; confirm this
survives the artifact CSP before committing to it.

**Also:** a disabled Run button and a "Working on N segments…" state, at minimum,
even before the worker lands.

**Expected gain:** no change to the ceiling; the tab stays responsive throughout.

### ~~2. Stop re-parsing the output~~ — done 2026-09-07

### ~~3. Snapshot only what changes~~ — done 2026-09-07

Both are described under **Already handled** above, with what they actually bought.

Worth recording, because it is the lesson rather than the result: **both were
predicted as memory savings and both delivered time savings instead.** Item 2 was
expected to remove "roughly a third of peak heap" and moved the heap column by about
2%. The reasoning error was treating five copies as five things held at once, when
the two being removed were each built and discarded inside a single run — so at no
point did the file exist five times over. Before predicting a memory win from
removing a copy, check whether anything still refers to it when the run ends.

### 4. Guard rail for oversized files

After 1, put a soft warning in front of files over ~100 MB: state the expected time
and let the user proceed. Better than an unexplained multi-second freeze or an
out-of-memory crash.

### 5. Only if still needed: streaming parse

Chunked parsing with progress reporting would push past 125 MB, but it's a large
change to a currently simple and well-tested parser.

Note that items 2 and 3 **did not move the ceiling at all** — 150 MB was out of
memory before them and still is. They removed transient copies, and the ceiling is
set by what a run has to hold simultaneously at its worst moment, which is dominated
by the working set, the output string and the change list. If the ceiling is the
thing that actually needs to move, this item is what moves it, and nothing cheaper
will. Don't start here anyway: 125 MB is far past any real batch.

## How to verify an improvement

1. `node web/bench/bench.mjs` before and after; compare run time and heap. **Measure
   the same tree with only the change absent** — not against the table above, which
   was taken on a different machine and, before 2026-09-07, with a benchmark that
   modelled the app's retained memory incorrectly. Stashing the change and re-running
   is the cheap way to get a comparison worth quoting.
2. Remember the heap column is measured after a forced GC. It will not show you a
   copy that dies before the run returns, however large that copy was.
3. Re-run the correctness suites — the engine must stay byte-for-byte identical to
   the Python `edi_engine` output. Anything touching `processText()` is exactly what
   those tests pin down, and anything touching how rules report `marks` is now pinned
   by the audits in `_marks.mjs`.

## Test harnesses

All committed. `node web/tests/all.mjs` runs the nine correctness suites
(engine/Python parity, outline and qualifier decoding, structure-tree building, the
claim index and CSV export, control counts and claim balance, de-identification,
virtual-list windowing math, the load path against a throwaway DOM, and the static
self-containment lint); `node web/bench/bench.mjs` runs the benchmark that produced
the numbers above.

`web/tests/_marks.mjs` is not a suite of its own — it is the mark audit, called from
`parity.mjs` and `deid.mjs`, which are where each rule is already wired up.
