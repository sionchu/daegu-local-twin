"""Derive LocalTwin market evidence from merged official/public snapshots.

This integration is deterministic and network-free.  It replaces the remaining demo
market inputs in opportunity_cells.json with:
- station-to-cell mobility demand from official Daegu Metro business-hour ridership;
- NAVER DataLab relative-interest mappings for exact corridor concepts;
- official REB per-square-meter rent/vacancy with exact mappings preserved;
- distance-decay rent/vacancy benchmarks for cells without an exact official-area label;
- a modelled neighboring-anchor spillover index.

No value produced here is observed storefront footfall or a business-success probability.
"""

from __future__ import annotations

import argparse
import json
import math
from copy import deepcopy
from pathlib import Path
from typing import Any, Mapping, Sequence


TRANSIT_LAMBDA_METERS = 450.0
SPILLOVER_LAMBDA_METERS = 350.0
RENT_INTERPOLATION_LAMBDA_METERS = 900.0
ANCHOR_WEIGHTS = {"transit": 0.55, "buzz": 0.25, "poi": 0.20}

BUZZ_PREFIX_MAP = {
    "hex-dongseongro-": "동성로",
    "hex-gyodong-": "교동",
    "hex-buksungro-": "북성로",
}

RENT_CELL_MAP = {
    "hex-dongseongro-01": {
        "officialArea": "동성로중심",
        "method": "exact shared place-name token: 동성로",
    },
    "hex-dongseongro-02": {
        "officialArea": "동성로중심",
        "method": "exact shared place-name token: 동성로",
    },
    "hex-seomun-01": {
        "officialArea": "서문시장/청라언덕",
        "method": "exact shared place-name token: 서문시장",
    },
}


