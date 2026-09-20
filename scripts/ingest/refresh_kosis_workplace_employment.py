"""Normalize KOSIS 2024 workplace employment for all Daegu SGIS dongs."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

SOURCE_PROVIDER = "국가데이터처 / KOSIS"
SOURCE_PUBLICATION = "전국사업체조사"
SOURCE_TABLE = "읍면동 산업대분류별 총괄"
SOURCE_YEAR = 2024
SOURCE_URL = "https://kosis.kr/upsHtml/online.do?isOnline=Y&PART=G&isNew=Y&dev=Y"
SOURCE_DOWNLOAD_URL = (
    "https://kosis.kr/upsHtml/online/downSrvcFile.do?"
    "PUBCODE=ZY&SEQ=539&FILE_NAME=0224.xlsx"
)
PUBCODE = "ZY"
CHAPTER_ID = "0224"
SEQ = 539
XLSX_NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REGION_PATTERN = re.compile(r"^\s*([0-9]+)\.(.+?)\s*$")


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
        default=Path("public/data/workplace_employment.json"),
    )
    parser.add_argument("--retrieved-at")
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def xlsx_column_index(reference: str) -> int:
    letters = re.match(r"([A-Z]+)", reference)
    if not letters:
        raise ValueError(f"invalid XLSX cell reference: {reference}")
    value = 0
    for char in letters.group(1):
        value = value * 26 + ord(char) - 64
    return value - 1


def xlsx_rows(data: bytes) -> Iterator[list[str]]:
    workbook = zipfile.ZipFile(io.BytesIO(data))
    shared: list[str] = []
    if "xl/sharedStrings.xml" in workbook.namelist():
        root = ET.fromstring(workbook.read("xl/sharedStrings.xml"))
        shared = [
            "".join(node.text or "" for node in item.iterfind(".//a:t", XLSX_NS))
            for item in root.findall("a:si", XLSX_NS)
        ]
    sheet = ET.fromstring(workbook.read("xl/worksheets/sheet1.xml"))
    for row in sheet.findall(".//a:sheetData/a:row", XLSX_NS):
        values: dict[int, str] = {}
        for cell in row.findall("a:c", XLSX_NS):
            index = xlsx_column_index(cell.get("r") or "")
            value_node = cell.find("a:v", XLSX_NS)
            cell_type = cell.get("t")
            if cell_type == "inlineStr":
                value = "".join(
                    node.text or "" for node in cell.iterfind(".//a:t", XLSX_NS)
                )
            elif value_node is None:
                value = ""
            elif cell_type == "s":
                value = shared[int(value_node.text or 0)]
            else:
                value = value_node.text or ""
            values[index] = value
        if values:
            yield [values.get(index, "") for index in range(max(values) + 1)]


def integer(value: Any) -> int:
    text = str(value or "").replace(",", "").strip()
    if not text or text == "X":
        return 0
    return int(float(text))


def load_zones(path: Path) -> dict[str, dict[str, Any]]:
    document = json.loads(path.read_text(encoding="utf-8"))
    zones: dict[str, dict[str, Any]] = {}
    for feature in document.get("features") or []:
        props = feature.get("properties") or {}
        zone_id = str(props.get("zoneId") or "")
        if not zone_id.startswith("sgis-dong:"):
            continue
        code = zone_id.split(":", 1)[1]
        zones[code] = {
            "zoneId": zone_id,
            "district": props.get("district"),
            "label": props.get("label"),
        }
    return zones


def normalize(input_path: Path, zones_path: Path, retrieved_at: str) -> dict[str, Any]:
    zones = load_zones(zones_path)
    if len(zones) != 150:
        raise ValueError(f"expected 150 SGIS zones, got {len(zones)}")

    city_row: dict[str, Any] | None = None
    districts: dict[str, dict[str, Any]] = {}
    source_dongs: dict[str, dict[str, Any]] = {}

    for row in xlsx_rows(input_path.read_bytes()):
        if len(row) < 4:
            continue
        region, industry, businesses, employees = row[:4]
        if str(industry).strip() != "전산업":
            continue
        match = REGION_PATTERN.match(str(region))
        if not match:
            continue
        code, source_name = match.group(1), match.group(2).strip()
        if not code.startswith("22"):
            continue
        record = {
            "administrativeCode": code,
            "sourceLabel": source_name,
            "businesses": integer(businesses),
            "employees": integer(employees),
        }
        if code == "22":
            city_row = record
        elif len(code) == 6:
            districts[code] = record
        elif len(code) == 8:
            source_dongs[code] = record

    if city_row is None:
        raise ValueError("missing Daegu city total row")
    if len(districts) != 9:
        raise ValueError(f"expected 9 Daegu district totals, got {len(districts)}")

    missing = sorted(set(zones) - set(source_dongs))
    unexpected = sorted(set(source_dongs) - set(zones))
    if missing or unexpected:
        raise ValueError(
            f"SGIS/KOSIS code mismatch: missing={missing[:10]} unexpected={unexpected[:10]}"
        )

    records = []
    name_mismatches = []
    for code in sorted(zones):
        source = source_dongs[code]
        zone = zones[code]
        if str(source["sourceLabel"]).replace(".", "·") != str(zone["label"]):
            name_mismatches.append(
                {
                    "administrativeCode": code,
                    "sourceLabel": source["sourceLabel"],
                    "sgisLabel": zone["label"],
                }
            )
        records.append(
            {
                "zoneId": zone["zoneId"],
                "administrativeCode": code,
                "district": zone["district"],
                "label": zone["label"],
                "sourceLabel": source["sourceLabel"],
                "businesses": source["businesses"],
                "employees": source["employees"],
            }
        )

    district_records = []
    for code, source in sorted(districts.items()):
        district_records.append(
            {
                "administrativeCode": code,
                "district": source["sourceLabel"],
                "businesses": source["businesses"],
                "employees": source["employees"],
            }
        )

    dong_businesses = sum(row["businesses"] for row in records)
    dong_employees = sum(row["employees"] for row in records)
    district_businesses = sum(row["businesses"] for row in district_records)
    district_employees = sum(row["employees"] for row in district_records)
    if not (
        dong_businesses == district_businesses == city_row["businesses"]
        and dong_employees == district_employees == city_row["employees"]
    ):
        raise ValueError("city/district/dong totals are not internally consistent")

    return {
        "schemaVersion": 1,
        "generatedAt": retrieved_at,
        "source": {
            "provider": SOURCE_PROVIDER,
            "publication": SOURCE_PUBLICATION,
            "table": SOURCE_TABLE,
            "sourceYear": SOURCE_YEAR,
            "url": SOURCE_URL,
            "downloadUrl": SOURCE_DOWNLOAD_URL,
            "pubcode": PUBCODE,
            "chapterId": CHAPTER_ID,
            "seq": SEQ,
            "retrievedAt": retrieved_at,
            "sourceSha256": sha256(input_path),
        },
        "coverage": {
            "city": "대구광역시",
            "districtCount": len(district_records),
            "zoneCount": len(records),
            "sgisCodeMatchedZones": len(records),
            "sgisCoveragePct": 100.0,
            "businesses": city_row["businesses"],
            "employees": city_row["employees"],
            "nameMismatchCount": len(name_mismatches),
        },
        "cityTotal": {
            "businesses": city_row["businesses"],
            "employees": city_row["employees"],
        },
        "byDistrict": district_records,
        "records": records,
        "nameMismatches": name_mismatches,
        "limitations": [
            "전국사업체조사의 사업체 소재지 기준 종사자수이며 거주지 기준 취업자수나 통근 유입인구와 다릅니다.",
            "2024년 기준 연간 조사 결과이며 실시간·시간대별 체류인구를 의미하지 않습니다.",
            "SGIS 2025Q2 행정동과 행정코드가 150/150 일치하여 코드로 직접 연결하며 명칭 차이는 감사용으로만 보존합니다.",
            "종사자수는 업무지구성의 공식 증거로 사용할 수 있으나 매출·방문객·상권 성공확률을 의미하지 않습니다.",
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
                "zones": document["coverage"]["zoneCount"],
                "businesses": document["coverage"]["businesses"],
                "employees": document["coverage"]["employees"],
                "nameMismatchCount": document["coverage"]["nameMismatchCount"],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
