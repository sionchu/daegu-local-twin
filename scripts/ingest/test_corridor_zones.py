from __future__ import annotations

import json
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def coordinate_pairs(value):
    if (
        isinstance(value, list)
        and len(value) >= 2
        and isinstance(value[0], (int, float))
        and isinstance(value[1], (int, float))
    ):
        yield float(value[0]), float(value[1])
        return
    if isinstance(value, list):
        for item in value:
            yield from coordinate_pairs(item)


class CorridorZonesTest(unittest.TestCase):
    def test_committed_corridors_are_map_derived_and_cover_all_groups(self) -> None:
        data = json.loads(
            (REPO_ROOT / "public/data/corridor_zones.geojson").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(data["type"], "FeatureCollection")
        self.assertEqual(len(data["features"]), 5)
        self.assertEqual(
            {feature["properties"]["zoneId"] for feature in data["features"]},
            {"dongseongro", "gyodong", "buksungro", "jungangro", "seomun"},
        )
        member_ids = {
            cell_id
            for feature in data["features"]
            for cell_id in feature["properties"]["memberCellIds"]
        }
        self.assertEqual(len(member_ids), 8)

        for feature in data["features"]:
            properties = feature["properties"]
            self.assertEqual(properties["sourceMode"], "modelled-map-derived")
            self.assertIn("공식 상권 경계가 아님", properties["boundaryMeaning"])
            coordinates = list(coordinate_pairs(feature["geometry"]["coordinates"]))
            self.assertGreater(len(coordinates), 3)
            lons = [lon for lon, _ in coordinates]
            lats = [lat for _, lat in coordinates]
            self.assertGreater(max(lons) - min(lons), 0)
            self.assertGreater(max(lats) - min(lats), 0)
            self.assertTrue(all(128.55 < lon < 128.62 for lon in lons))
            self.assertTrue(all(35.84 < lat < 35.90 for lat in lats))
            self.assertIn("labelLon", properties)
            self.assertIn("labelLat", properties)
            self.assertTrue(min(lons) <= float(properties["labelLon"]) <= max(lons))
            self.assertTrue(min(lats) <= float(properties["labelLat"]) <= max(lats))


if __name__ == "__main__":
    unittest.main()
