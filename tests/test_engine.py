import shutil
import tempfile
import unittest
from pathlib import Path

from edi_engine.engine import process

FIXTURE = Path(__file__).parent / "fixtures" / "sample_837p.edi"


class TestProcess(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.input_path = Path(self.tmp_dir.name) / "sample_837p.edi"
        shutil.copyfile(FIXTURE, self.input_path)

    def tearDown(self):
        self.tmp_dir.cleanup()

    def test_writes_new_file_in_same_folder_and_leaves_original_untouched(self):
        original_bytes = self.input_path.read_bytes()

        result = process(self.input_path)

        self.assertEqual(result.output_path.parent, self.input_path.parent)
        self.assertTrue(result.output_path.exists())
        self.assertNotEqual(result.output_path, self.input_path)
        self.assertEqual(self.input_path.read_bytes(), original_bytes)

    def test_increments_both_service_line_dates_in_sample_file(self):
        result = process(self.input_path)

        self.assertEqual(result.segments_changed, 2)
        self.assertEqual(result.rule_summary["dtp472_service_line_increment"], 2)

        output_text = result.output_path.read_text(encoding="utf-8")
        self.assertEqual(output_text.count("DTP*472*D8*20230102~"), 2)
        self.assertNotIn("DTP*472*D8*20230101~", output_text)

    def test_raises_clear_error_for_missing_file(self):
        with self.assertRaises(FileNotFoundError):
            process(Path(self.tmp_dir.name) / "does_not_exist.edi")


if __name__ == "__main__":
    unittest.main()
