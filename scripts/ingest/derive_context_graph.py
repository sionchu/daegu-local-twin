"""Derive LocalTwin commercial-context profiles and a lightweight evidence graph.

The graph uses official SGIS analysis zones, official registries where available, and
public-map anchors where official coordinates are unavailable. Distance-decay scores are
modelled proximity signals, not footfall, sales, employment counts, or success probabilities.
"""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import quantiles
from typing import Any

RULES = {
    "education": {"scaleM": 700.0, "maxDistanceM": 2500.0},
    "healthcare": {"scaleM": 900.0, "maxDistanceM": 3000.0},
    "employment_public": {"scaleM": 900.0, "maxDistanceM": 3000.0},
    "industrial": {"scaleM": 1300.0, "maxDistanceM": 4500.0},
    "transit": {"scaleM": 650.0, "maxDistanceM": 2200.0},
    "retail_market": {"scaleM": 800.0, "maxDistanceM": 2600.0},
    "culture_tourism": {"scaleM": 1000.0, "maxDistanceM": 3500.0},
    "parking_access": {"scaleM": 500.0, "maxDistanceM": 1500.0},
}

MAX_GRAPH_EDGES_PER_TYPE_PER_ZONE = 8
MAX_NEAREST_ANCHORS_PER_TYPE = 5

HIGHER_EDUCATION_SUBTYPES = {
    "college_university",
    "campus_building",
    "medical_school",
    "law_schools",
}

MARKET_SUBTYPES = {
    "farmers_market",
    "flea_market",
    "night_market",
    "shopping_center",
    "department_store",
}

TRANSIT_MAJOR_SUBTYPES = {
    "train_station",
    "metro_station",
    "light_rail_and_subway_stations",
    "bus_station",
}

