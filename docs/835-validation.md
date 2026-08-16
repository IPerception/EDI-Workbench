# 835 remittance advice: what the checks do, and why

Why the three 835 checks in `web/EDIWorkbench.html` are shaped the way they
are — in particular why one line in the transaction check reads backwards on
purpose, why `Σ SVC-03 = CLP-04` is not implemented even though it looks like
the obvious fourth check, and why a reversal claim is not treated as a special
case anywhere in the arithmetic.

The code states what each check does. This states what it refuses to do,
which is the part that reads as an oversight from the code alone.

## The governing rule here is not PACDR's

PACDR's rule was *"detected → do more, never do differently"*, and it held
because `005010X298` is structurally the same transaction as the 837P
submission the app was built around. **It does not hold for an 835.** An 835
is a different transaction, not a variant of one already supported, and the
probe that shaped this work found the default path actively wrong on one:
`LX` opened a group labelled "Line 1" — in an 837 `LX` anchors a service line,
but in an 835 it opens loop 2000, a grouping of *claims*. `NM1*82` opened a
group labelled "Rendering provider" and then swallowed both service lines,
their adjustments, and `PLB` — a transaction-level segment that must never sit
inside anything.

So for an 835 transaction the 837 anchors (`LX`, `CLM`, the `NM1` entity
loops) are switched off and replaced with 835 loop resolution, gated on
`ST-01 === "835"` per transaction. A file with no 835 in it runs exactly the
code it ran before this existed, and the gate being per-`ST` is what lets a
mixed interchange resolve an 837P and an 835 side by side, each correctly.

`005010X221A1` is detected directly from `ST-01`, which names the transaction
set outright — there is no guide-detection problem the way PACDR has one, and
this is deliberately not folded into `guideOf`/`GUIDE_PACDR`, which answers a
different question ("which 837 implementation guide").

## Everything here is a warning, not an error

All three findings are warnings, same posture as PACDR's. They test whether
the numbers an 835 states agree with each other — never conformance to any
particular recipient's companion guide, which the app has no way to know a
file is bound for.

## The three checks

**Line** — `SVC-02` minus the `CAS` adjustments inside that `SVC`'s own 2110
should equal `SVC-03`.

**Claim** — `CLP-03` minus every `CAS` on the claim, claim-level *and*
line-level together, should equal `CLP-04`. This is where a stray CAS repeat
between claims would be attributed wrong, so accumulation is scoped to
whichever claim is currently open, the same discipline PACDR's line
reconciliation already uses for its own `CAS` sums.

**Transaction** — `BPR-02` should equal every claim's `CLP-04` minus every
`PLB-04` on the transaction. Stands down unless `BPR-03` states a credit
(`"C"`) and the transaction carries at least one claim; a debit transaction or
one reporting nothing paid is a different shape this pass does not assert
anything about.

## The PLB sign convention — the thing most likely to be "fixed" into being wrong

**A *positive* `PLB-04` amount *reduces* what the payer pays; a negative one
increases it.** The check is therefore `BPR-02 = Σ CLP-04 − Σ PLB-04`, not
`+`. It reads backwards, which is exactly why it will look like a bug to
whoever reads the code next — a positive number in an amount field usually
means *more* money, and here it means less.

This is 835's equivalent of PACDR's "the line check is a disjunction, not a
chain" lesson: the version that looks obviously right is wrong, so it gets
three separate treatments rather than one, because any one of them alone gets
silently dropped in a later edit:

1. A comment directly at the subtraction in `validateDocument`, naming the
   convention and pointing here.
2. This document, explaining *why* the sign runs this way — a `PLB` records a
   provider-level adjustment such as a prior overpayment or a withheld
   amount, which comes *out of* what would otherwise be paid.
3. A test in `validate.mjs`, named for the convention itself — "a positive
   PLB reduces the payment" — that asserts the *detail text* of the finding,
   not just that one fires. A flipped sign still produces a finding on the
   fixture (the numbers no longer match either way), so a test that only
   checked pass/fail would not catch the regression; the detail text names
   the specific total the check computed, and that total is different under
   `+` than under `−`. This is the actual enforcement. It was verified by
   hand: flipping the subtraction to addition in the engine and re-running
   `validate.mjs` turns that assertion — and several others whose fixtures
   happen to still disagree under the wrong sign — red; flipping it back
   turns the suite green again.

## Reversals balance under the same three rules — there is no `CLP-02` gate

