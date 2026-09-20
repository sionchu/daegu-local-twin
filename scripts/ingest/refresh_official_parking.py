"""Normalize the national standard parking dataset into official Daegu parking evidence."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SOURCE_PROVIDER = "공공데이터포털 표준데이터 / 지방자치단체"
SOURCE_DATASET_ID = "15012896"
SOURCE_TITLE = "전국주차장정보표준데이터"
SOURCE_URL = "https://www.data.go.kr/data/15012896/standard.do"
REQUIRED_COLUMNS = {
    "주차장관리번호", "주차장명", "주차장구분", "주차장유형",
    "소재지도로명주소", "소재지지번주소", "주차구획수",
    "운영요일", "요금정보", "위도", "경도", "데이터기준일자", "제공기관코드", "제공기관명",
}
TEXT_ENCODINGS = ("utf-8-sig", "cp949", "euc-kr")
def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument(
        "--output", type=Path, default=Path("public/data/parking.json")
    )
    parser.add_argument("--retrieved-at")
    return parser.parse_args()


def source_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def decode_source(raw: bytes) -> tuple[str, str]:
    for encoding in TEXT_ENCODINGS:
        try:
            return raw.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    raise ValueError("unable to decode parking source")


def clean(value: str | None) -> str | None:
    text = re.sub(r"\s+", " ", str(value or "").strip())
    return text or None
def integer(value: str | None) -> int:
    text = str(value or "").replace(",", "").strip()
    if not text:
        return 0
    try:
        return int(float(text))
    except ValueError as exc:
        raise ValueError(f"invalid integer value: {value!r}") from exc


def coordinate(value: str | None, label: str) -> float:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"missing {label}")
    try:
        result = float(text)
    except ValueError as exc:
        raise ValueError(f"invalid {label}: {value!r}") from exc
    return result


def district_from_row(row: dict[str, str]) -> str | None:
    for key in ("소재지도로명주소", "소재지지번주소"):
        value = str(row.get(key) or "")
        match = re.search(r"대구광역시\s+([^\s]+(?:구|군))\b", value)
        if match:
            return match.group(1)
    provider = str(row.get("제공기관명") or "")
    match = re.search(r"대구광역시\s+([^\s]+(?:구|군))\b", provider)
    return match.group(1) if match else None


def is_daegu(row: dict[str, str]) -> bool:
    addresses = (
        str(row.get("소재지도로명주소") or "").strip(),
        str(row.get("소재지지번주소") or "").strip(),
    )
    if any(value.startswith("대구광역시") for value in addresses):
        return True
    return "대구광역시" in str(row.get("제공기관명") or "")
def normalize(input_path: Path, retrieved_at: str) -> dict[str, Any]:
    text, encoding = decode_source(input_path.read_bytes())
    reader = csv.DictReader(text.splitlines())
    fields = set(reader.fieldnames or [])
    missing = sorted(REQUIRED_COLUMNS - fields)
    if missing:
        raise ValueError("missing required columns: " + ", ".join(missing))

    source_rows = 0
    records: list[dict[str, Any]] = []
    provider_counts: Counter[str] = Counter()
    kind_counts: Counter[str] = Counter()
    type_counts: Counter[str] = Counter()
    fee_counts: Counter[str] = Counter()
    date_counts: Counter[str] = Counter()

    for row in reader:
        source_rows += 1
        if not is_daegu(row):
            continue

        lat = coordinate(row.get("위도"), "latitude")
        lon = coordinate(row.get("경도"), "longitude")
        if not (35.4 < lat < 36.6 and 128.1 < lon < 129.2):
            raise ValueError(
                f"out-of-range Daegu coordinate for {row.get('주차장관리번호')}: {lat}, {lon}"
            )

        source_parking_id = clean(row.get("주차장관리번호"))
        name = clean(row.get("주차장명"))
        provider_code = clean(row.get("제공기관코드"))
        if not source_parking_id or not name or not provider_code:
            raise ValueError("parking id/name/provider code is required")

        provider = clean(row.get("제공기관명"))
        parking_kind = clean(row.get("주차장구분"))
        parking_type = clean(row.get("주차장유형"))
        fee_type = clean(row.get("요금정보"))
        data_date = clean(row.get("데이터기준일자"))
        spaces = integer(row.get("주차구획수"))
        if spaces < 0:
            raise ValueError(f"negative parking spaces for {source_parking_id}")

        provider_counts[provider or "미상"] += 1
        kind_counts[parking_kind or "미상"] += 1
        type_counts[parking_type or "미상"] += 1
        fee_counts[fee_type or "미상"] += 1
        if data_date:
            date_counts[data_date] += 1
        records.append(
            {
                "parkingId": None,
                "sourceParkingId": source_parking_id,
                "providerCode": provider_code,
                "name": name,
                "district": district_from_row(row),
                "parkingKind": parking_kind,
                "parkingType": parking_type,
                "roadAddress": clean(row.get("소재지도로명주소")),
                "lotAddress": clean(row.get("소재지지번주소")),
                "spaces": spaces,
                "operationDays": clean(row.get("운영요일")),
                "weekdayOpen": clean(row.get("평일운영시작시각")),
                "weekdayClose": clean(row.get("평일운영종료시각")),
                "saturdayOpen": clean(row.get("토요일운영시작시각")),
                "saturdayClose": clean(row.get("토요일운영종료시각")),
                "holidayOpen": clean(row.get("공휴일운영시작시각")),
                "holidayClose": clean(row.get("공휴일운영종료시각")),
                "feeType": fee_type,
                "basicMinutes": integer(row.get("주차기본시간")),
                "basicFeeKrw": integer(row.get("주차기본요금")),
                "accessibleParking": clean(row.get("장애인전용주차구역보유여부")),
                "longitude": round(lon, 8),
                "latitude": round(lat, 8),
                "provider": provider,
                "dataDate": data_date,
            }
        )

    raw_id_counts = Counter(row["sourceParkingId"] for row in records)
    provider_id_counts = Counter(
        (row["providerCode"], row["sourceParkingId"]) for row in records
    )
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for row in records:
        grouped.setdefault((row["providerCode"], row["sourceParkingId"]), []).append(row)

    for (provider_code, source_parking_id), rows in grouped.items():
        rows.sort(
            key=lambda row: (
                row["name"],
                row["longitude"],
                row["latitude"],
                row["roadAddress"] or "",
                row["lotAddress"] or "",
            )
        )
        for index, row in enumerate(rows, start=1):
            base = f"{provider_code}:{source_parking_id}"
            row["parkingId"] = base if len(rows) == 1 else f"{base}:{index}"

    ids = [row["parkingId"] for row in records]
    if len(ids) != len(set(ids)):
        raise ValueError("canonical parkingId collision after source disambiguation")

    records.sort(key=lambda row: (row["district"] or "", row["name"], row["parkingId"]))
    dates = sorted(date_counts)
    return {
        "schemaVersion": 1,
        "generatedAt": retrieved_at,
        "source": {
            "provider": SOURCE_PROVIDER,
            "datasetId": SOURCE_DATASET_ID,
            "title": SOURCE_TITLE,
            "url": SOURCE_URL,
            "retrievedAt": retrieved_at,
            "sourceSha256": source_hash(input_path),
            "encoding": encoding,
            "sourceRecordCount": source_rows,
            "dataDateMin": dates[0] if dates else None,
            "dataDateMax": dates[-1] if dates else None,
        },
        "coverage": {
            "daeguParkingRecords": len(records),
            "coordinateRecords": len(records),
            "totalSpaces": sum(row["spaces"] for row in records),
            "publicRecords": sum(row["parkingKind"] == "공영" for row in records),
            "privateRecords": sum(row["parkingKind"] == "민영" for row in records),
            "freeRecords": sum(row["feeType"] == "무료" for row in records),
            "duplicateSourceManagementIds": sum(
                1 for count in raw_id_counts.values() if count > 1
            ),
            "duplicateProviderManagementIds": sum(
                1 for count in provider_id_counts.values() if count > 1
            ),
            "providerCounts": dict(sorted(provider_counts.items())),
            "parkingKindCounts": dict(sorted(kind_counts.items())),
            "parkingTypeCounts": dict(sorted(type_counts.items())),
            "feeTypeCounts": dict(sorted(fee_counts.items())),
        },
        "records": records,
        "limitations": [
            "표준데이터는 개별 기관 등록분을 월별 병합한 스냅샷으로 기관별 데이터기준일자가 다를 수 있습니다.",
            "주차구획수는 공급용량이며 특정 시점의 실시간 빈자리 수를 의미하지 않습니다.",
            "요금·운영시간은 데이터기준일 현재 값으로 실제 현장 운영과 차이가 있을 수 있습니다.",
            "주차장관리번호는 제공기관 간 재사용되며 1건은 동일 제공기관 내에서도 재사용되어, canonical ID는 제공기관코드+관리번호+충돌순번으로 생성합니다.",
            "이 스냅샷은 주차 접근성의 공식 공간근거로 사용하며 매출·방문자수·성공확률을 뜻하지 않습니다.",
        ],
    }


def main() -> int:
    args = parse_args()
    retrieved_at = args.retrieved_at or (
        datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    )
    document = normalize(args.input, retrieved_at)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "output": str(args.output),
                "records": document["coverage"]["daeguParkingRecords"],
                "spaces": document["coverage"]["totalSpaces"],
                "coordinateRecords": document["coverage"]["coordinateRecords"],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
