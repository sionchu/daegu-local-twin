"""Download and normalize the official Daegu Metro ridership file.

The public-data file can be downloaded without an API key. The portal also exposes an
auto-converted OpenAPI, but that path requires a data.go.kr service key. This adapter
therefore prefers the official no-login file distribution and keeps the resulting
snapshot provenance explicit.

Examples:
    python scripts/ingest/refresh_daegu_transit.py
    python scripts/ingest/refresh_daegu_transit.py --input path/to/file.csv
    python scripts/ingest/refresh_daegu_transit.py --month 7
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DATASET_ID = "15002503"
SOURCE_URL = f"https://www.data.go.kr/data/{DATASET_ID}/fileData.do?recommendDataYn=Y"
SELECT_DOWNLOAD_URL = "https://www.data.go.kr/tcs/dss/selectFileDataDownload.do"
FILE_DOWNLOAD_URL = "https://www.data.go.kr/cmm/cmm/fileDownload.do"
DEFAULT_STATIONS = ("중앙로", "반월당", "서문시장", "대구역")
BUSINESS_HOUR_COLUMNS = tuple(f"{hour:02d}시-{hour + 1:02d}시" for hour in range(10, 22))
ALL_HOUR_COLUMNS = tuple(f"{hour:02d}시-{hour + 1:02d}시" for hour in range(5, 24))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Refresh official Daegu Metro ridership snapshot.")
    parser.add_argument("--input", type=Path, help="Optional manually downloaded CSV/ZIP. Skips network download.")
    parser.add_argument("--output", type=Path, default=Path("public/data/transit.json"))
    parser.add_argument("--raw-dir", type=Path, default=Path("data/raw"))
    parser.add_argument("--month", type=int, help="Month to aggregate. Defaults to the latest month in the file.")
    parser.add_argument(
        "--stations",
        default=",".join(DEFAULT_STATIONS),
        help="Comma-separated station names. A trailing 역 is optional.",
    )
    parser.add_argument("--dataset-version", help="Override YYYYMMDD version when using a manually named file.")
    parser.add_argument("--keep-raw", action="store_true", help="Keep the downloaded source under data/raw.")
    return parser.parse_args()


def request_bytes(url: str, *, referer: str | None = None) -> tuple[bytes, dict[str, str]]:
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; LocalTwinDaegu/0.1; public-data research)",
        "Accept": "*/*",
    }
    if referer:
        headers["Referer"] = referer
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=45) as response:
        return response.read(), dict(response.headers.items())


def request_text(url: str) -> str:
    body, _ = request_bytes(url)
    for encoding in ("utf-8", "utf-8-sig", "cp949"):
        try:
            return body.decode(encoding)
        except UnicodeDecodeError:
            continue
    return body.decode("utf-8", errors="replace")


def quoted_args(fragment: str) -> list[str]:
    return [left or right for left, right in re.findall(r"'([^']*)'|\"([^\"]*)\"", fragment)]


def resolve_download_descriptor(page_html: str) -> tuple[str, str]:
    """Return (publicDataPk, uddi) from the portal's download onclick contract."""
    for match in re.finditer(r"fn_fileDataDown\s*\(([^)]*)\)", page_html, flags=re.IGNORECASE):
        args = quoted_args(match.group(1))
        uddi = next((item.split("uddi:", 1)[1] for item in args if item.startswith("uddi:")), None)
        if not uddi:
            continue
        public_data_pk = next((item for item in args if item.isdigit() and len(item) >= 6), DATASET_ID)
        return public_data_pk, uddi
    raise RuntimeError(
        "Could not resolve the data.go.kr file descriptor from the detail page. "
        "Download the official CSV manually and rerun with --input."
    )


def find_nested(obj: Any, key: str) -> Any:
    if isinstance(obj, dict):
        if key in obj and obj[key] not in (None, ""):
            return obj[key]
        for value in obj.values():
            found = find_nested(value, key)
            if found not in (None, ""):
                return found
    if isinstance(obj, list):
        for value in obj:
            found = find_nested(value, key)
            if found not in (None, ""):
                return found
    return None


def version_from_text(text: str) -> str | None:
    match = re.search(r"역별일별시간별승하차인원현황[_-]?(20\d{6})", text)
    return match.group(1) if match else None


