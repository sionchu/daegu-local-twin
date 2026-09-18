from __future__ import annotations

import unittest

from scripts.ingest.refresh_daegu_transit import normalize_transit


CSV_SAMPLE = """월,일,역번호,역명,승하차,05시-06시,06시-07시,07시-08시,08시-09시,09시-10시,10시-11시,11시-12시,12시-13시,13시-14시,14시-15시,15시-16시,16시-17시,17시-18시,18시-19시,19시-20시,20시-21시,21시-22시,22시-23시,23시-24시,일계
7,1,131,중앙로,승차,1,1,1,1,1,10,10,10,10,10,10,10,10,10,10,10,10,1,1,130
7,1,131,중앙로,하차,1,1,1,1,1,5,5,5,5,5,5,5,5,5,5,5,5,1,1,70
7,2,131,중앙로,승차,1,1,1,1,1,20,20,20,20,20,20,20,20,20,20,20,20,1,1,250
7,2,131,중앙로,하차,1,1,1,1,1,10,10,10,10,10,10,10,10,10,10,10,10,1,1,130
6,30,131,중앙로,승차,9,9,9,9,9,99,99,99,99,99,99,99,99,99,99,99,99,9,9,999
"""


class TransitNormalizationTest(unittest.TestCase):
    def test_aggregates_boarding_and_alighting_by_day(self) -> None:
        result = normalize_transit(
            CSV_SAMPLE,
            station_targets=("중앙로",),
            requested_month=7,
            dataset_version="20260731",
        )
        self.assertEqual(result["mode"], "official-snapshot")
        self.assertEqual(result["month"], 7)
        self.assertEqual(len(result["records"]), 1)
        record = result["records"][0]
        self.assertEqual(record["station"], "중앙로역")
        self.assertEqual(record["stationNumbers"], ["131"])
        self.assertEqual(record["daysObserved"], 2)
        self.assertEqual(record["averageDailyTotal"], 290.0)
        self.assertEqual(record["averageDailyBoardings"], 190.0)
        self.assertEqual(record["averageDailyAlightings"], 100.0)
        # Day 1 business hours: 12 * (10+5) = 180.
        # Day 2 business hours: 12 * (20+10) = 360.
        self.assertEqual(record["averageDailyBusinessHours"], 270.0)

    def test_defaults_to_latest_month_and_reports_missing_station(self) -> None:
        result = normalize_transit(
            CSV_SAMPLE,
            station_targets=("중앙로역", "반월당역"),
            requested_month=None,
            dataset_version="20260731",
        )
        self.assertEqual(result["month"], 7)
        self.assertEqual(result["missingStations"], ["반월당역"])


if __name__ == "__main__":
    unittest.main()
