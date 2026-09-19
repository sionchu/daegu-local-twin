"""Normalize a NAVER DataLab public-web UI XLSX export.

The browser step must use the public DataLab form and its visible download
link. This adapter intentionally accepts only that downloaded workbook; it
does not call NAVER's API, inspect private endpoints, or require credentials.
"""

from __future__ import annotations

import argparse
import io
import json
import math
import re
import zipfile
from datetime import date
from pathlib import Path
from statistics import fmean
from typing import Any, Iterable
from xml.etree import ElementTree as ET


SOURCE_URL = "https://datalab.naver.com/"
DEFAULT_AREAS = ("동성로", "교동", "북성로", "중앙로", "서문시장")
TIME_UNIT_MAP = {"일간": "day", "주간": "week", "월간": "month"}
XML_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS = {"m": XML_NS}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Normalize a NAVER DataLab public-web UI XLSX export."
    )
    parser.add_argument(
        "--input",
        type=Path,
        required=True,
        help="XLSX downloaded from the visible NAVER DataLab result page.",
    )
    parser.add_argument("--output", type=Path, default=Path("public/data/buzz.json"))
    parser.add_argument(
        "--areas",
        default=",".join(DEFAULT_AREAS),
        help="Comma-separated topics expected in the same comparison.",
    )
    parser.add_argument("--source-url", default=SOURCE_URL)
    parser.add_argument("--result-url", help="Optional result URL; otherwise read it from XLSX.")
    parser.add_argument("--source-sha256", required=True)
    parser.add_argument("--retrieved-at", required=True)
    parser.add_argument("--recent-weeks", type=int, default=4)
    parser.add_argument("--previous-weeks", type=int, default=8)
    return parser.parse_args()


def _column_number(column: str) -> int:
    value = 0
    for character in column:
        value = value * 26 + ord(character) - ord("A") + 1
    return value


def _shared_strings(root: ET.Element) -> list[str]:
    strings: list[str] = []
    for item in root.findall("m:si", NS):
        strings.append("".join(node.text or "" for node in item.iter(f"{{{XML_NS}}}t")))
    return strings


def _cell_value(cell: ET.Element, shared_strings: list[str]) -> str | None:
    kind = cell.attrib.get("t")
    if kind == "inlineStr":
        return "".join(node.text or "" for node in cell.iter(f"{{{XML_NS}}}t"))
    value = cell.find("m:v", NS)
    if value is None:
        return None
    if kind == "s":
        index = int(value.text or "-1")
        if index < 0 or index >= len(shared_strings):
            raise ValueError(f"shared string index out of range: {index}")
        return shared_strings[index]
    return value.text


def read_xlsx_rows(raw: bytes) -> list[list[str | None]]:
    """Read the first worksheet from an XLSX using only the Python stdlib."""

    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        names = set(archive.namelist())
        if "xl/sharedStrings.xml" not in names:
            raise ValueError("NAVER export is missing xl/sharedStrings.xml")
        sheet_name = "xl/worksheets/sheet1.xml"
        if sheet_name not in names:
            sheet_name = next(
                (name for name in sorted(names) if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", name)),
                "",
            )
        if not sheet_name:
            raise ValueError("NAVER export has no worksheet XML")
        shared_strings = _shared_strings(ET.fromstring(archive.read("xl/sharedStrings.xml")))
        sheet = ET.fromstring(archive.read(sheet_name))

    rows: list[list[str | None]] = []
    for row in sheet.findall(".//m:row", NS):
        cells: dict[int, str | None] = {}
        for cell in row.findall("m:c", NS):
            reference = cell.attrib.get("r", "")
            column = re.match(r"[A-Z]+", reference)
            if column is None:
                continue
            cells[_column_number(column.group(0))] = _cell_value(cell, shared_strings)
        if cells:
            rows.append([cells.get(index) for index in range(1, max(cells) + 1)])
    return rows


def _metadata(rows: list[list[str | None]]) -> dict[str, str]:
    metadata: dict[str, str] = {}
    for row in rows[:10]:
        if len(row) >= 2 and row[0] and row[1]:
            metadata[str(row[0])] = str(row[1])
    return metadata


def _period_info(period_text: str) -> tuple[str, str, str]:
    match = re.fullmatch(r"(일간|주간|월간)\s*:\s*(.+)", period_text.strip())
    if match is None:
        raise ValueError(f"unexpected NAVER period metadata: {period_text!r}")
    label = match.group(2).strip()
    return match.group(1), TIME_UNIT_MAP[match.group(1)], label


def _parse_date(value: str | None) -> date:
    if not value:
        raise ValueError("NAVER export contains a blank observation date")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"unexpected NAVER observation date: {value!r}") from exc


