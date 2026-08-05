"""Orchestrates parse -> apply rules -> write for a single EDI file.

This module is the one place a UI (or a future CLI/batch runner) needs to
call into. It has no knowledge of Tkinter or any other UI toolkit.
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Union

from .document import parse, serialize
from .naming import build_output_path
from .rules import Dtp472ServiceLineIncrementRule, Rule

DEFAULT_RULES: List[Rule] = [Dtp472ServiceLineIncrementRule()]


@dataclass
class ProcessResult:
    output_path: Path
    segments_changed: int
    rule_summary: Dict[str, int] = field(default_factory=dict)


def process(input_path: Union[str, Path], rules: Optional[List[Rule]] = None) -> ProcessResult:
    input_path = Path(input_path)
    if not input_path.is_file():
        raise FileNotFoundError(f"No such file: {input_path}")

    raw = input_path.read_text(encoding="utf-8")
    doc = parse(raw)

    active_rules = rules if rules is not None else DEFAULT_RULES
    summary: Dict[str, int] = {}
    for rule in active_rules:
        summary[rule.name] = rule.apply(doc.segments)

    output_text = serialize(doc)
    output_path = build_output_path(input_path)

    # Write-to-temp-then-rename so a crash mid-write can't leave a
    # corrupt "processed" file behind.
    tmp_path = output_path.with_name(output_path.name + ".tmp")
    tmp_path.write_text(output_text, encoding="utf-8", newline="")
    tmp_path.replace(output_path)

    return ProcessResult(
        output_path=output_path,
        segments_changed=sum(summary.values()),
        rule_summary=summary,
    )
