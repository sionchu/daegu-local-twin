"""Enrich public-map context anchors with official Daegu registries.

The official files are downloaded separately from data.go.kr and are not committed.
This adapter:
- filters broad/low-specificity Overture categories according to the canonical taxonomy;
- assigns subtype base weights;
- links exact-name school/factory records conservatively;
- writes a compact official registry/summary without phone/fax or unused raw columns;
- never upgrades public-map coordinates to official coordinates.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import re
import unicodedata
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from normalize_overture_context import (
    CATEGORY_TO_ANCHOR,
    anchor_name_allowed,
    base_weight,
)

SCHOOL_DATASET = {
    "provider": "대구광역시교육청",
    "datasetId": "15015254",
    "sourceUrl": "https://www.data.go.kr/data/15015254/fileData.do",
    "sourceDate": "2026-04-01",
}
FACTORY_DATASET = {
    "provider": "대구광역시",
    "datasetId": "15069132",
    "sourceUrl": "https://www.data.go.kr/data/15069132/fileData.do",
    "sourceDate": "2025-07-07",
}
POPULATION_DATASET = {
    "provider": "대구광역시",
    "datasetId": "3077757",
    "sourceUrl": "https://www.data.go.kr/data/3077757/fileData.do",
    "sourceDate": "2026-05-31",
}
HIRA_DATASET = {
    "provider": "건강보험심사평가원",
    "datasetId": "15051059",
    "sourceUrl": "https://opendata.hira.or.kr/op/opc/selectOpenData.do?sno=11925",
    "sourceDate": "2026-06-30",
}

XLSX_NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

CORP_TERMS = ("주식회사", "(주)", "㈜", "유한회사", "(유)", "합자회사", "합명회사")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--anchors", type=Path, required=True)
    parser.add_argument("--school-csv", type=Path, required=True)
    parser.add_argument("--factory-csv", type=Path, required=True)
    parser.add_argument("--population-csv", type=Path, required=True)
    parser.add_argument("--hira-zip", type=Path)
    parser.add_argument(
        "--anchors-output", type=Path, default=Path("public/data/context_anchors.json")
    )
    parser.add_argument(
        "--summary-output",
        type=Path,
        default=Path("public/data/official_context_summary.json"),
    )
    parser.add_argument(
        "--anchor-layer-dir",
        type=Path,
        default=Path("public/data/context_anchors"),
    )
    return parser.parse_args()


def read_cp949(path: Path) -> list[dict[str, str]]:
    text = path.read_bytes().decode("cp949")
    return list(csv.DictReader(text.splitlines()))


def normalize_name(value: str, *, company: bool = False) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).lower()
    text = re.sub(r"\([^)]*\)", "", text)
    if company:
        for term in CORP_TERMS:
            text = text.replace(term.lower(), "")
    return re.sub(r"[^0-9a-z가-힣]", "", text)


def district_from_address(value: str) -> str | None:
    match = re.search(r"대구광역시\s+([^\s]+(?:구|군))\b", str(value or ""))
    return match.group(1) if match else None


def int_value(value: str) -> int | None:
    text = str(value or "").replace(",", "").strip()
    return int(text) if text and re.fullmatch(r"-?\d+", text) else None


def float_value(value: str) -> float | None:
    text = str(value or "").replace(",", "").strip()
    try:
        return float(text)
    except ValueError:
        return None


def source_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def dataset_with_hash(dataset: dict[str, str], path: Path) -> dict[str, str]:
    return {**dataset, "sourceSha256": source_sha256(path)}


def build_unique_lookup(anchors: list[dict[str, Any]], anchor_type: str, *, company: bool = False):
    by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for anchor in anchors:
        if anchor.get("anchorType") != anchor_type:
            continue
        by_name[normalize_name(anchor.get("name") or "", company=company)].append(anchor)
    return {
        key: rows[0]
        for key, rows in by_name.items()
        if key and len(rows) == 1
    }


def xlsx_column_index(reference: str) -> int:
    letters = re.match(r"([A-Z]+)", reference)
    if not letters:
        raise ValueError(f"invalid XLSX cell reference: {reference}")
    value = 0
    for char in letters.group(1):
        value = value * 26 + ord(char) - 64
    return value - 1


def xlsx_rows(data: bytes):
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


def hira_records(path: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    dataset = dataset_with_hash(HIRA_DATASET, path)
    outer = zipfile.ZipFile(path)
    xlsx_files = [name for name in outer.namelist() if name.lower().endswith(".xlsx")]
    anchors: list[dict[str, Any]] = []
    counts_by_district: Counter[str] = Counter()
    counts_by_type: Counter[str] = Counter()

    for prefix, source_kind in (("1.", "hospital"), ("2.", "pharmacy")):
        member = next(
            name for name in xlsx_files if re.search(r"/" + re.escape(prefix), name)
        )
        iterator = xlsx_rows(outer.read(member))
        headers = next(iterator)
        index = {header: i for i, header in enumerate(headers)}

        for row in iterator:
            def get(field: str) -> str:
                position = index[field]
                return str(row[position]).strip() if position < len(row) else ""

            if get("시도코드명") != "대구":
                continue
            x = get("좌표(X)")
            y = get("좌표(Y)")
            if not x or not y:
                continue
            lon, lat = float(x), float(y)
            if not (128.0 < lon < 129.5 and 35.0 < lat < 37.0):
                continue

            official_type = get("종별코드명")
            name = get("요양기관명")
            district = get("시군구코드명")
            if district.startswith("대구"):
                district = district[2:]
            counts_by_district[district] += 1
            counts_by_type[official_type] += 1

            if source_kind == "pharmacy":
                subtype = "pharmacy"
                weight = 0.30
                capacity = None
                capacity_weight = 1.0
            else:
                if "치과" in official_type:
                    subtype = "dentist"
                    weight = 0.35
                elif official_type in {"상급종합", "종합병원"}:
                    subtype = "hospital"
                    weight = 1.80 if official_type == "상급종합" else 1.60
                elif "병원" in official_type:
                    subtype = "hospital"
                    weight = 1.20
                elif official_type in {"보건소", "보건지소", "보건진료소"}:
                    subtype = "medical_center"
                    weight = 0.80 if official_type == "보건소" else 0.50
                else:
                    subtype = "health_and_medical"
                    weight = 0.45
                doctor_text = get("총의사수")
                try:
                    capacity = max(float(doctor_text), 0.0) if doctor_text else None
                except ValueError:
                    capacity = None
                capacity_weight = (
                    1.0 + min(math.log1p(capacity) / 4.0, 1.0)
                    if capacity is not None
                    else 1.0
                )

            provider_id = get("암호화요양기호")
            anchors.append(
                {
                    "anchorId": f"hira:{provider_id}",
                    "name": name,
                    "anchorType": "healthcare",
                    "subtype": subtype,
                    "officialSubtype": official_type,
                    "longitude": round(lon, 8),
                    "latitude": round(lat, 8),
                    "district": district or None,
                    "dong": get("읍면동") or None,
                    "address": get("주소") or None,
                    "confidence": None,
                    "taxonomyHierarchy": [],
                    "capacity": capacity,
                    "capacityUnit": "doctor-count" if capacity is not None else None,
                    "baseWeight": weight,
                    "capacityWeight": round(capacity_weight, 4),
                    "quality": "official",
                    "coordinateQuality": "official",
                    "source": {
                        "provider": dataset["provider"],
                        "datasetId": dataset["datasetId"],
                        "sourceDate": dataset["sourceDate"],
                        "recordId": provider_id,
                    },
                }
            )

    anchors.sort(key=lambda row: (row["subtype"], row["name"], row["anchorId"]))
    summary = {
        "dataset": dataset,
        "recordCount": len(anchors),
        "countByDistrict": dict(sorted(counts_by_district.items())),
        "countByInstitutionType": dict(sorted(counts_by_type.items())),
        "coordinateQuality": "official",
        "capacityField": "병의원 기본정보 총의사수; 약국은 capacity 미사용",
    }
    return anchors, summary


def main() -> int:
    args = parse_args()
    school_dataset = dataset_with_hash(SCHOOL_DATASET, args.school_csv)
    factory_dataset = dataset_with_hash(FACTORY_DATASET, args.factory_csv)
    population_dataset = dataset_with_hash(POPULATION_DATASET, args.population_csv)
    doc = json.loads(args.anchors.read_text(encoding="utf-8"))
    records = []
    for anchor in doc.get("records") or []:
        subtype = str(anchor.get("subtype") or "")
        anchor_type = str(anchor.get("anchorType") or "")
        if CATEGORY_TO_ANCHOR.get(subtype) != anchor_type:
            continue
        if not anchor_name_allowed(anchor_type, str(anchor.get("name") or "")):
            continue
        anchor["baseWeight"] = base_weight(subtype)
        anchor.setdefault("coordinateQuality", "public-map")
        records.append(anchor)

    healthcare_summary = None
    if args.hira_zip and args.hira_zip.exists():
        official_healthcare, healthcare_summary = hira_records(args.hira_zip)
        records = [row for row in records if row.get("anchorType") != "healthcare"]
        records.extend(official_healthcare)

    school_rows = read_cp949(args.school_csv)
    school_name = "학교명"
    school_district = "관할구군청"
    school_address = "주소"
    school_postal = "우편번호"
    school_lookup = build_unique_lookup(records, "education")
    school_registry = []
    school_linked = 0
    school_counts: Counter[str] = Counter()
    for index, row in enumerate(school_rows, start=1):
        name = (row.get(school_name) or "").strip()
        district = (row.get(school_district) or "").strip()
        address = (row.get(school_address) or "").strip()
        postal = (row.get(school_postal) or "").strip()
        if district:
            school_counts[district] += 1
        registry_id = f"official-school:{index:04d}"
        matched = school_lookup.get(normalize_name(name))
        matched_anchor_id = None
        if matched:
            school_linked += 1
            matched_anchor_id = matched["anchorId"]
            matched["quality"] = "official-linked"
            matched["coordinateQuality"] = "public-map"
            matched["officialEvidence"] = {
                "registryId": registry_id,
                "provider": school_dataset["provider"],
                "datasetId": school_dataset["datasetId"],
                "sourceDate": school_dataset["sourceDate"],
                "name": name,
                "district": district or None,
                "address": address or None,
                "postalCode": postal or None,
                "coordinateNote": "시설 존재·명칭·주소는 공식, 좌표는 Overture public-map 매칭",
            }
        school_registry.append(
            {
                "registryId": registry_id,
                "name": name,
                "district": district or None,
                "address": address or None,
                "postalCode": postal or None,
                "matchedAnchorId": matched_anchor_id,
            }
        )

    factory_rows = read_cp949(args.factory_csv)
    factory_name = "회사명"
    factory_address = "공장대표주소(도로명)"
    factory_complex = "단지명"
    factory_industry = "업종명"
    factory_lookup = build_unique_lookup(records, "industrial", company=True)
    factory_linked = 0
    factory_counts: Counter[str] = Counter()
    complex_counts: Counter[str] = Counter()
    industry_by_district: dict[str, Counter[str]] = defaultdict(Counter)
    for index, row in enumerate(factory_rows, start=1):
        name = (row.get(factory_name) or "").strip()
        address = (row.get(factory_address) or "").strip()
        district = district_from_address(address)
        complex_name = (row.get(factory_complex) or "").strip()
        industry = (row.get(factory_industry) or "").strip()
        if district:
            factory_counts[district] += 1
            if industry:
                industry_by_district[district][industry] += 1
        if complex_name:
            complex_counts[complex_name] += 1
        matched = factory_lookup.get(normalize_name(name, company=True))
        if matched:
            factory_linked += 1
            matched["quality"] = "official-linked"
            matched["coordinateQuality"] = "public-map"
            evidence = matched.get("officialEvidence")
            factory_evidence = {
                "registryId": f"official-factory:{index:05d}",
                "provider": factory_dataset["provider"],
                "datasetId": factory_dataset["datasetId"],
                "sourceDate": factory_dataset["sourceDate"],
                "name": name,
                "district": district,
                "address": address or None,
                "industrialComplex": complex_name or None,
                "industry": industry or None,
                "coordinateNote": "공장 존재·주소는 공식, 좌표는 Overture public-map 매칭",
            }
            if evidence:
                matched["officialEvidence"] = [evidence, factory_evidence]
            else:
                matched["officialEvidence"] = factory_evidence

    population_rows = read_cp949(args.population_csv)
    population_by_district: dict[str, dict[str, Any]] = {}
    city_total = None
    for row in population_rows:
        label = row.get("행정구역") or ""
        values = {
            "population": int_value(row.get("2026년05월_총인구수") or ""),
            "households": int_value(row.get("2026년05월_세대수") or ""),
            "personsPerHousehold": float_value(row.get("2026년05월_세대당 인구") or ""),
            "male": int_value(row.get("2026년05월_남자 인구수") or ""),
            "female": int_value(row.get("2026년05월_여자 인구수") or ""),
        }
        if re.search(r"대구광역시\s*\(2700000000\)", label):
            city_total = values
            continue
        match = re.search(r"대구광역시\s+([^\s(]+(?:구|군))", label)
        if match:
            population_by_district[match.group(1)] = values

    records.sort(
        key=lambda row: (
            row["anchorType"],
            row.get("subtype") or "",
            row["name"],
            row["anchorId"],
        )
    )
    doc["records"] = records
    doc["coverage"]["anchorCount"] = len(records)
    doc["coverage"]["countsByType"] = dict(
        sorted(Counter(row["anchorType"] for row in records).items())
    )
    doc["coverage"]["qualityCounts"] = dict(
        sorted(Counter(row.get("quality") for row in records).items())
    )
    doc["officialEnrichment"] = {
        "school": {
            "dataset": school_dataset,
            "officialRecordCount": len(school_registry),
            "spatiallyLinkedCount": school_linked,
        },
        "factory": {
            "dataset": factory_dataset,
            "officialRecordCount": len(factory_rows),
            "spatiallyLinkedCount": factory_linked,
        },
        "population": {
            "dataset": population_dataset,
            "districtCount": len(population_by_district),
        },
        "healthcare": healthcare_summary,
    }

    summary = {
        "schemaVersion": 1,
        "geography": "대구광역시",
        "schoolRegistry": {
            "dataset": school_dataset,
            "recordCount": len(school_registry),
            "spatiallyLinkedCount": school_linked,
            "countByDistrict": dict(sorted(school_counts.items())),
            "records": school_registry,
        },
        "factorySummary": {
            "dataset": factory_dataset,
            "recordCount": len(factory_rows),
            "spatiallyLinkedCount": factory_linked,
            "countByDistrict": dict(sorted(factory_counts.items())),
            "topIndustrialComplexes": [
                {"name": name, "count": count}
                for name, count in complex_counts.most_common(40)
            ],
            "topIndustriesByDistrict": {
                district: [
                    {"industry": industry, "count": count}
                    for industry, count in counts.most_common(10)
                ]
                for district, counts in sorted(industry_by_district.items())
            },
        },
        "residentPopulation": {
            "dataset": population_dataset,
            "cityTotal": city_total,
            "byDistrict": population_by_district,
            "limitation": "구·군 단위 주민등록인구이며 동 단위 생활인구·직장인구·통근인구가 아님",
        },
        "healthcareRegistry": healthcare_summary,
    }

    args.anchors_output.parent.mkdir(parents=True, exist_ok=True)
    args.summary_output.parent.mkdir(parents=True, exist_ok=True)
    args.anchors_output.write_text(
        json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )

    args.anchor_layer_dir.mkdir(parents=True, exist_ok=True)
    records_by_type: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        records_by_type[str(record["anchorType"])].append(record)
    for anchor_type, typed_records in sorted(records_by_type.items()):
        # Client map layers only need display/picking fields. Keep the rich official
        # evidence in context_anchors.json and avoid shipping it again to browsers.
        client_records = [
            {
                "anchorId": row["anchorId"],
                "name": row["name"],
                "anchorType": row["anchorType"],
                "subtype": row.get("subtype"),
                "longitude": row["longitude"],
                "latitude": row["latitude"],
                "confidence": row.get("confidence"),
                "quality": row.get("quality"),
                "coordinateQuality": row.get("coordinateQuality"),
            }
            for row in typed_records
        ]
        layer_doc = {
            "schemaVersion": doc.get("schemaVersion", 1),
            "generatedAt": doc.get("generatedAt"),
            "geography": doc.get("geography", "대구광역시"),
            "anchorType": anchor_type,
            "recordCount": len(client_records),
            "records": client_records,
        }
        (args.anchor_layer_dir / f"{anchor_type}.json").write_text(
            json.dumps(layer_doc, ensure_ascii=False, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )

    args.summary_output.write_text(
        json.dumps(summary, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "anchors": len(records),
                "schoolOfficial": len(school_registry),
                "schoolLinked": school_linked,
                "factoryOfficial": len(factory_rows),
                "factoryLinked": factory_linked,
                "populationDistricts": len(population_by_district),
                "healthcareOfficial": healthcare_summary.get("recordCount") if healthcare_summary else 0,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
