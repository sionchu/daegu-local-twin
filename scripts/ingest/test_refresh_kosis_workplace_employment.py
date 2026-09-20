from __future__ import annotations

import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
sys.path.insert(0, str(SCRIPT_DIR))

import refresh_kosis_workplace_employment as workplace  # noqa: E402

NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"


def write_minimal_xlsx(path: Path, rows: list[list[object]]) -> None:
    worksheet = ET.Element(f"{{{NS}}}worksheet")
    sheet_data = ET.SubElement(worksheet, f"{{{NS}}}sheetData")
    for r_index, values in enumerate(rows, start=1):
        row = ET.SubElement(sheet_data, f"{{{NS}}}row", r=str(r_index))
        for c_index, value in enumerate(values, start=1):
            letters = ""
            n = c_index
            while n:
                n, rem = divmod(n - 1, 26)
                letters = chr(65 + rem) + letters
            cell = ET.SubElement(
                row, f"{{{NS}}}c", r=f"{letters}{r_index}", t="inlineStr"
            )
            inline = ET.SubElement(cell, f"{{{NS}}}is")
            text = ET.SubElement(inline, f"{{{NS}}}t")
            text.text = str(value)
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(
            "xl/worksheets/sheet1.xml",
            ET.tostring(worksheet, encoding="utf-8", xml_declaration=True),
        )


class WorkplaceEmploymentTest(unittest.TestCase):
    def test_committed_snapshot_has_full_sgis_coverage_and_consistent_totals(self) -> None:
        document = json.loads(
            (REPO_ROOT / "public/data/workplace_employment.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(document["source"]["sourceYear"], 2024)
        self.assertEqual(
            document["source"]["sourceSha256"],
            "C4E9D5EC7084477F7E2597C1242DA41A34B518D09841484C5889EDA0B7DBA3B5",
        )
        self.assertEqual(document["coverage"]["zoneCount"], 150)
        self.assertEqual(document["coverage"]["sgisCodeMatchedZones"], 150)
        self.assertEqual(document["coverage"]["sgisCoveragePct"], 100.0)
        self.assertEqual(document["coverage"]["districtCount"], 9)
        self.assertEqual(document["coverage"]["businesses"], 286841)
        self.assertEqual(document["coverage"]["employees"], 1021246)
        self.assertEqual(
            sum(row["employees"] for row in document["records"]), 1021246
        )
        self.assertEqual(
            sum(row["businesses"] for row in document["records"]), 286841
        )
        self.assertEqual(len({row["zoneId"] for row in document["records"]}), 150)

        availability = json.loads(
            (REPO_ROOT / "public/data/context_data_availability.json").read_text(
                encoding="utf-8"
            )
        )
        workplace_slot = next(
            row
            for row in availability["datasets"]
            if row["key"] == "workplace_population"
        )
        self.assertEqual(workplace_slot["status"], "available-official-dong-2024")
        self.assertEqual(workplace_slot["officialZoneRecords"], 150)

        provenance = json.loads(
            (REPO_ROOT / "public/data/provenance.json").read_text(encoding="utf-8")
        )
        source = next(
            row
            for row in provenance["sources"]
            if row["id"] == "kosis-workplace-employment-2024"
        )
        self.assertEqual(source["mode"], "official-snapshot")
        self.assertEqual(source["sourceSha256"], document["source"]["sourceSha256"])

    def test_code_match_rejects_incomplete_zone_coverage(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            zones = root / "zones.geojson"
            source = root / "source.xlsx"
            zones.write_text(
                json.dumps(
                    {
                        "type": "FeatureCollection",
                        "features": [
                            {
                                "properties": {
                                    "zoneId": f"sgis-dong:{22010540 + i}",
                                    "district": "중구",
                                    "label": f"동{i}",
                                }
                            }
                            for i in range(150)
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            write_minimal_xlsx(
                source,
                [
                    ["지역", "산업분류", "사업체수", "종사자수"],
                    ["22.대구광역시", "전산업", 10, 20],
                    ["220100.중구", "전산업", 10, 20],
                    ["22010540.동0", "전산업", 10, 20],
                ],
            )
            with self.assertRaisesRegex(ValueError, "expected 9 Daegu district totals"):
                workplace.normalize(source, zones, "2026-09-20T00:00:00Z")


if __name__ == "__main__":
    unittest.main()
