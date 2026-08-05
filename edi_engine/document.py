"""Delimiter-agnostic structural model for X12 EDI interchanges.

This is intentionally NOT a full X12 implementation-guide parser (no loop/
HL semantics, no element-level validation). It only knows how to split an
interchange into segments/elements and put it back together byte-faithfully,
which is all a segment-editing rule needs. Loop awareness, where required,
lives in individual rules (see rules.py).
"""

from dataclasses import dataclass, field
from typing import List


@dataclass
class Segment:
    id: str
    elements: List[str] = field(default_factory=list)
    # Whitespace (line breaks, etc.) that preceded this segment in the
    # source file, preserved so untouched segments serialize byte-for-byte.
    leading_ws: str = ""


@dataclass
class EdiDocument:
    segments: List[Segment]
    element_sep: str
    component_sep: str
    segment_terminator: str
    # Whatever trailed the final segment terminator in the source file
    # (typically a trailing newline, sometimes nothing).
    tail: str = ""


def detect_delimiters(raw: str):
    """Detect element separator, component separator, and segment terminator
    from the ISA segment, rather than assuming '*' and '~'.

    The ISA segment is the one fixed-width segment in X12: its 16th element
    (ISA16) is always exactly one character and is the component element
    separator, and the segment terminator is the single character
    immediately following it.
    """
    if not raw.startswith("ISA"):
        raise ValueError("File does not start with an ISA segment; not a valid X12 interchange.")

    element_sep = raw[3]
    parts = raw[4:].split(element_sep, 15)
    if len(parts) < 16:
        raise ValueError("Malformed ISA segment; expected 16 elements.")

    last_part = parts[15]
    if len(last_part) < 2:
        raise ValueError("Malformed ISA segment; missing component separator/segment terminator.")

    component_sep = last_part[0]
    segment_terminator = last_part[1]
    return element_sep, component_sep, segment_terminator


def parse(raw: str) -> EdiDocument:
    element_sep, component_sep, segment_terminator = detect_delimiters(raw)

    pieces = raw.split(segment_terminator)
    tail = pieces.pop() if pieces else ""

    segments: List[Segment] = []
    for piece in pieces:
        stripped = piece.lstrip("\r\n")
        if not stripped:
            continue
        leading_ws = piece[: len(piece) - len(stripped)]
        tokens = stripped.split(element_sep)
        segments.append(Segment(id=tokens[0], elements=tokens[1:], leading_ws=leading_ws))

    return EdiDocument(
        segments=segments,
        element_sep=element_sep,
        component_sep=component_sep,
        segment_terminator=segment_terminator,
        tail=tail,
    )


def serialize(doc: EdiDocument) -> str:
    parts: List[str] = []
    for seg in doc.segments:
        parts.append(seg.leading_ws)
        parts.append(doc.element_sep.join([seg.id, *seg.elements]))
        parts.append(doc.segment_terminator)
    parts.append(doc.tail)
    return "".join(parts)
