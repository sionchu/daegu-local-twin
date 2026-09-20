"""Normalize citywide Overture Places + division areas for LocalTwin Daegu.

Input files are downloaded separately with the overturemaps CLI. This adapter:
- clips records to the committed Daegu administrative boundary;
- creates public-map anchor points for commercial-context analysis;
- creates citywide locality analysis zones;
- keeps source confidence/version/license metadata;
- never upgrades public-map POIs to official observations.
"""

from __future__ import annotations

import argparse
import json
import math
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ANCHOR_CATEGORY_GROUPS: dict[str, set[str]] = {
    "education": {
        "elementary_school",
        "middle_school",
        "high_school",
        "school",
        "private_school",
        "preschool",
        "day_care_preschool",
        "college_university",
        "campus_building",
        "art_school",
        "language_school",
        "tutoring_center",
        "music_school",
        "vocational_and_technical_school",
        "medical_school",
        "law_schools",
        "specialty_school",
    },
    "healthcare": {
        "hospital",
        "medical_center",
        "health_and_medical",
        "pharmacy",
        "internal_medicine",
        "dentist",
        "dermatologist",
        "eye_care_clinic",
        "womens_health_clinic",
    },
    "employment_public": {
        "central_government_office",
        "public_service_and_government",
        "corporate_office",
        "post_office",
        "police_department",
        "fire_department",
        "library",
    },
    "industrial": {
        "business_manufacturing_and_supply",
        "commercial_industrial",
        "industrial_company",
        "auto_manufacturers_and_distributors",
        "plastic_manufacturer",
        "jewelry_and_watches_manufacturer",
        "motorcycle_manufacturer",
    },
    "transit": {
        "train_station",
        "metro_station",
        "light_rail_and_subway_stations",
        "bus_station",
    },
    "retail_market": {
        "shopping_center",
        "department_store",
        "farmers_market",
        "flea_market",
        "night_market",
        "supermarket",
        "wholesale_store",
    },
    "culture_tourism": {
        "landmark_and_historical_building",
        "museum",
        "art_museum",
        "history_museum",
        "science_museum",
        "contemporary_art_museum",
        "modern_art_museum",
        "textile_museum",
        "design_museum",
        "art_gallery",
        "cinema",
        "music_venue",
        "cultural_center",
        "park",
        "stadium_arena",
        "baseball_stadium",
        "soccer_stadium",
        "tennis_stadium",
        "hotel",
    },
    "parking_access": {
        "parking",
    },
}

CATEGORY_TO_ANCHOR = {
    category: group
    for group, categories in ANCHOR_CATEGORY_GROUPS.items()
    for category in categories
}

