"""Build LocalTwin map-derived commercial corridors from real OSM geometry.

The output is intentionally labelled modelled-map-derived. It uses actual OSM
road/market geometry, but it is not an official SEMAS commercial-area boundary.
"""
from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import LineString, Point, mapping
from shapely.ops import transform, unary_union

OUT = Path("public/data/corridor_zones.geojson")
NOMINATIM = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "LocalTwin-Daegu/0.2 (competition prototype; contact via GitHub sionchu/daegu-local-twin)"
WGS_TO_UTM = Transformer.from_crs("EPSG:4326", "EPSG:32652", always_xy=True)
UTM_TO_WGS = Transformer.from_crs("EPSG:32652", "EPSG:4326", always_xy=True)

ZONES = [
    {
        "zoneId": "dongseongro",
        "label": "동성로",
        "memberCellIds": ["hex-dongseongro-01", "hex-dongseongro-02"],
        "queries": ["동성로 대구 중구"],
        "center": [128.6009, 35.8715],
        "clipRadiusM": 760,
        "bufferM": 145,
    },
    {
        "zoneId": "gyodong",
        "label": "교동",
        "memberCellIds": ["hex-gyodong-01", "hex-gyodong-02"],
        "queries": ["교동길 대구 중구", "경상감영길 대구 중구"],
        "center": [128.5945, 35.87305],
        "clipRadiusM": 520,
        "bufferM": 82,
    },
    {
        "zoneId": "buksungro",
        "label": "북성로",
        "memberCellIds": ["hex-buksungro-01", "hex-buksungro-02"],
        "queries": ["북성로 대구 중구"],
        "center": [128.58655, 35.87715],
        "clipRadiusM": 760,
        "bufferM": 130,
    },
    {
        "zoneId": "jungangro",
        "label": "중앙로",
        "memberCellIds": ["hex-jungang-01"],
        "queries": ["중앙대로 대구 중구"],
        "center": [128.5996, 35.8678],
        "clipRadiusM": 480,
        "bufferM": 115,
    },
    {
        "zoneId": "seomun",
        "label": "서문시장",
        "memberCellIds": ["hex-seomun-01"],
        "queries": ["큰장로 대구 중구", "달성로 대구 중구", "서문시장 대구 중구"],
        "center": [128.5862, 35.8718],
        "clipRadiusM": 430,
        "bufferM": 105,
    },
]


def metric(geom):
    return transform(WGS_TO_UTM.transform, geom)


def geographic(geom):
    return transform(UTM_TO_WGS.transform, geom)


def search(query: str) -> list[dict]:
    params = urllib.parse.urlencode(
        {"format": "jsonv2", "polygon_geojson": "1", "limit": "10", "q": query}
    )
    request = urllib.request.Request(
        f"{NOMINATIM}?{params}",
        headers={"User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.load(response)
    time.sleep(1.1)
    return result


def geometry_from_results(results: list[dict]):
    parts = []
    source_ids = []
    source_names = []
    for item in results:
        geo = item.get("geojson") or {}
        gtype = geo.get("type")
        coords = geo.get("coordinates")
        if gtype == "LineString" and coords and len(coords) >= 2:
            parts.append(LineString(coords))
        elif gtype == "Point" and coords and len(coords) == 2:
            parts.append(Point(coords))
        else:
            continue
        source_ids.append(f'{item.get("osm_type")}:{item.get("osm_id")}')
        if item.get("display_name"):
            source_names.append(str(item["display_name"]).split(",")[0])
    return parts, source_ids, source_names


def build_zone(zone: dict) -> dict:
    parts = []
    source_ids = []
    source_names = []
    for query in zone["queries"]:
        query_parts, ids, names = geometry_from_results(search(query))
        parts.extend(query_parts)
        source_ids.extend(ids)
        source_names.extend(names)

    if not parts:
        raise RuntimeError(f'No OSM geometry for {zone["zoneId"]}')

    clip = metric(Point(*zone["center"])).buffer(zone["clipRadiusM"])
    clipped = [metric(part).intersection(clip) for part in parts]
    clipped = [part for part in clipped if not part.is_empty]
    if not clipped:
        raise RuntimeError(f'No OSM geometry intersects {zone["zoneId"]} clip')

    # Buffer the real road/market geometry in meters. The buffer is a model
    # corridor width, while the underlying centerlines/points are real map data.
    corridor = unary_union(clipped).buffer(
        zone["bufferM"],
        cap_style="round",
        join_style="round",
    ).intersection(clip)

    geom = geographic(corridor)
    return {
        "type": "Feature",
        "properties": {
            "zoneId": zone["zoneId"],
            "label": zone["label"],
            "memberCellIds": zone["memberCellIds"],
            "sourceMode": "modelled-map-derived",
            "boundaryMeaning": "실제 지도 도로/시장 geometry 기반 분석권역이며 공식 상권 경계가 아님",
            "sourceProvider": "OpenStreetMap contributors",
            "sourceUrl": "https://www.openstreetmap.org/",
            "queries": zone["queries"],
            "sourceFeatureNames": sorted(set(source_names)),
            "sourceOsmIds": sorted(set(source_ids)),
            "bufferMeters": zone["bufferM"],
        },
        "geometry": mapping(geom),
    }


def main() -> int:
    features = [build_zone(zone) for zone in ZONES]
    payload = {
        "type": "FeatureCollection",
        "name": "LocalTwin Daegu map-derived analysis corridors",
        "metadata": {
            "retrievedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "sourceProvider": "OpenStreetMap contributors",
            "sourceMode": "modelled-map-derived",
            "license": "ODbL",
            "limitation": "실제 OSM 도로/시장 geometry를 buffer한 분석 corridor이며 SEMAS 공식 상권영역 polygon이 아니다.",
            "replacementPath": "SEMAS storeZone coords polygon when an approved service key is available",
        },
        "features": features,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({"features": len(features), "output": str(OUT)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
