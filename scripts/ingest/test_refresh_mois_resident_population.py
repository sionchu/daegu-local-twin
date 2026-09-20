from __future__ import annotations

import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
sys.path.insert(0, str(SCRIPT_DIR))

import refresh_mois_resident_population as population  # noqa: E402


class ResidentPopulationTest(unittest.TestCase):
    def test_committed_snapshot_maps_all_sgis_zones_and_preserves_source_total(self) -> None:
        document = json.loads(
            (REPO_ROOT / "public/data/resident_population_dong.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(
            document["source"]["sourceSha256"],
            "33808E6A0DAF1F6923618727BCE9188EEBFF7F58B4EF4BBA06BDD033025FE233",
        )
        self.assertEqual(document["source"]["sourceRecordCount"], 3619)
        self.assertEqual(document["coverage"]["sourceDaeguAgencyRows"], 152)
        self.assertEqual(document["coverage"]["directNameMatchedRows"], 150)
        self.assertEqual(document["coverage"]["branchOfficeRows"], 2)
        self.assertEqual(document["coverage"]["sgisZoneCount"], 150)
        self.assertEqual(document["coverage"]["sgisCoveragePct"], 100.0)
        self.assertEqual(document["coverage"]["districtCount"], 9)
        self.assertEqual(document["coverage"]["population"], 2346277)
        self.assertEqual(
            document["coverage"]["population"],
            document["coverage"]["male"] + document["coverage"]["female"],
        )
        self.assertEqual(len(document["records"]), 150)
        self.assertEqual(len({row["zoneId"] for row in document["records"]}), 150)
        self.assertEqual(len(document["branchOfficeAssignments"]), 2)
        self.assertEqual(
            {row["sourceLabel"] for row in document["branchOfficeAssignments"]},
            {"논공읍공단출장소", "다사읍서재출장소"},
        )

        availability = json.loads(
            (REPO_ROOT / "public/data/context_data_availability.json").read_text(
                encoding="utf-8"
            )
        )
        resident = next(
            row for row in availability["datasets"] if row["key"] == "resident_population"
        )
        self.assertEqual(resident["status"], "available-official-dong-2026-08")
        self.assertEqual(resident["officialZoneRecords"], 150)
        self.assertEqual(resident["population"], 2346277)

        provenance = json.loads(
            (REPO_ROOT / "public/data/provenance.json").read_text(encoding="utf-8")
        )
        source = next(
            row
            for row in provenance["sources"]
            if row["id"] == "mois-dong-resident-population-2026-08"
        )
        self.assertEqual(source["mode"], "official-snapshot")
        self.assertEqual(source["sourceSha256"], document["source"]["sourceSha256"])

    def test_population_values_reject_inconsistent_sex_totals(self) -> None:
        row = {
            "전체 전월인구수": "10",
            "전월 남자인구수": "5",
            "전월 여자인구수": "5",
            "전체 당월인구수": "11",
            "당월 남자인구수": "6",
            "당월 여자인구수": "6",
            "전체 인구증감": "1",
            "남자 인구증감": "1",
            "여자 인구증감": "1",
        }
        with self.assertRaisesRegex(ValueError, "current population"):
            population.population_values(row)


if __name__ == "__main__":
    unittest.main()
