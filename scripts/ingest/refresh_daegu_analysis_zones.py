"""Build the canonical Daegu-wide analysis zones from official SGIS admin-dong boundaries."""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DATASET_ID = "15129688"
SOURCE_URL = f"https://www.data.go.kr/data/{DATASET_ID}/fileData.do"
DATASET_VERSION = "2025-06-30"
SOURCE_CRS = "EPSG:5179"
TARGET_CRS = "EPSG:4326"
DAEGU_PREFIX = "22"

DISTRICT_BY_PREFIX = {
    "2201": "중구",
    "2202": "동구",
    "2203": "서구",
    "2204": "남구",
    "2205": "북구",
    "2206": "수성구",
    "2207": "달서구",
    "2251": "달성군",
    "2252": "군위군",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("public/data/daegu_analysis_zones.geojson"),
    )
    parser.add_argument("--source-sha256", required=True)
    parser.add_argument("--retrieved-at")
    return parser.parse_args()


def retrieved_at(value: str | None) -> str:
    if value:
        return value
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def clean(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def main() -> int:
    args = parse_args()
    if not args.input.exists():
        raise SystemExit(f"input not found: {args.input}")

    try:
        import geopandas as gpd
        from shapely.geometry import mapping
    except ImportError as exc:
        raise SystemExit("This ingest adapter requires geopandas and shapely.") from exc

    frame = gpd.read_file(args.input)
    required = {"BASE_DATE", "ADM_CD", "ADM_NM", "geometry"}
    missing = required.difference(frame.columns)
    if missing:
        raise ValueError(f"SGIS Shapefile missing fields: {sorted(missing)}")
    if frame.crs is None or frame.crs.to_epsg() != 5179:
        raise ValueError(f"Expected EPSG:5179, got {frame.crs}")

    frame["ADM_CD"] = frame["ADM_CD"].map(clean)
    frame["ADM_NM"] = frame["ADM_NM"].map(clean)
    selected = frame[frame["ADM_CD"].str.startswith(DAEGU_PREFIX)].copy()
    if len(selected) != 150:
        raise ValueError(f"Expected 150 Daegu admin-dong polygons, got {len(selected)}")

    selected = selected.to_crs(TARGET_CRS)
    features = []
    district_counts: dict[str, int] = {}
    for row in selected.itertuples(index=False):
        code = clean(row.ADM_CD)
        name = clean(row.ADM_NM)
        prefix = code[:4]
        district = DISTRICT_BY_PREFIX.get(prefix)
        if not district:
            raise ValueError(f"Unknown Daegu district prefix {prefix} for {code}")
        district_counts[district] = district_counts.get(district, 0) + 1

        geometry = row.geometry
        label_point = geometry.representative_point()
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "zoneId": f"sgis-dong:{code}",
                    "label": name,
                    "district": district,
                    "officialCode": code,
                    "sourceMode": "official-snapshot",
                    "quality": "official",
                    "boundaryMeaning": "SGIS 2025Q2 공식 행정동 경계",
                    "labelLon": round(float(label_point.x), 7),
                    "labelLat": round(float(label_point.y), 7),
                },
                "geometry": mapping(geometry),
            }
        )

    features.sort(key=lambda feature: feature["properties"]["officialCode"])
    payload = {
        "type": "FeatureCollection",
        "name": "LocalTwin Daegu official administrative-dong analysis zones",
        "metadata": {
            "retrievedAt": retrieved_at(args.retrieved_at),
            "sourceProvider": "국가데이터처 / SGIS",
            "sourceDatasetId": DATASET_ID,
            "sourceUrl": SOURCE_URL,
            "sourceVersion": DATASET_VERSION,
            "sourceCrs": SOURCE_CRS,
            "targetCrs": TARGET_CRS,
            "sourceSha256": args.source_sha256,
            "sourceMode": "official-snapshot",
            "quality": "official",
            "districtCount": len(district_counts),
            "zoneCount": len(features),
            "districtCounts": dict(sorted(district_counts.items())),
            "limitation": "2025-06-30 기준 행정동 경계 snapshot이며 상권 자체의 경계는 아님",
        },
        "features": features,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "zones": len(features),
                "districts": district_counts,
                "output": str(args.output),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
