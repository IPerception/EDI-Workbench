"""Runs the Python engine on a copy of the fixture to produce a reference output."""
import shutil
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT))

from edi_engine.engine import process  # noqa: E402

out_dir = Path(sys.argv[1])
out_dir.mkdir(parents=True, exist_ok=True)
src = out_dir / "sample_837p.edi"
shutil.copyfile(PROJECT / "tests" / "fixtures" / "sample_837p.edi", src)

result = process(src)
print(result.output_path)