SUBTYPE_BASE_WEIGHTS: dict[str, float] = {
    # Education: universities/campuses are stronger recurring anchors than small academies.
    "college_university": 1.50,
    "campus_building": 1.00,
    "medical_school": 1.10,
    "law_schools": 1.10,
    "high_school": 0.70,
    "middle_school": 0.60,
    "elementary_school": 0.55,
    "vocational_and_technical_school": 0.65,
    "school": 0.50,
    "private_school": 0.40,
    "specialty_school": 0.40,
    "preschool": 0.25,
    "day_care_preschool": 0.25,
    "art_school": 0.20,
    "music_school": 0.20,
    "language_school": 0.20,
    "tutoring_center": 0.15,
    # Healthcare.
    "hospital": 1.40,
    "medical_center": 1.20,
    "health_and_medical": 0.60,
    "internal_medicine": 0.40,
    "pharmacy": 0.30,
    "dentist": 0.25,
    "dermatologist": 0.25,
    "eye_care_clinic": 0.25,
    "womens_health_clinic": 0.25,
    # Employment/public.
    "central_government_office": 1.10,
    "corporate_office": 0.85,
    "public_service_and_government": 0.65,
    "police_department": 0.40,
    "fire_department": 0.40,
    "library": 0.35,
    "post_office": 0.30,
    # Industry.
    "commercial_industrial": 1.00,
    "industrial_company": 1.00,
    "business_manufacturing_and_supply": 0.85,
    "auto_manufacturers_and_distributors": 0.80,
    "plastic_manufacturer": 0.80,
    "jewelry_and_watches_manufacturer": 0.80,
    "motorcycle_manufacturer": 0.80,
    # Transit.
    "train_station": 1.00,
    "metro_station": 1.00,
    "light_rail_and_subway_stations": 1.00,
    "bus_station": 0.70,
    # Retail/market anchors.
    "department_store": 1.50,
    "shopping_center": 1.20,
    "farmers_market": 1.20,
    "night_market": 1.20,
    "flea_market": 1.00,
    "wholesale_store": 0.85,
    "supermarket": 0.65,
    # Culture/tourism.
    "stadium_arena": 1.00,
    "baseball_stadium": 1.00,
    "soccer_stadium": 1.00,
    "tennis_stadium": 0.80,
    "museum": 0.80,
    "art_museum": 0.80,
    "history_museum": 0.80,
    "science_museum": 0.80,
    "contemporary_art_museum": 0.80,
    "modern_art_museum": 0.80,
    "textile_museum": 0.70,
    "design_museum": 0.70,
    "cinema": 0.70,
    "cultural_center": 0.70,
    "music_venue": 0.60,
    "hotel": 0.55,
    "art_gallery": 0.45,
    "park": 0.40,
    "landmark_and_historical_building": 0.35,
    # Parking is an access-support signal, not demand by itself.
    "parking": 0.30,
}

EXCLUDED_NAME_TERMS_BY_TYPE: dict[str, tuple[str, ...]] = {
    "employment_public": ("묘원", "묘지", "봉안", "납골", "교회", "성당", "사찰"),
}


def base_weight(subtype: str | None) -> float:
    return SUBTYPE_BASE_WEIGHTS.get(subtype or "", 0.50)


def anchor_name_allowed(anchor_type: str, name: str) -> bool:
    return not any(term in name for term in EXCLUDED_NAME_TERMS_BY_TYPE.get(anchor_type, ()))


LOCALITY_NAME_RE = re.compile(r".+(동|읍|면)$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--places", type=Path, required=True)
    parser.add_argument("--divisions", type=Path, required=True)
    parser.add_argument("--boundary", type=Path, required=True)
    parser.add_argument(
        "--anchors-output",
        type=Path,
        default=Path("public/data/context_anchors.json"),
    )
    parser.add_argument(
        "--zones-output",
        type=Path,
        default=Path("public/data/overture_context_zones.geojson"),
    )
    parser.add_argument("--min-confidence", type=float, default=0.45)
    parser.add_argument("--retrieved-at")
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def primary_name(properties: dict[str, Any]) -> str | None:
    names = properties.get("names")
    if not isinstance(names, dict):
        return None
    value = names.get("primary")
    return str(value).strip() if value else None


def primary_category(properties: dict[str, Any]) -> str | None:
    categories = properties.get("categories")
    if not isinstance(categories, dict):
        return None
    value = categories.get("primary")
    return str(value).strip() if value else None


def point_coordinates(feature: dict[str, Any]) -> tuple[float, float] | None:
    geometry = feature.get("geometry") or {}
    if geometry.get("type") != "Point":
        return None
    coordinates = geometry.get("coordinates")
    if (
        not isinstance(coordinates, list)
        or len(coordinates) < 2
        or not isinstance(coordinates[0], (int, float))
        or not isinstance(coordinates[1], (int, float))
    ):
        return None
    lon, lat = float(coordinates[0]), float(coordinates[1])
    if not math.isfinite(lon) or not math.isfinite(lat):
        return None
    return lon, lat


