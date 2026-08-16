# Manual-test samples

837 files for exercising the browser app by hand. The automated suites
(`node web/tests/all.mjs`) cover the same logic, but nothing in them looks at
rendering — these exist for the parts only eyes can check.

Everything here is **synthetic**. Names, addresses, member ids and NPIs are
invented; nothing derives from a production file. That is why these are
committed rather than ignored: they are regenerable, but having them present
means a UI change can be checked without first remembering which generator to
run.

Regenerate either set at any time — both are deterministic:

```
node web/tests/make_samples.mjs        # -> checks/
node web/tests/make_tree_samples.mjs   # -> tree/
node web/tests/make_deid_samples.mjs   # -> deid/
node web/tests/make_pacdr_samples.mjs  # -> pacdr/
node web/tests/make_835_samples.mjs    # -> 835/
```

The clean baselines are `tests/fixtures/sample_837p.edi`,
`tests/fixtures/sample_837_pacdr.edi` and `tests/fixtures/sample_835.edi`,
which should report no problems in any tab. All three are also what the app's
three sample buttons load — `lint.mjs` holds the embedded copies
byte-identical to the files on disk.

## `checks/` — deliberately broken

Derived from the fixture, each tripping one finding, for the Checks tab and
the control-count repair.

| File | What it exercises |
| --- | --- |
| `bad_se_count.edi` | SE-01 states 26 segments; 27 are present |
| `bad_control_number.edi` | SE-02 is `0009` but ST-02 is `0001` |
| `unbalanced_claim.edi` | CLM-02 states 175.00; the lines total 150.00 |
| `unclosed_envelope.edi` | The ISA has no IEA |
| `bad_amount.edi` | A line charge that isn't a number — warning, not error |
| `multi_problem.edi` | Two findings at once, plus a second claim and line modifiers |

## `tree/` — structurally interesting, and valid

All six pass validation cleanly, so anything the Checks tab flags while
looking at these is a real regression. They cover shapes the single fixture
doesn't have.

| File | What it exercises |
| --- | --- |
| `multi_hl.edi` | HL nesting three deep (2000A → 2000B → 2000C) with sibling loops at each level |
| `dangling_hl.edi` | An HL-02 pointing at a parent that never opened — must attach to the transaction, not vanish |
| `two_transactions.edi` | Two ST branches in one functional group; claim numbering restarts per transaction |
| `cob_loops.edi` | Context-sensitive loop ids — the same `NM1*82` is 2310B under a claim and 2420A under a service line; `NM1*IL` is 2010BA up top and 2330A inside the COB block. 19 distinct loops |
| `wide_composites.edi` | Composites wide enough to fill the element breakdown, including a masked address |
| `large.edi` | 600 subscribers, ~9,000 segments, ~12,600 rows fully expanded — for scrolling the virtualized tree |

`large.edi` is ~200 KB, by far the biggest file here. If that becomes
unwelcome in the repo it is the one to drop; the generator rebuilds it in
well under a second.

## `deid/` — for the Limited Data Set button

All four validate cleanly both before and after a Limited Data Set run, which
`deid.mjs` asserts — so anything the Checks tab reports while looking at these
is a real regression, not a side effect of the run.

| File | What it exercises |
| --- | --- |
| `repeat_patient.edi` | One member across four claims — the consistency property. After a run all four must still name one person, with one fake name **and** one fake member id, while the four account numbers stay four distinct values |
| `patient_and_cob.edi` | Three people in one transaction: subscriber, their child as the 2000C patient, and the subscriber again in the 2330A COB block. The two subscriber entries must match each other and differ from the patient's |
| `no_patient_loops.edi` | Only a provider and a pay-to address — the run must report no changes rather than inventing any |
| `awkward_values.edi` | A subscriber with no member id (keyed on name + date of birth instead), an `RD8` date range, and an impossible date (month 13) that must be skipped rather than failing the file |

All four have a billing provider named `WHITFIELD, ANNA`, and the two with
several claims — `repeat_patient.edi` and `patient_and_cob.edi` — also carry
`NM1*DN` and `NM1*82` inside them. Every one of those is a natural person and
every one must come out byte-identical: that is the check a name-shape
heuristic fails and loop-based targeting passes.

## `pacdr/` — post-adjudicated reports (005010X298)

One claim adjudicated by two payers across two service lines, so every loop
the guide exists for is present: `2010BB` as the data receiver, one `2320` per
payer with its `AMT*D`, and one `2430` per payer per line with its `SVD-02`
and `CAS`. The Claims tab gains eight columns for these files and the Tree tab
relabels two loops, neither of which any suite looks at.

| File | What it exercises |
| --- | --- |
| `clean_report.edi` | The baseline, a copy of the fixture — nothing should be reported in any tab |
| `payer_total_off.edi` | A payer's `2320 AMT*D` states 250.00 while its own `SVD-02`s pay 240.00 |
| `line_does_not_reconcile.edi` | One altered `CAS`, which breaks both adjudications on line 1: the first no longer accounts for the line charge, and the second no longer matches what it left behind |
| `unknown_payer.edi` | An `SVD-01` naming a payer no `2330B` on the claim identifies |

All three findings are warnings rather than errors. What is checked is
arithmetic inside the file, never conformance to a particular recipient's
companion guide — those differ between recipients, so encoding one would make
the app wrong for every other submitter.

## `835/` — remittance advice (005010X221A1)

A different transaction from the 837, not a variant of it: two service lines
on one claim, a second claim carrying a reversal (`CLP-02 = 22`, amounts
negative throughout), and a `PLB` closing the transaction. `N1*PR`/`N1*PE`
open the payer and payee, `LX` opens an optional grouping of claims rather
than a line, and `CLP`/`SVC` replace `CLM`/`SV1` — none of which the 837
tables reach, by construction. The Claims tab stays empty for these files;
Checks reads the payment instead.

| File | What it exercises |
| --- | --- |
| `clean_remittance.edi` | The baseline, a copy of the fixture — nothing should be reported in any tab |
| `line_does_not_reconcile.edi` | `SVC-02` minus its `CAS` adjustments does not equal `SVC-03` |
| `claim_does_not_reconcile.edi` | `CLP-03` minus every `CAS` on the claim does not equal `CLP-04` — and, since `BPR-02` is computed *from* `CLP-04`, the transaction total is now wrong too. The one sample that trips two findings, both genuinely present |
| `total_does_not_reconcile.edi` | `BPR-02` does not equal every claim's `CLP-04` minus every `PLB-04` |

All three findings are warnings. The transaction check is the one worth
reading closely if you're comparing numbers by hand: a **positive** `PLB-04`
**reduces** what was paid, so it is `Σ CLP-04 − Σ PLB-04`, not `+`. See
`docs/835-validation.md`.