`CLP-02 = 22` marks a claim as a reversal of a previously reported payment.
**Nothing in any of the three checks reads `CLP-02` at all.** A reversal is
the original claim with every amount's sign flipped, and the arithmetic above
already handles a negative amount correctly: `toCents` parses a leading `-`,
and subtraction does not care which side of zero its operands sit on.

This was tested deliberately rather than assumed. The committed fixture's
second claim is a reversal carrying negative `CLP-03`/`CLP-04`/`SVC-02`/
`SVC-03`/`CAS` values throughout, and it is required to validate cleanly
alongside the first, ordinary claim. Breaking the reversal's own `CAS` is
caught exactly the way breaking the original claim's would be — same finding,
same shape, only the sign of the numbers in the detail differs.

## What was cut, and why

**`Σ SVC-03 = CLP-04`.** Believed to hold wherever line-level detail exists —
if every 2110 under a claim states what was paid on it, the sum should equal
what the claim states was paid overall — but the loop inventory marks this
`[?]`, unconfirmed against any public source, and the user-set posture for
this feature (matching PACDR's) is that nothing ships on an unconfirmed fact.
It costs nothing to add later: it does not interact with the three checks
above, since none of them sums `SVC-03` across a claim.

**Debit (`BPR-03 = "D"`) and zero-payment transactions.** Also `[?]`. The
transaction check simply stands down for both rather than guessing at what
either shape's arithmetic should look like.

**`TS3`/`TS2` element semantics, and the exact repeat count/shapes `PLB`
takes in practice.** Neither is asserted anywhere; `TS3` and `TS2` are named
leaves only (segment names for the inspector), and `PLB` is read generically
as up to six repeating reason/amount pairs, which is what the segment's
definition allows rather than what any specific sender is known to send.

**CARC / RARC code-list validity, and any `PLB-03` reason-code table.** Same
argument as PACDR's `CN1-01`/`CN1-04`: those lists change quarterly, and a
stale copy embedded in a single-file app is worse than no check. `LQ` — the
segment that carries an 835's remark codes — keeps its generic 837 name,
"Form Identification", rather than being renamed for 835's use: it is also
the opener of 837 loop 2440, and renaming it here would misdescribe that row.

**Any individual payer's submission conventions**, `BPR` banking-detail
validation (routing/account number formats), and NPI check digits — the same
reasoning the app already applies to 837P and PACDR: this is a structural
reader, not a conformance checker for one recipient's rules.

## What else the 835 support does and does not do

**The Claims tab is empty for an 835 by design, not by accident.**
`buildClaimIndex` needed no code change for this — audited, not assumed: its
`emitLine` returns early whenever `clm === -1`, and an 835 never carries a
`CLM` segment, so `clm` never leaves `-1` for the whole walk. `CLP`, `SVC`,
`N1` and `PLB` all match none of that function's cases and are silently
skipped. The Claims tab flattens a provider's *submission* into one row per
service line; an 835 is not a submission, so there is nothing to flatten, and
an empty tab is the honest answer rather than a bug.

**The Limited Data Set does not reach an 835's patient identifiers.** Also no
code change, audited the same way: the rule's identifier-bearing loops are
`PERSON_LOOPS` — 2010BA, 2010CA, 2330A — reached through `buildTree`'s
`NM1`-keyed entity-loop resolution. An 835's own `NM1` (inside loop 2100:
`NM1*QC` patient, `NM1*IL` insured, `NM1*82` rendering provider, and so on)
opens no loop at all under this feature — see "the governing rule" above —
so `scrubLoop` never reaches one of these NM1s, and `PERSON_LOOPS` itself
never names an 835 loop id to begin with. An 835 handed through Limited Data
Set comes back byte-identical to what went in, which is worth stating loudly
in the app's own UI copy: silence here would hand a user a file they believe
is scrubbed.

## Sources, and what could not be used

The X12 TR3 for `005010X221A1` is paywalled and was **not read**. Nothing
here or in the code derives from it, and — unlike PACDR, which cross-read two
published state companion guides — no companion guide was used for this pass
either; the user's posture, set explicitly for this feature, was to proceed
on model knowledge and cut or stand down anything not certain, rather than
wait on sourcing. What is asserted here is limited to loop ids, segment ids,
element positions and the balancing arithmetic the 835 transaction's own
definition implies — functional facts about a data format, the same posture
the app has always taken for 837P and PACDR.

The fixture (`tests/fixtures/sample_835.edi`) is **wholly invented**: payer
and provider names, member ids, control numbers, and every dollar amount.
