# Post-adjudicated reports: what the checks do, and why

Why the three PACDR checks in `web/EDIWorkbench.html` are shaped the way they
are — in particular why one of them is deliberately looser than it first looks,
and why a longer list of plausible checks was ruled out rather than overlooked.

The code states what each check does. This states what it refuses to do, which
is the part that reads as an oversight from the code alone.

## The governing rule: detection adds, never diverts

`005010X298` is structurally the same transaction as the 837P submission the
app was built around — same loop ids, same anchors, same nesting. What differs
is meaning, not shape.

So every guard is *"PACDR detected → do more"*, never *"→ do differently"*. A
file with no `005010X298` in it runs exactly the code it ran before any of this
existed, and X299 institutional and X300 dental get that same fallback by
failing the prefix match rather than by an exclusion list anyone has to
maintain.

Two loops carry a different meaning under PACDR, which is why they are
relabelled rather than reinterpreted:

| Loop | 837P | PACDR |
| --- | --- | --- |
| `2010BB` | Payer name | **Data receiver** — the agency the report is sent *to*, which paid nothing |
| `2330B` | Other payer (situational COB) | **The payer that actually adjudicated the claim** |

The consequence is the one worth remembering: the Claims tab's existing Payer
column reads `NM1*PR`, which under PACDR resolves to `2010BB` — the reporting
destination, not a payer. For a PACDR row the meaningful payer comes from the
`2330B` inside each `2320`.

**And there is deliberately no fallback.** A PACDR claim carrying no `2320` —
one nothing has adjudicated — shows an empty Payer, not the `NM1*PR` the column
would otherwise read. Falling back names the data receiver as the payer, which
puts the same organisation in both the Payer and Data receiver columns and
sends it to the CSV export too. Blank is the honest answer; naming an
organisation that paid nothing is worse than naming none.

### Detection precedence

`ST-03`, then the nearest preceding `GS-08`, then `BHT-06`. `BHT-06` is read
last and only when no guide was named, because `RP` is legal in an X222A1
submission and must never overrule an explicit `005010X222A1`.

The subtlety, and it applies at **both** version positions: a stated version
only settles the question when it *names an implementation guide*. A bare
`005010` gives the standard's version and nothing about which guide, so it
falls through to the next signal rather than pre-empting it. Without that, a
transaction stating only `005010` is read as nothing at all — even when the
envelope above it names the guide outright, and even when `BHT-06` plainly says
`RP`. Neither is what the app's guide promises, nor what the file says.

## Everything here is a warning, not an error

All three findings are warnings. They test arithmetic *inside the file* —
whether the numbers it states agree with each other — never conformance to any
particular recipient's companion guide. A file can disagree with its recipient's
rules and still be internally coherent, and the app has no way to know which
recipient a file is bound for.

## P1 — payer paid amount vs. its own service lines

For each `2320`: `AMT*D` should equal the sum of `SVD-02` across the claim's
`2430` loops whose `SVD-01` names that same payer.

This is the reliable one. Both companion guides consulted treat it as a
property of the transaction rather than a local submission rule, and every payer
instance in the worked examples of both satisfies it.

It is gated on `AMT*D` being present and numeric, the payer id being non-empty,
the claim having at least one service line, **and that payer having a `2430` on
every line**. The last gate is the load-bearing one: adjudication reported only
at claim level is legal, and without that gate every such claim reports a false
shortfall.

It also stands down when any contributing `SVD-02` cannot be read as a number,
because the sum is then genuinely unknowable. **Standing down is never silent.**
Every money element in the file — `CLM-02`, `SV1-02`, `AMT*D`, `CAS` and
`SVD-02` — reports an unreadable value as a warning in its own right. That
matters more than it looks: the Checks tab tells a clean file that each payer's
`AMT*D` was compared against its own service lines, and a check that quietly
disabled itself would leave that reassurance standing over a comparison nothing
ever performed.

## P2 — line reconciliation, and why it is deliberately loose

**This is the check most likely to be "fixed" into being wrong.**

The rule as implemented: for each `2430`, `SVD-02` plus the sum of its `CAS`
amounts must equal *either* the line charge (`SV1-02`) *or* the
patient-responsibility total of another `2430` on the same line. It fires only
when the total matches neither.

The obvious rule — the one an earlier draft of this analysis asserted, and the
one anybody re-deriving it from first principles will land on — is a **chain**:
the primary payer reconciles against the line charge, and each subsequent payer
reconciles against the previous payer's patient responsibility. It looks right,
and it fits the textbook coordination-of-benefits case.

It is wrong, and the Ohio guide's own worked examples disprove it. Both shapes
below are valid; a chained rule reports the second as an error.

**Shape one — a genuine chain.** Line charge 1000.00:

