"""Normalize official R-ONE commercial rent and vacancy exports.

The collection step is intentionally separate from this adapter.  A user
downloads the JSON export through the public 한국부동산원 R-ONE statistics UI,
then this script parses the documented table shape and writes a deterministic
snapshot.  No API key, browser profile, cookie, or private endpoint is used.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import OrderedDict
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any


DATASET_ID = "15134761"
SOURCE_URL = "https://www.data.go.kr/data/15134761/openapi.do"
OFFICIAL_PORTAL_URL = "https://www.reb.or.kr/r-one/portal/stat/easyStatPage.do"
PROVIDER = "한국부동산원"
PROPERTY_TYPE = "소규모 상가"
GEOGRAPHIC_LEVEL = "상권"
TARGET_PROVINCE = "대구"
REQUESTED_CORRIDOR_LABELS = ("동성로", "교동", "북성로")

RENT_METRIC = "임대료"
RENT_UNIT = "천원/㎡"
RENT_TABLE_NAME = "임대동향 지역별 임대료(2024년3분기~)_소규모 상가"
RENT_TABLE_ID = "T248223134698125"

VACANCY_METRIC = "공실률"
VACANCY_UNIT = "%"
VACANCY_TABLE_NAME = "임대동향 지역별 공실률(2024년3분기~)_소규모 상가"
VACANCY_TABLE_ID = "T241833134686576"

PERIOD_PATTERN = re.compile(r"^(?P<year>\d{4})년\s+(?P<quarter>[1-4])분기$")
SHA256_PATTERN = re.compile(r"^[0-9a-fA-F]{64}$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Normalize public R-ONE JSON exports into the official REB snapshot."
    )
    parser.add_argument("--rent-input", type=Path, required=True)
    parser.add_argument("--vacancy-input", type=Path, required=True)
    parser.add_argument("--retrieved-at", required=True)
    parser.add_argument("--rent-source-sha256", required=True)
    parser.add_argument("--vacancy-source-sha256", required=True)
    parser.add_argument(
        "--output", type=Path, default=Path("public/data/rent_benchmark.json")
    )
    return parser.parse_args()


def number(value: Any) -> int | float:
    if isinstance(value, bool) or value is None:
        raise ValueError(f"Expected a numeric value, got {value!r}")
    try:
        parsed = Decimal(str(value).strip())
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"Expected a numeric value, got {value!r}") from exc
    if not parsed.is_finite():
        raise ValueError(f"Expected a finite numeric value, got {value!r}")
    if parsed == parsed.to_integral_value():
        return int(parsed)
    return float(parsed)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def period_from_label(label: str) -> dict[str, Any]:
    match = PERIOD_PATTERN.fullmatch(label.strip())
    if match is None:
        raise ValueError(f"Unsupported R-ONE period label: {label!r}")
    year = int(match.group("year"))
    quarter = int(match.group("quarter"))
    month_end = {1: "03-31", 2: "06-30", 3: "09-30", 4: "12-31"}[quarter]
    return {
        "cycle": "QY",
        "code": f"{year:04d}{quarter:02d}",
        "year": year,
        "quarter": quarter,
        "label": f"{year}년 {quarter}분기",
        "asOf": f"{year:04d}-{month_end}",
    }


def _data_rows(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    try:
        data = payload["sheet"]["1"]["data"]
    except (KeyError, TypeError) as exc:
        raise ValueError("R-ONE export must contain sheet.1.data") from exc
    if not isinstance(data, dict):
        raise ValueError("R-ONE export sheet.1.data must be an object")
    return data


def _latest_period(data: dict[str, dict[str, Any]]) -> tuple[str, dict[str, Any]]:
    header = data.get("0")
    if not isinstance(header, dict):
        raise ValueError("R-ONE export is missing the table header row")
    candidates: list[tuple[tuple[int, int], str, dict[str, Any]]] = []
    for key, value in header.items():
        if not isinstance(value, str):
            continue
        match = PERIOD_PATTERN.fullmatch(value.strip())
        if match is None:
            continue
        period = period_from_label(value)
        candidates.append(((period["year"], period["quarter"]), str(key), period))
    if not candidates:
        raise ValueError("R-ONE export has no quarterly period columns")
    _, value_key, period = max(candidates)
    return value_key, period


def _raw_row_count(data: dict[str, dict[str, Any]]) -> int:
    return sum(1 for key in data if str(key).isdigit() and int(key) >= 3)


def _region_name(row: dict[str, Any]) -> str:
    region_name = row.get("2") or row.get("3")
    if not isinstance(region_name, str) or not region_name.strip():
        raise ValueError(f"R-ONE row has no region name: {row!r}")
    return region_name.strip()


def parse_export(
    payload: dict[str, Any],
    *,
    expected_metric: str,
    expected_unit: str,
    table_name: str,
) -> dict[str, Any]:
    data = _data_rows(payload)
    value_key, period = _latest_period(data)
    metric = data.get("1", {}).get(value_key)
    unit = data.get("2", {}).get(value_key)
    if metric != expected_metric:
        raise ValueError(f"Expected metric {expected_metric!r}, got {metric!r}")
    if unit != expected_unit:
        raise ValueError(f"Expected unit {expected_unit!r}, got {unit!r}")

    records: OrderedDict[str, dict[str, Any]] = OrderedDict()
    for key in sorted(
        (key for key in data if str(key).isdigit() and int(key) >= 3),
        key=lambda item: int(item),
    ):
        row = data[key]
        if not isinstance(row, dict):
            raise ValueError(f"R-ONE data row {key!r} must be an object")
        province = row.get("1")
        if province != TARGET_PROVINCE:
            continue
        region_name = _region_name(row)
        # The province aggregate is not an 상권 row.  The target snapshot uses
        # the most detailed official level exposed by this table.
        if region_name == TARGET_PROVINCE:
            continue
        value = number(row.get(value_key))
        parsed = {
            "provinceName": TARGET_PROVINCE,
            "regionName": region_name,
            "regionFullName": f"{TARGET_PROVINCE}>{region_name}",
            "sourceRowNumber": int(row["0"]),
            "metric": expected_metric,
            "value": value,
            "unit": expected_unit,
            "tableName": table_name,
        }
        previous = records.get(region_name)
        if previous is not None and previous != parsed:
            raise ValueError(f"Conflicting duplicate official region row: {region_name}")
        records[region_name] = parsed

    return {
        "period": period,
        "valueKey": value_key,
        "rawRecordCount": _raw_row_count(data),
        "provinceAreaRecordCount": sum(
            1
            for key in data
            if str(key).isdigit()
            and int(key) >= 3
            and isinstance(data[key], dict)
            and data[key].get("1") == TARGET_PROVINCE
        ),
        "records": records,
    }


def rent_per_square_meter_won(value: int | float) -> int | float:
    converted = Decimal(str(value)) * Decimal("1000")
    if converted == converted.to_integral_value():
        return int(converted)
    return float(converted)


def normalize_exports(
    rent_payload: dict[str, Any],
    vacancy_payload: dict[str, Any],
    *,
    retrieved_at: str,
    rent_source_sha256: str,
    vacancy_source_sha256: str,
) -> dict[str, Any]:
    if not SHA256_PATTERN.fullmatch(rent_source_sha256):
        raise ValueError("rent_source_sha256 must be a 64-character SHA256 hex digest")
    if not SHA256_PATTERN.fullmatch(vacancy_source_sha256):
        raise ValueError("vacancy_source_sha256 must be a 64-character SHA256 hex digest")

    rent = parse_export(
        rent_payload,
        expected_metric=RENT_METRIC,
        expected_unit=RENT_UNIT,
        table_name=RENT_TABLE_NAME,
    )
    vacancy = parse_export(
        vacancy_payload,
        expected_metric=VACANCY_METRIC,
        expected_unit=VACANCY_UNIT,
        table_name=VACANCY_TABLE_NAME,
    )
    if rent["period"] != vacancy["period"]:
        raise ValueError(
            f"Rent and vacancy period mismatch: {rent['period']} != {vacancy['period']}"
        )

    rent_records = rent["records"]
    vacancy_records = vacancy["records"]
    if set(rent_records) != set(vacancy_records):
        raise ValueError(
            "Rent and vacancy official geography sets do not match: "
            f"rent={sorted(rent_records)} vacancy={sorted(vacancy_records)}"
        )

    records: list[dict[str, Any]] = []
    for region_name, rent_row in rent_records.items():
        vacancy_row = vacancy_records[region_name]
        period = rent["period"]
        records.append(
            {
                "periodCode": period["code"],
                "period": period,
                "geography": {
                    "level": GEOGRAPHIC_LEVEL,
                    "provinceName": TARGET_PROVINCE,
                    "regionName": region_name,
                    "regionFullName": rent_row["regionFullName"],
                    "sourceRentRowNumber": rent_row["sourceRowNumber"],
                    "sourceVacancyRowNumber": vacancy_row["sourceRowNumber"],
                },
                "commercialPropertyType": PROPERTY_TYPE,
                "official": {
                    "rent": {
                        "metric": RENT_METRIC,
                        "value": rent_row["value"],
                        "unit": RENT_UNIT,
                        "sourceTableId": RENT_TABLE_ID,
                        "sourceTableName": RENT_TABLE_NAME,
                    },
                    "vacancy": {
                        "metric": VACANCY_METRIC,
                        "value": vacancy_row["value"],
                        "unit": VACANCY_UNIT,
                        "sourceTableId": VACANCY_TABLE_ID,
                        "sourceTableName": VACANCY_TABLE_NAME,
                    },
                },
                "localTwin": {
                    "rentPerSquareMeter": {
                        "value": rent_per_square_meter_won(rent_row["value"]),
                        "unit": "원/㎡",
                        "formula": "official rent (천원/㎡) × 1,000",
                        "scope": "official 상권 benchmark; individual store rent is not inferred",
                    },
                    "vacancy": {
                        "value": vacancy_row["value"],
                        "unit": "%",
                        "formula": "official vacancy value; no unit conversion",
                        "scope": "official 상권 benchmark; individual store vacancy is not inferred",
                    },
                },
                "sourceMode": "official-snapshot",
            }
        )

    period = rent["period"]
    area_names = [record["geography"]["regionName"] for record in records]
    containing_corridor_labels = {
        label: [area for area in area_names if label in area]
        for label in REQUESTED_CORRIDOR_LABELS
    }
    matched = {
        label: areas for label, areas in containing_corridor_labels.items() if areas
    }
    unavailable = [
        label for label, areas in containing_corridor_labels.items() if not areas
    ]

    return {
        "mode": "official-snapshot",
        "provider": PROVIDER,
        "datasetId": DATASET_ID,
        "sourceUrl": SOURCE_URL,
        "officialPortalUrl": OFFICIAL_PORTAL_URL,
        "retrievedAt": retrieved_at,
        "sourceVersion": period["code"],
        "sourceDate": period["asOf"],
        "sourcePeriod": period,
        "officialGeographyLevel": GEOGRAPHIC_LEVEL,
        "commercialPropertyType": PROPERTY_TYPE,
        "sourceFiles": [
            {
                "metric": RENT_METRIC,
                "tableId": RENT_TABLE_ID,
                "tableName": RENT_TABLE_NAME,
                "sourceSha256": rent_source_sha256.upper(),
                "hashScope": "downloaded official R-ONE JSON export",
            },
            {
                "metric": VACANCY_METRIC,
                "tableId": VACANCY_TABLE_ID,
                "tableName": VACANCY_TABLE_NAME,
                "sourceSha256": vacancy_source_sha256.upper(),
                "hashScope": "downloaded official R-ONE JSON export",
            },
        ],
        "coverage": {
            "requestedCorridorLabels": list(REQUESTED_CORRIDOR_LABELS),
            "officialProvince": TARGET_PROVINCE,
            "officialGeographyLevel": GEOGRAPHIC_LEVEL,
            "officialAreaNames": area_names,
            "matchedOfficialAreaLabelsByStringContainment": matched,
            "unavailableRequestedCorridorLabels": unavailable,
            "note": "These are official R-ONE 상권 labels only; no cell-level or street-label allocation is performed.",
        },
        "metricDefinitions": {
            "rent": {
                "officialName": RENT_METRIC,
                "unit": RENT_UNIT,
                "definition": "상가의 환산임대료를 임대가능면적(전용면적+공용면적)으로 나눈 상권별 ㎡당 지표. 보증금과 월세를 전환율로 환산하며 관리비와 부가가치세는 제외.",
                "surveyBasis": "상가 1층 기준 임대료",
            },
            "vacancy": {
                "officialName": VACANCY_METRIC,
                "unit": VACANCY_UNIT,
                "definition": "해당 상권 표본의 공실면적 합을 표본의 총 임대가능면적 합으로 나눈 지표.",
                "surveyBasis": "임대계약 미체결 또는 자가·무상임대 방식으로 이용되지 않는 빈 공간을 공실로 정의",
            },
        },
        "quality": {
            "rentRawRecordCount": rent["rawRecordCount"],
            "vacancyRawRecordCount": vacancy["rawRecordCount"],
            "rentDaeguAreaRecordCount": rent["provinceAreaRecordCount"],
            "vacancyDaeguAreaRecordCount": vacancy["provinceAreaRecordCount"],
            "provinceAggregateExcluded": 1,
            "rentSelectedAreaCount": len(rent_records),
            "vacancySelectedAreaCount": len(vacancy_records),
            "normalizedRecordCount": len(records),
            "syntheticRecordCount": 0,
            "missingMetricPairCount": 0,
        },
        "records": records,
        "limitations": [
            "Official quarterly market benchmark at the R-ONE 상권 level; it is not a specific store's deposit, monthly rent, or vacancy.",
            "The public JSON export exposes area names and source row numbers but no area code; no code was invented.",
            "The official table contains 동성로중심 but no official 교동 or 북성로 row. Those labels remain unavailable and receive no allocated value.",
            "The localTwin rent field is only a unit conversion to 원/㎡; no area multiplication or store-level monthly-rent estimate is made.",
            "Cell-level rentRelief or map integration is intentionally outside this data-only snapshot.",
        ],
    }


def main() -> int:
    args = parse_args()
    for path in (args.rent_input, args.vacancy_input):
        if not path.exists():
            raise SystemExit(f"input file not found: {path}")
    rent_payload = json.loads(args.rent_input.read_text(encoding="utf-8-sig"))
    vacancy_payload = json.loads(args.vacancy_input.read_text(encoding="utf-8-sig"))
    snapshot = normalize_exports(
        rent_payload,
        vacancy_payload,
        retrieved_at=args.retrieved_at,
        rent_source_sha256=args.rent_source_sha256,
        vacancy_source_sha256=args.vacancy_source_sha256,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        f"wrote {snapshot['quality']['normalizedRecordCount']} official REB records "
        f"for {snapshot['sourceVersion']} to {args.output}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
