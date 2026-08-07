# Manual-test samples

837P files for exercising the browser app by hand. The automated suites
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
```

The clean baseline is `tests/fixtures/sample_837p.edi`, which should report no
problems in any tab.

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
