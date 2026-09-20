"""Normalize REB apartment-complex basic information into Daegu housing capacity.

The output keeps complete official district totals and only exact district+dong-name
links to SGIS administrative dongs. Partial zone links are audit evidence only and
must not be treated as complete zone household totals.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SOURCE_PROVIDER = "한국부동산원"
SOURCE_DATASET_ID = "15106861"
SOURCE_TITLE = "공동주택 단지 식별정보_기본정보"
SOURCE_URL = "https://www.data.go.kr/data/15106861/fileData.do"
SOURCE_VERSION = "2026-08-31"
PORTAL_REPORTED_ROWS = 44628
REQUIRED_COLUMNS = {
    "단지고유번호", "필지고유번호", "주소", "단지종류",
    "동수", "세대수", "사용승인일", "도로명주소",
}
def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument(
        "--zones",
        type=Path,
        default=Path("public/data/daegu_analysis_zones.geojson"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("public/data/housing_capacity.json"),
    )
    parser.add_argument("--retrieved-at")
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def decode_source(raw: bytes) -> tuple[str, str]:
    for encoding in ("utf-8-sig", "cp949", "euc-kr"):
        try:
            return raw.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    raise ValueError("unable to decode source as UTF-8-SIG/CP949/EUC-KR")
def integer(value: str | None) -> int:
    text = str(value or "").replace(",", "").strip()
    if not text:
        return 0
    try:
        return int(float(text))
    except ValueError as exc:
        raise ValueError(f"invalid integer value: {value!r}") from exc


def source_name(row: dict[str, str]) -> str:
    for key in ("단지명_공시가격", "단지명_건축물대장", "단지명_도로명주소"):
        value = (row.get(key) or "").strip()
        if value:
            return value
    return (row.get("단지고유번호") or "").strip()


def load_zone_lookup(path: Path) -> dict[tuple[str, str], str]:
    document = json.loads(path.read_text(encoding="utf-8"))
    lookup: dict[tuple[str, str], str] = {}
    for feature in document.get("features") or []:
        props = feature.get("properties") or {}
        district = str(props.get("district") or "").strip()
        label = str(props.get("label") or "").strip()
        zone_id = str(props.get("zoneId") or "").strip()
        if district and label and zone_id:
            lookup[(district, label)] = zone_id
    return lookup
def normalize(input_path: Path, zones_path: Path, retrieved_at: str) -> dict[str, Any]:
    raw = input_path.read_bytes()
    text, encoding = decode_source(raw)
    reader = csv.DictReader(text.splitlines())
    fieldnames = set(reader.fieldnames or [])
    missing = sorted(REQUIRED_COLUMNS - fieldnames)
    if missing:
        raise ValueError("missing required columns: " + ", ".join(missing))

    zone_lookup = load_zone_lookup(zones_path)
    district = defaultdict(lambda: {"complexRecords": 0, "households": 0})
    zone = defaultdict(lambda: {"complexRecords": 0, "households": 0})
    source_rows = 0
    daegu_rows = 0
    daegu_households = 0
    linked_rows = 0
    linked_households = 0

    for row in reader:
        source_rows += 1
        address = (row.get("주소") or "").strip()
        if not address.startswith("대구광역시"):
            continue
        parts = address.split()
        if len(parts) < 3:
            continue
        district_name, legal_dong = parts[1], parts[2]
        households = integer(row.get("세대수"))
        daegu_rows += 1
        daegu_households += households
        district[district_name]["complexRecords"] += 1
        district[district_name]["households"] += households
        zone_id = zone_lookup.get((district_name, legal_dong))
        if zone_id:
            linked_rows += 1
            linked_households += households
            zone[(zone_id, district_name, legal_dong)]["complexRecords"] += 1
            zone[(zone_id, district_name, legal_dong)]["households"] += households

    by_district = [
        {"district": name, **values}
        for name, values in sorted(district.items())
    ]
    exact_links = [
        {
            "zoneId": zone_id,
            "district": district_name,
            "label": label,
            "partialComplexRecords": values["complexRecords"],
            "partialHouseholds": values["households"],
            "linkQuality": "official-name-exact-partial",
        }
        for (zone_id, district_name, label), values in sorted(zone.items())
    ]

    return {
        "schemaVersion": 1,
        "generatedAt": retrieved_at,
        "source": {
            "provider": SOURCE_PROVIDER,
            "datasetId": SOURCE_DATASET_ID,
            "title": SOURCE_TITLE,
            "url": SOURCE_URL,
            "sourceVersion": SOURCE_VERSION,
            "retrievedAt": retrieved_at,
            "sourceSha256": sha256(input_path),
            "encoding": encoding,
            "portalReportedRowCount": PORTAL_REPORTED_ROWS,
            "sourceRecordCount": source_rows,
            "portalRowCountMatchesSource": source_rows == PORTAL_REPORTED_ROWS,
        },
        "coverage": {
            "daeguComplexRecords": daegu_rows,
            "daeguHouseholds": daegu_households,
            "districtCount": len(by_district),
            "exactNameLinkedComplexRecords": linked_rows,
            "exactNameLinkedHouseholds": linked_households,
            "exactNameLinkedZoneCount": len(exact_links),
            "rowCoveragePct": round(linked_rows / daegu_rows * 100, 2) if daegu_rows else 0,
            "householdCoveragePct": round(
                linked_households / daegu_households * 100, 2
            ) if daegu_households else 0,
        },
        "byDistrict": by_district,
        "exactNameLinkedZones": exact_links,
        "limitations": [
            "구·군 합계는 한국부동산원 공식 공동주택 세대수의 대구 전체 집계입니다.",
            "동 단위 값은 법정동명과 SGIS 행정동명이 구·군까지 정확히 일치한 단지만 포함한 부분집계입니다.",
            "법정동이 여러 행정동으로 분할되는 경우 임의 배분하지 않아 동 단위 커버리지가 불완전합니다.",
            "공동주택 세대수는 주민등록인구·생활인구·실거주인구를 의미하지 않습니다.",
            "부분연결 세대수는 상권잠재 점수나 주거생활권 최종판정에 사용하지 않습니다.",
            "공공데이터포털 화면의 전체 행 44,628과 실제 다운로드 원문 307,834행이 일치하지 않아 원문 SHA256과 실제 파싱 행수를 우선 기록합니다.",
        ],
    }


def main() -> int:
    args = parse_args()
    retrieved_at = args.retrieved_at or (
        datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    )
    document = normalize(args.input, args.zones, retrieved_at)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(document, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "output": str(args.output),
                "daeguComplexRecords": document["coverage"]["daeguComplexRecords"],
                "daeguHouseholds": document["coverage"]["daeguHouseholds"],
                "exactNameLinkedZoneCount": document["coverage"]["exactNameLinkedZoneCount"],
                "householdCoveragePct": document["coverage"]["householdCoveragePct"],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
