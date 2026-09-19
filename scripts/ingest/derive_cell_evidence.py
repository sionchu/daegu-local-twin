"""Derive LocalTwin cell-level spatial evidence from committed canonical snapshots.

This integration is deterministic and network-free. It updates only the cell fields
backed by already-reviewed official inputs:
- SEMAS business point counts by current LocalTwin polygon;
- administrative-dong assignment by cell center;
- a modelled regeneration-context score from the official three-sector diagnosis.

Transit, rent, buzz, spillover, and mobility/footfall fields are intentionally untouched.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from copy import deepcopy
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


BUSINESS_CATEGORIES = ("cafe", "restaurant", "retail", "beauty", "service")
DERIVATION_ID = "cell-spatial-evidence"
REGENERATION_FORMULA = "qualifyingSectorCount / 3 * 100"


def point_on_segment(
    point: tuple[float, float],
    start: tuple[float, float],
    end: tuple[float, float],
    epsilon: float = 1e-10,
) -> bool:
    x, y = point
    ax, ay = start
    bx, by = end
    cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax)
    if abs(cross) > epsilon:
        return False
    return (
        min(ax, bx) - epsilon <= x <= max(ax, bx) + epsilon
        and min(ay, by) - epsilon <= y <= max(ay, by) + epsilon
    )


def ring_covers_point(ring: Sequence[Sequence[float]], point: tuple[float, float]) -> bool:
    inside = False
    for index, current in enumerate(ring):
        previous = ring[index - 1]
        start = (float(previous[0]), float(previous[1]))
        end = (float(current[0]), float(current[1]))
        if point_on_segment(point, start, end):
            return True
        x, y = point
        x1, y1 = start
        x2, y2 = end
        if (y1 > y) != (y2 > y):
            crossing_x = (x2 - x1) * (y - y1) / (y2 - y1) + x1
            if x < crossing_x:
                inside = not inside
    return inside


def polygon_covers_point(
    polygon: Sequence[Sequence[Sequence[float]]],
    point: tuple[float, float],
) -> bool:
    if not polygon or not ring_covers_point(polygon[0], point):
        return False
    return not any(ring_covers_point(hole, point) for hole in polygon[1:])


def geojson_geometry_covers_point(geometry: Mapping[str, Any], point: tuple[float, float]) -> bool:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type == "Polygon":
        return polygon_covers_point(coordinates, point)
    if geometry_type == "MultiPolygon":
        return any(polygon_covers_point(polygon, point) for polygon in coordinates)
    raise ValueError(f"Unsupported admin-dong geometry type: {geometry_type!r}")


def cell_covers_point(cell: Mapping[str, Any], point: tuple[float, float]) -> bool:
    boundary = cell.get("boundary")
    if not isinstance(boundary, list) or len(boundary) < 3:
        raise ValueError(f"Cell {cell.get('cellId')} has no valid boundary")
    ring = [[float(vertex["lon"]), float(vertex["lat"])] for vertex in boundary]
    return ring_covers_point(ring, point)


def unique_cell_for_business(
    business: Mapping[str, Any],
    cells: Sequence[Mapping[str, Any]],
) -> Mapping[str, Any]:
    point = (float(business["longitude"]), float(business["latitude"]))
    hits = [cell for cell in cells if cell_covers_point(cell, point)]
    if len(hits) != 1:
        raise ValueError(
            f"Business {business.get('sourceBusinessId')} resolved to {len(hits)} cells"
        )
    return hits[0]


def unique_admin_dong_for_cell(
    cell: Mapping[str, Any],
    admin_boundaries: Mapping[str, Any],
) -> Mapping[str, Any]:
    center = cell["center"]
    point = (float(center["lon"]), float(center["lat"]))
    hits = [
        feature
        for feature in admin_boundaries["features"]
        if geojson_geometry_covers_point(feature["geometry"], point)
    ]
    if len(hits) != 1:
        raise ValueError(f"Cell {cell['cellId']} resolved to {len(hits)} admin dongs")
    return hits[0]


def regeneration_score(qualifying_sector_count: int) -> float:
    if qualifying_sector_count < 0 or qualifying_sector_count > 3:
        raise ValueError("qualifyingSectorCount must be between 0 and 3")
    return round(qualifying_sector_count / 3 * 100, 2)


def _regeneration_by_name(snapshot: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    records: dict[str, Mapping[str, Any]] = {}
    for record in snapshot["records"]:
        name = record["geography"]["name"]
        if name in records:
            raise ValueError(f"Duplicate regeneration geography: {name}")
        records[name] = record
    return records


def derive_cell_evidence(
    cells: Sequence[Mapping[str, Any]],
    businesses: Sequence[Mapping[str, Any]],
    regeneration: Mapping[str, Any],
    admin_boundaries: Mapping[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    updated_cells = deepcopy(list(cells))
    by_id = {cell["cellId"]: cell for cell in updated_cells}
    category_counts: dict[str, Counter[str]] = {
        cell_id: Counter({category: 0 for category in BUSINESS_CATEGORIES})
        for cell_id in by_id
    }
    poi_counts: Counter[str] = Counter()

    for business in businesses:
        category = business.get("category")
        if category not in BUSINESS_CATEGORIES:
            raise ValueError(
                f"Business {business.get('sourceBusinessId')} has unsupported category {category!r}"
            )
        cell = unique_cell_for_business(business, updated_cells)
        cell_id = cell["cellId"]
        poi_counts[cell_id] += 1
        category_counts[cell_id][category] += 1

    if sum(poi_counts.values()) != len(businesses):
        raise ValueError("Not every official business was assigned exactly once")

    regeneration_by_name = _regeneration_by_name(regeneration)
    evidence_records: list[dict[str, Any]] = []

    for cell in updated_cells:
        cell_id = cell["cellId"]
        counts = {category: category_counts[cell_id][category] for category in BUSINESS_CATEGORIES}
        if sum(counts.values()) != poi_counts[cell_id]:
            raise ValueError(f"Category counts do not sum to poiCount for {cell_id}")

        admin_feature = unique_admin_dong_for_cell(cell, admin_boundaries)
        admin_props = admin_feature["properties"]
        admin_name = admin_props["officialName"]
        admin_code = admin_props["officialCode"]

        decline = regeneration_by_name.get(admin_name)
        if decline is None:
            raise ValueError(f"No regeneration record found for official admin dong {admin_name}")

        raw_count = decline["raw"]["qualifyingSectorCount"]
        qualifying_count = int(raw_count)
        score = regeneration_score(qualifying_count)

        cell["poiCount"] = poi_counts[cell_id]
        cell["sameCategoryCounts"] = counts
        # Compatibility only: the default LocalTwin scenario category is cafe.
        # Competition modelling should use explicit category/source-category fields.
        cell["sameCategoryCount"] = counts["cafe"]
        cell["regenerationScore"] = score

        provenance_ids = list(cell.get("provenanceIds") or [])
        for provenance_id in (
            "smb-poi",
            "regeneration",
            "admin-dong-boundaries",
            DERIVATION_ID,
        ):
            if provenance_id not in provenance_ids:
                provenance_ids.append(provenance_id)
        cell["provenanceIds"] = provenance_ids

        evidence_records.append(
            {
                "cellId": cell_id,
                "label": cell["label"],
                "poi": {
                    "total": poi_counts[cell_id],
                    "categories": counts,
                    "assignmentMethod": "business point-in-polygon against LocalTwin cell boundary",
                },
                "adminDong": {
                    "officialCode": admin_code,
                    "officialName": admin_name,
                    "assignmentMethod": "cell-center point-in-polygon against official SGIS boundary",
                },
                "regenerationContext": {
                    "officialQualifyingSectorCount": qualifying_count,
                    "officialMeetsTwoOrMoreSectors": decline["raw"]["meetsTwoOrMoreSectors"],
                    "modelledScore": score,
                    "formula": REGENERATION_FORMULA,
                },
            }
        )

    first_business_source = businesses[0]["source"] if businesses else {}
    sidecar = {
        "mode": "modelled",
        "modelVersion": "cell-spatial-evidence-v1",
        "inputs": {
            "businesses": {
                "datasetId": first_business_source.get("datasetId"),
                "version": first_business_source.get("version"),
                "recordCount": len(businesses),
            },
            "regeneration": {
                "datasetId": regeneration.get("datasetId"),
                "sourceVersion": regeneration.get("sourceVersion"),
                "recordCount": regeneration.get("normalizedRecordCount"),
            },
            "adminDongBoundaries": {
                "datasetId": admin_boundaries["source"]["datasetId"],
                "datasetVersion": admin_boundaries["source"]["datasetVersion"],
                "featureCount": len(admin_boundaries["features"]),
            },
        },
        "businessAssignment": {
            "method": "point-in-polygon; boundary included; exactly one current cell required",
            "sourceRecordCount": len(businesses),
            "assignedRecordCount": sum(poi_counts.values()),
        },
        "adminDongAssignment": {
            "method": "cell-center point-in-polygon; exactly one official administrative dong required",
            "cellCount": len(updated_cells),
        },
        "regenerationScore": {
            "mode": "modelled",
            "formula": REGENERATION_FORMULA,
            "meaning": "share of the three official decline-diagnosis sectors that qualify",
        },
        "sameCategoryCountCompatibility": {
            "value": "sameCategoryCounts.cafe",
            "note": "legacy compatibility only; do not interpret broad LocalTwin service grouping as exact competition",
        },
        "records": evidence_records,
        "limitations": [
            "Cell-level assignments are deterministic modelled joins, not official cell-level statistics.",
            "The SGIS boundary snapshot is 2025-06-30 while the decline snapshot is 2025-12-31.",
            "The regeneration score is context only and is not a business-success, revenue, or causal uplift probability.",
            "Transit, rent, buzz, spillover, and mobility values remain unchanged by this derivation.",
        ],
    }
    return updated_cells, sidecar


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cells", type=Path, default=Path("public/data/opportunity_cells.json"))
    parser.add_argument("--businesses", type=Path, default=Path("public/data/businesses.json"))
    parser.add_argument("--regeneration", type=Path, default=Path("public/data/regeneration.json"))
    parser.add_argument(
        "--admin-boundaries",
        type=Path,
        default=Path("public/data/admin_dong_boundaries.geojson"),
    )
    parser.add_argument(
        "--output-cells",
        type=Path,
        default=Path("public/data/opportunity_cells.json"),
    )
    parser.add_argument(
        "--output-evidence",
        type=Path,
        default=Path("public/data/cell_spatial_evidence.json"),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    updated_cells, sidecar = derive_cell_evidence(
        load_json(args.cells),
        load_json(args.businesses),
        load_json(args.regeneration),
        load_json(args.admin_boundaries),
    )
    args.output_cells.write_text(
        json.dumps(updated_cells, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    args.output_evidence.write_text(
        json.dumps(sidecar, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "cells": len(updated_cells),
                "businessesAssigned": sidecar["businessAssignment"]["assignedRecordCount"],
                "outputCells": str(args.output_cells),
                "outputEvidence": str(args.output_evidence),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
