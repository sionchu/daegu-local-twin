"""Aggregate official SEMAS Daegu businesses into LocalTwin analysis zones.

Inputs are the official 2026Q2 Daegu SEMAS CSV and committed zone polygons.
Raw business rows are not committed; only deterministic zone aggregates are output.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from collections import Counter, defaultdict
from pathlib import Path
from statistics import quantiles
from typing import Any

from normalize_semas_businesses import local_twin_category, parse_coordinate

DATASET = {
    "provider": "소상공인시장진흥공단",
    "datasetId": "15083033",
    "sourceUrl": "https://www.data.go.kr/data/15083033/fileData.do",
    "version": "20260630",
    "sourceDate": "2026-06-30",
}

LOCAL_CATEGORIES = ("cafe", "restaurant", "retail", "beauty", "service")
MID_CATEGORY_DENOMINATOR = 75


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument(
        "--city-zones",
        type=Path,
        default=Path("public/data/daegu_analysis_zones.geojson"),
    )
    parser.add_argument(
        "--corridors",
        type=Path,
        default=Path("public/data/corridor_zones.geojson"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("public/data/zone_business_profiles.json"),
    )
    parser.add_argument("--generated-at", default="2026-09-20T02:00:00Z")
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def source_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def p90(values: list[float]) -> float:
    positive = sorted(value for value in values if value > 0)
    if not positive:
        return 1.0
    if len(positive) < 10:
        return positive[-1]
    return quantiles(positive, n=10, method="inclusive")[8]


def normalized_entropy(counts: Counter[str]) -> float:
    total = sum(counts.values())
    if total <= 0:
        return 0.0
    entropy = 0.0
    for count in counts.values():
        if count <= 0:
            continue
        probability = count / total
        entropy -= probability * math.log(probability)
    return min(entropy / math.log(MID_CATEGORY_DENOMINATOR), 1.0)


def zone_rows(city_zones: dict[str, Any], corridors: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for feature in city_zones.get("features") or []:
        props = feature.get("properties") or {}
        rows.append(
            {
                "zoneId": props["zoneId"],
                "label": props["label"],
                "district": props.get("district"),
                "zoneKind": "locality",
                "geometry": feature["geometry"],
            }
        )
    for feature in corridors.get("features") or []:
        props = feature.get("properties") or {}
        rows.append(
            {
                "zoneId": props["zoneId"],
                "label": props["label"],
                "district": None,
                "zoneKind": "commercial_corridor",
                "geometry": feature["geometry"],
            }
        )
    return rows


def main() -> int:
    args = parse_args()
    try:
        from pyproj import Transformer
        from shapely.geometry import Point, shape
        from shapely.ops import transform
        from shapely.strtree import STRtree
    except ImportError as exc:
        raise SystemExit("This ingest adapter requires shapely and pyproj.") from exc

    city_zones = load_json(args.city_zones)
    corridors = load_json(args.corridors)
    zones = zone_rows(city_zones, corridors)

    transformer = Transformer.from_crs("EPSG:4326", "EPSG:32652", always_xy=True)
    projected_geometries = [
        transform(transformer.transform, shape(zone["geometry"])) for zone in zones
    ]
    tree = STRtree(projected_geometries)
    area_sq_km = [max(geometry.area / 1_000_000.0, 1e-6) for geometry in projected_geometries]

    counts: dict[str, int] = defaultdict(int)
    local_counts: dict[str, Counter[str]] = defaultdict(Counter)
    major_counts: dict[str, Counter[str]] = defaultdict(Counter)
    mid_counts: dict[str, Counter[str]] = defaultdict(Counter)
    source_rows = 0
    valid_coordinates = 0
    locality_assigned = 0
    corridor_assignments = 0
    unmatched_locality = 0

    with args.source.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            source_rows += 1
            coordinate, issue = parse_coordinate(row)
            if issue or coordinate is None:
                continue
            valid_coordinates += 1
            point = transform(transformer.transform, Point(coordinate[0], coordinate[1]))
            candidate_indices = list(tree.query(point))
            containing = [
                int(index)
                for index in candidate_indices
                if projected_geometries[int(index)].covers(point)
            ]
            if not containing:
                unmatched_locality += 1
                continue

            locality_indices = [index for index in containing if zones[index]["zoneKind"] == "locality"]
            corridor_indices = [
                index for index in containing if zones[index]["zoneKind"] == "commercial_corridor"
            ]
            if locality_indices:
                # Overture locality polygons can overlap slightly; choose the most specific
                # (smallest area) containing polygon.
                locality_index = min(locality_indices, key=lambda index: area_sq_km[index])
                target_indices = [locality_index, *corridor_indices]
                locality_assigned += 1
            else:
                target_indices = corridor_indices

            category = local_twin_category(row)
            major = str(row.get("상권업종대분류명") or "").strip() or "(없음)"
            mid = str(row.get("상권업종중분류명") or "").strip() or "(없음)"

            for index in target_indices:
                zone_id = zones[index]["zoneId"]
                counts[zone_id] += 1
                local_counts[zone_id][category] += 1
                major_counts[zone_id][major] += 1
                mid_counts[zone_id][mid] += 1
                if zones[index]["zoneKind"] == "commercial_corridor":
                    corridor_assignments += 1

    base_records: list[dict[str, Any]] = []
    for index, zone in enumerate(zones):
        zone_id = zone["zoneId"]
        count = counts[zone_id]
        density = count / area_sq_km[index]
        diversity = normalized_entropy(mid_counts[zone_id])
        base_records.append(
            {
                "zoneId": zone_id,
                "label": zone["label"],
                "district": zone["district"],
                "zoneKind": zone["zoneKind"],
                "quality": "official-snapshot",
                "areaSqKm": round(area_sq_km[index], 5),
                "businessCount": count,
                "businessesPerSqKm": round(density, 2),
                "categoryDiversity": round(diversity, 4),
                "categoryCounts": {
                    category: local_counts[zone_id].get(category, 0)
                    for category in LOCAL_CATEGORIES
                },
                "topMajorCategories": [
                    {"name": name, "count": value}
                    for name, value in major_counts[zone_id].most_common(8)
                ],
                "topMidCategories": [
                    {"name": name, "count": value}
                    for name, value in mid_counts[zone_id].most_common(10)
                ],
            }
        )

    zone_kinds = sorted({row["zoneKind"] for row in base_records})
    normalization = {}
    for zone_kind in zone_kinds:
        kind_rows = [row for row in base_records if row["zoneKind"] == zone_kind]
        density_p90 = p90([float(row["businessesPerSqKm"]) for row in kind_rows])
        category_density_p90 = {
            category: p90(
                [
                    row["categoryCounts"][category] / max(float(row["areaSqKm"]), 1e-6)
                    for row in kind_rows
                ]
            )
            for category in LOCAL_CATEGORIES
        }
        normalization[zone_kind] = {
            "businessDensityP90": density_p90,
            "categoryDensityP90": category_density_p90,
        }

    for row in base_records:
        norms = normalization[row["zoneKind"]]
        row["businessDensityScore"] = round(
            min(float(row["businessesPerSqKm"]) / max(norms["businessDensityP90"], 1e-6), 1.0)
            * 100,
            1,
        )
        row["businessDiversityScore"] = round(float(row["categoryDiversity"]) * 100, 1)
        row["categoryDensityScores"] = {
            category: round(
                min(
                    (
                        row["categoryCounts"][category]
                        / max(float(row["areaSqKm"]), 1e-6)
                    )
                    / max(norms["categoryDensityP90"][category], 1e-6),
                    1.0,
                )
                * 100,
                1,
            )
            for category in LOCAL_CATEGORIES
        }

    base_records.sort(
        key=lambda row: (
            row["zoneKind"],
            row.get("district") or "",
            row["label"],
            row["zoneId"],
        )
    )

    output = {
        "schemaVersion": 1,
        "generatedAt": args.generated_at,
        "source": {**DATASET, "sourceSha256": source_sha256(args.source)},
        "method": {
            "spatialJoin": "official SEMAS point -> smallest containing locality polygon; model corridors additionally receive overlapping points",
            "density": "business count / polygon area km2",
            "densityNormalization": "p90 capped at 100 within each zoneKind",
            "diversity": "Shannon entropy across SEMAS mid categories / ln(75)",
            "limitations": [
                "상업밀도와 업종다양성은 영업 중 업소 구조를 나타내며 매출이나 성공확률이 아님",
                "대구 전역 locality polygon은 공식 SGIS 2025Q2 행정동 경계이며 상권 자체의 경계는 아님",
                "모델 corridor는 서로 겹칠 수 있어 동일 점포가 여러 corridor에 포함될 수 있음",
            ],
        },
        "coverage": {
            "sourceRows": source_rows,
            "validCoordinateRows": valid_coordinates,
            "localityAssignedRows": locality_assigned,
            "unmatchedLocalityRows": unmatched_locality,
            "corridorAssignments": corridor_assignments,
            "zoneCount": len(base_records),
        },
        "normalization": normalization,
        "records": base_records,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "sourceRows": source_rows,
                "validCoordinates": valid_coordinates,
                "localityAssigned": locality_assigned,
                "unmatchedLocality": unmatched_locality,
                "profiles": len(base_records),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