```
2430 #1   SVD pays 800.00   CAS*PR*2*200.00
          800.00 + 200.00 = 1000.00          -> the line charge
2430 #2   SVD pays 100.00   CAS*PR*2*50.00   CAS*CO*45*50.00
          100.00 + 50.00 + 50.00 = 200.00    -> #1's patient responsibility
```

**Shape two — no chain at all.** Line charge 120.00:

```
2430 #1   SVD pays 0.00     CAS*CO*45*120.00
          0.00 + 120.00 = 120.00             -> the line charge
2430 #2   SVD pays 120.00   (no CAS)
          120.00 + 0.00 = 120.00             -> the line charge again
```

In shape two both payers adjudicated the full charge independently, and the only
adjustment is `CO` — contractual — so there is **no patient responsibility to
chain from**. A chained rule computes an expected 0.00 for the second payer and
reports a valid file. Accepting either comparator passes both shapes and still
catches an arbitrary number, which is all the check was ever able to promise.

(The figures above are invented to show the structure. The examples that
established it are in the Ohio companion guide cited below; nothing is
reproduced from it here.)

Two consequences that follow from reconciliation being a property of the *line*
rather than of one payer:

- One unreadable `CAS` suppresses the whole line, not just the `2430` carrying
  it. Each payer is measured partly against what the others left behind, so a
  partial total would fail payers that balance and pass ones that do not.
- With neither comparator readable, the check stands down rather than reporting
  against a figure it has already admitted it cannot read.

## P3 — a line adjudication naming an unknown payer

`SVD-01` must match a `2330B` `NM109` somewhere on the claim.

**Not the converse.** A `2320` carrying no line-level detail is legal, so a
payer that appears at claim level and never at line level is not a finding.

## Payer order is not document order

Nothing may key off document position to decide which payer is primary. Use
`SBR-01`. A worked example in the Ohio guide emits the secondary payer's `2320`
*before* the primary's, with its `2430`s in the same order, and reading position
as precedence silently mislabels every column that follows from the primary
payer.

## Deliberately not checked

Each of these is a rule belonging to one recipient's submission policy rather
than to the transaction. Encoding any would make the app wrong for every other
submitter.

- **`CN1-04` as a claim disposition.** This is the tempting one. One state
  instructs its submitters to overload X12's free-form contract-code element
  with a one-character paid / partially-paid / denied indicator; the other
  guide consulted does not mention `CN1` at all. The app shows the raw value in
  its own column and **never decodes it** — it stays out of the qualifier table
  that feeds the reference panel, because a decode there would assert one
  state's convention as the meaning of the element.
- **Recipient-specific identifiers and conventions** — trading-partner id
  formats and lengths, fixed receiver ids, provider-id widths, zip fill, member
  id lengths, remark-code and tracking-reference conventions, and rules of the
  "exactly one `SBR-06` of value 6" kind.
- **NPI check digits.**
- **CARC / RARC and `CN1-01` code-list validity.** Also a maintenance argument:
  those lists change quarterly, and a stale copy embedded in a single-file app
  is worse than no check.
- **`AMT*F5` patient-paid** is not surfaced as a column — a deliberate scope
  call, not an omission.

`CLM-02` = the sum of line charges still holds under PACDR. The app already
checked it, and it needed no change.

## Limited Data Set: no change was required

Audited rather than assumed. PACDR's identifier-bearing fields sit in `2330A`
(`NM1*IL`, `N3`, `N4`, `DMG`, `REF*SY`/`EA`), which the existing `PERSON_LOOPS`
scrubbing already reaches — `buildTree` gets there via the `2300` `SBR` anchor
into the `2320` entity loop. `2330B` payer fields, `SVD-01`, `AMT*D` and `MOA`
are not patient identifiers and must stay real for the file to remain
meaningful. `DTP*573` already shifts with the claim owner's offset.

`REF*F8`, the payer claim control number, is **left real** — it identifies a
claim within a payer's system, not a person.

## Sources, and what could not be used

The X12 TR3 for `005010X298` is paywalled and was **not read**. Nothing here or
in the code derives from it.

The loop inventory behind this work was assembled by cross-reading two publicly
published state companion guides — the Ohio Department of Medicaid's PACDR
Professional companion guide, and the New York State DOH APD OSDS transaction
companion guide — and keeping only what both treat as structural. Those guides
are third-party documents: they are not redistributed in this repository, no
prose is reproduced from them, and the worked examples that shaped P2 are
described structurally above rather than copied.

Loop ids, segment ids, element positions and plain labels are functional facts
about a data format, and are used here the same way the app has always used
them for 837P.

Test fixtures are **wholly invented** — payers, people and identifiers alike.
One guide's examples name a real company beside a member record, which is
reason enough never to adapt them for a committed fixture in a public
repository.
