from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
sys.path.insert(0, str(SCRIPT_DIR))

import refresh_schoolinfo_capacity as schoolinfo  # noqa: E402


class SchoolinfoCapacityTest(unittest.TestCase):
    def test_committed_snapshot_has_official_coordinates_and_capacity(self) -> None:
        document = json.loads(
            (REPO_ROOT / "public/data/school_capacity.json").read_text(
                encoding="utf-8"
            )
        )
        coverage = document["coverage"]
        self.assertEqual(document["source"]["sourceYear"], 2026)
        self.assertEqual(document["source"]["locationCode"], "03")
        self.assertEqual(len(document["source"]["requests"]), 12)
        self.assertEqual(len(document["source"]["sourceBundleSha256"]), 64)
        self.assertEqual(coverage["rawBasicUniqueSchools"], 503)
        self.assertEqual(coverage["rawStudentUniqueSchools"], 471)
        self.assertEqual(coverage["activeSchoolRecords"], 472)
        self.assertEqual(coverage["officialCoordinateRecords"], 472)
        self.assertEqual(coverage["studentCapacityRecords"], 471)
        self.assertEqual(coverage["studentCapacityCoveragePct"], 99.79)
        self.assertEqual(coverage["missingStudentCapacityCount"], 1)
        self.assertEqual(coverage["totalStudents"], 228756)
        self.assertEqual(
            coverage["maleStudents"] + coverage["femaleStudents"],
            coverage["totalStudents"],
        )
        self.assertEqual(len(document["records"]), 472)
        self.assertEqual(
            len({row["schoolCode"] for row in document["records"]}),
            472,
        )
        self.assertTrue(
            all(
                128.0 < row["longitude"] < 129.5
                and 35.0 < row["latitude"] < 37.0
                and row["coordinateQuality"] == "official-schoolinfo"
                for row in document["records"]
            )
        )
        self.assertTrue(
            all(
                "phone" not in key.lower()
                and "fax" not in key.lower()
                and "homepage" not in key.lower()
                for row in document["records"]
                for key in row
            )
        )
        self.assertEqual(
            document["missingStudentCapacitySchoolCodes"],
            ["S030000285"],
        )

        availability = json.loads(
            (REPO_ROOT / "public/data/context_data_availability.json").read_text(
                encoding="utf-8"
            )
        )
        slot = next(
            row
            for row in availability["datasets"]
            if row["key"] == "school_capacity_official"
        )
        self.assertEqual(slot["status"], "available-official-schoolinfo-2026")
        self.assertEqual(slot["officialCoordinateRecords"], 472)
        self.assertEqual(slot["studentCapacityRecords"], 471)
        self.assertEqual(slot["totalStudents"], 228756)

        provenance = json.loads(
            (REPO_ROOT / "public/data/provenance.json").read_text(encoding="utf-8")
        )
        source = next(
            row
            for row in provenance["sources"]
            if row["id"] == "schoolinfo-k12-capacity-2026"
        )
        self.assertEqual(source["mode"], "official-snapshot")
        self.assertEqual(
            source["sourceSha256"],
            document["source"]["sourceBundleSha256"],
        )

    def test_active_filter_excludes_closed_absent_and_publication_exempt(self) -> None:
        self.assertTrue(
            schoolinfo.is_active_school(
                {"CLOSE_YN": "N", "ABSCH_YN": "N", "PBAN_EXCP_YN": "N"}
            )
        )
        self.assertFalse(
            schoolinfo.is_active_school(
                {"CLOSE_YN": "Y", "ABSCH_YN": "N", "PBAN_EXCP_YN": "N"}
            )
        )
        self.assertFalse(
            schoolinfo.is_active_school(
                {"CLOSE_YN": "N", "ABSCH_YN": "Y", "PBAN_EXCP_YN": "N"}
            )
        )
        self.assertFalse(
            schoolinfo.is_active_school(
                {"CLOSE_YN": "N", "ABSCH_YN": "N", "PBAN_EXCP_YN": "Y"}
            )
        )

    def test_student_total_and_sex_total_support_regular_and_grouped_fields(self) -> None:
        regular = {"SUM": 30, "COL_MSUM": 14, "COL_WSUM": 16}
        grouped = {
            "COL_SUM": 20,
            "COL_MSUM1": 3,
            "COL_MSUM2": 7,
            "COL_MSUM4": 11,
            "COL_WSUM1": 4,
            "COL_WSUM2": 6,
            "COL_WSUM4": 9,
        }
        self.assertEqual(schoolinfo.student_total(regular), 30)
        self.assertEqual(schoolinfo.sex_total(regular, "COL_MSUM"), 14)
        self.assertEqual(schoolinfo.sex_total(regular, "COL_WSUM"), 16)
        self.assertEqual(schoolinfo.student_total(grouped), 20)
        self.assertEqual(schoolinfo.sex_total(grouped, "COL_MSUM"), 11)
        self.assertEqual(schoolinfo.sex_total(grouped, "COL_WSUM"), 9)


if __name__ == "__main__":
    unittest.main()
