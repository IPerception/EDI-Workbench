import unittest
from pathlib import Path

from edi_engine.document import parse, serialize

FIXTURE = Path(__file__).parent / "fixtures" / "sample_837p.edi"


class TestDocumentRoundTrip(unittest.TestCase):
    def test_parse_then_serialize_is_byte_identical_when_untouched(self):
        raw = FIXTURE.read_text(encoding="utf-8")
        doc = parse(raw)
        self.assertEqual(serialize(doc), raw)

    def test_detects_delimiters_from_isa_segment(self):
        raw = FIXTURE.read_text(encoding="utf-8")
        doc = parse(raw)
        self.assertEqual(doc.element_sep, "*")
        self.assertEqual(doc.segment_terminator, "~")
        self.assertEqual(doc.component_sep, ":")

    def test_segment_ids_parsed_in_order(self):
        raw = FIXTURE.read_text(encoding="utf-8")
        doc = parse(raw)
        ids = [seg.id for seg in doc.segments]
        self.assertEqual(ids[0], "ISA")
        self.assertEqual(ids[-1], "IEA")
        self.assertIn("DTP", ids)


if __name__ == "__main__":
    unittest.main()
