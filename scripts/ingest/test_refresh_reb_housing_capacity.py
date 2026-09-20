from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

import refresh_reb_housing_capacity as housing  # noqa: E402


HEADER = [
    "단지고유번호",
    "필지고유번호",
    "주소",
    "단지명_공시가격",
    "단지명_건축물대장",
    "단지명_도로명주소",
    "단지종류",
    "동수",
    "세대수",
    "사용승인일",
    "도로명주소",
]
class HousingCapacityTest(unittest.TestCase):
    def make_zones(self, path: Path) -> None:
        document = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {
                        "zoneId": "sgis-dong:1",
                        "district": "달서구",
                        "label": "감삼동",
                    },
                    "geometry": {"type": "Polygon", "coordinates": []},
                },
                {
                    "type": "Feature",
                    "properties": {
                        "zoneId": "sgis-dong:2",
                        "district": "수성구",
                        "label": "범어1동",
                    },
                    "geometry": {"type": "Polygon", "coordinates": []},
                },
            ],
        }
        path.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
    def make_csv(self, path: Path) -> None:
        rows = [
            HEADER,
            [
                "A1", "P1", "대구광역시 달서구 감삼동 1", "감삼A", "", "",
                "1", "3", "300", "2024-01-01", "감삼로 1",
            ],
            [
                "A2", "P2", "대구광역시 수성구 범어동 2", "범어A", "", "",
                "1", "5", "500", "2024-01-01", "범어로 2",
            ],
            [
                "A3", "P3", "대구광역시 수성구 범어1동 3", "범어B", "", "",
                "1", "2", "120", "2024-01-01", "범어로 3",
            ],
            [
                "A4", "P4", "서울특별시 중구 필동 1", "서울A", "", "",
                "1", "1", "50", "2024-01-01", "필동로 1",
            ],
        ]
        text = "\n".join(",".join(row) for row in rows) + "\n"
        path.write_bytes(text.encode("cp949"))
    def test_normalize_keeps_district_totals_and_partial_exact_links(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.csv"
            zones = root / "zones.geojson"
            self.make_csv(source)
            self.make_zones(zones)

            document = housing.normalize(
                source,
                zones,
                "2026-09-20T07:53:32Z",
            )

        self.assertEqual(document["source"]["encoding"], "cp949")
        self.assertEqual(document["source"]["sourceRecordCount"], 4)
        self.assertFalse(document["source"]["portalRowCountMatchesSource"])
        self.assertEqual(document["coverage"]["daeguComplexRecords"], 3)
        self.assertEqual(document["coverage"]["daeguHouseholds"], 920)
        self.assertEqual(document["coverage"]["exactNameLinkedComplexRecords"], 2)
        self.assertEqual(document["coverage"]["exactNameLinkedHouseholds"], 420)
        self.assertEqual(document["coverage"]["exactNameLinkedZoneCount"], 2)
        districts = {row["district"]: row for row in document["byDistrict"]}
        self.assertEqual(districts["달서구"]["households"], 300)
        self.assertEqual(districts["수성구"]["households"], 620)

        links = {row["zoneId"]: row for row in document["exactNameLinkedZones"]}
        self.assertEqual(links["sgis-dong:1"]["partialHouseholds"], 300)
        self.assertEqual(links["sgis-dong:2"]["partialHouseholds"], 120)
        self.assertNotEqual(
            document["coverage"]["exactNameLinkedHouseholds"],
            document["coverage"]["daeguHouseholds"],
        )

    def test_committed_snapshot_matches_verified_source(self) -> None:
        repo_root = SCRIPT_DIR.parents[1]
        document = json.loads(
            (repo_root / "public/data/housing_capacity.json").read_text(encoding="utf-8")
        )
        self.assertEqual(document["source"]["sourceSha256"], "87272863D9C2EDCD69D1A5319EB5755C288F13E8D0525DAFB92C10A54C3CB00D")
        self.assertEqual(document["source"]["sourceRecordCount"], 307834)
        self.assertFalse(document["source"]["portalRowCountMatchesSource"])
        self.assertEqual(document["coverage"]["daeguComplexRecords"], 9100)
        self.assertEqual(document["coverage"]["daeguHouseholds"], 749768)
        self.assertEqual(document["coverage"]["exactNameLinkedZoneCount"], 38)
        self.assertEqual(document["coverage"]["exactNameLinkedHouseholds"], 246191)
        self.assertEqual(document["coverage"]["householdCoveragePct"], 32.84)

    def test_missing_required_column_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.csv"
            zones = root / "zones.geojson"
            source.write_bytes("주소,세대수\n대구광역시 달서구 감삼동 1,3\n".encode("cp949"))
            self.make_zones(zones)
            with self.assertRaisesRegex(ValueError, "missing required columns"):
                housing.normalize(source, zones, "2026-09-20T00:00:00Z")


if __name__ == "__main__":
    unittest.main()
