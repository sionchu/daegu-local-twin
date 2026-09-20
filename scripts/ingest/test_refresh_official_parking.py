from __future__ import annotations

import csv
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
sys.path.insert(0, str(SCRIPT_DIR))

import refresh_official_parking as parking  # noqa: E402

HEADERS = [
    "주차장관리번호", "주차장명", "주차장구분", "주차장유형",
    "소재지도로명주소", "소재지지번주소", "주차구획수",
    "급지구분", "부제시행구분", "운영요일",
    "평일운영시작시각", "평일운영종료시각",
    "토요일운영시작시각", "토요일운영종료시각",
    "공휴일운영시작시각", "공휴일운영종료시각",
    "요금정보", "주차기본시간", "주차기본요금",
    "추가단위시간", "추가단위요금", "1일주차권요금적용시간",
    "1일주차권요금", "월정기권요금", "결제방법", "특기사항",
    "관리기관명", "전화번호", "위도", "경도",
    "장애인전용주차구역보유여부", "데이터기준일자",
    "제공기관코드", "제공기관명",
]
def row(
    parking_id: str,
    name: str,
    provider_code: str,
    provider: str,
    address: str,
    spaces: str,
    lat: str,
    lon: str,
) -> list[str]:
    values = {key: "" for key in HEADERS}
    values.update(
        {
            "주차장관리번호": parking_id,
            "주차장명": name,
            "주차장구분": "공영",
            "주차장유형": "노외",
            "소재지지번주소": address,
            "주차구획수": spaces,
            "운영요일": "평일+토요일+공휴일",
            "요금정보": "무료",
            "위도": lat,
            "경도": lon,
            "데이터기준일자": "2026-07-16",
            "제공기관코드": provider_code,
            "제공기관명": provider,
        }
    )
    return [values[key] for key in HEADERS]
class OfficialParkingTest(unittest.TestCase):
    def write_fixture(self, path: Path) -> None:
        buffer = io.StringIO()
        writer = csv.writer(buffer, lineterminator="\n")
        writer.writerow(HEADERS)
        writer.writerow(
            row(
                "P-1", "중구A", "100", "대구광역시 중구",
                "대구광역시 중구 동인동 1", "10", "35.87", "128.60",
            )
        )
        writer.writerow(
            row(
                "P-1", "북구A", "200", "대구광역시 북구",
                "대구광역시 북구 산격동 1", "20", "35.90", "128.61",
            )
        )
        writer.writerow(
            row(
                "P-2", "서구A", "300", "대구광역시 서구",
                "대구광역시 서구 비산동 1", "30", "35.88", "128.56",
            )
        )
        writer.writerow(
            row(
                "P-2", "서구B", "300", "대구광역시 서구",
                "대구광역시 서구 중리동 2", "40", "35.86", "128.53",
            )
        )
        writer.writerow(
            row(
                "S-1", "서울A", "400", "서울특별시 중구",
                "서울특별시 중구 필동 1", "99", "37.56", "126.99",
            )
        )
        path.write_bytes(buffer.getvalue().encode("cp949"))
    def test_normalize_preserves_source_collisions_with_unique_ids(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "parking.csv"
            self.write_fixture(source)
            document = parking.normalize(source, "2026-09-20T08:16:51Z")

        self.assertEqual(document["source"]["encoding"], "cp949")
        self.assertEqual(document["source"]["sourceRecordCount"], 5)
        self.assertEqual(document["coverage"]["daeguParkingRecords"], 4)
        self.assertEqual(document["coverage"]["totalSpaces"], 100)
        self.assertEqual(document["coverage"]["duplicateSourceManagementIds"], 2)
        self.assertEqual(document["coverage"]["duplicateProviderManagementIds"], 1)

        records = document["records"]
        ids = [record["parkingId"] for record in records]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertIn("100:P-1", ids)
        self.assertIn("200:P-1", ids)
        self.assertIn("300:P-2:1", ids)
        self.assertIn("300:P-2:2", ids)
        self.assertTrue(all(record["providerCode"] for record in records))
        self.assertTrue(all(record["district"] for record in records))
    def test_invalid_daegu_coordinate_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "parking.csv"
            buffer = io.StringIO()
            writer = csv.writer(buffer, lineterminator="\n")
            writer.writerow(HEADERS)
            writer.writerow(
                row(
                    "P-1", "잘못된좌표", "100", "대구광역시 중구",
                    "대구광역시 중구 동인동 1", "10", "37.56", "126.99",
                )
            )
            source.write_bytes(buffer.getvalue().encode("cp949"))
            with self.assertRaisesRegex(ValueError, "out-of-range Daegu coordinate"):
                parking.normalize(source, "2026-09-20T08:16:51Z")

    def test_committed_snapshot_matches_verified_source(self) -> None:
        document = json.loads(
            (REPO_ROOT / "public/data/parking.json").read_text(encoding="utf-8")
        )
        self.assertEqual(
            document["source"]["sourceSha256"],
            "FDABC9DD32B9DB72BA0F718A35F0271F8DB55EAE8CB48397E471B0988E127085",
        )
        self.assertEqual(document["source"]["sourceRecordCount"], 18883)
        self.assertEqual(document["coverage"]["daeguParkingRecords"], 1086)
        self.assertEqual(document["coverage"]["coordinateRecords"], 1086)
        self.assertEqual(document["coverage"]["totalSpaces"], 50687)
        self.assertEqual(document["coverage"]["publicRecords"], 915)
        self.assertEqual(document["coverage"]["privateRecords"], 171)
        self.assertEqual(document["coverage"]["duplicateSourceManagementIds"], 24)
        self.assertEqual(document["coverage"]["duplicateProviderManagementIds"], 1)


if __name__ == "__main__":
    unittest.main()