BUSINESS_CATEGORY_LABELS = {
    "cafe": "카페",
    "restaurant": "음식점",
    "retail": "소매",
    "beauty": "뷰티",
    "service": "생활서비스",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--anchors", type=Path, required=True)
    parser.add_argument("--city-zones", type=Path, required=True)
    parser.add_argument("--corridors", type=Path, required=True)
    parser.add_argument(
        "--profiles-output",
        type=Path,
        default=Path("public/data/zone_context_profiles.json"),
    )
    parser.add_argument(
        "--graph-output",
        type=Path,
        default=Path("public/data/context_graph.json"),
    )
    parser.add_argument(
        "--corridor-profiles-output",
        type=Path,
        default=Path("public/data/corridor_context_profiles.json"),
    )
    parser.add_argument(
        "--availability-output",
        type=Path,
        default=Path("public/data/context_data_availability.json"),
    )
    parser.add_argument(
        "--official-context-summary",
        type=Path,
        default=Path("public/data/official_context_summary.json"),
    )
    parser.add_argument(
        "--business-profiles",
        type=Path,
        default=Path("public/data/zone_business_profiles.json"),
    )
    parser.add_argument(
        "--workplace-employment",
        type=Path,
        default=Path("public/data/workplace_employment.json"),
    )
    parser.add_argument("--generated-at")
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def generated_at(value: str | None) -> str:
    if value:
        return value
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def p90(values: list[float]) -> float:
    nonzero = sorted(value for value in values if value > 0)
    if not nonzero:
        return 1.0
    if len(nonzero) < 10:
        return nonzero[-1]
    return quantiles(nonzero, n=10, method="inclusive")[8]


def zone_features(city_zones: dict[str, Any], corridors: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for feature in city_zones.get("features") or []:
        properties = feature.get("properties") or {}
        rows.append(
            {
                "zoneId": properties["zoneId"],
                "label": properties["label"],
                "district": properties.get("district"),
                "zoneKind": "locality",
                "memberCellIds": [],
                "quality": properties.get("quality", "public-map"),
                "geometry": feature["geometry"],
            }
        )
    for feature in corridors.get("features") or []:
        properties = feature.get("properties") or {}
        rows.append(
            {
                "zoneId": properties["zoneId"],
                "label": properties["label"],
                "district": None,
                "zoneKind": "commercial_corridor",
                "memberCellIds": properties.get("memberCellIds") or [],
                "quality": "modelled-map-derived",
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
    except ImportError as exc:
        raise SystemExit("This ingest adapter requires shapely and pyproj.") from exc

    anchors_doc = load_json(args.anchors)
    city_zones = load_json(args.city_zones)
    corridors = load_json(args.corridors)
    official_context = (
        load_json(args.official_context_summary)
        if args.official_context_summary.exists()
        else {}
    )
    business_profile_doc = (
        load_json(args.business_profiles)
        if args.business_profiles.exists()
        else {"records": []}
    )
    business_profiles_by_zone = {
        row["zoneId"]: row
        for row in business_profile_doc.get("records") or []
        if row.get("zoneId")
    }
    workplace_doc = (
        load_json(args.workplace_employment)
        if args.workplace_employment.exists()
        else {"records": [], "coverage": {}, "source": {}}
    )
    workplace_by_zone = {
        row["zoneId"]: row
        for row in workplace_doc.get("records") or []
        if row.get("zoneId")
    }
    ranked_workplace = sorted(
        workplace_by_zone.values(),
        key=lambda row: (-int(row.get("employees") or 0), row["zoneId"]),
    )
    workplace_rank_by_zone = {
        row["zoneId"]: index
        for index, row in enumerate(ranked_workplace, start=1)
    }
    workplace_score_by_zone = {
        row["zoneId"]: round(
            (
                (len(ranked_workplace) - index)
                / max(len(ranked_workplace) - 1, 1)
            )
            * 100,
            1,
        )
        for index, row in enumerate(ranked_workplace, start=1)
    }
    school_counts_by_district = (
        (official_context.get("schoolRegistry") or {}).get("countByDistrict") or {}
    )
    factory_counts_by_district = (
        (official_context.get("factorySummary") or {}).get("countByDistrict") or {}
    )
    population_by_district = (
        (official_context.get("residentPopulation") or {}).get("byDistrict") or {}
    )
    healthcare_counts_by_district = (
        (official_context.get("healthcareRegistry") or {}).get("countByDistrict") or {}
    )

    transformer = Transformer.from_crs("EPSG:4326", "EPSG:32652", always_xy=True)
    project = transformer.transform

    anchors = anchors_doc.get("records") or []
    projected_anchors: dict[str, Any] = {}
    anchors_by_type: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for anchor in anchors:
        point = transform(project, Point(float(anchor["longitude"]), float(anchor["latitude"])))
        projected_anchors[anchor["anchorId"]] = point
        anchors_by_type[anchor["anchorType"]].append(anchor)

    zones = zone_features(city_zones, corridors)
    raw_by_zone: dict[str, dict[str, float]] = {}
    detail_by_zone: dict[str, dict[str, Any]] = {}
    graph_edge_candidates: dict[str, dict[str, list[dict[str, Any]]]] = {}

    for zone in zones:
        zone_geom = transform(project, shape(zone["geometry"]))
        raw_scores: dict[str, float] = {}
        type_details: dict[str, Any] = {}
        type_edges: dict[str, list[dict[str, Any]]] = {}

        for anchor_type, rule in RULES.items():
            rows: list[dict[str, Any]] = []
            raw = 0.0
            subtype_counts: dict[str, int] = defaultdict(int)

            for anchor in anchors_by_type.get(anchor_type, []):
                distance_m = float(zone_geom.distance(projected_anchors[anchor["anchorId"]]))
                if distance_m > rule["maxDistanceM"]:
                    continue
                decay = math.exp(-distance_m / rule["scaleM"])
                base_weight = float(anchor.get("baseWeight") or 1.0)
                capacity_weight = float(anchor.get("capacityWeight") or 1.0)
                influence = decay * base_weight * capacity_weight
                raw += influence
                subtype_counts[str(anchor.get("subtype") or "unknown")] += 1
                rows.append(
                    {
                        "anchorId": anchor["anchorId"],
                        "name": anchor["name"],
                        "subtype": anchor.get("subtype"),
                        "distanceM": round(distance_m, 1),
                        "decayWeight": round(decay, 6),
                        "baseWeight": round(base_weight, 4),
                        "capacityWeight": round(capacity_weight, 4),
                        "influenceWeight": round(influence, 6),
                        "quality": anchor.get("quality"),
                    }
                )

            rows.sort(
                key=lambda item: (
                    -item["influenceWeight"],
                    item["distanceM"],
                    item["name"],
                )
            )
            raw_scores[anchor_type] = raw
            type_details[anchor_type] = {
                "countWithinCatchment": len(rows),
                "rawDecaySum": round(raw, 6),
                "nearestAnchors": rows[:MAX_NEAREST_ANCHORS_PER_TYPE],
                "subtypeCounts": dict(sorted(subtype_counts.items())),
                "scaleM": rule["scaleM"],
                "maxDistanceM": rule["maxDistanceM"],
            }
            type_edges[anchor_type] = rows[:MAX_GRAPH_EDGES_PER_TYPE_PER_ZONE]

        raw_by_zone[zone["zoneId"]] = raw_scores
        detail_by_zone[zone["zoneId"]] = type_details
        graph_edge_candidates[zone["zoneId"]] = type_edges

    zone_kind_by_id = {zone["zoneId"]: zone["zoneKind"] for zone in zones}
    zone_kinds = sorted(set(zone_kind_by_id.values()))
    normalization_by_kind = {
        zone_kind: {
            anchor_type: p90(
                [
                    raw_by_zone[zone_id].get(anchor_type, 0.0)
                    for zone_id in raw_by_zone
                    if zone_kind_by_id[zone_id] == zone_kind
                ]
            )
            for anchor_type in RULES
        }
        for zone_kind in zone_kinds
    }

    profile_rows: list[dict[str, Any]] = []
    for zone in zones:
        zone_id = zone["zoneId"]
        normalization = normalization_by_kind[zone["zoneKind"]]
        scores = {
            anchor_type: round(
                min(raw_by_zone[zone_id].get(anchor_type, 0.0) / normalization[anchor_type], 1.0)
                * 100,
                1,
            )
            for anchor_type in RULES
        }

        details = detail_by_zone[zone_id]
        university_raw = sum(
            row["influenceWeight"]
            for row in graph_edge_candidates[zone_id]["education"]
            if row.get("subtype") in HIGHER_EDUCATION_SUBTYPES
        )
        market_raw = sum(
            row["influenceWeight"]
            for row in graph_edge_candidates[zone_id]["retail_market"]
            if row.get("subtype") in MARKET_SUBTYPES
        )
        transit_major_raw = sum(
            row["influenceWeight"]
            for row in graph_edge_candidates[zone_id]["transit"]
            if row.get("subtype") in TRANSIT_MAJOR_SUBTYPES
        )

        profile_rows.append(
            {
                "zoneId": zone_id,
                "label": zone["label"],
                "district": zone["district"],
                "zoneKind": zone["zoneKind"],
                "memberCellIds": zone["memberCellIds"],
                "quality": "modelled-hybrid-evidence",
                "scores": scores,
                "specialSignals": {
                    "higherEducationProximity": round(min(university_raw / 2.5, 1.0) * 100, 1),
                    "marketAnchorProximity": round(min(market_raw / 2.5, 1.0) * 100, 1),
                    "majorTransitProximity": round(min(transit_major_raw / 2.5, 1.0) * 100, 1),
                },
                "anchorEvidence": details,
                "businessSignals": (
                    {
                        "businessCount": business_profiles_by_zone[zone_id]["businessCount"],
                        "businessesPerSqKm": business_profiles_by_zone[zone_id]["businessesPerSqKm"],
                        "businessDensityScore": business_profiles_by_zone[zone_id]["businessDensityScore"],
                        "businessDiversityScore": business_profiles_by_zone[zone_id]["businessDiversityScore"],
                        "categoryCounts": business_profiles_by_zone[zone_id]["categoryCounts"],
                        "categoryDensityScores": business_profiles_by_zone[zone_id]["categoryDensityScores"],
                        "topMajorCategories": business_profiles_by_zone[zone_id]["topMajorCategories"],
                        "topMidCategories": business_profiles_by_zone[zone_id]["topMidCategories"],
                        "quality": "official-snapshot",
                        "sourceDatasetId": "15083033",
                        "sourceDate": "2026-06-30",
                    }
                    if zone_id in business_profiles_by_zone
                    else None
                ),
                "officialZoneSignals": (
                    {
                        "workplaceBusinesses": workplace_by_zone[zone_id]["businesses"],
                        "workplaceEmployees": workplace_by_zone[zone_id]["employees"],
                        "workplaceEmployeeRank": workplace_rank_by_zone[zone_id],
                        "workplaceEmploymentScore": workplace_score_by_zone[zone_id],
                        "workplaceSourceYear": (workplace_doc.get("source") or {}).get("sourceYear"),
                        "quality": "official-snapshot",
                        "sourceId": "kosis-workplace-employment-2024",
                    }
                    if zone_id in workplace_by_zone
                    else None
                ),
                "officialDistrictSignals": {
                    "schoolCount": school_counts_by_district.get(zone.get("district")),
                    "healthcareFacilityCount": healthcare_counts_by_district.get(zone.get("district")),
                    "registeredFactoryCount": factory_counts_by_district.get(zone.get("district")),
                    "residentPopulation": population_by_district.get(zone.get("district")),
                    "spatialResolution": "district",
                },
                "classificationAvailability": {
                    "businessDistrict": (
                        "official-dong-workplace-employment-available"
                        if zone_id in workplace_by_zone
                        else (
                            "partial-anchor-and-factory-registry"
                            if factory_counts_by_district.get(zone.get("district")) is not None
                            else "partial-anchor-only"
                        )
                    ),
                    "residentialLife": (
                        "district-population-only-missing-local-living-population"
                        if population_by_district.get(zone.get("district"))
                        else "blocked-missing-resident-and-living-population"
                    ),
                    "commuting": (
                        "workplace-employment-available-missing-OD"
                        if zone_id in workplace_by_zone
                        else "blocked-missing-OD-or-commuter-flow"
                    ),
                    "finalFunctionalProfile": "blocked-until-local-population-and-flow-data",
                },
            }
        )

    profile_rows.sort(key=lambda row: (row["zoneKind"], row.get("district") or "", row["label"], row["zoneId"]))

    referenced_anchor_ids: set[str] = set()
    edges: list[dict[str, Any]] = []
    for zone in zones:
        zone_id = zone["zoneId"]
        for anchor_type, rows in graph_edge_candidates[zone_id].items():
            for row in rows:
                referenced_anchor_ids.add(row["anchorId"])
                edges.append(
                    {
                        "edgeId": f'near:{zone_id}:{row["anchorId"]}',
                        "from": zone_id,
                        "to": row["anchorId"],
                        "relation": "NEAR",
                        "anchorType": anchor_type,
                        "distanceM": row["distanceM"],
                        "decayWeight": row["decayWeight"],
                        "baseWeight": row["baseWeight"],
                        "capacityWeight": row["capacityWeight"],
                        "influenceWeight": row["influenceWeight"],
                        "quality": "derived",
                        "method": "UTM52N polygon-to-point distance × exponential distance decay × subtype base weight",
                    }
                )

    for zone in zones:
        zone_id = zone["zoneId"]
        business_profile = business_profiles_by_zone.get(zone_id)
        if not business_profile:
            continue
        for category, count in business_profile.get("categoryCounts", {}).items():
            if count <= 0:
                continue
            edges.append(
                {
                    "edgeId": f"business-profile:{zone_id}:{category}",
                    "from": zone_id,
                    "to": f"business-category:{category}",
                    "relation": "HAS_BUSINESS_PROFILE",
                    "businessCount": count,
                    "densityScore": business_profile.get("categoryDensityScores", {}).get(category),
                    "quality": "official-snapshot",
                    "sourceDatasetId": "15083033",
                    "sourceDate": "2026-06-30",
                    "method": "SEMAS official business point-in-polygon aggregation",
                }
            )

    anchor_lookup = {row["anchorId"]: row for row in anchors}
    graph_nodes: list[dict[str, Any]] = []
    for zone in zones:
        graph_nodes.append(
            {
                "nodeId": zone["zoneId"],
                "nodeType": "AnalysisZone",
                "label": zone["label"],
                "district": zone["district"],
                "zoneKind": zone["zoneKind"],
                "quality": zone["quality"],
            }
        )
    for category, label in BUSINESS_CATEGORY_LABELS.items():
        graph_nodes.append(
            {
                "nodeId": f"business-category:{category}",
                "nodeType": "BusinessCategory",
                "label": label,
                "category": category,
                "quality": "taxonomy",
            }
        )
    for anchor_id in sorted(referenced_anchor_ids):
        anchor = anchor_lookup[anchor_id]
        graph_nodes.append(
            {
                "nodeId": anchor_id,
                "nodeType": "Anchor",
                "label": anchor["name"],
                "anchorType": anchor["anchorType"],
                "subtype": anchor["subtype"],
                "longitude": anchor["longitude"],
                "latitude": anchor["latitude"],
                "quality": anchor["quality"],
                "coordinateQuality": anchor.get("coordinateQuality"),
                "baseWeight": anchor.get("baseWeight"),
                "officialLinked": anchor.get("quality") == "official-linked",
            }
        )

    now = generated_at(args.generated_at)
    profiles_doc = {
        "schemaVersion": 1,
        "generatedAt": now,
        "method": {
            "description": "Anchor proximity signals using polygon-to-point distance, exponential distance decay, and subtype base weights",
            "rules": RULES,
            "normalization": {
                "method": "p90 capped at 100, normalized separately by zoneKind",
                "p90RawDecaySumByZoneKind": {
                    zone_kind: {
                        key: round(value, 6)
                        for key, value in values.items()
                    }
                    for zone_kind, values in normalization_by_kind.items()
                },
            },
            "limitations": [
                "공식 이용자수/종사자수 capacity가 없는 시설은 subtype별 기본가중치만 사용함",
                "업무지구/베드타운 최종 분류는 직장인구·거주인구·생활인구·OD 확보 전까지 비활성",
                "점수는 접근성/밀도 상대지표이며 매출·방문객·성공확률이 아님",
            ],
        },
        "coverage": {
            "zoneCount": len(profile_rows),
            "citywideLocalityZones": sum(row["zoneKind"] == "locality" for row in profile_rows),
            "commercialCorridors": sum(row["zoneKind"] == "commercial_corridor" for row in profile_rows),
        },
        "records": profile_rows,
    }

    graph_doc = {
        "schemaVersion": 1,
        "generatedAt": now,
        "graphType": "commercial-context-evidence-graph",
        "nodeCount": len(graph_nodes),
        "edgeCount": len(edges),
        "edgePolicy": {
            "relations": ["NEAR", "HAS_BUSINESS_PROFILE"],
            "maxEdgesPerTypePerZone": MAX_GRAPH_EDGES_PER_TYPE_PER_ZONE,
            "note": "ATTRACTS/SUITABLE_FOR edges are intentionally withheld until mobility/category-fit evidence is calibrated",
        },
        "nodes": graph_nodes,
        "edges": edges,
    }

    availability_doc = {
        "schemaVersion": 1,
        "generatedAt": now,
        "geography": "대구광역시",
        "datasets": [
            {
                "key": "anchor_places",
                "status": "available-citywide",
                "source": "Overture Places",
                "quality": "public-map",
                "output": "context_anchors.json",
            },
            {
                "key": "analysis_zones",
                "status": "available-citywide-official",
                "source": "SGIS 2025Q2 행정동 경계",
                "sourceUrl": "https://www.data.go.kr/data/15129688/fileData.do",
                "quality": "official",
                "officialRecords": 150,
                "output": "daegu_analysis_zones.geojson",
            },
            {
                "key": "school_official",
                "status": "available-official-registry-partial-spatial-link",
                "source": "대구광역시교육청 학교현황 2026-04-01",
                "sourceUrl": "https://www.data.go.kr/data/15015254/fileData.do",
                "quality": "official + public-map-coordinate-link",
                "officialRecords": (official_context.get("schoolRegistry") or {}).get("recordCount"),
                "spatiallyLinked": (official_context.get("schoolRegistry") or {}).get("spatiallyLinkedCount"),
                "output": "official_context_summary.json + context_anchors.json",
            },
            {
                "key": "factory_official",
                "status": "available-official-district-summary-partial-spatial-link",
                "source": "대구광역시 제조업체(공장등록업체)현황 2025-07-07",
                "sourceUrl": "https://www.data.go.kr/data/15069132/fileData.do",
                "quality": "official + public-map-coordinate-link",
                "officialRecords": (official_context.get("factorySummary") or {}).get("recordCount"),
                "spatiallyLinked": (official_context.get("factorySummary") or {}).get("spatiallyLinkedCount"),
                "output": "official_context_summary.json + context_anchors.json",
            },
            {
                "key": "businesses_official",
                "status": "available-citywide-official-snapshot",
                "source": "SEMAS 상가(상권)정보 2026-06-30",
                "sourceUrl": "https://www.data.go.kr/data/15083033/fileData.do",
                "quality": "official-snapshot",
                "officialRecords": (business_profile_doc.get("coverage") or {}).get("sourceRows"),
                "mappedLocalityRecords": (business_profile_doc.get("coverage") or {}).get("localityAssignedRows"),
                "output": "zone_business_profiles.json + context_graph.json",
            },
            {
                "key": "parking_official",
                "status": "available-citywide-official",
                "source": "data.go.kr National Parking Standard Dataset",
                "sourceUrl": "https://www.data.go.kr/data/15012896/standard.do",
                "quality": "official",
                "officialRecords": sum(
                    1 for anchor in anchors_by_type.get("parking_access", [])
                    if anchor.get("quality") == "official"
                ),
                "output": "parking.json + context_anchors/parking_access.json + zone_context_profiles.json",
            },
            {
                "key": "workplace_population",
                "status": (
                    "available-official-dong-2024"
                    if workplace_by_zone
                    else "missing"
                ),
                "source": (
                    "KOSIS National Business Survey 2024 dong totals"
                    if workplace_by_zone
                    else "SGIS/KOSIS workplace or employee statistics"
                ),
                "sourceUrl": (workplace_doc.get("source") or {}).get("url"),
                "quality": "official" if workplace_by_zone else "official-needed",
                "officialZoneRecords": len(workplace_by_zone),
                "cityBusinesses": (workplace_doc.get("coverage") or {}).get("businesses"),
                "cityEmployees": (workplace_doc.get("coverage") or {}).get("employees"),
                "output": (
                    "workplace_employment.json + zone_context_profiles.json"
                    if workplace_by_zone
                    else None
                ),
                "limitation": (
                    "business-location employees; not resident employment, commuting inflow, or time-of-day presence"
                    if workplace_by_zone
                    else None
                ),
            },
            {
                "key": "resident_population",
                "status": "available-district-level-only",
                "source": "대구광역시 주민등록인구및세대현황 2026-05-31",
                "sourceUrl": "https://www.data.go.kr/data/3077757/fileData.do",
                "quality": "official",
                "output": "official_context_summary.json",
                "limitation": "구·군 단위이므로 동/권역 생활성격 판정에는 단독 사용하지 않음",
            },
            {
                "key": "healthcare_official",
                "status": "available-official-citywide",
                "source": "건강보험심사평가원 전국 병의원 및 약국 현황 2026-06",
                "sourceUrl": "https://opendata.hira.or.kr/op/opc/selectOpenData.do?sno=11925",
                "quality": "official",
                "officialRecords": (official_context.get("healthcareRegistry") or {}).get("recordCount"),
                "coordinateQuality": "official",
                "output": "context_anchors.json + official_context_summary.json",
            },
            {
                "key": "living_population",
                "status": "controlled-data-slot",
                "source": "D-데이터허브 / DIP telecom living population 2020.01~2025.09",
                "quality": "controlled",
                "commitPolicy": "approved aggregate export only",
            },
            {
                "key": "card_spend",
                "status": "controlled-data-slot",
                "source": "D-데이터허브 / DIP card transactions",
                "quality": "controlled",
                "commitPolicy": "approved aggregate export only",
            },
            {
                "key": "commute_od",
                "status": "controlled-or-historical-slot",
                "source": "D-데이터허브 / DIP OD datasets",
                "quality": "controlled/historical",
                "commitPolicy": "approved aggregate export only; do not present old OD as current",
            },
            {
                "key": "visitor_population",
                "status": "controlled-data-slot",
                "source": "D-데이터허브 / DIP telecom visitor population through 2025-09",
                "quality": "controlled",
                "commitPolicy": "approved aggregate export only",
            },
        ],
    }

    corridor_profiles_doc = {
        "schemaVersion": 1,
        "generatedAt": now,
        "method": profiles_doc["method"],
        "coverage": {"commercialCorridors": 5},
        "records": [
            row
            for row in profile_rows
            if row["zoneKind"] == "commercial_corridor"
        ],
    }

    args.profiles_output.parent.mkdir(parents=True, exist_ok=True)
    args.graph_output.parent.mkdir(parents=True, exist_ok=True)
    args.corridor_profiles_output.parent.mkdir(parents=True, exist_ok=True)
    args.availability_output.parent.mkdir(parents=True, exist_ok=True)
    if args.availability_output.exists():
        existing_availability = load_json(args.availability_output)
        generated_keys = {row.get("key") for row in availability_doc.get("datasets") or []}
        for row in existing_availability.get("datasets") or []:
            if row.get("key") not in generated_keys:
                availability_doc["datasets"].append(row)

    args.profiles_output.write_text(
        json.dumps(profiles_doc, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    args.corridor_profiles_output.write_text(
        json.dumps(corridor_profiles_doc, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    args.graph_output.write_text(
        json.dumps(graph_doc, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    args.availability_output.write_text(
        json.dumps(availability_doc, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(
        json.dumps(
            {
                "profiles": len(profile_rows),
                "graphNodes": len(graph_nodes),
                "graphEdges": len(edges),
                "referencedAnchors": len(referenced_anchor_ids),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