def compact_sources(properties: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for source in properties.get("sources") or []:
        if not isinstance(source, dict):
            continue
        row = {
            "provider": source.get("provider"),
            "dataset": source.get("dataset"),
            "version": source.get("version"),
            "updateTime": source.get("update_time"),
            "license": source.get("license"),
        }
        if row not in rows:
            rows.append(row)
        if len(rows) >= 4:
            break
    return rows


def generic_name(anchor_type: str, subtype: str) -> str:
    labels = {
        "education": "교육시설",
        "healthcare": "의료시설",
        "employment_public": "업무·공공시설",
        "industrial": "산업시설",
        "transit": "교통거점",
        "retail_market": "시장·대형점포",
        "culture_tourism": "문화·관광시설",
        "parking_access": "주차시설",
    }
    return labels.get(anchor_type, subtype)


def main() -> int:
    args = parse_args()

    try:
        from shapely.geometry import Point, mapping, shape
    except ImportError as exc:
        raise SystemExit("This ingest adapter requires shapely.") from exc

    boundary_doc = load_json(args.boundary)
    city_geometry = shape(boundary_doc["features"][0]["geometry"])

    places = load_json(args.places)
    anchors: list[dict[str, Any]] = []
    skipped_outside = 0
    skipped_confidence = 0

    for feature in places.get("features") or []:
        properties = feature.get("properties") or {}
        category = primary_category(properties)
        anchor_type = CATEGORY_TO_ANCHOR.get(category or "")
        if not anchor_type:
            continue

        point = point_coordinates(feature)
        if point is None:
            continue
        lon, lat = point
        if not city_geometry.covers(Point(lon, lat)):
            skipped_outside += 1
            continue

        confidence_raw = properties.get("confidence")
        confidence = float(confidence_raw) if isinstance(confidence_raw, (int, float)) else None
        if confidence is not None and confidence < args.min_confidence:
            skipped_confidence += 1
            continue

        taxonomy = properties.get("taxonomy") or {}
        hierarchy = taxonomy.get("hierarchy") if isinstance(taxonomy, dict) else None
        name = primary_name(properties) or generic_name(anchor_type, category or "unknown")
        if not anchor_name_allowed(anchor_type, name):
            continue
        anchors.append(
            {
                "anchorId": f'overture:{feature.get("id")}',
                "name": name,
                "anchorType": anchor_type,
                "subtype": category,
                "longitude": round(lon, 8),
                "latitude": round(lat, 8),
                "confidence": confidence,
                "taxonomyHierarchy": hierarchy if isinstance(hierarchy, list) else [],
                "capacity": None,
                "capacityUnit": None,
                "baseWeight": base_weight(category),
                "quality": "public-map",
                "coordinateQuality": "public-map",
                "source": {
                    "provider": "Overture Maps Foundation",
                    "recordId": feature.get("id"),
                    "sources": compact_sources(properties),
                },
            }
        )

    anchors.sort(key=lambda row: (row["anchorType"], row["subtype"] or "", row["name"], row["anchorId"]))
    anchor_counts = Counter(row["anchorType"] for row in anchors)

    divisions = load_json(args.divisions)
    candidate_counties: list[tuple[str, Any, str]] = []
    for feature in divisions.get("features") or []:
        properties = feature.get("properties") or {}
        if (
            properties.get("country") == "KR"
            and properties.get("region") == "KR-27"
            and properties.get("class") == "land"
            and properties.get("subtype") == "county"
        ):
            geometry = shape(feature["geometry"])
            intersection = geometry.intersection(city_geometry)
            ratio = intersection.area / geometry.area if geometry.area else 0
            if not intersection.is_empty and ratio >= 0.5:
                candidate_counties.append(
                    (
                        primary_name(properties) or "미상",
                        intersection,
                        str(feature.get("id")),
                    )
                )

    zones: list[dict[str, Any]] = []
    for feature in divisions.get("features") or []:
        properties = feature.get("properties") or {}
        if not (
            properties.get("country") == "KR"
            and properties.get("region") == "KR-27"
            and properties.get("class") == "land"
            and properties.get("subtype") == "locality"
        ):
            continue

        name = primary_name(properties)
        if not name or not LOCALITY_NAME_RE.fullmatch(name):
            continue

        geometry = shape(feature["geometry"])
        if geometry.is_empty or not geometry.is_valid:
            geometry = geometry.buffer(0)
        if geometry.is_empty:
            continue

        intersection = geometry.intersection(city_geometry)
        ratio = intersection.area / geometry.area if geometry.area else 0
        if intersection.is_empty or ratio < 0.5:
            continue

        representative = intersection.representative_point()
        district_name = None
        district_source_id = None
        for county_name, county_geometry, county_id in candidate_counties:
            if county_geometry.covers(representative):
                district_name = county_name
                district_source_id = county_id
                break

        zones.append(
            {
                "type": "Feature",
                "properties": {
                    "zoneId": f'overture-locality:{feature.get("id")}',
                    "label": name,
                    "district": district_name,
                    "sourceDivisionId": feature.get("id"),
                    "sourceDistrictId": district_source_id,
                    "sourceMode": "public-map-division",
                    "boundaryMeaning": "Overture locality polygon clipped to the Daegu administrative boundary; SGIS official boundary replacement pending",
                    "labelLon": round(float(representative.x), 8),
                    "labelLat": round(float(representative.y), 8),
                    "quality": "public-map",
                },
                "geometry": mapping(intersection),
            }
        )

    zones.sort(
        key=lambda feature: (
            feature["properties"].get("district") or "",
            feature["properties"]["label"],
            feature["properties"]["zoneId"],
        )
    )

    retrieved_at = args.retrieved_at or utc_now()

    anchor_doc = {
        "schemaVersion": 1,
        "retrievedAt": retrieved_at,
        "geography": "대구광역시",
        "source": {
            "provider": "Overture Maps Foundation",
            "theme": "places",
            "inputMode": "bbox download clipped to committed Daegu boundary",
            "quality": "public-map",
            "limitations": [
                "공식 시설대장이 아니라 공개 지도 POI snapshot임",
                "학교·병원·사업체 수와 규모는 공식 원천으로 추후 보강해야 함",
                "capacity가 null인 시설은 접근성/밀도 신호에만 사용하고 수요량으로 해석하지 않음",
            ],
        },
        "normalization": {
            "minConfidence": args.min_confidence,
            "anchorCategoryGroups": {
                group: sorted(categories)
                for group, categories in ANCHOR_CATEGORY_GROUPS.items()
            },
        },
        "coverage": {
            "anchorCount": len(anchors),
            "countsByType": dict(sorted(anchor_counts.items())),
            "skippedOutsideDaegu": skipped_outside,
            "skippedBelowConfidence": skipped_confidence,
        },
        "records": anchors,
    }

    zone_doc = {
        "type": "FeatureCollection",
        "name": "LocalTwin Daegu citywide analysis zones",
        "metadata": {
            "retrievedAt": retrieved_at,
            "sourceProvider": "Overture Maps Foundation",
            "sourceTheme": "divisions / division_area",
            "sourceMode": "public-map-division",
            "quality": "public-map",
            "districtCount": len(candidate_counties),
            "zoneCount": len(zones),
            "limitation": "대구 전역 P1 분석단위용 공개지도 경계이며 SGIS 공식 읍면동 경계로 교체 가능한 임시 canonical zone",
        },
        "features": zones,
    }

    args.anchors_output.parent.mkdir(parents=True, exist_ok=True)
    args.zones_output.parent.mkdir(parents=True, exist_ok=True)
    args.anchors_output.write_text(
        json.dumps(anchor_doc, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    args.zones_output.write_text(
        json.dumps(zone_doc, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )

    print(
        json.dumps(
            {
                "anchors": len(anchors),
                "anchorsByType": dict(sorted(anchor_counts.items())),
                "districts": len(candidate_counties),
                "zones": len(zones),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