def _parse_index(value: str | None, area: str, observation_date: str) -> float:
    if value is None or value.strip() == "":
        raise ValueError(f"missing relative index for {area} on {observation_date}")
    try:
        parsed = float(value)
    except ValueError as exc:
        raise ValueError(f"non-numeric relative index for {area} on {observation_date}") from exc
    if not math.isfinite(parsed) or parsed < 0 or parsed > 100:
        raise ValueError(f"relative index out of range for {area} on {observation_date}: {parsed}")
    return parsed


def _rounded(value: float, digits: int) -> float:
    return round(value, digits)


def normalize_export(
    raw: bytes,
    *,
    areas: Iterable[str] = DEFAULT_AREAS,
    source_url: str = SOURCE_URL,
    result_url: str | None = None,
    source_sha256: str,
    retrieved_at: str,
    recent_weeks: int = 4,
    previous_weeks: int = 8,
) -> dict[str, Any]:
    requested_areas = tuple(area.strip() for area in areas if area.strip())
    if not requested_areas:
        raise ValueError("at least one area is required")
    if recent_weeks <= 0 or previous_weeks <= 0:
        raise ValueError("recent-weeks and previous-weeks must be positive")
    if not re.fullmatch(r"[0-9A-Fa-f]{64}", source_sha256):
        raise ValueError("source-sha256 must be a 64-character hexadecimal digest")

    rows = read_xlsx_rows(raw)
    metadata = _metadata(rows)
    if "기간" not in metadata:
        raise ValueError("NAVER export is missing 기간 metadata")
    korean_time_unit, time_unit, period_label = _period_info(metadata["기간"])

    header_index = next(
        (
            index
            for index, row in enumerate(rows)
            if row and row[0] == "날짜" and len(row) >= 2
        ),
        None,
    )
    if header_index is None:
        raise ValueError("NAVER export is missing the 날짜 header row")
    header = rows[header_index]
    if len(header) % 2 != 0:
        raise ValueError("NAVER export date/value columns are not paired")

    area_columns: dict[str, tuple[int, int]] = {}
    for date_index in range(0, len(header), 2):
        if header[date_index] != "날짜" or not header[date_index + 1]:
            raise ValueError("NAVER export has an unexpected date/value header")
        area = str(header[date_index + 1])
        if area in area_columns:
            raise ValueError(f"duplicate NAVER topic: {area}")
        area_columns[area] = (date_index, date_index + 1)
    if set(area_columns) != set(requested_areas):
        raise ValueError(
            f"NAVER topics differ from requested topics: expected {requested_areas}, "
            f"actual {tuple(area_columns)}"
        )

    series: list[dict[str, Any]] = []
    observation_dates: list[date] = []
    for row in rows[header_index + 1 :]:
        if not row or not row[0]:
            continue
        date_values = {str(row[pair[0]]) for pair in area_columns.values() if len(row) > pair[0] and row[pair[0]]}
        if len(date_values) != 1:
            raise ValueError("NAVER export has mismatched dates across topics")
        observation_date_text = next(iter(date_values))
        observation_date = _parse_date(observation_date_text)
        if observation_dates and observation_date <= observation_dates[-1]:
            raise ValueError("NAVER observation dates must be strictly increasing")
        values: dict[str, float] = {}
        for area in requested_areas:
            date_index, value_index = area_columns[area]
            if len(row) <= value_index:
                raise ValueError(f"NAVER export row is missing {area} on {observation_date_text}")
            values[area] = _parse_index(row[value_index], area, observation_date_text)
        observation_dates.append(observation_date)
        series.append({"date": observation_date_text, "values": values})

    required_observations = recent_weeks + previous_weeks
    if len(series) < required_observations:
        raise ValueError(
            f"NAVER export has {len(series)} observations; "
            f"at least {required_observations} are required for the requested windows"
        )

    analysis_series = series[-required_observations:]
    previous_series = analysis_series[:previous_weeks]
    recent_series = analysis_series[previous_weeks:]
    summaries: list[dict[str, Any]] = []
    for area in requested_areas:
        recent_mean = _rounded(fmean(item["values"][area] for item in recent_series), 5)
        previous_mean = _rounded(fmean(item["values"][area] for item in previous_series), 5)
        momentum = None if previous_mean == 0 else _rounded(recent_mean / previous_mean - 1, 6)
        summaries.append(
            {
                "area": area,
                "recentIndex": recent_mean,
                "previousIndex": previous_mean,
                "recentMean": recent_mean,
                "previousMean": previous_mean,
                "momentum": momentum,
                "sourceMode": "public-web-ui",
            }
        )

    result = result_url or metadata.get("url")
    if not result:
        raise ValueError("NAVER export is missing its result URL")
    return {
        "mode": "public-snapshot",
        "provider": "NAVER DataLab",
        "accessMode": "public-web-ui",
        "sourceMode": "public-web-ui",
        "proxyType": "search-relative-interest",
        "relativeIndex": True,
        "sourceUrl": source_url,
        "resultUrl": result,
        "sourceSha256": source_sha256.upper(),
        "retrievedAt": retrieved_at,
        "sourceVersion": f"{period_label} {time_unit} export",
        "sourceDate": observation_dates[-1].isoformat(),
        "query": {
            "topics": list(requested_areas),
            "periodLabel": period_label,
            "periodStart": observation_dates[0].isoformat(),
            "periodEnd": observation_dates[-1].isoformat(),
            "timeUnit": time_unit,
            "timeUnitLabel": korean_time_unit,
            "scope": {key: value for key, value in metadata.items() if key in ("주제", "범위", "성별", "연령대")},
        },
        "series": series,
        "records": summaries,
        "calculation": {
            "recentWindowWeeks": recent_weeks,
            "previousWindowWeeks": previous_weeks,
            "analysisPeriodStart": analysis_series[0]["date"],
            "analysisPeriodEnd": analysis_series[-1]["date"],
            "formula": "momentum = previousMean > 0 ? (recentMean / previousMean) - 1 : null",
            "means": "recentMean is the arithmetic mean of the latest 4 weekly relative-index observations; previousMean is the arithmetic mean of the preceding 8 observations",
        },
        "limitations": [
            "NAVER DataLab normalizes each topic against the maximum within the queried comparison period; values are relative indices, not counts.",
            "This is a search-interest proxy only; it does not measure business outcomes or causal relationships.",
            f"The {len(requested_areas)} topics were queried together in one public comparison, and the export does not provide street-level or store-level demand.",
            "The public UI export contains the observations returned by NAVER at retrieval time; no API credentials or private endpoints were used.",
        ],
    }


def main() -> int:
    args = parse_args()
    if not args.input.exists():
        raise SystemExit(f"input file not found: {args.input}")
    snapshot = normalize_export(
        args.input.read_bytes(),
        areas=args.areas.split(","),
        source_url=args.source_url,
        result_url=args.result_url,
        source_sha256=args.source_sha256,
        retrieved_at=args.retrieved_at,
        recent_weeks=args.recent_weeks,
        previous_weeks=args.previous_weeks,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"wrote {len(snapshot['series'])} weekly observations for "
        f"{len(snapshot['records'])} topics to {args.output}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
