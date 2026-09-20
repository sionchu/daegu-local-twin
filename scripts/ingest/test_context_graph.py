from __future__ import annotations

import json
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


class ContextGraphTest(unittest.TestCase):
    def test_citywide_context_snapshots_have_expected_coverage(self) -> None:
        anchors = json.loads(
            (REPO_ROOT / "public/data/context_anchors.json").read_text(encoding="utf-8")
        )
        zones = json.loads(
            (REPO_ROOT / "public/data/daegu_analysis_zones.geojson").read_text(
                encoding="utf-8"
            )
        )
        profiles = json.loads(
            (REPO_ROOT / "public/data/zone_context_profiles.json").read_text(
                encoding="utf-8"
            )
        )
        graph = json.loads(
            (REPO_ROOT / "public/data/context_graph.json").read_text(encoding="utf-8")
        )
        businesses = json.loads(
            (REPO_ROOT / "public/data/zone_business_profiles.json").read_text(
                encoding="utf-8"
            )
        )

        self.assertGreaterEqual(anchors["coverage"]["anchorCount"], 7000)
        self.assertEqual(
            set(anchors["coverage"]["countsByType"]),
            {
                "education",
                "healthcare",
                "employment_public",
                "industrial",
                "transit",
                "retail_market",
                "culture_tourism",
                "parking_access",
            },
        )
        self.assertEqual(zones["metadata"]["zoneCount"], 150)
        self.assertEqual(zones["metadata"]["quality"], "official")
        self.assertEqual(zones["metadata"]["sourceDatasetId"], "15129688")
        self.assertEqual(zones["metadata"]["districtCount"], 9)
        self.assertTrue(
            all(
                feature["properties"]["zoneId"].startswith("sgis-dong:")
                and feature["properties"]["quality"] == "official"
                for feature in zones["features"]
            )
        )
        self.assertEqual(profiles["coverage"]["citywideLocalityZones"], 150)
        self.assertEqual(profiles["coverage"]["commercialCorridors"], 5)

        corridor_profiles = [
            row for row in profiles["records"] if row["zoneKind"] == "commercial_corridor"
        ]
        self.assertEqual(
            {row["zoneId"] for row in corridor_profiles},
            {"dongseongro", "gyodong", "buksungro", "jungangro", "seomun"},
        )
        for profile in corridor_profiles:
            self.assertEqual(len(profile["scores"]), 8)
            self.assertEqual(
                profile["classificationAvailability"]["finalFunctionalProfile"],
                "blocked-until-local-population-and-flow-data",
            )

        self.assertEqual(businesses["coverage"]["sourceRows"], 118357)
        self.assertEqual(businesses["coverage"]["validCoordinateRows"], 118357)
        self.assertEqual(businesses["coverage"]["localityAssignedRows"], 118357)
        self.assertEqual(businesses["coverage"]["unmatchedLocalityRows"], 0)
        self.assertEqual(len(businesses["records"]), 155)
        self.assertTrue(
            all(row["businessDensityScore"] >= 0 for row in businesses["records"])
        )
        self.assertTrue(
            all(row["businessDiversityScore"] >= 0 for row in businesses["records"])
        )

        node_ids = {node["nodeId"] for node in graph["nodes"]}
        node_types = {node["nodeType"] for node in graph["nodes"]}
        relations = {edge["relation"] for edge in graph["edges"]}
        self.assertEqual(graph["nodeCount"], len(graph["nodes"]))
        self.assertEqual(graph["edgeCount"], len(graph["edges"]))
        self.assertGreater(graph["edgeCount"], 8500)
        self.assertEqual(relations, {"NEAR", "HAS_BUSINESS_PROFILE"})
        self.assertIn("BusinessCategory", node_types)
        self.assertEqual(
            sum(node["nodeType"] == "BusinessCategory" for node in graph["nodes"]),
            5,
        )

        for edge in graph["edges"]:
            self.assertIn(edge["from"], node_ids)
            self.assertIn(edge["to"], node_ids)
            if edge["relation"] == "NEAR":
                self.assertGreaterEqual(edge["distanceM"], 0)
                self.assertGreater(edge["decayWeight"], 0)
                self.assertGreater(edge["baseWeight"], 0)
                self.assertGreater(edge["influenceWeight"], 0)
            else:
                self.assertGreater(edge["businessCount"], 0)
                self.assertEqual(edge["sourceDatasetId"], "15083033")

        official = json.loads(
            (REPO_ROOT / "public/data/official_context_summary.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(official["schoolRegistry"]["recordCount"], 482)
        self.assertGreaterEqual(official["schoolRegistry"]["spatiallyLinkedCount"], 300)
        self.assertEqual(official["factorySummary"]["recordCount"], 11744)
        self.assertGreaterEqual(official["factorySummary"]["spatiallyLinkedCount"], 70)
        self.assertEqual(official["healthcareRegistry"]["recordCount"], 5649)
        self.assertEqual(official["healthcareRegistry"]["coordinateQuality"], "official")
        self.assertEqual(len(official["residentPopulation"]["byDistrict"]), 9)

        provenance = json.loads(
            (REPO_ROOT / "public/data/provenance.json").read_text(encoding="utf-8")
        )
        provenance_by_id = {row["id"]: row for row in provenance["sources"]}
        for summary_key, source_id in {
            "schoolRegistry": "official-school-registry",
            "factorySummary": "official-factory-registry",
            "residentPopulation": "official-resident-population",
            "healthcareRegistry": "official-healthcare-registry",
        }.items():
            digest = official[summary_key]["dataset"]["sourceSha256"]
            self.assertEqual(len(digest), 64)
            self.assertEqual(digest, provenance_by_id[source_id]["sourceSha256"])
        self.assertNotIn("학교급", provenance_by_id["official-school-registry"]["fieldsUsed"])
        self.assertIn(
            "공식 SGIS 2025Q2",
            provenance_by_id["semas-citywide-business-2026q2"]["limitations"][1],
        )
        self.assertNotIn(
            "교체 예정",
            provenance_by_id["semas-citywide-business-2026q2"]["limitations"][1],
        )
        self.assertEqual(
            businesses["source"]["sourceSha256"],
            provenance_by_id["semas-citywide-business-2026q2"]["sourceSha256"],
        )
        self.assertIn("공식 SGIS 2025Q2", businesses["method"]["limitations"][1])
        self.assertEqual(
            zones["metadata"]["sourceSha256"].upper(),
            provenance_by_id["context-sgis-zones"]["sourceSha256"],
        )

        for layer_name, minimum in {
            "education": 700,
            "healthcare": 5600,
            "employment_public": 250,
            "industrial": 70,
            "transit": 90,
            "retail_market": 90,
            "culture_tourism": 600,
            "parking_access": 10,
        }.items():
            layer = json.loads(
                (REPO_ROOT / f"public/data/context_anchors/{layer_name}.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertGreaterEqual(layer["recordCount"], minimum)
            self.assertTrue(
                all(
                    set(row).issuperset(
                        {
                            "anchorId",
                            "name",
                            "anchorType",
                            "longitude",
                            "latitude",
                            "quality",
                        }
                    )
                    for row in layer["records"][:20]
                )
            )
            self.assertTrue(
                all("officialEvidence" not in row for row in layer["records"][:20])
            )

    def test_restricted_data_slots_are_not_fabricated(self) -> None:
        availability = json.loads(
            (REPO_ROOT / "public/data/context_data_availability.json").read_text(
                encoding="utf-8"
            )
        )
        by_key = {row["key"]: row for row in availability["datasets"]}
        self.assertEqual(by_key["living_population"]["status"], "controlled-data-slot")
        self.assertEqual(by_key["card_spend"]["status"], "controlled-data-slot")
        self.assertIn("missing", by_key["workplace_population"]["status"])
        self.assertEqual(
            by_key["resident_population"]["status"],
            "available-district-level-only",
        )
        self.assertTrue(by_key["school_official"]["status"].startswith("available-official"))
        self.assertTrue(by_key["factory_official"]["status"].startswith("available-official"))
        self.assertEqual(
            by_key["businesses_official"]["status"],
            "available-citywide-official-snapshot",
        )
        self.assertEqual(
            by_key["analysis_zones"]["status"],
            "available-citywide-official",
        )
        self.assertEqual(by_key["analysis_zones"]["officialRecords"], 150)
        self.assertEqual(by_key["healthcare_official"]["officialRecords"], 5649)


if __name__ == "__main__":
    unittest.main()
