import unittest

from edi_engine.document import Segment
from edi_engine.rules import Dtp472ServiceLineIncrementRule


class TestDtp472ServiceLineIncrementRule(unittest.TestCase):
    def setUp(self):
        self.rule = Dtp472ServiceLineIncrementRule()

    def test_only_increments_dtp472_inside_a_service_line_loop(self):
        segments = [
            Segment(id="CLM", elements=["ACCT", "150"]),
            Segment(id="DTP", elements=["472", "D8", "20230101"]),  # claim-level: not in a service line
            Segment(id="LX", elements=["1"]),
            Segment(id="DTP", elements=["472", "D8", "20230101"]),  # service-line: should change
            Segment(id="SE", elements=["10", "0001"]),
        ]

        changed = self.rule.apply(segments)

        self.assertEqual(changed, 1)
        self.assertEqual(segments[1].elements[2], "20230101")  # untouched
        self.assertEqual(segments[3].elements[2], "20230102")  # incremented

    def test_ignores_other_dtp_qualifiers_and_formats(self):
        segments = [
            Segment(id="LX", elements=["1"]),
            Segment(id="DTP", elements=["434", "D8", "20230101"]),  # different qualifier
            Segment(id="DTP", elements=["472", "RD8", "20230101-20230102"]),  # different date format
        ]

        changed = self.rule.apply(segments)

        self.assertEqual(changed, 0)

    def test_handles_month_and_year_rollover(self):
        segments = [
            Segment(id="LX", elements=["1"]),
            Segment(id="DTP", elements=["472", "D8", "20231231"]),
        ]

        self.rule.apply(segments)

        self.assertEqual(segments[1].elements[2], "20240101")

    def test_handles_leap_year(self):
        segments = [
            Segment(id="LX", elements=["1"]),
            Segment(id="DTP", elements=["472", "D8", "20240228"]),
        ]

        self.rule.apply(segments)

        self.assertEqual(segments[1].elements[2], "20240229")

    def test_service_line_scope_resets_on_new_line_and_closes_on_boundary_segments(self):
        segments = [
            Segment(id="LX", elements=["1"]),
            Segment(id="DTP", elements=["472", "D8", "20230101"]),
            Segment(id="SE", elements=["10", "0001"]),  # closes the loop
            Segment(id="DTP", elements=["472", "D8", "20230101"]),  # after SE: should not change
        ]

        changed = self.rule.apply(segments)

        self.assertEqual(changed, 1)
        self.assertEqual(segments[1].elements[2], "20230102")
        self.assertEqual(segments[3].elements[2], "20230101")


if __name__ == "__main__":
    unittest.main()
