from datetime import datetime
from pathlib import Path


def build_output_path(input_path: Path) -> Path:
    """Same-folder, collision-safe output filename for a processed file."""
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    stem = input_path.stem
    suffix = input_path.suffix or ".edi"

    candidate = input_path.with_name(f"{stem}_processed_{timestamp}{suffix}")
    counter = 1
    while candidate.exists():
        candidate = input_path.with_name(f"{stem}_processed_{timestamp}_{counter}{suffix}")
        counter += 1
    return candidate
