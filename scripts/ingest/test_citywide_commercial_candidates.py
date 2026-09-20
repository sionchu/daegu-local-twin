from __future__ import annotations

import json
import sys
import unittest
from collections import Counter
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
sys.path.insert(0, str(SCRIPT_DIR))

import derive_citywide_commercial_candidates as commercial  # noqa: E402


class CitywideCommercialCandidateTest(unittest.TestCase):
    def test_weighted_score_is_deterministic_and_bounded(self) -> None:
        profile = {
            "businessSignals": {
                "businessDensityScore": 100,
                "businessDiversityScore": 50,
            },
            "scores": {
                "transit": 80,
                "retail_market": 60,
                "employment_public": 70,
                "culture_tourism": 40,
                "healthcare": 20,
            },
        }
        self.assertEqual(commercial.commercial_potential(profile), 73.2)

        extreme = {
            "businessSignals": {
                "businessDensityScore": 180,
                "businessDiversityScore": -40,
            },
            "scores": {
                "transit": 150,
                "retail_market": 120,
                "employment_public": -5,
                "culture_tourism": 100,
                "healthcare": 100,
            },
        }
        score = commercial.commercial_potential(extreme)
        self.assertGreaterEqual(score, 0)
        self.assertLessEqual(score, 100)

    def test_committed_snapshot_has_evidence_bounded_candidate_coverage(self) -> None:
        candidate_document = json.loads(
            (REPO_ROOT / "public/data/citywide_commercial_candidates.geojson").read_text(
                encoding="utf-8"
            )
        )
        profile_document = json.loads(
            (REPO_ROOT / "public/data/citywide_commercial_profiles.json").read_text(
                encoding="utf-8"
            )
        )
        features = candidate_document["features"]
        records = profile_document["records"]
        metadata = candidate_document["metadata"]
        coverage = metadata["coverage"]

        locality = [row for row in records if row["zoneKind"] == "locality"]
        corridors = [row for row in records if row["zoneKind"] == "commercial_corridor"]
        locality_candidates = [row for row in locality if row["isCommercialCandidate"]]
        candidate_records = [row for row in records if row["isCommercialCandidate"]]

        self.assertEqual(len(records), 155)
        self.assertEqual(len(locality), 150)
        self.assertEqual(len(corridors), 5)
        self.assertEqual(
            {row["zoneId"] for row in corridors},
            {"dongseongro", "gyodong", "buksungro", "jungangro", "seomun"},
        )
        self.assertTrue(all(row["isCommercialCandidate"] for row in corridors))

        self.assertEqual(coverage["profileCount"], 155)
        self.assertEqual(coverage["localityZoneCount"], 150)
        self.assertEqual(coverage["localityCandidateCount"], len(locality_candidates))
        self.assertEqual(coverage["centralCorridorCount"], 5)
        self.assertEqual(coverage["candidateCount"], len(features))
        self.assertEqual(coverage["candidateCount"], 19)
        self.assertEqual(len(candidate_records), 19)
        self.assertEqual(
            metadata["scoreCalibration"]["method"],
            "upstream empirical percentile index",
        )
        self.assertEqual(metadata["scoreCalibration"]["positiveScoreRange"], [5, 95])
        self.assertLessEqual(
            max(row["commercialPotentialScore"] for row in candidate_records),
            95.0,
        )
        self.assertFalse(
            any(row["commercialPotentialScore"] == 100 for row in candidate_records)
        )
        self.assertEqual(
            {feature["properties"]["zoneId"] for feature in features},
            {row["zoneId"] for row in candidate_records},
        )
        self.assertTrue(
            all(feature["properties"]["isCommercialCandidate"] for feature in features)
        )

        district_counts = Counter(row["district"] for row in locality_candidates)
        self.assertTrue(district_counts)
        self.assertTrue(
            all(
                count <= commercial.MAX_CANDIDATES_PER_DISTRICT
                for count in district_counts.values()
            )
        )
        self.assertLess(len(district_counts), 9)

        for properties in locality_candidates:
            self.assertGreaterEqual(
                properties["commercialPotentialScore"],
                commercial.MIN_CANDIDATE_SCORE,
            )
            self.assertGreaterEqual(
                properties["businessCount"],
                commercial.MIN_BUSINESS_COUNT,
            )
            self.assertLessEqual(
                properties["centralCorridorOverlapRatio"],
                commercial.MAX_CENTRAL_OVERLAP_RATIO,
            )
            self.assertIsInstance(properties["candidateRank"], int)
            self.assertIn(properties["candidateTier"], {"strong", "review", "emerging"})
            self.assertIn("공식 상권 경계가 아님", properties["boundaryMeaning"])

        non_candidates = [row for row in locality if not row["isCommercialCandidate"]]
        self.assertTrue(non_candidates)
        self.assertTrue(all(row["candidateRank"] is None for row in non_candidates))

        boundaries = metadata["evidenceBoundary"]
        self.assertTrue(any("매출/성공확률" in line for line in boundaries))
        self.assertTrue(any("공식 상권" in line for line in boundaries))

        provenance = json.loads(
            (REPO_ROOT / "public/data/provenance.json").read_text(encoding="utf-8")
        )
        source = next(
            row
            for row in provenance["sources"]
            if row["id"] == "citywide-commercial-candidates"
        )
        self.assertEqual(source["mode"], "modelled")
        self.assertTrue(any("공식 상권" in line for line in source["limitations"]))
        self.assertTrue(any("NAVER" in line for line in source["limitations"]))


if __name__ == "__main__":
    unittest.main()
