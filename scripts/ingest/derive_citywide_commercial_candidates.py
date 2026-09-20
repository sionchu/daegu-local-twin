"""Derive evidence-bounded citywide commercial candidates for LocalTwin Daegu.

This adapter does not declare official commercial districts. It ranks official SGIS
administrative-dong analysis zones using already-derived SEMAS business structure and
context-access signals, preserves the five map-derived central corridors, and marks a
small, spatially distributed subset as commercial candidates for review.

The score is modelled evidence for prioritization only. It is not observed footfall,
sales, revenue, success probability, or an official commercial-area designation.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

LOCALITY_WEIGHTS = {
    "businessDensity": 0.34,
    "businessDiversity": 0.18,
    "transit": 0.16,
    "retailMarket": 0.12,
    "employmentPublic": 0.10,
    "cultureTourism": 0.06,
    "healthcare": 0.04,
}

MIN_CANDIDATE_SCORE = 52.0
MIN_BUSINESS_COUNT = 250
MAX_CANDIDATES_PER_DISTRICT = 2
MIN_CANDIDATE_SEPARATION_M = 1400.0
CENTRAL_OVERLAP_BUFFER_M = 150.0
MAX_CENTRAL_OVERLAP_RATIO = 0.12


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--profiles",
        type=Path,
        default=Path("public/data/zone_context_profiles.json"),
    )
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
        default=Path("public/data/citywide_commercial_candidates.geojson"),
    )
    parser.add_argument(
        "--profiles-output",
        type=Path,
        default=Path("public/data/citywide_commercial_profiles.json"),
    )
    parser.add_argument("--generated-at")
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def generated_at(value: str | None) -> str:
    if value:
        return value
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def clamp_score(value: float) -> float:
    return max(0.0, min(100.0, float(value)))


def commercial_potential(profile: dict[str, Any]) -> float:
    business = profile.get("businessSignals") or {}
    scores = profile.get("scores") or {}
    weighted = (
        clamp_score(business.get("businessDensityScore") or 0.0)
        * LOCALITY_WEIGHTS["businessDensity"]
        + clamp_score(business.get("businessDiversityScore") or 0.0)
        * LOCALITY_WEIGHTS["businessDiversity"]
        + clamp_score(scores.get("transit") or 0.0) * LOCALITY_WEIGHTS["transit"]
        + clamp_score(scores.get("retail_market") or 0.0) * LOCALITY_WEIGHTS["retailMarket"]
        + clamp_score(scores.get("employment_public") or 0.0)
        * LOCALITY_WEIGHTS["employmentPublic"]
        + clamp_score(scores.get("culture_tourism") or 0.0)
        * LOCALITY_WEIGHTS["cultureTourism"]
        + clamp_score(scores.get("healthcare") or 0.0) * LOCALITY_WEIGHTS["healthcare"]
    )
    return round(weighted, 1)


def profile_properties(profile: dict[str, Any], score: float) -> dict[str, Any]:
    business = profile.get("businessSignals") or {}
    scores = profile.get("scores") or {}
    return {
        "commercialPotentialScore": score,
        "businessCount": int(business.get("businessCount") or 0),
        "businessDensityScore": round(float(business.get("businessDensityScore") or 0.0), 1),
        "businessDiversityScore": round(float(business.get("businessDiversityScore") or 0.0), 1),
        "transitScore": round(float(scores.get("transit") or 0.0), 1),
        "retailMarketScore": round(float(scores.get("retail_market") or 0.0), 1),
        "employmentPublicScore": round(float(scores.get("employment_public") or 0.0), 1),
        "cultureTourismScore": round(float(scores.get("culture_tourism") or 0.0), 1),
        "healthcareScore": round(float(scores.get("healthcare") or 0.0), 1),
    }


def candidate_tier(score: float) -> str:
    if score >= 75.0:
        return "strong"
    if score >= 62.0:
        return "review"
    return "emerging"


def main() -> int:
    args = parse_args()

    try:
        from pyproj import Transformer
        from shapely.geometry import shape
        from shapely.ops import transform, unary_union
    except ImportError as exc:
        raise SystemExit("This ingest adapter requires shapely and pyproj.") from exc

    profile_doc = load_json(args.profiles)
    zone_doc = load_json(args.city_zones)
    corridor_doc = load_json(args.corridors)

    profiles_by_zone = {
        row["zoneId"]: row
        for row in profile_doc.get("records") or []
        if row.get("zoneId")
    }
    city_features = zone_doc.get("features") or []
    corridor_features = corridor_doc.get("features") or []

    transformer = Transformer.from_crs("EPSG:4326", "EPSG:32652", always_xy=True)
    project = transformer.transform

    corridor_geometries = [
        transform(project, shape(feature["geometry"]))
        for feature in corridor_features
        if feature.get("geometry")
    ]
    corridor_union = (
        unary_union(corridor_geometries).buffer(CENTRAL_OVERLAP_BUFFER_M)
        if corridor_geometries
        else None
    )

    locality_rows: list[dict[str, Any]] = []
    projected_by_zone: dict[str, Any] = {}
    for feature in city_features:
        properties = feature.get("properties") or {}
        zone_id = properties.get("zoneId")
        profile = profiles_by_zone.get(zone_id)
        if not zone_id or not profile:
            continue

        geometry = transform(project, shape(feature["geometry"]))
        projected_by_zone[zone_id] = geometry
        score = commercial_potential(profile)
        overlap_ratio = 0.0
        if corridor_union is not None and geometry.area > 0:
            overlap_ratio = float(geometry.intersection(corridor_union).area / geometry.area)

        row = {
            "zoneId": zone_id,
            "label": properties.get("label") or profile.get("label") or zone_id,
            "district": properties.get("district") or profile.get("district"),
            "score": score,
            "businessCount": int((profile.get("businessSignals") or {}).get("businessCount") or 0),
            "overlapRatio": round(overlap_ratio, 4),
            "feature": feature,
            "profile": profile,
        }
        locality_rows.append(row)

    selectable = [
        row
        for row in locality_rows
        if row["score"] >= MIN_CANDIDATE_SCORE
        and row["businessCount"] >= MIN_BUSINESS_COUNT
        and row["overlapRatio"] <= MAX_CENTRAL_OVERLAP_RATIO
    ]

    by_district: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in selectable:
        by_district[str(row.get("district") or "미분류")].append(row)

    selected_zone_ids: set[str] = set()
    selected_rows: list[dict[str, Any]] = []
    for district in sorted(by_district):
        ranked = sorted(
            by_district[district],
            key=lambda row: (-row["score"], -row["businessCount"], row["zoneId"]),
        )
        chosen: list[dict[str, Any]] = []
        for row in ranked:
            if len(chosen) >= MAX_CANDIDATES_PER_DISTRICT:
                break
            centroid = projected_by_zone[row["zoneId"]].centroid
            if any(
                centroid.distance(projected_by_zone[other["zoneId"]].centroid)
                < MIN_CANDIDATE_SEPARATION_M
                for other in chosen
            ):
                continue
            chosen.append(row)

        for row in chosen:
            selected_zone_ids.add(row["zoneId"])
            selected_rows.append(row)

    selected_rows.sort(
        key=lambda row: (-row["score"], -row["businessCount"], row["zoneId"])
    )
    locality_rank = {row["zoneId"]: index + 1 for index, row in enumerate(selected_rows)}

    profile_records: list[dict[str, Any]] = []
    candidate_features: list[dict[str, Any]] = []
    for row in sorted(locality_rows, key=lambda item: item["zoneId"]):
        profile = row["profile"]
        source_properties = row["feature"].get("properties") or {}
        is_candidate = row["zoneId"] in selected_zone_ids
        properties = {
            "zoneId": row["zoneId"],
            "label": row["label"],
            "district": row["district"],
            "zoneKind": "locality",
            "labelLon": source_properties.get("labelLon"),
            "labelLat": source_properties.get("labelLat"),
            "isCommercialCandidate": is_candidate,
            "candidateRank": locality_rank.get(row["zoneId"]),
            "candidateTier": candidate_tier(row["score"]) if is_candidate else None,
            "centralCorridorOverlapRatio": row["overlapRatio"],
            **profile_properties(profile, row["score"]),
            "quality": "modelled-hybrid-evidence",
            "boundaryMeaning": "SGIS 2025Q2 행정동 기반 상권후보 분석권역이며 공식 상권 경계가 아님",
            "selectionMeaning": (
                "대구 전역 상권 검토 우선 후보"
                if is_candidate
                else "비후보 행정동 분석권역"
            ),
        }
        profile_records.append(properties)
        if is_candidate:
            candidate_features.append(
                {
                    "type": "Feature",
                    "properties": properties,
                    "geometry": row["feature"]["geometry"],
                }
            )

    corridor_rows: list[dict[str, Any]] = []
    for feature in corridor_features:
        source_properties = feature.get("properties") or {}
        zone_id = source_properties.get("zoneId")
        profile = profiles_by_zone.get(zone_id)
        if not zone_id or not profile:
            continue
        score = commercial_potential(profile)
        corridor_rows.append(
            {
                "zoneId": zone_id,
                "label": source_properties.get("label") or profile.get("label") or zone_id,
                "feature": feature,
                "profile": profile,
                "score": score,
            }
        )

    corridor_rows.sort(key=lambda row: (-row["score"], row["zoneId"]))
    for index, row in enumerate(corridor_rows, start=1):
        source_properties = row["feature"].get("properties") or {}
        properties = {
            "zoneId": row["zoneId"],
            "label": row["label"],
            "district": "중구",
            "zoneKind": "commercial_corridor",
            "labelLon": source_properties.get("labelLon"),
            "labelLat": source_properties.get("labelLat"),
            "memberCellIds": source_properties.get("memberCellIds") or [],
            "isCommercialCandidate": True,
            "candidateRank": index,
            "candidateTier": "precise-corridor",
            "centralCorridorOverlapRatio": 1.0,
            **profile_properties(row["profile"], row["score"]),
            "quality": "modelled-map-derived",
            "boundaryMeaning": source_properties.get(
                "boundaryMeaning",
                "도로·시장 geometry 기반 중앙도심 분석권역이며 공식 상권 경계가 아님",
            ),
            "selectionMeaning": "기존 중앙도심 정밀 상권분석 권역",
        }
        profile_records.append(properties)
        candidate_features.append(
            {
                "type": "Feature",
                "properties": properties,
                "geometry": row["feature"]["geometry"],
            }
        )

    now = generated_at(args.generated_at)
    metadata = {
        "schemaVersion": 1,
        "generatedAt": now,
        "sourceZones": "public/data/daegu_analysis_zones.geojson",
        "sourceProfiles": "public/data/zone_context_profiles.json",
        "sourceCentralCorridors": "public/data/corridor_zones.geojson",
        "scoreWeights": LOCALITY_WEIGHTS,
        "selection": {
            "minCandidateScore": MIN_CANDIDATE_SCORE,
            "minBusinessCount": MIN_BUSINESS_COUNT,
            "maxCandidatesPerDistrict": MAX_CANDIDATES_PER_DISTRICT,
            "minCandidateSeparationM": MIN_CANDIDATE_SEPARATION_M,
            "centralOverlapBufferM": CENTRAL_OVERLAP_BUFFER_M,
            "maxCentralOverlapRatio": MAX_CENTRAL_OVERLAP_RATIO,
        },
        "coverage": {
            "profileCount": len(profile_records),
            "localityZoneCount": len(locality_rows),
            "localityCandidateCount": len(selected_rows),
            "centralCorridorCount": len(corridor_rows),
            "candidateCount": len(candidate_features),
            "districtCandidateCounts": dict(
                sorted(
                    (
                        district,
                        sum(
                            1
                            for row in selected_rows
                            if (row.get("district") or "미분류") == district
                        ),
                    )
                    for district in {
                        str(row.get("district") or "미분류") for row in selected_rows
                    }
                )
            ),
        },
        "evidenceBoundary": [
            "SEMAS 2026Q2 점포구조와 시설·교통 접근성의 모델 결합 상대점수",
            "행정동 후보권역은 공식 SGIS 경계를 사용하지만 공식 상권 지정이 아님",
            "중앙 5개 corridor는 기존 도로·시장 geometry 기반 분석권역",
            "검색관심·점포실거래·생활인구·카드매출이 전역 직접관측으로 확보되기 전에는 후보점수를 매출/성공확률로 해석하지 않음",
        ],
    }
    output = {
        "type": "FeatureCollection",
        "name": "LocalTwin Daegu citywide commercial candidates",
        "metadata": metadata,
        "features": candidate_features,
    }
    profiles_output = {
        "metadata": metadata,
        "records": profile_records,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    args.profiles_output.parent.mkdir(parents=True, exist_ok=True)
    args.profiles_output.write_text(
        json.dumps(profiles_output, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "candidatesOutput": str(args.output),
                "profilesOutput": str(args.profiles_output),
                "profileCount": len(profile_records),
                "localityZones": len(locality_rows),
                "localityCandidates": len(selected_rows),
                "centralCorridors": len(corridor_rows),
                "candidateCount": len(candidate_features),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
