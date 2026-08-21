# EDI Workbench

**Browser workbench for healthcare EDI: read any X12 file, and turn real ones into safe
test data. Nothing leaves your machine.**

![The Document tab: an 837 interchange decoded one segment per row, each with its name
and value, an outline on the left for jumping between claims and service lines, and the
rule panel in the rail.](docs/images/document-tab.png)

Download the app from the [latest
release](https://github.com/IPerception/EDI-Workbench/releases/latest) and open it in a
browser, or open `web/EDIWorkbench.html` from a clone. Either way that is the whole
install — no server, no build step, no npm, no network access at any point.

A hosted demo runs at
[iperception.github.io/EDI-Workbench](https://iperception.github.io/EDI-Workbench/) — the
same file, served instead of downloaded, and it transmits nothing either. It tracks `main`
rather than the latest release, so it can be ahead of the version above. For real data,
download it and open it locally.

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
- **Post-adjudicated reports** — `005010X298` files are recognised from `ST-03`, `GS-08`
  or `BHT-06` and read for what they mean: `2010BB` is the data receiver rather than a
  payer, the payer that actually paid is the `2330B` inside each `2320`, and the Claims
  tab gains eight columns for what was paid, adjusted and by whom.
- **835 remittance advice** — `005010X221A1` files are recognised from `ST-01` and read
  as a different transaction, not a variant of the 837: `N1*PR`/`N1*PE` open the payer
  and payee, `LX` opens an optional grouping of claims rather than a service line, `CLP`
  opens a claim and `SVC` a service line's payment, and `PLB` a transaction-level
  provider balance. The Claims tab stays empty for an 835 by design — there is no
  submission to flatten — and the Limited Data Set does not reach its patient
  identifiers, since they sit outside the loops the rule targets.
- **Checks** — control counts and envelope integrity (`SE-01`, `GE-01`, `IEA-01` and
  matching control numbers), plus claim balance against service-line charges, compared
  as whole cents so a balanced file is never reported as off by a rounding error. For a
  post-adjudicated report, also whether each payer's claim total matches its own service
  lines, whether each line's adjudication accounts for the charge, and whether every
  `SVD-01` names a payer the claim identifies. For an 835, whether each line's payment
  reconciles against its adjustments, whether each claim's total does, and whether the
  stated payment equals every claim's payment minus every provider-level balance
  adjustment — under the same rules for a reversed claim as any other.
- **Mask** — hides names, addresses, dates of birth and member IDs on screen, for
  screen-sharing a real file. Display only; the file you download is untouched.

![The Tree tab, showing an interchange's loops nested inside one another with their 837P
loop ids in a fixed column — 2010BA subscriber, 2300 claim, 2310A-C provider loops, 2400
service line — and a diagnosis composite expanded into its parts.](docs/images/tree-tab.png)

*The Tree tab. Loop ids are resolved from position, not from the segment alone: the same
`NM1*82` is 2310B under a claim and 2420A under a service line.*

![The Claims tab, showing two claims across three service lines as a table: claim number,
patient, line, service date, procedure, units, charge, diagnoses, place of service,
billing provider, payer and claim total.](docs/images/claims-tab.png)

*The Claims tab, one row per service line. The subscriber's claim has two lines; the
dependent's has one.*

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

![The Changes tab after a Limited Data Set run, showing before-and-after pairs for each
rewritten segment: a subscriber name and member id, a street address, a date of birth, a
social security number, a phone and email, and a patient account number.](docs/images/limited-data-set.png)

*Reviewing a Limited Data Set run before downloading. Replacements keep each value's
shape — a nine-digit SSN stays nine digits, and an account number keeps its letter and
digit pattern — so the result still exercises whatever validates the file downstream.*

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
| **837 PACDR** professional post-adjudicated reports (005010X298) | Full — the above, plus adjudication columns and the three balancing checks |
| **835** remittance advice (005010X221A1) | Reading — loop resolution and the three balancing checks; no claim table, no Limited Data Set, no CSV export |
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
| `docs/pacdr-validation.md` | What the post-adjudicated checks do, what they deliberately don't, and why. |
| `docs/835-validation.md` | What the 835 balancing checks do, what they deliberately don't, and why. |
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

Sample 837 and 835 files for manual testing live in `web/tests/samples/`, with a README
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
