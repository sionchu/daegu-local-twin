from __future__ import annotations

import copy
import unittest

from scripts.ingest.refresh_reb_rent import (
    RENT_METRIC,
    RENT_UNIT,
    VACANCY_METRIC,
    VACANCY_UNIT,
    normalize_exports,
)


RENT_SHA = "A" * 64
VACANCY_SHA = "B" * 64


def export_payload(metric: str, unit: str, values: dict[str, str]) -> dict[str, object]:
    period_columns = {
        "4": "2024년 3분기",
        "5": "2024년 4분기",
        "10": "2026년 1분기",
        "11": "2026년 2분기",
    }
    data: dict[str, dict[str, str]] = {
        "0": {"0": "No", "1": "지역", **period_columns},
        "1": {"0": "No", "1": "지역", **{key: metric for key in period_columns}},
        "2": {"0": "No", "1": "지역", **{key: unit for key in period_columns}},
    }
    for index, (region, value) in enumerate(values.items(), start=3):
        data[str(index)] = {
            "0": str(index - 2),
            "1": "대구",
            "2": region,
            "3": region,
            "11": value,
        }
    return {"sheet": {"1": {"dataRows": str(len(data)), "data": data}}}


class RebRentNormalizationTest(unittest.TestCase):
    def test_preserves_official_values_and_separates_conversion(self) -> None:
        rent = export_payload(
            RENT_METRIC,
            RENT_UNIT,
            {"대구": "20.6", "동성로중심": "26.8", "삼덕/대봉": "27.2"},
        )
        vacancy = export_payload(
            VACANCY_METRIC,
            VACANCY_UNIT,
            {"대구": "10.8", "동성로중심": "12.8", "삼덕/대봉": "0.0"},
        )

        result = normalize_exports(
            rent,
            vacancy,
            retrieved_at="2026-09-19T08:40:28Z",
            rent_source_sha256=RENT_SHA,
            vacancy_source_sha256=VACANCY_SHA,
        )

        self.assertEqual(result["mode"], "official-snapshot")
        self.assertEqual(result["sourcePeriod"]["code"], "202602")
        self.assertEqual(result["officialGeographyLevel"], "상권")
        self.assertEqual(result["quality"]["provinceAggregateExcluded"], 1)
        self.assertEqual(result["quality"]["normalizedRecordCount"], 2)
        record = result["records"][0]
        self.assertEqual(record["geography"]["regionName"], "동성로중심")
        self.assertEqual(record["official"]["rent"]["value"], 26.8)
        self.assertEqual(record["official"]["rent"]["unit"], "천원/㎡")
        self.assertEqual(record["official"]["vacancy"]["value"], 12.8)
        self.assertEqual(record["official"]["vacancy"]["unit"], "%")
        self.assertEqual(record["localTwin"]["rentPerSquareMeter"]["value"], 26800)
        self.assertEqual(record["localTwin"]["rentPerSquareMeter"]["unit"], "원/㎡")
        self.assertEqual(record["localTwin"]["vacancy"]["value"], 12.8)
        self.assertEqual(result["coverage"]["unavailableRequestedCorridorLabels"], ["교동", "북성로"])

    def test_period_mismatch_is_rejected(self) -> None:
        rent = export_payload(RENT_METRIC, RENT_UNIT, {"동성로중심": "26.8"})
        vacancy = export_payload(VACANCY_METRIC, VACANCY_UNIT, {"동성로중심": "12.8"})
        vacancy["sheet"]["1"]["data"]["0"]["11"] = "2026년 1분기"

        with self.assertRaisesRegex(ValueError, "period mismatch"):
            normalize_exports(
                rent,
                vacancy,
                retrieved_at="2026-09-19T08:40:28Z",
                rent_source_sha256=RENT_SHA,
                vacancy_source_sha256=VACANCY_SHA,
            )

    def test_metric_and_unit_are_validated(self) -> None:
        rent = export_payload("잘못된 지표", RENT_UNIT, {"동성로중심": "26.8"})
        vacancy = export_payload(VACANCY_METRIC, VACANCY_UNIT, {"동성로중심": "12.8"})

        with self.assertRaisesRegex(ValueError, "Expected metric"):
            normalize_exports(
                rent,
                vacancy,
                retrieved_at="2026-09-19T08:40:28Z",
                rent_source_sha256=RENT_SHA,
                vacancy_source_sha256=VACANCY_SHA,
            )

    def test_geography_sets_must_match_without_filling_missing_areas(self) -> None:
        rent = export_payload(RENT_METRIC, RENT_UNIT, {"동성로중심": "26.8", "삼덕/대봉": "27.2"})
        vacancy = export_payload(VACANCY_METRIC, VACANCY_UNIT, {"동성로중심": "12.8"})

        with self.assertRaisesRegex(ValueError, "geography sets do not match"):
            normalize_exports(
                rent,
                vacancy,
                retrieved_at="2026-09-19T08:40:28Z",
                rent_source_sha256=RENT_SHA,
                vacancy_source_sha256=VACANCY_SHA,
            )

    def test_conflicting_duplicate_official_row_is_rejected(self) -> None:
        rent = export_payload(RENT_METRIC, RENT_UNIT, {"동성로중심": "26.8"})
        duplicate = copy.deepcopy(rent["sheet"]["1"]["data"]["3"])
        duplicate["0"] = "2"
        duplicate["11"] = "99.9"
        rent["sheet"]["1"]["data"]["4"] = duplicate
        vacancy = export_payload(VACANCY_METRIC, VACANCY_UNIT, {"동성로중심": "12.8"})

        with self.assertRaisesRegex(ValueError, "Conflicting duplicate"):
            normalize_exports(
                rent,
                vacancy,
                retrieved_at="2026-09-19T08:40:28Z",
                rent_source_sha256=RENT_SHA,
                vacancy_source_sha256=VACANCY_SHA,
            )


if __name__ == "__main__":
    unittest.main()
