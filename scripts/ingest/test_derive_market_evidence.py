from __future__ import annotations

import json
import unittest
from pathlib import Path

from scripts.ingest.derive_market_evidence import derive_market_evidence


REPO_ROOT = Path(__file__).resolve().parents[2]


def load(name: str):
    return json.loads((REPO_ROOT / name).read_text(encoding="utf-8"))


class DeriveMarketEvidenceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.cells = load("public/data/opportunity_cells.json")
        self.transit = load("public/data/transit.json")
        self.locations = load("public/data/transit_station_locations.json")
        self.buzz = load("public/data/buzz.json")
        self.rent = load("public/data/rent_benchmark.json")

    def test_derives_all_transit_and_removes_demo_footfall(self) -> None:
        updated, evidence = derive_market_evidence(
            self.cells,
            self.transit,
            self.locations,
            self.buzz,
            self.rent,
        )
        self.assertEqual(len(updated), 8)
        self.assertTrue(all(cell["transitDemand"] > 0 for cell in updated))
        self.assertTrue(all(cell["observedFootfall"] is None for cell in updated))
        self.assertTrue(all(cell["evidenceQuality"] == "modelled" for cell in updated))
        self.assertEqual(evidence["transitModel"]["lambdaMeters"], 450.0)
        for record in evidence["records"]:
            self.assertEqual(len(record["transit"]["stationContributions"]), 4)

    def test_maps_buzz_and_fills_rent_with_explicit_modelled_blend(self) -> None:
        updated, evidence = derive_market_evidence(
            self.cells,
            self.transit,
            self.locations,
            self.buzz,
            self.rent,
        )
        by_id = {cell["cellId"]: cell for cell in updated}
        self.assertEqual(sum(cell["buzzLevel"] is not None for cell in updated), 6)
        self.assertIsNone(by_id["hex-jungang-01"]["buzzLevel"])
        self.assertIsNone(by_id["hex-seomun-01"]["buzzLevel"])

        self.assertEqual(
            by_id["hex-dongseongro-01"]["rentBenchmarkKrwPerSqm"],
            26_800,
        )
        self.assertEqual(
            by_id["hex-seomun-01"]["rentBenchmarkKrwPerSqm"],
            17_300,
        )
        self.assertEqual(by_id["hex-dongseongro-01"]["rentBenchmarkMode"], "exact")
        self.assertEqual(
            by_id["hex-dongseongro-01"]["rentBenchmarkSourceAreas"],
            ["동성로중심"],
        )
        self.assertEqual(by_id["hex-gyodong-01"]["rentBenchmarkMode"], "proxy")
        self.assertEqual(
            set(by_id["hex-gyodong-01"]["rentBenchmarkSourceAreas"]),
            {"동성로중심", "서문시장/청라언덕"},
        )
        self.assertTrue(
            all(cell["rentBenchmarkKrwPerSqm"] is not None for cell in updated)
        )
        self.assertTrue(
            all(cell["vacancyBenchmark"] is not None for cell in updated)
        )
        self.assertGreater(
            by_id["hex-gyodong-01"]["rentBenchmarkKrwPerSqm"],
            by_id["hex-buksungro-02"]["rentBenchmarkKrwPerSqm"],
        )
        self.assertTrue(all("rentBenchmark" not in cell for cell in updated))

        rent_records = {record["cellId"]: record["rent"] for record in evidence["records"]}
        self.assertEqual(
            rent_records["hex-dongseongro-01"]["officialArea"],
            "동성로중심",
        )
        self.assertEqual(
            rent_records["hex-seomun-01"]["officialArea"],
            "서문시장/청라언덕",
        )
        self.assertEqual(
            rent_records["hex-gyodong-01"]["mode"],
            "modelled spatial blend of official-area benchmarks",
        )
        self.assertEqual(
            len(rent_records["hex-gyodong-01"]["sourceOfficialAreas"]),
            2,
        )
        self.assertEqual(evidence["rentInterpolation"]["lambdaMeters"], 900.0)

    def test_spillover_is_reproducible_and_bounded(self) -> None:
        updated, evidence = derive_market_evidence(
            self.cells,
            self.transit,
            self.locations,
            self.buzz,
            self.rent,
        )
        scores = [cell["spilloverScore"] for cell in updated]
        self.assertTrue(all(score is not None and 0 <= score <= 100 for score in scores))
        self.assertAlmostEqual(min(scores), 0.0)
        self.assertAlmostEqual(max(scores), 100.0)
        for record in evidence["records"]:
            self.assertTrue(record["spillover"]["selfExcluded"])
            self.assertEqual(len(record["spillover"]["contributions"]), 7)

    def test_committed_outputs_match_derivation(self) -> None:
        updated, evidence = derive_market_evidence(
            self.cells,
            self.transit,
            self.locations,
            self.buzz,
            self.rent,
        )
        committed = load("public/data/cell_market_evidence.json")
        self.assertEqual(updated, self.cells)
        self.assertEqual(evidence, committed)


if __name__ == "__main__":
    unittest.main()