def download_latest() -> tuple[bytes, str, str]:
    page_html = request_text(SOURCE_URL)
    version = version_from_text(page_html) or "unknown"
    public_data_pk, uddi = resolve_download_descriptor(page_html)
    query = urllib.parse.urlencode(
        {
            "publicDataDetailPk": f"uddi:{uddi}",
            "publicDataPk": public_data_pk,
            "atchFileId": "",
            "fileDetailSn": "1",
            "url": "/tcs/dss/selectFileDataDownload.do",
        }
    )
    metadata_raw, _ = request_bytes(f"{SELECT_DOWNLOAD_URL}?{query}", referer=SOURCE_URL)
    metadata = json.loads(metadata_raw.decode("utf-8"))
    atch_file_id = find_nested(metadata, "atchFileId")
    file_detail_sn = str(find_nested(metadata, "fileDetailSn") or "1")
    data_name = find_nested(metadata, "dataNm") or f"daegu-metro-ridership-{version}.csv"
    if not atch_file_id:
        raise RuntimeError("data.go.kr did not return atchFileId for the official file.")

    file_query = urllib.parse.urlencode(
        {
            "atchFileId": atch_file_id,
            "fileDetailSn": file_detail_sn,
            "dataNm": data_name,
        }
    )
    body, headers = request_bytes(f"{FILE_DOWNLOAD_URL}?{file_query}", referer=SOURCE_URL)
    disposition = headers.get("Content-Disposition", "")
    filename_match = re.search(r"filename\*?=(?:UTF-8''|\")?([^\";]+)", disposition, flags=re.IGNORECASE)
    filename = urllib.parse.unquote(filename_match.group(1).strip()) if filename_match else str(data_name)
    return body, filename, version


def unpack_source(raw: bytes, filename: str) -> tuple[bytes, str]:
    if raw[:4] == b"PK\x03\x04" or filename.lower().endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            csv_names = [name for name in archive.namelist() if name.lower().endswith(".csv")]
            if not csv_names:
                raise RuntimeError("Official ZIP contained no CSV file.")
            csv_name = sorted(csv_names)[0]
            return archive.read(csv_name), csv_name
    return raw, filename


