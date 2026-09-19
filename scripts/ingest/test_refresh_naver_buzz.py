from __future__ import annotations

import io
import unittest
import zipfile
from xml.sax.saxutils import escape

from scripts.ingest.refresh_naver_buzz import normalize_export


SOURCE_SHA = "0123456789abcdef" * 4


def make_xlsx(rows: list[list[str]]) -> bytes:
    strings: list[str] = []
    for row in rows:
        for value in row:
            if value not in strings:
                strings.append(value)

    def shared_index(value: str) -> int:
        return strings.index(value)

    def column_name(index: int) -> str:
        result = ""
        while index:
            index, remainder = divmod(index - 1, 26)
            result = chr(65 + remainder) + result
        return result

    shared_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        f'count="{len(strings)}" uniqueCount="{len(strings)}">'
        + "".join(f"<si><t>{escape(value)}</t></si>" for value in strings)
        + "</sst>"
    )
    sheet_rows = []
    for row_number, row in enumerate(rows, start=1):
        cells = []
        for column_number, value in enumerate(row, start=1):
            reference = f"{column_name(column_number)}{row_number}"
            cells.append(f'<c r="{reference}" t="s"><v>{shared_index(value)}</v></c>')
        sheet_rows.append(f'<row r="{row_number}">{"".join(cells)}</row>')
    sheet_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData>{"".join(sheet_rows)}</sheetData></worksheet>'
    )
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("xl/sharedStrings.xml", shared_xml)
        archive.writestr("xl/worksheets/sheet1.xml", sheet_xml)
    return output.getvalue()


def sample_rows(observation_count: int = 12) -> list[list[str]]:
    rows = [
        ["url", "https://datalab.naver.com/keyword/trendResult.naver?hashKey=test"],
        ["주제", "통검"],
        ["범위", "합계"],
        ["기간", "주간 : 2026-06 ~ 2026-09"],
        ["성별", "전체(여성,남성)"],
        ["연령대", "전체"],
        ["날짜", "동성로", "날짜", "교동", "날짜", "북성로", "날짜", "중앙로", "날짜", "서문시장"],
    ]
    for index in range(observation_count):
        day = f"2026-06-{index + 1:02d}"
        rows.append([day, str(10 + index), day, str(20 + index), day, str(30 + index), day, str(40 + index), day, str(50 + index)])
    return rows


class NaverBuzzNormalizationTest(unittest.TestCase):
    def test_parses_public_export_and_calculates_windows(self) -> None:
        result = normalize_export(
            make_xlsx(sample_rows()),
            source_sha256=SOURCE_SHA,
            retrieved_at="2026-09-19T08:56:30Z",
        )
        self.assertEqual(result["mode"], "public-snapshot")
        self.assertEqual(result["provider"], "NAVER DataLab")
        self.assertEqual(result["accessMode"], "public-web-ui")
        self.assertEqual(result["query"]["timeUnit"], "week")
        self.assertEqual(len(result["series"]), 12)
        self.assertEqual(result["series"][0]["values"]["동성로"], 10.0)
        self.assertEqual(result["series"][-1]["values"]["북성로"], 41.0)
        dongseongro = result["records"][0]
        self.assertEqual(dongseongro["recentMean"], 19.5)
        self.assertEqual(dongseongro["previousMean"], 13.5)
        self.assertEqual(dongseongro["momentum"], 0.444444)
        self.assertEqual(result["calculation"]["analysisPeriodStart"], "2026-06-01")

    def test_rejects_missing_topic_or_observation(self) -> None:
        rows = sample_rows()
        rows[6] = ["날짜", "동성로", "날짜", "교동", "날짜", "북성로", "날짜", "중앙로", "날짜", "다른지역"]
        with self.assertRaisesRegex(ValueError, "topics differ"):
            normalize_export(make_xlsx(rows), source_sha256=SOURCE_SHA, retrieved_at="now")

        with self.assertRaisesRegex(ValueError, "at least 12"):
            normalize_export(
                make_xlsx(sample_rows(11)),
                source_sha256=SOURCE_SHA,
                retrieved_at="now",
            )

    def test_rejects_mismatched_dates(self) -> None:
        rows = sample_rows()
        rows[8][2] = "2026-06-08"
        with self.assertRaisesRegex(ValueError, "mismatched dates"):
            normalize_export(make_xlsx(rows), source_sha256=SOURCE_SHA, retrieved_at="now")


if __name__ == "__main__":
    unittest.main()