def build_rent_area_anchors(
    cells: Sequence[Mapping[str, Any]],
    rent_by_area: Mapping[str, Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Build one model anchor per exactly mapped official REB commercial area.

    The anchor coordinate is the centroid of LocalTwin cells that have an explicit
    place-name mapping to that official area. It is only a modelling coordinate for
    interpolation; it is not an official R-ONE commercial-area centroid.
    """

    grouped: dict[str, list[Mapping[str, float]]] = {}
    for cell in cells:
        mapping = RENT_CELL_MAP.get(str(cell["cellId"]))
        if mapping is None:
            continue
        area = str(mapping["officialArea"])
        if area not in rent_by_area:
            raise ValueError(f"official rent area missing: {area}")
        grouped.setdefault(area, []).append(cell["center"])

    anchors: list[dict[str, Any]] = []
    for area in sorted(grouped):
        centers = grouped[area]
        anchors.append(
            {
                "officialArea": area,
                "center": {
                    "lat": sum(float(item["lat"]) for item in centers) / len(centers),
                    "lon": sum(float(item["lon"]) for item in centers) / len(centers),
                },
                "sourceCellIds": [
                    str(cell["cellId"])
                    for cell in cells
                    if RENT_CELL_MAP.get(str(cell["cellId"]), {}).get("officialArea") == area
                ],
                "record": rent_by_area[area],
            }
        )
    if len(anchors) < 2:
        raise ValueError("rent interpolation requires at least two exact official-area anchors")
    return anchors


def interpolate_rent_benchmark(
    center: Mapping[str, float],
    anchors: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    contributions: list[dict[str, Any]] = []
    total_weight = 0.0
    weighted_rent = 0.0
    weighted_vacancy = 0.0

    for anchor in anchors:
        distance = distance_meters(center, anchor["center"])
        weight = decay(distance, RENT_INTERPOLATION_LAMBDA_METERS)
        record = anchor["record"]
        rent_value = float(record["localTwin"]["rentPerSquareMeter"]["value"])
        vacancy_value = float(record["localTwin"]["vacancy"]["value"])
        total_weight += weight
        weighted_rent += rent_value * weight
        weighted_vacancy += vacancy_value * weight
        contributions.append(
            {
                "officialArea": anchor["officialArea"],
                "sourceCellIds": anchor["sourceCellIds"],
                "distanceMeters": round(distance, 1),
                "rawWeight": round(weight, 6),
                "rentKrwPerSqm": int(rent_value),
                "vacancyPct": vacancy_value,
            }
        )

    if total_weight <= 0:
        raise ValueError("rent interpolation produced zero total weight")

    for contribution in contributions:
        contribution["normalizedWeight"] = round(
            float(contribution["rawWeight"]) / total_weight,
            6,
        )

    return {
        # Keep the benchmark visually honest: the official inputs themselves are
        # reported in 100 KRW/㎡ increments, so the modelled blend is rounded likewise.
        "rentKrwPerSqm": int(round((weighted_rent / total_weight) / 100.0) * 100),
        "vacancyPct": round(weighted_vacancy / total_weight, 1),
        "contributions": contributions,
    }


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def distance_meters(a: Mapping[str, float], b: Mapping[str, float]) -> float:
    """Great-circle distance using the haversine formula."""

    earth_radius = 6_371_008.8
    lat1 = math.radians(float(a["lat"]))
    lat2 = math.radians(float(b["lat"]))
    delta_lat = lat2 - lat1
    delta_lon = math.radians(float(b["lon"]) - float(a["lon"]))
    hav = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    )
    return 2 * earth_radius * math.asin(min(1.0, math.sqrt(hav)))


def decay(distance_m: float, lambda_m: float) -> float:
    if distance_m < 0 or lambda_m <= 0:
        raise ValueError("distance must be non-negative and lambda positive")
    return math.exp(-distance_m / lambda_m)


def normalize_metric(values: Sequence[float | None], value: float | None) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    available = [item for item in values if item is not None and math.isfinite(item)]
    if not available:
        return None
    minimum = min(available)
    maximum = max(available)
    if maximum == minimum:
        return 50.0
    return (value - minimum) / (maximum - minimum) * 100.0


def buzz_topic_for_cell(cell_id: str) -> str | None:
    for prefix, topic in BUZZ_PREFIX_MAP.items():
        if cell_id.startswith(prefix):
            return topic
    return None


def _index_by(items: Sequence[Mapping[str, Any]], key: str) -> dict[str, Mapping[str, Any]]:
    result: dict[str, Mapping[str, Any]] = {}
    for item in items:
        value = str(item[key])
        if value in result:
            raise ValueError(f"duplicate {key}: {value}")
        result[value] = item
    return result


def derive_market_evidence(
    cells: Sequence[Mapping[str, Any]],
    transit: Mapping[str, Any],
    station_locations: Mapping[str, Any],
    buzz: Mapping[str, Any],
    rent: Mapping[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    updated = deepcopy(list(cells))

    if transit.get("mode") != "official-snapshot":
        raise ValueError("transit input must be an official-snapshot")
    if rent.get("mode") != "official-snapshot":
        raise ValueError("rent input must be an official-snapshot")
    if buzz.get("provider") != "NAVER DataLab" or buzz.get("mode") != "public-snapshot":
        raise ValueError("buzz input must be the NAVER public-snapshot")

    transit_by_station = _index_by(transit["records"], "station")
    locations_by_station = _index_by(station_locations["records"], "station")
    if set(transit_by_station) != set(locations_by_station):
        raise ValueError(
            "station location names must exactly match transit station names: "
            f"transit={sorted(transit_by_station)} locations={sorted(locations_by_station)}"
        )

    buzz_by_area = _index_by(buzz["records"], "area")
    rent_by_area = {
        record["geography"]["regionName"]: record
        for record in rent["records"]
    }
    rent_area_anchors = build_rent_area_anchors(updated, rent_by_area)

    records: list[dict[str, Any]] = []

    # First pass: official/public inputs -> cell-level modelled evidence.
    for cell in updated:
        center = {"lat": float(cell["center"]["lat"]), "lon": float(cell["center"]["lon"])}

        station_contributions: list[dict[str, Any]] = []
        transit_total = 0.0
        for station_name in sorted(transit_by_station):
            station = transit_by_station[station_name]
            location = locations_by_station[station_name]
            station_point = {
                "lat": float(location["latitude"]),
                "lon": float(location["longitude"]),
            }
            distance = distance_meters(center, station_point)
            factor = decay(distance, TRANSIT_LAMBDA_METERS)
            station_demand = float(station["averageDailyBusinessHours"])
            contribution = station_demand * factor
            transit_total += contribution
            station_contributions.append(
                {
                    "station": station_name,
                    "stationNumbers": station["stationNumbers"],
                    "averageDailyBusinessHours": station_demand,
                    "distanceMeters": round(distance, 1),
                    "decay": round(factor, 6),
                    "contribution": round(contribution, 1),
                }
            )

        topic = buzz_topic_for_cell(cell["cellId"])
        buzz_record = buzz_by_area.get(topic) if topic else None

        rent_mapping = RENT_CELL_MAP.get(cell["cellId"])
        rent_record = None
        rent_interpolation = None
        if rent_mapping is not None:
            rent_record = rent_by_area.get(rent_mapping["officialArea"])
            if rent_record is None:
                raise ValueError(
                    f"official rent area missing: {rent_mapping['officialArea']}"
                )
        else:
            rent_interpolation = interpolate_rent_benchmark(center, rent_area_anchors)

        cell["transitDemand"] = round(transit_total, 1)
        cell["observedFootfall"] = None
        cell["footfallSource"] = (
            "관측 보행량 없음 · 재무 시뮬레이션은 공식 역 승하차를 거리감쇠한 이동수요 proxy 사용"
        )
        cell["buzzLevel"] = (
            round(float(buzz_record["recentMean"]), 5) if buzz_record else None
        )
        cell["buzzMomentum"] = (
            None
            if buzz_record is None or buzz_record["momentum"] is None
            else round(float(buzz_record["momentum"]), 6)
        )

        if rent_record is not None:
            cell["rentBenchmarkKrwPerSqm"] = int(
                rent_record["localTwin"]["rentPerSquareMeter"]["value"]
            )
            cell["vacancyBenchmark"] = float(rent_record["localTwin"]["vacancy"]["value"])
        elif rent_interpolation is not None:
            cell["rentBenchmarkKrwPerSqm"] = int(rent_interpolation["rentKrwPerSqm"])
            cell["vacancyBenchmark"] = float(rent_interpolation["vacancyPct"])
        else:
            raise ValueError(f"no rent evidence path for {cell['cellId']}")
        cell.pop("rentBenchmark", None)

        # Remove source IDs that previously pointed at demo cell values, then add only
        # sources actually used for this cell.
        provenance_ids = [
            item
            for item in cell.get("provenanceIds", [])
            if item not in {"transit", "transit-station-locations", "buzz", "rent-benchmark", "spillover-model", "cell-market-evidence"}
        ]
        provenance_ids.extend(["transit", "transit-station-locations", "spillover-model", "cell-market-evidence"])
        if buzz_record is not None:
            provenance_ids.append("buzz")
        if rent_record is not None or rent_interpolation is not None:
            provenance_ids.append("rent-benchmark")
        cell["provenanceIds"] = list(dict.fromkeys(provenance_ids))

        records.append(
            {
                "cellId": cell["cellId"],
                "label": cell["label"],
                "transit": {
                    "mode": "modelled",
                    "formula": (
                        "sum(averageDailyBusinessHours(station) * "
                        "exp(-distance(cell, station)/450m))"
                    ),
                    "lambdaMeters": TRANSIT_LAMBDA_METERS,
                    "distanceMethod": "haversine",
                    "value": cell["transitDemand"],
                    "unit": "station-ridership demand proxy / business day",
                    "stationContributions": station_contributions,
                },
                "buzz": (
                    {
                        "mode": "modelled mapping of public relative-interest snapshot",
                        "topic": topic,
                        "recentMean": cell["buzzLevel"],
                        "momentum": cell["buzzMomentum"],
                        "mappingMethod": "exact corridor concept by canonical cell-id prefix",
                    }
                    if buzz_record is not None
                    else {
                        "mode": "unavailable",
                        "topic": None,
                        "recentMean": None,
                        "momentum": None,
                        "reason": "no exact NAVER corridor concept mapping for this cell",
                    }
                ),
                "rent": (
                    {
                        "mode": "modelled mapping of official-area benchmark",
                        "officialArea": rent_mapping["officialArea"],
                        "mappingMethod": rent_mapping["method"],
                        "rentKrwPerSqm": cell["rentBenchmarkKrwPerSqm"],
                        "vacancyPct": cell["vacancyBenchmark"],
                    }
                    if rent_record is not None
                    else {
                        "mode": "modelled spatial blend of official-area benchmarks",
                        "officialArea": None,
                        "mappingMethod": (
                            "distance-decay blend across exact-mapped official R-ONE "
                            f"area anchors; lambda={int(RENT_INTERPOLATION_LAMBDA_METERS)}m"
                        ),
                        "rentKrwPerSqm": cell["rentBenchmarkKrwPerSqm"],
                        "vacancyPct": cell["vacancyBenchmark"],
                        "sourceOfficialAreas": rent_interpolation["contributions"],
                    }
                ),
            }
        )

    # Second pass: build anchor strengths from non-demo inputs.
    transit_values = [float(cell["transitDemand"]) for cell in updated]
    buzz_values = [
        None if cell["buzzLevel"] is None else float(cell["buzzLevel"])
        for cell in updated
    ]
    poi_values = [float(cell["poiCount"]) for cell in updated]

    for cell, record in zip(updated, records, strict=True):
        components = {
            "transit": normalize_metric(transit_values, float(cell["transitDemand"])),
            "buzz": normalize_metric(
                buzz_values,
                None if cell["buzzLevel"] is None else float(cell["buzzLevel"]),
            ),
            "poi": normalize_metric(poi_values, float(cell["poiCount"])),
        }
        available_weight = sum(
            ANCHOR_WEIGHTS[name]
            for name, value in components.items()
            if value is not None
        )
        if available_weight == 0:
            raise ValueError(f"no anchor components for {cell['cellId']}")
        anchor_strength = sum(
            0.0
            if value is None
            else value * ANCHOR_WEIGHTS[name] / available_weight
            for name, value in components.items()
        )
        cell["anchorStrength"] = round(anchor_strength, 2)
        record["anchor"] = {
            "mode": "modelled",
            "weights": ANCHOR_WEIGHTS,
            "components": {
                name: None if value is None else round(value, 2)
                for name, value in components.items()
            },
            "availableWeightRenormalized": round(available_weight, 2),
            "strength": cell["anchorStrength"],
        }

    # Third pass: neighboring anchor spillover, self excluded.
    raw_spillover: list[float] = []
    for target in updated:
        target_center = {
            "lat": float(target["center"]["lat"]),
            "lon": float(target["center"]["lon"]),
        }
        raw = 0.0
        contributions: list[dict[str, Any]] = []
        for anchor in updated:
            if anchor["cellId"] == target["cellId"]:
                continue
            anchor_center = {
                "lat": float(anchor["center"]["lat"]),
                "lon": float(anchor["center"]["lon"]),
            }
            distance = distance_meters(target_center, anchor_center)
            factor = decay(distance, SPILLOVER_LAMBDA_METERS)
            contribution = float(anchor["anchorStrength"]) * factor
            raw += contribution
            contributions.append(
                {
                    "fromCellId": anchor["cellId"],
                    "distanceMeters": round(distance, 1),
                    "decay": round(factor, 6),
                    "anchorStrength": anchor["anchorStrength"],
                    "contribution": round(contribution, 4),
                }
            )
        raw_spillover.append(raw)
        next(record for record in records if record["cellId"] == target["cellId"])[
            "spillover"
        ] = {
            "mode": "modelled",
            "formula": "sum(other anchorStrength * exp(-distance/350m)); min-max normalized",
            "lambdaMeters": SPILLOVER_LAMBDA_METERS,
            "selfExcluded": True,
            "raw": round(raw, 6),
            "contributions": contributions,
        }

    for cell, raw in zip(updated, raw_spillover, strict=True):
        score = normalize_metric(raw_spillover, raw)
        cell["spilloverScore"] = None if score is None else round(score, 2)
        cell["evidenceQuality"] = "modelled"
        record = next(item for item in records if item["cellId"] == cell["cellId"])
        record["spillover"]["score"] = cell["spilloverScore"]

    sidecar = {
        "mode": "modelled",
        "modelVersion": "cell-market-evidence-v2",
        "inputs": {
            "transit": {
                "datasetId": transit.get("datasetId"),
                "datasetVersion": transit.get("datasetVersion"),
                "sourceSha256": transit.get("sourceSha256"),
            },
            "stationLocations": {
                "coordinateSystem": station_locations.get("coordinateSystem"),
                "officialLocationDatasetReference": station_locations.get(
                    "officialLocationDatasetReference"
                ),
                "records": station_locations.get("records"),
            },
            "buzz": {
                "provider": buzz.get("provider"),
                "sourceDate": buzz.get("sourceDate"),
                "sourceSha256": buzz.get("sourceSha256"),
                "topics": buzz.get("query", {}).get("topics"),
            },
            "rent": {
                "datasetId": rent.get("datasetId"),
                "sourcePeriod": rent.get("sourcePeriod"),
                "commercialPropertyType": rent.get("commercialPropertyType"),
            },
        },
        "transitModel": {
            "lambdaMeters": TRANSIT_LAMBDA_METERS,
            "formula": (
                "TransitDemand(cell)=sum(station averageDailyBusinessHours * "
                "exp(-haversineDistance(cell,station)/lambda))"
            ),
            "meaning": "modelled station-ridership mobility proxy; not storefront footfall",
        },
        "buzzMapping": BUZZ_PREFIX_MAP,
        "rentMapping": RENT_CELL_MAP,
        "rentInterpolation": {
            "lambdaMeters": RENT_INTERPOLATION_LAMBDA_METERS,
            "anchorPolicy": (
                "one modelling anchor per exactly mapped official R-ONE area; "
                "anchor coordinate = centroid of exact-mapped LocalTwin cell centers"
            ),
            "anchors": [
                {
                    "officialArea": anchor["officialArea"],
                    "center": {
                        "lat": round(float(anchor["center"]["lat"]), 6),
                        "lon": round(float(anchor["center"]["lon"]), 6),
                    },
                    "sourceCellIds": anchor["sourceCellIds"],
                }
                for anchor in rent_area_anchors
            ],
        },
        "anchorModel": {
            "weights": ANCHOR_WEIGHTS,
            "missingMetricPolicy": "renormalize weights over available components",
        },
        "spilloverModel": {
            "lambdaMeters": SPILLOVER_LAMBDA_METERS,
            "formula": "sum(other anchorStrength * exp(-distance/350m)); min-max normalized",
            "meaning": "modelled neighboring-anchor context; not observed cross-visitation or causality",
        },
        "records": records,
        "limitations": [
            "역 승하차는 공식 통계지만 cell transitDemand는 거리감쇠로 파생한 modelled proxy입니다.",
            "관측된 점포 앞 보행량이 없으므로 observedFootfall은 모든 cell에서 null입니다.",
            "NAVER 값은 동일 비교기간에서 정규화된 상대 검색 관심도이며 절대 검색량·매출·감성이 아닙니다.",
            "REB 임대료는 공식 상권의 소규모 상가 1층 환산임대료(원/㎡) benchmark이며 점포 전체 월세가 아닙니다.",
            "정확히 연결되는 cell은 공식 REB 상권 benchmark를 그대로 사용하고, 나머지 cell은 정확매칭 상권 anchor 간 거리감쇠 보간값을 modelled benchmark로 사용합니다.",
            "보간 임대료/공실률은 점포 실제 호가·계약값이나 공식 cell-level 통계가 아닙니다.",
            "spilloverScore는 인접 anchor의 결정론적 공간지표이며 실제 교차방문이나 인과효과가 아닙니다.",
        ],
    }
    return updated, sidecar


def compact_cells(cells: Sequence[Mapping[str, Any]]) -> str:
    return (
        "[\n"
        + "\n".join(
            "  "
            + json.dumps(cell, ensure_ascii=False, separators=(",", ":"))
            + ("," if index < len(cells) - 1 else "")
            for index, cell in enumerate(cells)
        )
        + "\n]\n"
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cells", type=Path, default=Path("public/data/opportunity_cells.json"))
    parser.add_argument("--transit", type=Path, default=Path("public/data/transit.json"))
    parser.add_argument(
        "--station-locations",
        type=Path,
        default=Path("public/data/transit_station_locations.json"),
    )
    parser.add_argument("--buzz", type=Path, default=Path("public/data/buzz.json"))
    parser.add_argument("--rent", type=Path, default=Path("public/data/rent_benchmark.json"))
    parser.add_argument(
        "--output-cells",
        type=Path,
        default=Path("public/data/opportunity_cells.json"),
    )
    parser.add_argument(
        "--output-evidence",
        type=Path,
        default=Path("public/data/cell_market_evidence.json"),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    updated, sidecar = derive_market_evidence(
        load_json(args.cells),
        load_json(args.transit),
        load_json(args.station_locations),
        load_json(args.buzz),
        load_json(args.rent),
    )
    args.output_cells.write_text(compact_cells(updated), encoding="utf-8")
    args.output_evidence.write_text(
        json.dumps(sidecar, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "cells": len(updated),
                "observedFootfallNonNull": sum(
                    1 for cell in updated if cell["observedFootfall"] is not None
                ),
                "buzzMapped": sum(1 for cell in updated if cell["buzzLevel"] is not None),
                "rentMapped": sum(
                    1 for cell in updated if cell["rentBenchmarkKrwPerSqm"] is not None
                ),
                "outputCells": str(args.output_cells),
                "outputEvidence": str(args.output_evidence),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
