# EDI Workbench

**Browser workbench for healthcare EDI: read any X12 file, and turn real ones into safe
test data. Nothing leaves your machine.**

Open `web/EDIWorkbench.html` in a browser. That is the whole install — no server, no
build step, no npm, no network access at any point.

## Why it exists

Two jobs, both awkward without it:

- **Reading a file.** Any X12 interchange — production, a vendor's sample, or something
  you built yourself. An 837 is a wall of `NM1*IL*1*…~` with the structure implied rather
  than written down. The app decodes every segment, recovers the loop nesting, and
  flattens claims into something you can actually read.
- **Making test data out of a real one.** Production files are the only realistic test
  input, and they carry PHI. The app rewrites patient identifiers consistently, so the
  result still behaves like a real batch without naming real people.

The first is most of the use and needs nothing but a file. The second is why the app is
client-side: a file carrying PHI never crosses the network, which is the main reason this
is a browser app and not a service.

## What it does

### Reading

- **Document** — one row per segment, decoded, with an outline to jump by transaction,
  claim or service line, and a filter over segment IDs and values. Selecting a row opens
  an inspector that names every element, decodes qualifiers, and splits composites.
- **Tree** — the nesting the segments imply rather than their order on disk: envelope,
  the `HL` hierarchy resolved through its parent pointers, then claims and service
  lines, each group labelled with its 837P loop id.
- **Claims** — one row per service line: patient, date, procedure, modifiers, units,
  charge, diagnoses, payer. Exports to CSV.
- **Checks** — control counts and envelope integrity (`SE-01`, `GE-01`, `IEA-01` and
  matching control numbers), plus claim balance against service-line charges, compared
  as whole cents so a balanced file is never reported as off by a rounding error.
- **Mask** — hides names, addresses, dates of birth and member IDs on screen, for
  screen-sharing a real file. Display only; the file you download is untouched.

### Changing

- **Service date shift** — moves `DTP*472` dates inside service lines by a set number of
  days, forwards or backwards.
- **Find & replace** — over element values only, optionally scoped to given segments,
  matching a substring, a whole element, or a whole component inside a composite.
- **Limited Data Set** — replaces patient and subscriber names, member ids, addresses,
  contact details, SSNs, medical record numbers and account numbers with consistent
  stand-ins, and shifts each patient's dates by their own offset. One person keeps one
  identity across the whole file, so claims still match up. Providers are left real.

Every change is previewed before anything is written: changed segments are marked in the
document and shown before and after. Output is byte-faithful — whitespace, delimiters and
untouched segments come back exactly as they went in.

> **A Limited Data Set is not de-identified data under HIPAA.** It removes the direct
> identifiers (45 CFR 164.514(e)) but the output remains PHI and still requires a data
> use agreement. De-identification is §164.514(b) — Safe Harbor or expert determination —
> and this tool performs neither. Safe Harbor's year-only date rule cannot be expressed in
> a valid 837 at all: `D8` is `CCYYMMDD` and `DTP*472` is required on every service line,
> so it would force every date to `YYYY0101`. Not legal advice.

## Supported today

The parser is generic X12; the claim-aware features are 837-specific.

| | Support |
| --- | --- |
| **837P** professional claims (005010X222A1) | Full — loop resolution, claim table, validation, Limited Data Set |
| **Any X12 interchange** | Parse, browse, inspect, find & replace, control-count checks |

Delimiters are read from the `ISA` header rather than assumed, so a file using `|` and
newlines parses as readily as `*` and `~`.

## Repository layout

| Path | What it is |
| --- | --- |
| `web/EDIWorkbench.html` | **The app.** Self-contained: markup, styles and engine in one file. |
| `web/tests/` | Eight correctness suites, plus generators for the committed sample files. |
| `web/bench/` | Benchmark over synthetic interchanges up to 150 MB. |
| `web/PERFORMANCE.md` | Measured limits and the ordered backlog for improving them. |
| `edi_engine/`, `ui/`, `app.py`, `tests/` | The original Python/Tkinter prototype. |

The Python program is not the backend for the browser app — the two are independent
implementations. It is kept because the parity suite checks the JavaScript engine against
it byte for byte, which is what stops the port drifting from the original.

## Running the tests

```sh
node web/tests/all.mjs     # browser app: 8 suites
python -m unittest         # Python prototype
```

No dependencies for either. The parity suite shells out to Python to regenerate its
reference output, so run it with both available.

Sample 837P files for manual testing live in `web/tests/samples/`, with a README
tabulating what each one exercises. All of them are synthetic — deliberately so, since
they are committed.

## Scale

Comfortable to about 25 MB (roughly 30,000 claims), usable to 50 MB, out of memory past
about 125 MB. Memory is the constraint rather than CPU. `web/PERFORMANCE.md` has the
measurements and the planned work.

## Browser support

Any current Chrome, Edge, Firefox or Safari. Uses `<dialog>`, CSS grid and
`prefers-color-scheme`; no polyfills and no transpilation.

## Using it with real data

The app runs entirely in your browser and transmits nothing. That is a description of how
it works, not a compliance guarantee, and it is the only assurance it offers. If you open
a file containing PHI, handling it remains your responsibility:

- **Your obligations do not change.** Whatever governed that data before you opened it
  here — HIPAA, your organisation's policies, a business associate agreement, a data use
  agreement, state law — governs it still.
- **Downloaded output is your file.** It lands in your downloads folder, unencrypted, and
  nothing here deletes it, tracks it, or knows where it goes next.
- **A Limited Data Set is still PHI.** It is not de-identified data under HIPAA and still
  requires a data use agreement before it is shared. See the note above.
- **Free text is not scanned.** The Limited Data Set rewrites named fields in the loops it
  recognises. Free-text elements — notes (`NTE`), file information (`K3`), and similar —
  can carry names or identifiers, and nothing here detects or removes them. Review them
  yourself before treating output as safe to share.
- **Masking is a display setting.** The eye button changes what is on screen, never what is
  in the file or the download.

The software is provided as-is, without warranty of any kind, and none of this is legal
advice. Deciding whether a given use is permitted is yours to make.

## License

MIT — see [LICENSE](LICENSE).
