"""Normalize 2026 Schoolinfo public K-12 capacity for Daegu.

Inputs are the public Schoolinfo `openData.do` JSON responses for:
- APITYPE=0  : school basic information (official coordinates)
- APITYPE=63 : gender student counts
for location code 03 and school request kinds 02..07.

Raw responses stay outside Git. The normalized snapshot excludes phone/fax/homepage
fields and preserves only fields needed for LocalTwin education-capacity evidence.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SOURCE_PROVIDER = "한국교육학술정보원 / 학교알리미"
SOURCE_YEAR = 2026
SOURCE_LOCATION_CODE = "03"
SOURCE_LOCATION_NAME = "대구광역시교육청"
PUBLIC_DATA_URL = "https://www.schoolinfo.go.kr/ng/go/pnnggo_a01_l2.do"
DATA_ENDPOINT = "https://www.schoolinfo.go.kr/openData.do"
REQUEST_KINDS = ("02", "03", "04", "05", "06", "07")
BASIC_API_TYPE = "0"
STUDENT_API_TYPE = "63"

DAEGU_BOUNDS = {
    "west": 128.0,
    "south": 35.0,
    "east": 129.5,
    "north": 37.0,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("public/data/school_capacity.json"),
    )
    parser.add_argument("--retrieved-at")
    return parser.parse_args()


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest().upper()


def bundle_sha256(paths: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in sorted(paths, key=lambda value: value.name):
        digest.update(path.name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest().upper()


def load_response(path: Path) -> list[dict[str, Any]]:
    document = json.loads(path.read_text(encoding="utf-8"))
    records = document.get("list")
    if not isinstance(records, list):
        raise ValueError(f"Schoolinfo response has no list array: {path}")
    return records


def integer(value: Any) -> int | None:
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        raise ValueError(f"invalid numeric value: {value!r}")
    try:
        return int(float(value))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"invalid numeric value: {value!r}") from exc


def student_total(row: dict[str, Any]) -> int | None:
    for key in ("SUM", "COL_SUM"):
        value = integer(row.get(key))
        if value is not None:
            return value
    return None


def sex_total(row: dict[str, Any], prefix: str) -> int | None:
    direct = integer(row.get(prefix))
    if direct is not None:
        return direct

    numbered: list[tuple[int, int]] = []
    pattern = re.compile(rf"^{re.escape(prefix)}(\d+)$")
    for key, value in row.items():
        match = pattern.match(str(key))
        if not match:
            continue
        parsed = integer(value)
        if parsed is not None:
            numbered.append((int(match.group(1)), parsed))
    if not numbered:
        return None

    # Special/miscellaneous-school responses expose staged subtotal fields
    # (e.g. COL_MSUM1..4); the highest suffix is the published grand total.
    return max(numbered, key=lambda item: item[0])[1]


def is_active_school(row: dict[str, Any]) -> bool:
    return (
        str(row.get("CLOSE_YN") or "").strip() == "N"
        and str(row.get("ABSCH_YN") or "").strip() != "Y"
        and str(row.get("PBAN_EXCP_YN") or "").strip() != "Y"
    )


def normalize(input_dir: Path, retrieved_at: str) -> dict[str, Any]:
    basic_by_code: dict[str, dict[str, Any]] = {}
    basic_request_kind: dict[str, str] = {}
    students_by_code: dict[str, dict[str, Any]] = {}
    student_request_kind: dict[str, str] = {}
    source_paths: list[Path] = []
    request_evidence: list[dict[str, Any]] = []

    for request_kind in REQUEST_KINDS:
        for source_type, api_type, prefix in (
            ("basic", BASIC_API_TYPE, "basic"),
            ("students", STUDENT_API_TYPE, "students"),
        ):
            path = input_dir / f"{prefix}-{request_kind}.json"
            if not path.exists():
                raise FileNotFoundError(path)
            source_paths.append(path)
            records = load_response(path)
            request_evidence.append(
                {
                    "fileName": path.name,
                    "sourceType": source_type,
                    "apiType": api_type,
                    "schoolRequestKindCode": request_kind,
                    "rawRecordCount": len(records),
                    "sourceSha256": file_sha256(path),
                }
            )
            target = basic_by_code if source_type == "basic" else students_by_code
            kind_target = (
                basic_request_kind
                if source_type == "basic"
                else student_request_kind
            )
            for row in records:
                school_code = str(row.get("SCHUL_CODE") or "").strip()
                if not school_code:
                    raise ValueError(f"missing SCHUL_CODE in {path.name}")
                if school_code in target:
                    raise ValueError(
                        f"duplicate SCHUL_CODE across {source_type} responses: "
                        f"{school_code}"
                    )
                target[school_code] = row
                kind_target[school_code] = request_kind

    active_basic = {
        code: row
        for code, row in basic_by_code.items()
        if is_active_school(row)
    }
    unexpected_student_codes = sorted(set(students_by_code) - set(active_basic))
    if unexpected_student_codes:
        raise ValueError(
            "student responses include non-active schools: "
            + ", ".join(unexpected_student_codes[:10])
        )

    records: list[dict[str, Any]] = []
    missing_student_codes: list[str] = []
    coordinate_count = 0
    student_capacity_count = 0
    total_students = 0
    male_students_total = 0
    female_students_total = 0
    student_counts_by_request_kind: dict[str, int] = {}

    for school_code in sorted(active_basic):
        basic = active_basic[school_code]
        student = students_by_code.get(school_code)

        longitude = float(basic.get("LGTUD"))
        latitude = float(basic.get("LTTUD"))
        if not (
            DAEGU_BOUNDS["west"] < longitude < DAEGU_BOUNDS["east"]
            and DAEGU_BOUNDS["south"] < latitude < DAEGU_BOUNDS["north"]
        ):
            raise ValueError(
                f"school coordinate outside Daegu validation bounds: "
                f"{school_code} {longitude},{latitude}"
            )
        coordinate_count += 1

        total = student_total(student) if student else None
        male = sex_total(student, "COL_MSUM") if student else None
        female = sex_total(student, "COL_WSUM") if student else None

        if student:
            if total is None:
                raise ValueError(
                    f"student response has no total field for {school_code}"
                )
            if male is not None and female is not None and male + female != total:
                raise ValueError(
                    f"student sex totals do not equal total for {school_code}: "
                    f"{male}+{female}!={total}"
                )
            student_capacity_count += 1
            total_students += total
            male_students_total += male or 0
            female_students_total += female or 0
            request_kind = student_request_kind[school_code]
            student_counts_by_request_kind[request_kind] = (
                student_counts_by_request_kind.get(request_kind, 0) + 1
            )
        else:
            missing_student_codes.append(school_code)

        records.append(
            {
                "schoolCode": school_code,
                "schoolName": str(basic.get("SCHUL_NM") or "").strip(),
                "schoolRequestKindCode": basic_request_kind[school_code],
                "schoolKindCode": str(
                    basic.get("SCHUL_KND_SC_CODE") or ""
                ).strip(),
                "schoolCourse": (
                    str(basic.get("SCHUL_CRSE_SC_VALUE_NM") or "").strip()
                    or None
                ),
                "administrativeAreaCode": str(
                    basic.get("ADRCD_CD") or ""
                ).strip(),
                "administrativeAreaName": str(
                    basic.get("ADRCD_NM") or ""
                ).strip(),
                "roadAddress": str(
                    basic.get("SCHUL_RDNMA") or ""
                ).strip(),
                "longitude": round(longitude, 10),
                "latitude": round(latitude, 10),
                "totalStudents": total,
                "maleStudents": male,
                "femaleStudents": female,
                "studentCapacityQuality": (
                    "official-2026" if student else "official-missing"
                ),
                "coordinateQuality": "official-schoolinfo",
            }
        )

    if coordinate_count != len(records):
        raise ValueError("not all active schools have official coordinates")

    if male_students_total + female_students_total != total_students:
        raise ValueError(
            "aggregate male/female student totals do not equal total students"
        )

    coverage_pct = (
        round(student_capacity_count / len(records) * 100, 2)
        if records
        else 0.0
    )

    return {
        "schemaVersion": 1,
        "generatedAt": retrieved_at,
        "source": {
            "provider": SOURCE_PROVIDER,
            "publicDataUrl": PUBLIC_DATA_URL,
            "dataEndpoint": DATA_ENDPOINT,
            "sourceYear": SOURCE_YEAR,
            "locationCode": SOURCE_LOCATION_CODE,
            "locationName": SOURCE_LOCATION_NAME,
            "sourceBundleSha256": bundle_sha256(source_paths),
            "requests": sorted(
                request_evidence,
                key=lambda row: (
                    row["sourceType"],
                    row["schoolRequestKindCode"],
                ),
            ),
        },
        "coverage": {
            "rawBasicUniqueSchools": len(basic_by_code),
            "rawStudentUniqueSchools": len(students_by_code),
            "activeSchoolRecords": len(records),
            "officialCoordinateRecords": coordinate_count,
            "studentCapacityRecords": student_capacity_count,
            "studentCapacityCoveragePct": coverage_pct,
            "missingStudentCapacityCount": len(missing_student_codes),
            "totalStudents": total_students,
            "maleStudents": male_students_total,
            "femaleStudents": female_students_total,
            "studentRecordsByRequestKind": dict(
                sorted(student_counts_by_request_kind.items())
            ),
        },
        "records": records,
        "missingStudentCapacitySchoolCodes": missing_student_codes,
        "limitations": [
            "2026 학교알리미 공개용데이터의 활성·공시대상 학교만 포함합니다.",
            "학교 좌표는 학교알리미 학교기본정보의 공식 위도·경도를 사용합니다.",
            "학생수는 학교알리미 2026 성별 학생수 공시값이며 실시간 등교인원·유동인구가 아닙니다.",
            "활성학교 중 대구고등학교부설방송통신고등학교 1개교는 성별 학생수 공개응답이 없어 capacity를 null로 유지합니다.",
            "대학·전문대학 재학생/교직원은 이 초중등 snapshot 범위가 아니며 별도 고등교육 데이터로 보강해야 합니다.",
            "전화번호·팩스·홈페이지 등 LocalTwin 분석에 불필요한 연락처 필드는 정규화 결과에서 제외합니다.",
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
    document = normalize(args.input_dir, retrieved_at)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(document, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "output": str(args.output),
                "activeSchools": document["coverage"]["activeSchoolRecords"],
                "officialCoordinates": document["coverage"][
                    "officialCoordinateRecords"
                ],
                "studentCapacityRecords": document["coverage"][
                    "studentCapacityRecords"
                ],
                "studentCapacityCoveragePct": document["coverage"][
                    "studentCapacityCoveragePct"
                ],
                "totalStudents": document["coverage"]["totalStudents"],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
