"""Normalize the official SGIS administrative-dong boundary snapshot.

The crawl/download step is intentionally separate from this adapter.  The
official ZIP is downloaded from data.go.kr, then this script converts the
``bnd_dong`` Shapefile from EPSG:5179 to RFC 7946 GeoJSON coordinates
(EPSG:4326/WGS84) and keeps only the official ADM_CD prefix for Daegu Jung-gu.

No corridor label is used here.  The only spatial relationship with
LocalTwin cells is tested separately by ``test_refresh_admin_dong_boundaries``.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

DATASET_ID = "15129688"
SOURCE_URL = f"https://www.data.go.kr/data/{DATASET_ID}/fileData.do"
DEFAULT_DATASET_VERSION = "2025-06-30"
DEFAULT_SOURCE_CRS = "EPSG:5179"
TARGET_CRS = "EPSG:4326"
DEFAULT_CODE_PREFIX = "2201"
TARGET_GEOGRAPHY = "대구광역시 중구"
OUTPUT_NAME = "daegu-jung-gu-administrative-dong-boundaries"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Normalize the official SGIS administrative-dong boundary Shapefile."
    )
    parser.add_argument(
        "--input",
        type=Path,
        required=True,
        help="Official bnd_dong Shapefile or an already-WGS84 GeoJSON export.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("public/data/admin_dong_boundaries.geojson"),
    )
    parser.add_argument("--dataset-version", default=DEFAULT_DATASET_VERSION)
    parser.add_argument("--source-crs", default=DEFAULT_SOURCE_CRS)
    parser.add_argument(
        "--code-prefix",
        default=DEFAULT_CODE_PREFIX,
        help="Official SGIS ADM_CD prefix for the target administrative district.",
    )
    parser.add_argument("--source-sha256", required=True)
    parser.add_argument("--retrieved-at")
    return parser.parse_args()


def retrieved_at_or_now(value: str | None) -> str:
    if value:
        return value
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def clean_source_value(value: Any) -> str:
    """Return an official text/code field without changing its semantic value."""

    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def feature_properties(properties: dict[str, Any]) -> tuple[str, str, str]:
    """Read the SGIS source fields while accepting normalized test fixtures."""

    code = clean_source_value(properties.get("ADM_CD", properties.get("officialCode")))
    name = clean_source_value(properties.get("ADM_NM", properties.get("officialName")))
    base_date = clean_source_value(properties.get("BASE_DATE", properties.get("sourceBaseDate")))
    if not code or not name:
        raise ValueError("Every selected feature must contain ADM_CD and ADM_NM.")
    return code, name, base_date


def normalized_feature(feature: dict[str, Any], *, code_prefix: str) -> dict[str, Any] | None:
    properties = dict(feature.get("properties") or {})
    code, name, base_date = feature_properties(properties)
    if not code.startswith(code_prefix):
        return None

    geometry = feature.get("geometry")
    if not geometry or geometry.get("type") not in {"Polygon", "MultiPolygon"}:
        raise ValueError(f"Unsupported or empty geometry for ADM_CD {code}.")

    # Keep both the normalized aliases and the exact official source fields.
    return {
        "type": "Feature",
        "properties": {
            "officialCode": code,
            "officialName": name,
            "sourceFields": {
                "BASE_DATE": base_date,
                "ADM_CD": code,
                "ADM_NM": name,
            },
        },
        "geometry": geometry,
    }


def normalize_features(
    features: Iterable[dict[str, Any]],
    *,
    code_prefix: str = DEFAULT_CODE_PREFIX,
    source_crs: str = DEFAULT_SOURCE_CRS,
    dataset_version: str = DEFAULT_DATASET_VERSION,
    source_sha256: str | None = None,
    retrieved_at: str | None = None,
    source_feature_count: int | None = None,
) -> dict[str, Any]:
    """Create the canonical WGS84 FeatureCollection from WGS84 features.

    Shapefile reprojection happens in ``read_source_features`` before this
    function is called.  Keeping this function geometry-library independent
    makes the deterministic cell-center test portable.
    """

    source_features = list(features)
    selected = [
        normalized
        for feature in source_features
        if (normalized := normalized_feature(feature, code_prefix=code_prefix)) is not None
    ]
    selected.sort(key=lambda feature: feature["properties"]["officialCode"])
    codes = [feature["properties"]["officialCode"] for feature in selected]
    if len(codes) != len(set(codes)):
        raise ValueError("Selected official ADM_CD values must be unique.")
    if not selected:
        raise ValueError(f"No official features matched ADM_CD prefix {code_prefix!r}.")

    return {
        "type": "FeatureCollection",
        "name": OUTPUT_NAME,
        "coordinateReferenceSystem": f"{TARGET_CRS} (WGS84; RFC 7946 coordinates)",
        "source": {
            "provider": "국가데이터처",
            "datasetId": DATASET_ID,
            "sourceUrl": SOURCE_URL,
            "datasetVersion": dataset_version,
            "sourceCrs": source_crs,
            "targetCrs": TARGET_CRS,
            "sourceSha256": source_sha256,
            "retrievedAt": retrieved_at_or_now(retrieved_at),
            "filter": {"field": "ADM_CD", "prefix": code_prefix, "geography": TARGET_GEOGRAPHY},
            "sourceFeatureCount": (
                source_feature_count if source_feature_count is not None else len(source_features)
            ),
            "selectedFeatureCount": len(selected),
        },
        "limitations": [
            "공식 SGIS 행정동 경계의 2025-06-30 기준 snapshot이며 실시간 경계가 아님",
            "공식 원본의 ADM_CD와 ADM_NM을 보존하고 EPSG:5179 geometry만 EPSG:4326으로 변환함",
            "동성로·교동·북성로 같은 corridor label은 행정동으로 변환하거나 하드코딩하지 않음",
        ],
        "features": selected,
    }


def read_source_features(
    input_path: Path,
    *,
    source_crs: str,
) -> tuple[list[dict[str, Any]], int, str]:
    """Read a source Shapefile or already-WGS84 GeoJSON.

    GeoPandas is imported only for the Shapefile path because it is an ingest
    environment dependency, not a runtime dependency of the LocalTwin app.
    """

    if input_path.suffix.lower() in {".geojson", ".json"}:
        document = json.loads(input_path.read_text(encoding="utf-8"))
        if document.get("type") != "FeatureCollection":
            raise ValueError("GeoJSON input must be a FeatureCollection.")
        input_crs = (document.get("source") or {}).get("sourceCrs") or TARGET_CRS
        if input_crs != TARGET_CRS:
            raise ValueError(
                "GeoJSON input must already use EPSG:4326; use the official Shapefile for reprojection."
            )
        features = list(document.get("features") or [])
        return features, len(features), input_crs

    if input_path.suffix.lower() != ".shp":
        raise ValueError("--input must be a .shp, .geojson, or .json file.")

    try:
        import geopandas as gpd
        from shapely.geometry import mapping
    except ImportError as exc:  # pragma: no cover - only reached in a missing ingest environment
        raise RuntimeError("Shapefile normalization requires geopandas and shapely.") from exc

    frame = gpd.read_file(input_path)
    required = {"BASE_DATE", "ADM_CD", "ADM_NM", "geometry"}
    missing = required.difference(frame.columns)
    if missing:
        raise ValueError(f"Official Shapefile is missing fields: {sorted(missing)}")
    if frame.crs is None:
        raise ValueError("Official Shapefile has no CRS metadata.")

    detected_epsg = frame.crs.to_epsg()
    detected_source_crs = f"EPSG:{detected_epsg}" if detected_epsg else source_crs
    if detected_source_crs.upper() != source_crs.upper():
        raise ValueError(
            f"Official Shapefile CRS is {detected_source_crs}, expected {source_crs}."
        )

    frame = frame.to_crs(TARGET_CRS)
    features: list[dict[str, Any]] = []
    for row in frame.itertuples(index=False):
        properties = {
            "BASE_DATE": getattr(row, "BASE_DATE"),
            "ADM_CD": getattr(row, "ADM_CD"),
            "ADM_NM": getattr(row, "ADM_NM"),
        }
        features.append(
            {
                "type": "Feature",
                "properties": properties,
                "geometry": mapping(getattr(row, "geometry")),
            }
        )
    return features, len(frame), detected_source_crs


def main() -> int:
    args = parse_args()
    if not args.input.exists():
        raise SystemExit(f"input file not found: {args.input}")

    features, source_feature_count, detected_crs = read_source_features(
        args.input,
        source_crs=args.source_crs,
    )
    snapshot = normalize_features(
        features,
        code_prefix=args.code_prefix,
        source_crs=detected_crs,
        dataset_version=args.dataset_version,
        source_sha256=args.source_sha256,
        retrieved_at=args.retrieved_at,
        source_feature_count=source_feature_count,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2, separators=(",", ": ")) + "\n",
        encoding="utf-8",
    )
    print(
        f"wrote {len(snapshot['features'])} official administrative-dong boundaries "
        f"from {source_feature_count} source features to {args.output}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
