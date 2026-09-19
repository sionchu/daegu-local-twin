"""Normalize the official SEMAS business snapshot for the LocalTwin map extent.

The adapter accepts either the official ZIP download or its Daegu CSV member.
It keeps source category fields intact, adds only the LocalTwin category mapping,
and filters records by the exact union of the current map-cell boundaries.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import zipfile
from collections import Counter
from pathlib import Path
from typing import Iterable, Iterator, Mapping, Sequence


DATASET_ID = "15083033"
DATASET_VERSION = "20260630"
DATASET_DATE = "2026-06-30"

Point = tuple[float, float]
Cell = Mapping[str, object]


def clean(value: object) -> str | None:
    """Return a stripped string, or None for an empty source value."""

    if value is None:
        return None
    text = str(value).strip()
    return text or None


def point_on_segment(point: Point, start: Point, end: Point, epsilon: float = 1e-10) -> bool:
    """Return whether a point lies on a line segment, including its endpoints."""

    x, y = point
    ax, ay = start
    bx, by = end
    cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax)
    if abs(cross) > epsilon:
        return False
    return (
        min(ax, bx) - epsilon <= x <= max(ax, bx) + epsilon
        and min(ay, by) - epsilon <= y <= max(ay, by) + epsilon
    )


def point_in_polygon(point: Point, boundary: Sequence[Point]) -> bool:
    """Use ray casting, treating polygon boundaries as inside."""

    x, y = point
    inside = False
    for index, start in enumerate(boundary):
        end = boundary[(index + 1) % len(boundary)]
        if point_on_segment(point, start, end):
            return True
        ax, ay = start
        bx, by = end
        if (ay > y) != (by > y):
            intersection_x = (bx - ax) * (y - ay) / (by - ay) + ax
            if x < intersection_x:
                inside = not inside
    return inside


def cell_boundary(cell: Cell) -> tuple[Point, ...]:
    raw_boundary = cell.get("boundary")
    if not isinstance(raw_boundary, list) or len(raw_boundary) < 3:
        raise ValueError(f"Cell {cell.get('cellId', '<unknown>')} has no valid boundary")
    boundary: list[Point] = []
    for vertex in raw_boundary:
        if not isinstance(vertex, Mapping):
            raise ValueError(f"Cell {cell.get('cellId', '<unknown>')} has an invalid vertex")
        try:
            boundary.append((float(vertex["lon"]), float(vertex["lat"])))
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError(f"Cell {cell.get('cellId', '<unknown>')} has an invalid vertex") from error
    return tuple(boundary)


def match_cell(lon: float, lat: float, cells: Sequence[Cell]) -> tuple[str, str] | None:
    """Match a coordinate to the first current map cell containing it."""

    for cell in cells:
        cell_id = clean(cell.get("cellId"))
        if not cell_id:
            raise ValueError("Every map cell must have a cellId")
        if point_in_polygon((lon, lat), cell_boundary(cell)):
            if cell_id.startswith("hex-dongseongro-"):
                segment = "dongseongro"
            elif cell_id.startswith("hex-gyodong-"):
                segment = "gyodong"
            elif cell_id.startswith("hex-buksungro-"):
                segment = "buksungro"
            else:
                segment = "current-map-other"
            return cell_id, segment
    return None


def local_twin_category(row: Mapping[str, object]) -> str:
    """Map source categories to the existing LocalTwin category vocabulary."""

    major = clean(row.get("상권업종대분류명")) or ""
    category_text = " ".join(
        clean(row.get(field)) or ""
        for field in ("상권업종대분류명", "상권업종중분류명", "상권업종소분류명")
    )

    if major == "음식" and any(term in category_text for term in ("카페", "커피", "다방")):
        return "cafe"
    if major == "음식":
        return "restaurant"
    if major == "소매":
        return "retail"
    if any(term in category_text for term in ("미용", "뷰티", "헤어", "네일", "피부")):
        return "beauty"
    return "service"


def parse_coordinate(row: Mapping[str, object]) -> tuple[Point | None, str | None]:
    """Parse source longitude/latitude and classify missing or invalid values."""

    longitude_text = clean(row.get("경도"))
    latitude_text = clean(row.get("위도"))
    if longitude_text is None or latitude_text is None:
        return None, "missing"
    try:
        longitude = float(longitude_text)
        latitude = float(latitude_text)
    except ValueError:
        return None, "invalid"
    if not (
        math.isfinite(longitude)
        and math.isfinite(latitude)
        and -180 <= longitude <= 180
        and -90 <= latitude <= 90
    ):
        return None, "invalid"
    return (longitude, latitude), None


def _source_category(row: Mapping[str, object]) -> dict[str, dict[str, str | None]]:
    return {
        "major": {
            "code": clean(row.get("상권업종대분류코드")),
            "name": clean(row.get("상권업종대분류명")),
        },
        "mid": {
            "code": clean(row.get("상권업종중분류코드")),
            "name": clean(row.get("상권업종중분류명")),
        },
        "small": {
            "code": clean(row.get("상권업종소분류코드")),
            "name": clean(row.get("상권업종소분류명")),
        },
        "standardIndustry": {
            "code": clean(row.get("표준산업분류코드")),
            "name": clean(row.get("표준산업분류명")),
        },
    }


def _normalized_record(
    row: Mapping[str, object],
    point: Point,
    dataset_id: str,
    dataset_version: str,
    dataset_date: str,
) -> dict[str, object]:
    return {
        "sourceBusinessId": clean(row.get("상가업소번호")),
        "businessName": clean(row.get("상호명")),
        "longitude": point[0],
        "latitude": point[1],
        "sourceCategory": _source_category(row),
        "category": local_twin_category(row),
        "source": {
            "datasetId": dataset_id,
            "version": dataset_version,
            "date": dataset_date,
        },
        "mode": "official-snapshot",
    }


def _csv_rows_from_zip(source: Path) -> Iterator[dict[str, str]]:
    with zipfile.ZipFile(source) as archive:
        candidates: list[str] = []
        for member in archive.infolist():
            if not member.filename.lower().endswith(".csv"):
                continue
            with archive.open(member) as raw_member:
                with io.TextIOWrapper(raw_member, encoding="utf-8-sig", newline="") as text:
                    first_row = next(csv.DictReader(text), None)
            if first_row and first_row.get("시도명") == "대구광역시":
                candidates.append(member.filename)

        if len(candidates) != 1:
            raise ValueError(
                "Expected exactly one Daegu CSV member identified by 시도명=대구광역시; "
                f"found {len(candidates)}"
            )

        with archive.open(candidates[0]) as raw_member:
            with io.TextIOWrapper(raw_member, encoding="utf-8-sig", newline="") as text:
                yield from csv.DictReader(text)


def source_rows(source: Path) -> Iterator[dict[str, str]]:
    """Yield rows from an official ZIP or a direct UTF-8 CSV."""

    if zipfile.is_zipfile(source):
        yield from _csv_rows_from_zip(source)
        return
    with source.open("r", encoding="utf-8-sig", newline="") as text:
        yield from csv.DictReader(text)


def load_cells(path: Path) -> list[Cell]:
    with path.open("r", encoding="utf-8") as handle:
        cells = json.load(handle)
    if not isinstance(cells, list) or not cells:
        raise ValueError("The map-cell file must contain a non-empty JSON array")
    for cell in cells:
        if not isinstance(cell, Mapping):
            raise ValueError("The map-cell file contains a non-object cell")
        cell_boundary(cell)
    return cells


def normalize_rows(
    rows: Iterable[Mapping[str, object]],
    cells: Sequence[Cell],
    *,
    dataset_id: str = DATASET_ID,
    dataset_version: str = DATASET_VERSION,
    dataset_date: str = DATASET_DATE,
) -> tuple[list[dict[str, object]], dict[str, object]]:
    """Filter, deterministically deduplicate, and normalize source rows."""

    records: list[dict[str, object]] = []
    seen_ids: set[str] = set()
    raw_major_counts: Counter[str] = Counter()
    local_category_counts: Counter[str] = Counter()
    segment_counts: Counter[str] = Counter()
    cell_counts: Counter[str] = Counter()
    raw_record_count = 0
    missing_coordinate_count = 0
    invalid_coordinate_count = 0
    missing_identifier_count = 0
    missing_name_count = 0
    corridor_candidate_count = 0
    duplicate_rows_dropped = 0

    for row in rows:
        raw_record_count += 1
        coordinate, coordinate_issue = parse_coordinate(row)
        if coordinate_issue == "missing":
            missing_coordinate_count += 1
            continue
        if coordinate_issue == "invalid":
            invalid_coordinate_count += 1
            continue
        assert coordinate is not None

        match = match_cell(coordinate[0], coordinate[1], cells)
        if match is None:
            continue
        corridor_candidate_count += 1
        source_id = clean(row.get("상가업소번호"))
        if source_id is None:
            missing_identifier_count += 1
            continue
        if source_id in seen_ids:
            duplicate_rows_dropped += 1
            continue

        seen_ids.add(source_id)
        cell_id, segment = match
        record = _normalized_record(
            row,
            coordinate,
            dataset_id,
            dataset_version,
            dataset_date,
        )
        records.append(record)
        segment_counts[segment] += 1
        cell_counts[cell_id] += 1
        major = clean(row.get("상권업종대분류명")) or "(없음)"
        raw_major_counts[major] += 1
        local_category_counts[str(record["category"])] += 1
        if clean(row.get("상호명")) is None:
            missing_name_count += 1

    records.sort(key=lambda record: str(record["sourceBusinessId"]))
    report: dict[str, object] = {
        "datasetId": dataset_id,
        "datasetVersion": dataset_version,
        "datasetDate": dataset_date,
        "rawRecordCount": raw_record_count,
        "normalizedRecordCount": len(records),
        "corridorCandidateCountBeforeDedup": corridor_candidate_count,
        "duplicateRowsDropped": duplicate_rows_dropped,
        "sourceMissingCoordinateCount": missing_coordinate_count,
        "sourceInvalidCoordinateCount": invalid_coordinate_count,
        "sourceMissingIdentifierCount": missing_identifier_count,
        "normalizedMissingBusinessNameCount": missing_name_count,
        "corridorSegmentCounts": dict(sorted(segment_counts.items())),
        "cellCounts": dict(sorted(cell_counts.items())),
        "sourceMajorCategoryCounts": dict(sorted(raw_major_counts.items())),
        "localTwinCategoryCounts": dict(sorted(local_category_counts.items())),
        "duplicatePolicy": "sourceBusinessId; retain first corridor row in source order",
        "filter": "point-in-polygon union of all boundaries in public/data/opportunity_cells.json; boundary included",
    }
    return records, report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="Official SEMAS ZIP or Daegu CSV")
    parser.add_argument(
        "--cells",
        type=Path,
        default=Path("public/data/opportunity_cells.json"),
        help="Current LocalTwin map-cell JSON",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("public/data/businesses.json"),
        help="Normalized business JSON output",
    )
    parser.add_argument("--report", type=Path, help="Optional quality report JSON output")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    cells = load_cells(args.cells)
    records, report = normalize_rows(source_rows(args.source), cells)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
