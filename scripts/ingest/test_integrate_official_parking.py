from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
sys.path.insert(0, str(SCRIPT_DIR))

import integrate_official_parking as parking  # noqa: E402


class OfficialParkingIntegrationTest(unittest.TestCase):
    def test_replaces_public_map_parking_without_capacity_weighting(self) -> None:
        anchors = {
            "schemaVersion": 1,
            "geography": "Daegu",
            "records": [
                {
                    "anchorId": "old",
                    "name": "old",
                    "anchorType": "parking_access",
                    "longitude": 128.6,
                    "latitude": 35.8,
                },
                {
                    "anchorId": "school",
                    "name": "school",
                    "anchorType": "education",
                    "longitude": 128.5,
                    "latitude": 35.9,
                },
            ],
        }
        source = {"provider": "official", "datasetId": "x", "sourceSha256": "ABC"}
        snapshot = {
            "source": source,
            "records": [
                {
                    "parkingId": "p1",
                    "name": "P1",
                    "longitude": 128.61,
                    "latitude": 35.81,
                    "spaces": 321,
                    "parkingKind": "public",
                    "parkingType": "surface",
                    "feeType": "paid",
                    "dataDate": "2026-07-01",
                }
            ],
        }

        output, layer = parking.integrate(snapshot, anchors)
        rows = output["records"]
        official = [row for row in rows if row["anchorType"] == "parking_access"]

        self.assertEqual(len(official), 1)
        self.assertEqual(official[0]["anchorId"], "official-parking:p1")
        self.assertEqual(official[0]["quality"], "official")
        self.assertEqual(official[0]["coordinateQuality"], "official")
        self.assertEqual(official[0]["capacity"], 321)
        self.assertEqual(official[0]["baseWeight"], 1.0)
        self.assertEqual(official[0]["capacityWeight"], 1.0)
        self.assertEqual(layer["recordCount"], 1)
        self.assertEqual(output["officialEnrichment"]["parking"]["replacedPublicMapParkingAnchors"], 1)

    def test_committed_snapshot_uses_all_official_parking_records(self) -> None:
        anchors = json.loads(
            (REPO_ROOT / "public/data/context_anchors.json").read_text(encoding="utf-8")
        )
        layer = json.loads(
            (REPO_ROOT / "public/data/context_anchors/parking_access.json").read_text(
                encoding="utf-8"
            )
        )
        parking_doc = json.loads(
            (REPO_ROOT / "public/data/parking.json").read_text(encoding="utf-8")
        )

        rows = [row for row in anchors["records"] if row["anchorType"] == "parking_access"]
        self.assertEqual(len(rows), 1086)
        self.assertEqual(layer["recordCount"], 1086)
        self.assertEqual(len(parking_doc["records"]), 1086)
        self.assertTrue(all(row["quality"] == "official" for row in rows))
        self.assertTrue(all(row["coordinateQuality"] == "official" for row in rows))
        self.assertTrue(all(row["capacityWeight"] == 1.0 for row in rows))
        self.assertEqual(
            anchors["officialEnrichment"]["parking"]["totalSpaces"],
            parking_doc["coverage"]["totalSpaces"],
        )


if __name__ == "__main__":
    unittest.main()
