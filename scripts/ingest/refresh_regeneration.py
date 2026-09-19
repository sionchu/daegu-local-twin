#!/usr/bin/env python3
"""Normalize the official URIS urban-decline workbook for Daegu Jung-gu.

The source workbook is published by the Ministry of Land, Infrastructure and
Transport's Urban Regeneration Information System.  This adapter intentionally
accepts a downloaded workbook instead of fetching it: no credential or API key
is needed, and the committed output contains only the normalized snapshot and
the source hash.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import posixpath
import re
import zipfile
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable
from xml.etree import ElementTree as ET


SOURCE_URL = "https://www.city.go.kr/mobile/notice/notice/noticeList/view.do?nttId=9611"
SOURCE_DOWNLOAD_URL = "https://www.city.go.kr/cmm/fms/FileDown.do?atchFileId=FILE_000000000046447&fileSn=0"
SOURCE_PROVIDER = "국토교통부 / 도시재생종합정보체계"
SOURCE_DATASET_ID = "city.go.kr:nttId=9611"
SOURCE_FILE_ID = "FILE_000000000046447"
SOURCE_FILE_NAME = "도시쇠퇴현황25.12.31기준.xlsx"
SOURCE_VERSION = "2025-12-31"
SOURCE_GEOGRAPHY_LEVEL = "읍면동(행정동)"
TARGET_PROVINCE = "대구광역시"
TARGET_DISTRICT = "대구광역시 중구"

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"m": NS_MAIN, "r": NS_REL}


@dataclass(frozen=True)
class IndicatorSpec:
    code: str
    column: str
    unit: str
    value_type: str


INDICATORS = (
    IndicatorSpec("pastPopulationChangeRate", "G", "percent", "rate"),
    IndicatorSpec("recentPopulationDeclineYears", "H", "years", "count"),
    IndicatorSpec("pastBusinessChangeRate", "I", "percent", "rate"),
    IndicatorSpec("recentBusinessDeclineYears", "J", "years", "count"),
    IndicatorSpec("oldBuildingRatio", "K", "percent", "rate"),
)


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("\u00a0", " ")).strip()


def _column_name(cell_ref: str) -> str:
    match = re.match(r"[A-Z]+", cell_ref)
    if match is None:
        raise ValueError(f"Invalid Excel cell reference: {cell_ref}")
    return match.group(0)


def _shared_strings(archive: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    return [
        "".join(text.text or "" for text in item.iter(f"{{{NS_MAIN}}}t"))
        for item in root.findall("m:si", NS)
    ]


def _cell_value(cell: ET.Element, shared_strings: list[str]) -> str:
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        return "".join(text.text or "" for text in cell.iter(f"{{{NS_MAIN}}}t"))

    value = cell.find("m:v", NS)
    if value is None or value.text is None:
        return ""
    if cell_type == "s":
        return shared_strings[int(value.text)]
    if cell_type == "b":
        return "TRUE" if value.text == "1" else "FALSE"
    return value.text


def _rows(archive: zipfile.ZipFile, sheet_path: str, shared_strings: list[str]) -> list[tuple[int, dict[str, str]]]:
    root = ET.fromstring(archive.read(sheet_path))
    result: list[tuple[int, dict[str, str]]] = []
    for row in root.findall(".//m:sheetData/m:row", NS):
        row_number = int(row.attrib["r"])
        values: dict[str, str] = {}
        for cell in row.findall("m:c", NS):
            values[_column_name(cell.attrib["r"])] = _cell_value(cell, shared_strings)
        result.append((row_number, values))
    return result


def _worksheet_paths(archive: zipfile.ZipFile) -> dict[str, str]:
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    relationship_map = {
        relationship.attrib["Id"]: relationship.attrib["Target"]
        for relationship in relationships.findall(f"{{{NS_PACKAGE_REL}}}Relationship")
    }
    paths: dict[str, str] = {}
    sheets_element = workbook.find("m:sheets", NS)
    if sheets_element is None:
        raise ValueError("Official workbook is missing the sheets element")
    for sheet in sheets_element:
        relationship_id = sheet.attrib[f"{{{NS_REL}}}id"]
        target = relationship_map[relationship_id]
        if target.startswith("/"):
            path = target.lstrip("/")
        elif target.startswith("xl/"):
            path = target
        else:
            path = posixpath.normpath(posixpath.join("xl", target))
        paths[sheet.attrib["name"]] = path
    return paths


def _number(raw_value: str) -> int | float | None:
    if raw_value == "":
        return None
    try:
        number = Decimal(raw_value)
    except InvalidOperation:
        return None
    if number == number.to_integral_value():
        return int(number)
    return float(number)


def _find_header_row(rows: Iterable[tuple[int, dict[str, str]]]) -> int:
    for index, (_row_number, row) in enumerate(rows):
        if (
            normalize_text(row.get("A", "")) == "시도명"
            and normalize_text(row.get("B", "")) == "시군구명"
            and normalize_text(row.get("C", "")) == "읍면동명"
        ):
            return index
    raise ValueError("Could not find the official 읍면동 summary header")


def _definition_rows(rows: list[tuple[int, dict[str, str]]]) -> list[dict[str, str]]:
    definitions: list[dict[str, str]] = []
    labels = {
        "G": "과거대비인구변화(%)",
        "H": "최근인구변화(년수)",
        "I": "과거대비사업체변화(%)",
        "J": "최근사업체변화(년수)",
        "K": "노후건축물비율(%)",
    }
    for _row_number, row in rows:
        label = normalize_text(row.get("B", ""))
        if label not in labels.values():
            continue
        column = next(column for column, value in labels.items() if value == label)
        definitions.append(
            {
                "column": column,
                "name": label,
                "description": normalize_text(row.get("C", "")),
                "criterion": normalize_text(row.get("H", "")),
                "surveyYear": normalize_text(row.get("I", "")),
                "source": normalize_text(row.get("J", "")),
                "publishedAt": normalize_text(row.get("K", "")),
            }
        )
    if len(definitions) != len(INDICATORS):
        raise ValueError(f"Expected {len(INDICATORS)} official definitions, found {len(definitions)}")
    return definitions


def _source_hash(input_path: Path) -> str:
    digest = hashlib.sha256()
    with input_path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def normalize_workbook(input_path: Path, retrieved_at: str) -> dict[str, Any]:
    source_hash = _source_hash(input_path)
    with zipfile.ZipFile(input_path) as archive:
        shared_strings = _shared_strings(archive)
        sheets = _worksheet_paths(archive)
        try:
            summary_rows = _rows(archive, sheets["진단결과_총괄표"], shared_strings)
        except KeyError as error:
            raise ValueError("Official workbook is missing the 진단결과_총괄표 sheet") from error

    header_index = _find_header_row(summary_rows)
    definitions = _definition_rows(summary_rows[:header_index])
    data_rows = [
        (row_number, row)
        for row_number, row in summary_rows[header_index + 1 :]
        if row.get("A", "") and row.get("B", "") and row.get("C", "")
    ]
    selected_rows = [
        (row_number, row)
        for row_number, row in data_rows
        if row.get("A") == TARGET_PROVINCE and row.get("B") == TARGET_DISTRICT
    ]
    if not selected_rows:
        raise ValueError(f"No official records found for {TARGET_DISTRICT}")

    records: list[dict[str, Any]] = []
    for row_number, row in selected_rows:
        indicators: dict[str, Any] = {}
        for spec in INDICATORS:
            raw_value = row.get(spec.column, "")
            definition = next(item for item in definitions if item["column"] == spec.column)
            indicators[spec.code] = {
                "name": definition["name"],
                "rawValue": raw_value,
                "value": _number(raw_value),
                "unit": spec.unit,
                "valueType": spec.value_type,
                "sourceCell": f"{spec.column}{row_number}",
            }

        records.append(
            {
                "geography": {
                    "level": SOURCE_GEOGRAPHY_LEVEL,
                    "provinceName": row["A"],
                    "districtName": row["B"],
                    "name": row["C"],
                },
                "source": {
                    "datasetId": SOURCE_DATASET_ID,
                    "fileId": SOURCE_FILE_ID,
                    "sheet": "진단결과_총괄표",
                    "row": row_number,
                },
                "raw": {
                    "diagnosisFlags": {
                        "populationSocial": row.get("D", ""),
                        "industryEconomy": row.get("E", ""),
                        "physicalEnvironment": row.get("F", ""),
                    },
                    "indicators": indicators,
                    "qualifyingSectorCount": row.get("L", ""),
                    "meetsTwoOrMoreSectors": row.get("M", ""),
                    "sourceColumns": {
                        column: row.get(column, "")
                        for column in ("A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M")
                    },
                },
            }
        )

    selected_names = {record["geography"]["name"] for record in records}
    if len(selected_names) != len(records):
        raise ValueError("Duplicate official 읍면동 names found in the selected source records")

    return {
        "mode": "official-snapshot",
        "provider": SOURCE_PROVIDER,
        "datasetId": SOURCE_DATASET_ID,
        "sourceFileId": SOURCE_FILE_ID,
        "sourceFileName": SOURCE_FILE_NAME,
        "sourceUrl": SOURCE_URL,
        "sourceDownloadUrl": SOURCE_DOWNLOAD_URL,
        "sourceVersion": SOURCE_VERSION,
        "retrievedAt": retrieved_at,
        "sourceSha256": source_hash,
        "officialGeographyLevel": SOURCE_GEOGRAPHY_LEVEL,
        "officialGeographyScope": {
            "provinceName": TARGET_PROVINCE,
            "districtName": TARGET_DISTRICT,
        },
        "sourceRecordCount": len(data_rows),
        "normalizedRecordCount": len(records),
        "requestedAreas": [
            {
                "label": "교동",
                "status": "not_present_in_official_geography",
                "officialMapping": None,
            },
            {
                "label": "북성로",
                "status": "not_present_in_official_geography",
                "officialMapping": None,
            },
            {
                "label": "대신동",
                "status": "exact_official_name",
                "officialMapping": "대신동",
            },
        ],
        "indicatorDefinitions": definitions,
        "records": records,
        "modelled": {
            "localTwinDeclineContextScore": None,
            "note": "이 data-only snapshot은 공식 raw 지표만 보존하며 0~100 LocalTwin score를 산출하지 않습니다.",
        },
        "limitations": [
            "공식 지리단위는 읍면동(행정동)이며 동성로·교동·북성로 corridor 경계가 아닙니다.",
            "교동과 북성로는 원본 공식 읍면동명에 없으므로 어떤 읍면동에도 임의 매핑하지 않았습니다.",
            "지표는 도시쇠퇴 진단 맥락의 공식 지표이며 미래 매출, 점포 생존, 또는 사업 성공을 예측하지 않습니다.",
            "지표별 조사 기준연도와 공표시점은 indicatorDefinitions에 원문대로 보존했습니다.",
            "이 파일에는 LocalTwin의 0~100 파생 score가 없으며, cell-level 계산과 지도 반영은 후속 integration 범위입니다.",
        ],
    }


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="Downloaded official URIS .xlsx file")
    parser.add_argument("--output", type=Path, required=True, help="Normalized JSON output path")
    parser.add_argument("--retrieved-at", required=True, help="ISO-8601 retrieval timestamp")
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    snapshot = normalize_workbook(args.input, args.retrieved_at)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "sourceRecordCount": snapshot["sourceRecordCount"],
                "normalizedRecordCount": snapshot["normalizedRecordCount"],
                "sourceSha256": snapshot["sourceSha256"],
                "output": str(args.output),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
