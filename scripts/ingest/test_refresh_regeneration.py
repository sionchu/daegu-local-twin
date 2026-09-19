import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from scripts.ingest.refresh_regeneration import normalize_workbook


MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def _cell(reference: str, value: str) -> str:
    escaped = (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
    return f'<c r="{reference}" t="inlineStr"><is><t>{escaped}</t></is></c>'


def _row(number: int, values: dict[str, str]) -> str:
    return f'<row r="{number}">' + "".join(_cell(f"{column}{number}", value) for column, value in values.items()) + "</row>"


def _write_fixture(path: Path) -> None:
    definitions = [
        {"A": "인구사회 부문", "B": "과거대비인구변화(%)", "C": "과거 인구 변화", "H": "20%이상 감소", "I": "2025년", "J": "인구총조사", "K": "2026년"},
        {"A": "인구사회 부문", "B": "최근인구변화(년수)", "C": "최근 인구 변화", "H": "3년이상 연속감소", "I": "2025년", "J": "주민등록인구통계", "K": "2026년"},
        {"A": "산업경제 부문", "B": "과거대비사업체변화(%)", "C": "과거 사업체 변화", "H": "5%이상 감소", "I": "2024년", "J": "전국사업체조사", "K": "2025년"},
        {"A": "산업경제 부문", "B": "최근사업체변화(년수)", "C": "최근 사업체 변화", "H": "3년이상 연속감소", "I": "2024년", "J": "전국사업체조사", "K": "2025년"},
        {"A": "물리환경 부문", "B": "노후건축물비율(%)", "C": "노후 건축물", "H": "50%이상", "I": "2025년", "J": "건축물대장", "K": "2025년"},
    ]
    rows = [
        _row(1, {"A": "2025년 도시재생 활성화지역 진단 결과(총괄표)"}),
        _row(2, {"A": "지표구축 기준년도 : 2025년(2025.12월 기준)"}),
    ]
    rows.extend(_row(index + 3, values) for index, values in enumerate(definitions))
    rows.append(_row(8, {"A": "시도명", "B": "시군구명", "C": "읍면동명", "D": "인구사회 부문", "E": "산업경제 부문", "F": "물리환경 부문", "G": "과거대비 인구변화(%)", "H": "최근인구변화", "I": "과거대비 사업체변화(%)", "J": "최근사업체변화", "K": "노후건축물비율(%)", "L": "부합부문", "M": "2개 부문 이상 부합여부"}))
    rows.append(_row(9, {"A": "대구광역시", "B": "대구광역시 중구", "C": "대신동", "D": "X", "E": "O", "F": "O", "G": "-9.3089221248066067", "H": "2", "I": "-5.8412268831754623", "J": "4", "K": "85.909568870000001", "L": "2", "M": "O"}))
    rows.append(_row(10, {"A": "대구광역시", "B": "대구광역시 중구", "C": "다른동", "D": "X", "E": "X", "F": "X", "G": "1", "H": "0", "I": "2", "J": "0", "K": "3", "L": "0", "M": "X"}))
    sheet = f'<worksheet xmlns="{MAIN_NS}"><sheetData>{"".join(rows)}</sheetData></worksheet>'
    workbook = f'<workbook xmlns="{MAIN_NS}" xmlns:r="{REL_NS}"><sheets><sheet name="진단결과_총괄표" sheetId="2" r:id="rId1"/></sheets></workbook>'
    workbook_rels = f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("xl/workbook.xml", workbook)
        archive.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        archive.writestr("xl/worksheets/sheet1.xml", sheet)


class RefreshRegenerationTest(unittest.TestCase):
    def test_normalizes_official_geographies_without_mapping_corridor_labels(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "fixture.xlsx"
            _write_fixture(source)
            snapshot = normalize_workbook(source, "2026-09-19T06:32:16Z")

        self.assertEqual(snapshot["mode"], "official-snapshot")
        self.assertEqual(snapshot["sourceRecordCount"], 2)
        self.assertEqual(snapshot["normalizedRecordCount"], 2)
        self.assertEqual(snapshot["officialGeographyLevel"], "읍면동(행정동)")
        daesin = next(record for record in snapshot["records"] if record["geography"]["name"] == "대신동")
        self.assertEqual(daesin["raw"]["indicators"]["oldBuildingRatio"]["rawValue"], "85.909568870000001")
        self.assertEqual(daesin["raw"]["indicators"]["oldBuildingRatio"]["value"], 85.90956887)
        self.assertIsNone(snapshot["modelled"]["localTwinDeclineContextScore"])
        self.assertEqual(snapshot["requestedAreas"][0]["officialMapping"], None)

    def test_snapshot_is_json_serializable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "fixture.xlsx"
            _write_fixture(source)
            snapshot = normalize_workbook(source, "2026-09-19T06:32:16Z")
        json.dumps(snapshot, ensure_ascii=False)


if __name__ == "__main__":
    unittest.main()
