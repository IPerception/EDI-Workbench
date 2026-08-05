"""Transform rules applied to a parsed EdiDocument's segments.

Each rule is a small, self-contained class exposing `name` and
`apply(segments) -> int` (count of segments changed). To add a future
requirement, write a new Rule and register it in engine.DEFAULT_RULES --
the parser, writer, and UI never need to change.
"""

from datetime import date, timedelta
from typing import List, Protocol

from .document import Segment


class Rule(Protocol):
    name: str

    def apply(self, segments: List[Segment]) -> int:
        """Mutate matching segments in place; return count of changes made."""
        ...


# Segments that only ever appear outside a loop-2400 (service line) context
# in an 837P. Seeing one of these means we've left the current service line.
_SERVICE_LINE_BOUNDARY_IDS = {"CLM", "HL", "SE"}


class Dtp472ServiceLineIncrementRule:
    """Increments the date on every DTP*472 (Service Date) segment that
    falls inside a service-line loop (2400), by a fixed number of days.

    Loop membership is tracked with a simple state machine rather than a
    full HL-hierarchy parser: an LX segment opens a service line, and CLM/
    HL/SE close it. That's sufficient for 837P, where DTP*472 only ever
    appears in loop 2400 anyway; it also means claim-level dates are left
    alone if this rule is ever reused against an 837I.
    """

    name = "dtp472_service_line_increment"

    def __init__(self, days: int = 1):
        self.days = days

    def apply(self, segments: List[Segment]) -> int:
        changed = 0
        in_service_line = False

        for seg in segments:
            if seg.id == "LX":
                in_service_line = True
                continue
            if seg.id in _SERVICE_LINE_BOUNDARY_IDS:
                in_service_line = False
                continue
            if not in_service_line or seg.id != "DTP" or len(seg.elements) < 3:
                continue

            qualifier, date_fmt, value = seg.elements[0], seg.elements[1], seg.elements[2]
            if qualifier != "472" or date_fmt != "D8":
                continue

            try:
                parsed = date(int(value[0:4]), int(value[4:6]), int(value[6:8]))
            except (ValueError, IndexError):
                continue  # malformed date value; skip rather than fail the whole file

            seg.elements[2] = (parsed + timedelta(days=self.days)).strftime("%Y%m%d")
            changed += 1

        return changed
