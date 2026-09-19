from __future__ import annotations

import json
import unittest
from pathlib import Path

from scripts.ingest.derive_cell_evidence import (
    BUSINESS_CATEGORIES,
    derive_cell_evidence,
    regeneration_score,
)


REPO_ROOT = Path(__file__).resolve().parents[2]


class DeriveCellEvidenceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.cells = json.loads(
            (REPO_ROOT / "public/data/opportunity_cells.json").read_text(encoding="utf-8")
        )
        self.businesses = json.loads(
            (REPO_ROOT / "public/data/businesses.json").read_text(encoding="utf-8")
        )
        self.regeneration = json.loads(
            (REPO_ROOT / "public/data/regeneration.json").read_text(encoding="utf-8")
        )
        self.admin_boundaries = json.loads(
            (REPO_ROOT / "public/data/admin_dong_boundaries.geojson").read_text(encoding="utf-8")
        )

    def test_official_inputs_resolve_without_loss_or_ambiguity(self) -> None:
        updated, evidence = derive_cell_evidence(
            self.cells,
            self.businesses,
            self.regeneration,
            self.admin_boundaries,
        )

        self.assertEqual(len(updated), 8)
        self.assertEqual(len(evidence["records"]), 8)
        self.assertEqual(evidence["businessAssignment"]["sourceRecordCount"], 2165)
        self.assertEqual(evidence["businessAssignment"]["assignedRecordCount"], 2165)
        self.assertEqual(sum(cell["poiCount"] for cell in updated), 2165)

        for cell in updated:
            self.assertEqual(
                sum(cell["sameCategoryCounts"].get(category, 0) for category in BUSINESS_CATEGORIES),
                cell["poiCount"],
            )
            self.assertEqual(cell["sameCategoryCount"], cell["sameCategoryCounts"]["cafe"])

        for record in evidence["records"]:
            self.assertTrue(record["adminDong"]["officialCode"])
            self.assertTrue(record["adminDong"]["officialName"])
            count = record["regenerationContext"]["officialQualifyingSectorCount"]
            self.assertEqual(
                record["regenerationContext"]["modelledScore"],
                regeneration_score(count),
            )

    def test_expected_current_cell_admin_dong_assignments(self) -> None:
        _, evidence = derive_cell_evidence(
            self.cells,
            self.businesses,
            self.regeneration,
            self.admin_boundaries,
        )
        mapping = {
            record["cellId"]: record["adminDong"]["officialName"]
            for record in evidence["records"]
        }
        self.assertEqual(
            mapping,
            {
                "hex-dongseongro-01": "성내1동",
                "hex-dongseongro-02": "동인동",
                "hex-gyodong-01": "성내1동",
                "hex-gyodong-02": "성내2동",
                "hex-buksungro-01": "성내2동",
                "hex-buksungro-02": "성내3동",
                "hex-jungang-01": "삼덕동",
                "hex-seomun-01": "성내3동",
            },
        )

    def test_regeneration_score_is_bounded_and_transparent(self) -> None:
        self.assertEqual(regeneration_score(0), 0)
        self.assertEqual(regeneration_score(1), 33.33)
        self.assertEqual(regeneration_score(2), 66.67)
        self.assertEqual(regeneration_score(3), 100)

    def test_committed_outputs_match_derivation(self) -> None:
        updated, evidence = derive_cell_evidence(
            self.cells,
            self.businesses,
            self.regeneration,
            self.admin_boundaries,
        )

        committed_evidence_path = REPO_ROOT / "public/data/cell_spatial_evidence.json"
        if not committed_evidence_path.exists():
            self.skipTest("derived evidence artifact not committed yet")

        committed_evidence = json.loads(committed_evidence_path.read_text(encoding="utf-8"))
        self.assertEqual(evidence, committed_evidence)
        self.assertEqual(updated, self.cells)


if __name__ == "__main__":
    unittest.main()
