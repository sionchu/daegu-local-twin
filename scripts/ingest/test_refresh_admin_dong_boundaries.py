from __future__ import annotations

import json
import unittest
from pathlib import Path
from typing import Any

from scripts.ingest.refresh_admin_dong_boundaries import normalize_features


REPO_ROOT = Path(__file__).resolve().parents[2]
BOUNDARY_PATH = REPO_ROOT / "public/data/admin_dong_boundaries.geojson"
CELL_PATH = REPO_ROOT / "public/data/opportunity_cells.json"


def _point_on_segment(point: tuple[float, float], start: tuple[float, float], end: tuple[float, float]) -> bool:
    px, py = point
    ax, ay = start
    bx, by = end
    cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax)
    if abs(cross) > 1e-12:
        return False
    return min(ax, bx) - 1e-12 <= px <= max(ax, bx) + 1e-12 and min(ay, by) - 1e-12 <= py <= max(ay, by) + 1e-12


def _ring_covers_point(ring: list[list[float]], point: tuple[float, float]) -> bool:
    inside = False
    for index, current in enumerate(ring):
        previous = ring[index - 1]
        current_point = (float(current[0]), float(current[1]))
        previous_point = (float(previous[0]), float(previous[1]))
        if _point_on_segment(point, previous_point, current_point):
            return True
        x, y = point
        x1, y1 = previous_point
        x2, y2 = current_point
        if (y1 > y) != (y2 > y):
            crossing_x = (x2 - x1) * (y - y1) / (y2 - y1) + x1
            if x < crossing_x:
                inside = not inside
    return inside


def _geometry_covers_point(geometry: dict[str, Any], point: tuple[float, float]) -> bool:
    geometry_type = geometry["type"]
    coordinates = geometry["coordinates"]
    polygons = [coordinates] if geometry_type == "Polygon" else coordinates
    for polygon in polygons:
        if not _ring_covers_point(polygon[0], point):
            continue
        if any(_ring_covers_point(hole, point) for hole in polygon[1:]):
            continue
        return True
    return False


def cell_hits(snapshot: dict[str, Any], cell: dict[str, Any]) -> list[str]:
    center = cell["center"]
    point = (float(center["lon"]), float(center["lat"]))
    return [
        feature["properties"]["officialCode"]
        for feature in snapshot["features"]
        if _geometry_covers_point(feature["geometry"], point)
    ]


class AdminDongBoundaryNormalizationTest(unittest.TestCase):
    def test_preserves_official_fields_and_filters_by_official_code(self) -> None:
        source_features = [
            {
                "type": "Feature",
                "properties": {"BASE_DATE": 20250630, "ADM_CD": "22010540", "ADM_NM": "삼덕동"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[128.59, 35.86], [128.60, 35.86], [128.60, 35.87], [128.59, 35.86]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"BASE_DATE": "20250630", "ADM_CD": "99999999", "ADM_NM": "다른 지역"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[128.60, 35.86], [128.61, 35.86], [128.61, 35.87], [128.60, 35.86]]],
                },
            },
        ]

        result = normalize_features(
            source_features,
            source_crs="EPSG:4326",
            source_sha256="fixture-sha256",
            retrieved_at="2026-09-19T00:00:00Z",
        )

        self.assertEqual(result["type"], "FeatureCollection")
        self.assertEqual(result["source"]["targetCrs"], "EPSG:4326")
        self.assertEqual(len(result["features"]), 1)
        properties = result["features"][0]["properties"]
        self.assertEqual(properties["officialCode"], "22010540")
        self.assertEqual(properties["officialName"], "삼덕동")
        self.assertEqual(properties["sourceFields"]["ADM_CD"], "22010540")
        self.assertEqual(properties["sourceFields"]["ADM_NM"], "삼덕동")
        self.assertEqual(properties["sourceFields"]["BASE_DATE"], "20250630")

    def test_current_localtwin_cell_centers_resolve_to_exactly_one_admin_dong(self) -> None:
        snapshot = json.loads(BOUNDARY_PATH.read_text(encoding="utf-8"))
        cells = json.loads(CELL_PATH.read_text(encoding="utf-8"))

        self.assertEqual(len(snapshot["features"]), 12)
        self.assertEqual(len(cells), 8)
        for cell in cells:
            hits = cell_hits(snapshot, cell)
            self.assertEqual(
                len(hits),
                1,
                f"cell center {cell['cellId']} must resolve to exactly one official admin dong: {hits}",
            )


if __name__ == "__main__":
    unittest.main()
