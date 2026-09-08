// Audits whether a rule's marks account for every change it actually makes.
//
// Not a suite of its own -- it is called from the suites that already have a
// rule wired up: parity.mjs for the two engine rules, deid.mjs for
// DeidentifyRule. Putting the audit next to each rule's other tests beats a
// tenth suite that would have to re-lift the whole engine to reach them.
//
// Why this exists at all: processText used to build its change list by cloning
// every segment before the rules ran and comparing afterwards. The clone was a
// full second copy of the working set, so it was dropped -- the change list is
// now built from what the rules say they touched. That moves the correctness of
// the Changes tab, and of the Limited Data Set's own record of what it
// rewrote, onto the accuracy of `marks`. Nothing checked that before; this does.
//
// Two directions, and they are not equally serious:
//
//   unmarked    a rule changed something and did not say so. The change list
//               misses it. Nothing downstream can recover it, because the
//               before-value is gone the moment the rule overwrites it. This
//               must always be empty.
//   overclaimed a rule marked something that did not actually change. Harmless
//               and expected -- StringReplaceRule counts a match even when the
//               replacement equals what it matched. processText filters these
//               with sameSegment, which is exactly why that filter was kept
//               when the full snapshot was dropped.

const key = (segment, element) => `${segment}:${element}`;

export function auditMarks(parse, rule, raw) {
  const doc = parse(raw);
  if (typeof rule.check === "function") rule.check(doc);

  // The audit's own before-copy. This is the thing processText no longer does;
  // a test may pay for it because a fixture is small and correctness is the
  // point, which is not true of a 50 MB file in a browser tab.
  const before = doc.segments.map((seg) => ({ id: seg.id, elements: seg.elements.slice() }));
  const result = rule.apply(doc.segments);

  const changed = new Set();
  doc.segments.forEach((seg, i) => {
    const was = before[i].elements;
    const now = seg.elements;
    // Compare across the longer of the two: a rule that appends or truncates
    // elements has changed the segment just as much as one that overwrites.
    for (let j = 0; j < Math.max(was.length, now.length); j++) {
      if (was[j] !== now[j]) changed.add(key(i, j));
    }
    if (before[i].id !== seg.id) changed.add(key(i, "id"));
  });

  const claimed = new Set();
  for (const mark of result.marks) {
    for (const element of mark.elements) claimed.add(key(mark.segment, element));
  }

  const sorted = (set) => [...set].sort();
  return {
    result,
    changed: sorted(changed),
    unmarked: sorted([...changed].filter((k) => !claimed.has(k))),
    overclaimed: sorted([...claimed].filter((k) => !changed.has(k))),
  };
}
