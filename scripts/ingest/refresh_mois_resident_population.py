"""Normalize MOIS monthly administrative-dong resident population for Daegu."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SOURCE_PROVIDER = "행정안전부"
SOURCE_DATASET_ID = "3033254"
SOURCE_TITLE = "지역별(행정동) 성별 주민등록 인구증감"
SOURCE_URL = "https://www.data.go.kr/data/3033254/fileData.do"
SOURCE_VERSION = "2026-08-31"
SOURCE_DOWNLOAD_ID = "FILE_000000007644766"
SOURCE_SHA256 = "33808E6A0DAF1F6923618727BCE9188EEBFF7F58B4EF4BBA06BDD033025FE233"
REQUIRED_COLUMNS = {
    "행정기관코드",
    "기준연월",
    "시도명",
    "시군구명",
    "읍면동명",
    "전체 전월인구수",
    "전월 남자인구수",
    "전월 여자인구수",
    "전체 당월인구수",
    "당월 남자인구수",
    "당월 여자인구수",
    "전체 인구증감",
    "남자 인구증감",
    "여자 인구증감",
}
BRANCH_OFFICE_PARENT = {
    ("달성군", "논공읍공단출장소"): ("달성군", "논공읍"),
    ("달성군", "다사읍서재출장소"): ("달성군", "다사읍"),
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
        default=Path("public/data/resident_population_dong.json"),
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


def integer(value: Any) -> int:
    text = str(value or "").replace(",", "").strip()
    if not text:
        return 0
    return int(text)


def normalize_label(value: Any) -> str:
    return re.sub(r"\s+", "", str(value or "").strip().replace(".", "·"))


def load_zones(path: Path) -> dict[tuple[str, str], dict[str, Any]]:
    document = json.loads(path.read_text(encoding="utf-8"))
    result: dict[tuple[str, str], dict[str, Any]] = {}
    for feature in document.get("features") or []:
        props = feature.get("properties") or {}
        district = str(props.get("district") or "").strip()
        label = str(props.get("label") or "").strip()
        zone_id = str(props.get("zoneId") or "").strip()
        if district and label and zone_id:
            result[(normalize_label(district), normalize_label(label))] = {
                "zoneId": zone_id,
                "district": district,
                "label": label,
            }
    return result


def population_values(row: dict[str, str]) -> dict[str, int]:
    values = {
        "previousPopulation": integer(row.get("전체 전월인구수")),
        "previousMale": integer(row.get("전월 남자인구수")),
        "previousFemale": integer(row.get("전월 여자인구수")),
        "population": integer(row.get("전체 당월인구수")),
        "male": integer(row.get("당월 남자인구수")),
        "female": integer(row.get("당월 여자인구수")),
        "populationChange": integer(row.get("전체 인구증감")),
        "maleChange": integer(row.get("남자 인구증감")),
        "femaleChange": integer(row.get("여자 인구증감")),
    }
    if values["population"] != values["male"] + values["female"]:
        raise ValueError("current population does not equal male + female")
    if values["previousPopulation"] != values["previousMale"] + values["previousFemale"]:
        raise ValueError("previous population does not equal male + female")
    if values["population"] - values["previousPopulation"] != values["populationChange"]:
        raise ValueError("population change does not match current - previous")
    return values


def normalize(
    input_path: Path,
    zones_path: Path,
    retrieved_at: str,
    *,
    expected_zone_count: int = 150,
) -> dict[str, Any]:
    raw = input_path.read_bytes()
    text, encoding = decode_source(raw)
    reader = csv.DictReader(text.splitlines())
    fields = set(reader.fieldnames or [])
    missing_columns = sorted(REQUIRED_COLUMNS - fields)
    if missing_columns:
        raise ValueError("missing required columns: " + ", ".join(missing_columns))

    zones = load_zones(zones_path)
    if len(zones) != expected_zone_count:
        raise ValueError(f"expected {expected_zone_count} zones, got {len(zones)}")

    aggregates: dict[str, dict[str, Any]] = {}
    source_rows = 0
    daegu_rows = 0
    direct_rows = 0
    branch_rows = 0
    branch_assignments: list[dict[str, Any]] = []
    source_months: set[str] = set()

    for row in reader:
        source_rows += 1
        if (row.get("시도명") or "").strip() != "대구광역시":
            continue
        daegu_rows += 1
        source_months.add((row.get("기준연월") or "").strip())
        district = (row.get("시군구명") or "").strip()
        label = (row.get("읍면동명") or "").strip()
        source_key = (district, label)
        target_key = source_key
        link_quality = "official-name-exact"
        if (
            normalize_label(district),
            normalize_label(label),
        ) not in zones:
            target_key = BRANCH_OFFICE_PARENT.get(source_key)  # type: ignore[assignment]
            if target_key is None:
                raise ValueError(f"unmapped Daegu administrative row: {source_key}")
            branch_rows += 1
            link_quality = "official-name-exact-plus-branch-office"
            branch_assignments.append(
                {
                    "sourceAgencyCode": (row.get("행정기관코드") or "").strip(),
                    "sourceDistrict": district,
                    "sourceLabel": label,
                    "targetDistrict": target_key[0],
                    "targetLabel": target_key[1],
                }
            )
        else:
            direct_rows += 1

        normalized_target = (
            normalize_label(target_key[0]),
            normalize_label(target_key[1]),
        )
        zone = zones.get(normalized_target)
        if zone is None:
            raise ValueError(f"target zone not found: {target_key}")

        record = aggregates.setdefault(
            zone["zoneId"],
            {
                "zoneId": zone["zoneId"],
                "district": zone["district"],
                "label": zone["label"],
                "sourceAgencyCodes": [],
                "sourceAgencyLabels": [],
                "linkQuality": "official-name-exact",
                "previousPopulation": 0,
                "previousMale": 0,
                "previousFemale": 0,
                "population": 0,
                "male": 0,
                "female": 0,
                "populationChange": 0,
                "maleChange": 0,
                "femaleChange": 0,
            },
        )
        record["sourceAgencyCodes"].append((row.get("행정기관코드") or "").strip())
        record["sourceAgencyLabels"].append(label)
        if link_quality != "official-name-exact":
            record["linkQuality"] = link_quality
        for key, value in population_values(row).items():
            record[key] += value

    if len(source_months) != 1:
        raise ValueError(f"expected one source month, got {sorted(source_months)}")
    if len(aggregates) != expected_zone_count:
        raise ValueError(
            f"expected {expected_zone_count} mapped zones, got {len(aggregates)}"
        )

    records = sorted(
        aggregates.values(),
        key=lambda row: (row["district"], row["label"], row["zoneId"]),
    )
    for row in records:
        if row["population"] != row["male"] + row["female"]:
            raise ValueError(f"aggregated sex totals mismatch for {row['zoneId']}")
        if row["population"] - row["previousPopulation"] != row["populationChange"]:
            raise ValueError(f"aggregated population change mismatch for {row['zoneId']}")

    district_map: dict[str, dict[str, int]] = defaultdict(
        lambda: {
            "previousPopulation": 0,
            "population": 0,
            "male": 0,
            "female": 0,
            "populationChange": 0,
        }
    )
    for row in records:
        values = district_map[row["district"]]
        for key in values:
            values[key] += row[key]
    by_district = [
        {"district": district, **values}
        for district, values in sorted(district_map.items())
    ]

    coverage = {
        "sourceDaeguAgencyRows": daegu_rows,
        "directNameMatchedRows": direct_rows,
        "branchOfficeRows": branch_rows,
        "sgisZoneCount": len(records),
        "sgisCoveragePct": 100.0,
        "districtCount": len(by_district),
        "previousPopulation": sum(row["previousPopulation"] for row in records),
        "population": sum(row["population"] for row in records),
        "male": sum(row["male"] for row in records),
        "female": sum(row["female"] for row in records),
        "populationChange": sum(row["populationChange"] for row in records),
    }

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
            "sourceRecordCount": source_rows,
            "sourceMonth": next(iter(source_months)),
            "downloadFileId": SOURCE_DOWNLOAD_ID,
        },
        "coverage": coverage,
        "byDistrict": by_district,
        "records": records,
        "branchOfficeAssignments": branch_assignments,
        "limitations": [
            "주민등록지에 신고된 대한민국 국민 기준이며 외국인은 포함하지 않습니다.",
            "주민등록인구는 거주인구의 공식 행정통계이지만 통신 기반 생활인구·방문인구·시간대별 체류인구와 다릅니다.",
            "SGIS 공개 경계는 2025-06-30 기준이고 MOIS 원본은 2026-08-31 기준이므로 행정기관코드 체계는 직접 변환하지 않습니다.",
            "SGIS 150개 권역은 구·군+행정동명 exact match로 모두 연결하고 논공읍공단출장소·다사읍서재출장소는 명시적으로 각 부모 읍에 합산합니다.",
            "주민등록인구만으로 업무지구·주거생활권·통근형을 최종 확정하지 않으며 생활인구와 OD가 추가로 필요합니다.",
        ],
    }


def main() -> int:
    args = parse_args()
    retrieved_at = args.retrieved_at or (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
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
                "zones": document["coverage"]["sgisZoneCount"],
                "sourceRows": document["coverage"]["sourceDaeguAgencyRows"],
                "branchRows": document["coverage"]["branchOfficeRows"],
                "population": document["coverage"]["population"],
                "change": document["coverage"]["populationChange"],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
