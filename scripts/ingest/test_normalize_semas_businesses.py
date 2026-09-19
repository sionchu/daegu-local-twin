import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).parent))

from normalize_semas_businesses import (  # noqa: E402
    local_twin_category,
    normalize_rows,
    point_in_polygon,
)


CELL = {
    "cellId": "hex-dongseongro-test",
    "boundary": [
        {"lon": 128.0, "lat": 35.0},
        {"lon": 129.0, "lat": 35.0},
        {"lon": 129.0, "lat": 36.0},
        {"lon": 128.0, "lat": 36.0},
    ],
}


def row(source_id: str, longitude: str = "128.5", latitude: str = "35.5", **overrides: str) -> dict[str, str]:
    value = {
        "상가업소번호": source_id,
        "상호명": "테스트 점포",
        "경도": longitude,
        "위도": latitude,
        "상권업종대분류코드": "I2",
        "상권업종대분류명": "음식",
        "상권업종중분류코드": "I212",
        "상권업종중분류명": "비알코올",
        "상권업종소분류코드": "I21201",
        "상권업종소분류명": "카페",
        "표준산업분류코드": "I56220",
        "표준산업분류명": "비알코올 음료점업",
    }
    value.update(overrides)
    return value


class NormalizeSemasBusinessesTest(unittest.TestCase):
    def test_polygon_includes_boundary_and_rejects_outside(self) -> None:
        boundary = [(128.0, 35.0), (129.0, 35.0), (129.0, 36.0), (128.0, 36.0)]
        self.assertTrue(point_in_polygon((128.5, 35.5), boundary))
        self.assertTrue(point_in_polygon((128.0, 35.5), boundary))
        self.assertFalse(point_in_polygon((127.9, 35.5), boundary))

    def test_local_category_mapping_keeps_source_category_separate(self) -> None:
        self.assertEqual(local_twin_category(row("one")), "cafe")
        self.assertEqual(local_twin_category(row("two", **{"상권업종대분류명": "소매"})), "retail")
        self.assertEqual(
            local_twin_category(
                row(
                    "three",
                    **{
                        "상권업종대분류명": "수리·개인",
                        "상권업종중분류명": "이용·미용",
                        "상권업종소분류명": "미용실",
                    },
                )
            ),
            "beauty",
        )

    def test_duplicate_source_id_retains_first_record_deterministically(self) -> None:
        records, report = normalize_rows(
            [row("same", **{"상호명": "첫 점포"}), row("same", **{"상호명": "두 번째 점포"}), row("other")],
            [CELL],
        )
        self.assertEqual(report["corridorCandidateCountBeforeDedup"], 3)
        self.assertEqual(report["duplicateRowsDropped"], 1)
        self.assertEqual(report["normalizedRecordCount"], 2)
        self.assertEqual(records[0]["sourceBusinessId"], "other")
        self.assertEqual(next(item for item in records if item["sourceBusinessId"] == "same")["businessName"], "첫 점포")

    def test_missing_coordinates_are_not_interpolated(self) -> None:
        records, report = normalize_rows([row("missing", latitude="")], [CELL])
        self.assertEqual(records, [])
        self.assertEqual(report["sourceMissingCoordinateCount"], 1)
        self.assertEqual(report["normalizedRecordCount"], 0)


if __name__ == "__main__":
    unittest.main()
