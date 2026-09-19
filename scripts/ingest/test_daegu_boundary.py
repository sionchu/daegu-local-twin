from __future__ import annotations

import json
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

def coordinate_pairs(value):
    if isinstance(value, list) and len(value) >= 2 and all(
        isinstance(value[index], (int, float)) for index in (0, 1)
    ):
        yield float(value[0]), float(value[1])
        return
    if isinstance(value, list):
        for item in value:
            yield from coordinate_pairs(item)

class DaeguBoundaryTest(unittest.TestCase):
    def test_committed_boundary_is_daegu_and_contains_service_area(self) -> None:
        data = json.loads(
            (REPO_ROOT / "public/data/daegu_boundary.geojson").read_text(encoding="utf-8")
        )
        self.assertEqual(data["type"], "FeatureCollection")
        self.assertEqual(data["metadata"]["osmId"], 2395674)
        points = list(coordinate_pairs(data["features"][0]["geometry"]["coordinates"]))
        self.assertGreater(len(points), 100)
        lons = [lon for lon, _ in points]
        lats = [lat for _, lat in points]
        self.assertLess(min(lons), 128.565)
        self.assertGreater(max(lons), 128.615)
        self.assertLess(min(lats), 35.852)
        self.assertGreater(max(lats), 35.892)

if __name__ == "__main__":
    unittest.main()