def decode_csv(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "cp949", "euc-kr", "utf-8"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise RuntimeError("Could not decode official CSV as UTF-8/CP949/EUC-KR.")


def clean_number(value: str | None) -> int:
    if value is None:
        return 0
    cleaned = re.sub(r"[^0-9-]", "", str(value))
    return int(cleaned) if cleaned not in ("", "-") else 0


STATION_ALIASES = {
    "반월당1": "반월당",
    "반월당2": "반월당",
}


def clean_station(value: str) -> str:
    value = re.sub(r"\([^)]*\)", "", value or "")
    value = re.sub(r"\[[^]]*\]", "", value)
    value = value.replace(" ", "").strip()
    value = value[:-1] if value.endswith("역") else value
    return STATION_ALIASES.get(value, value)


def clean_row(row: dict[str, str]) -> dict[str, str]:
    return {(key or "").strip().lstrip("\ufeff"): (value or "").strip() for key, value in row.items()}


def row_hour_total(row: dict[str, str], columns: tuple[str, ...]) -> int:
    return sum(clean_number(row.get(column)) for column in columns)


def normalize_transit(
    csv_text: str,
    *,
    station_targets: tuple[str, ...],
    requested_month: int | None,
    dataset_version: str,
) -> dict[str, Any]:
    reader = csv.DictReader(io.StringIO(csv_text))
    rows = [clean_row(row) for row in reader]
    required = {"월", "일", "역번호", "역명", "승하차"}
    if not rows or not required.issubset(rows[0]):
        actual = sorted(rows[0].keys()) if rows else []
        raise RuntimeError(f"Unexpected CSV columns. Required={sorted(required)} actual={actual}")

    months = sorted({clean_number(row.get("월")) for row in rows if clean_number(row.get("월")) > 0})
    if not months:
        raise RuntimeError("No valid month values were found in the official CSV.")
    month = requested_month or months[-1]
    if month not in months:
        raise RuntimeError(f"Month {month} is absent. Available months: {months}")

    normalized_targets = {clean_station(name): name.rstrip("역") for name in station_targets}
    daily: dict[str, dict[int, dict[str, Any]]] = defaultdict(
        lambda: defaultdict(
            lambda: {
                "total": 0,
                "business": 0,
                "boardings": 0,
                "alightings": 0,
                "stationNumbers": set(),
            }
        )
    )

    for row in rows:
        if clean_number(row.get("월")) != month:
            continue
        station_key = clean_station(row.get("역명", ""))
        if station_key not in normalized_targets:
            continue
        day = clean_number(row.get("일"))
        if day <= 0:
            continue

        hourly_total = row_hour_total(row, ALL_HOUR_COLUMNS)
        day_total = clean_number(row.get("일계")) or hourly_total
        business_total = row_hour_total(row, BUSINESS_HOUR_COLUMNS)
        direction = (row.get("승하차") or "").strip()

        record = daily[station_key][day]
        record["total"] += day_total
        record["business"] += business_total
        if "승차" in direction:
            record["boardings"] += day_total
        elif "하차" in direction:
            record["alightings"] += day_total
        station_number = (row.get("역번호") or "").strip()
        if station_number:
            record["stationNumbers"].add(station_number)

    records: list[dict[str, Any]] = []
    for station_key, display in normalized_targets.items():
        by_day = daily.get(station_key, {})
        if not by_day:
            continue
        days = sorted(by_day)
        count = len(days)
        station_numbers = sorted({n for day in days for n in by_day[day]["stationNumbers"]})
        records.append(
            {
                "station": f"{display}역",
                "stationNumbers": station_numbers,
                "daysObserved": count,
                "averageDailyTotal": round(sum(by_day[day]["total"] for day in days) / count, 1),
                "averageDailyBusinessHours": round(sum(by_day[day]["business"] for day in days) / count, 1),
                "averageDailyBoardings": round(sum(by_day[day]["boardings"] for day in days) / count, 1),
                "averageDailyAlightings": round(sum(by_day[day]["alightings"] for day in days) / count, 1),
                "sourceMode": "official-file-snapshot",
            }
        )

    missing = [f"{display}역" for key, display in normalized_targets.items() if key not in daily]
    return {
        "mode": "official-snapshot",
        "provider": "대구교통공사",
        "datasetId": DATASET_ID,
        "datasetVersion": dataset_version,
        "sourceUrl": SOURCE_URL,
        "month": month,
        "businessHours": "10:00-22:00",
        "retrievedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "records": records,
        "missingStations": missing,
        "limitations": [
            "역 단위 승하차 실측 통계이며 개별 점포 앞 보행량이 아님",
            "LocalTwin의 점포/셀 수요로 사용하려면 역-셀 거리감쇠 등 별도 모델 변환이 필요",
        ],
    }


def main() -> int:
    args = parse_args()
    targets = tuple(name.strip() for name in args.stations.split(",") if name.strip())
    if not targets:
        raise SystemExit("At least one station is required.")

    if args.input:
        raw = args.input.read_bytes()
        filename = args.input.name
        version = args.dataset_version or version_from_text(filename) or "unknown"
    else:
        try:
            raw, filename, discovered_version = download_latest()
        except Exception as exc:
            raise SystemExit(
                f"Automatic official-file download failed: {exc}\n"
                f"Manual fallback: download {SOURCE_URL} and rerun with --input <file>."
            ) from exc
        version = args.dataset_version or discovered_version
        if args.keep_raw:
            args.raw_dir.mkdir(parents=True, exist_ok=True)
            (args.raw_dir / filename).write_bytes(raw)

    csv_bytes, csv_name = unpack_source(raw, filename)
    if version == "unknown":
        version = version_from_text(csv_name) or "unknown"
    snapshot = normalize_transit(
        decode_csv(csv_bytes),
        station_targets=targets,
        requested_month=args.month,
        dataset_version=version,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"wrote {len(snapshot['records'])} official station records "
        f"for month {snapshot['month']} to {args.output}"
    )
    if snapshot["missingStations"]:
        print("missing stations:", ", ".join(snapshot["missingStations"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
