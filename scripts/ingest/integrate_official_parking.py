"""Replace public-map parking anchors with the official Daegu parking snapshot."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--parking", type=Path, default=Path("public/data/parking.json"))
    parser.add_argument("--anchors", type=Path, default=Path("public/data/context_anchors.json"))
    parser.add_argument(
        "--layer-output",
        type=Path,
        default=Path("public/data/context_anchors/parking_access.json"),
    )
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def official_anchor(row: dict[str, Any], source: dict[str, Any]) -> dict[str, Any]:
    return {
        "anchorId": f"official-parking:{row['parkingId']}",
        "name": row["name"],
        "anchorType": "parking_access",
        "subtype": "parking",
        "longitude": float(row["longitude"]),
        "latitude": float(row["latitude"]),
        "confidence": None,
        "capacity": int(row.get("spaces") or 0),
        "capacityUnit": "parking_spaces",
        "quality": "official",
        "coordinateQuality": "official",
        "baseWeight": 1.0,
        "capacityWeight": 1.0,
        "officialEvidence": {
            "provider": source.get("provider"),
            "datasetId": source.get("datasetId"),
            "sourceSha256": source.get("sourceSha256"),
            "dataDate": row.get("dataDate"),
            "providerName": row.get("provider"),
            "parkingKind": row.get("parkingKind"),
            "parkingType": row.get("parkingType"),
            "feeType": row.get("feeType"),
            "spaces": int(row.get("spaces") or 0),
            "roadAddress": row.get("roadAddress"),
            "lotAddress": row.get("lotAddress"),
        },
    }


def integrate(
    parking_doc: dict[str, Any],
    anchors_doc: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    existing = list(anchors_doc.get("records") or [])
    retained = [row for row in existing if row.get("anchorType") != "parking_access"]

    source = parking_doc.get("source") or {}
    parking_records = parking_doc.get("records") or []
    official = [official_anchor(row, source) for row in parking_records]
    official.sort(key=lambda row: (row["name"], row["anchorId"]))

    merged = retained + official
    merged.sort(key=lambda row: (row.get("anchorType") or "", row.get("name") or "", row["anchorId"]))

    output = dict(anchors_doc)
    output["records"] = merged
    enrichment = dict(output.get("officialEnrichment") or {})
    enrichment["parking"] = {
        "dataset": source,
        "recordCount": len(official),
        "totalSpaces": sum(row["capacity"] for row in official),
        "replacedPublicMapParkingAnchors": len(existing) - len(retained),
        "scoreSemantics": {
            "baseWeight": 1.0,
            "capacityWeight": 1.0,
            "note": "parking spaces are preserved as evidence but are not used as hidden score weights",
        },
    }
    output["officialEnrichment"] = enrichment

    layer = {
        "schemaVersion": output.get("schemaVersion", 1),
        "generatedAt": source.get("retrievedAt"),
        "geography": output.get("geography"),
        "anchorType": "parking_access",
        "recordCount": len(official),
        "records": [
            {
                "anchorId": row["anchorId"],
                "name": row["name"],
                "anchorType": row["anchorType"],
                "subtype": row["subtype"],
                "longitude": row["longitude"],
                "latitude": row["latitude"],
                "confidence": None,
                "capacity": row["capacity"],
                "capacityUnit": row["capacityUnit"],
                "quality": row["quality"],
                "coordinateQuality": row["coordinateQuality"],
            }
            for row in official
        ],
    }
    return output, layer


def main() -> int:
    args = parse_args()
    output, layer = integrate(load_json(args.parking), load_json(args.anchors))
    args.anchors.write_text(
        json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    args.layer_output.parent.mkdir(parents=True, exist_ok=True)
    args.layer_output.write_text(
        json.dumps(layer, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "parkingAnchors": layer["recordCount"],
                "totalSpaces": output["officialEnrichment"]["parking"]["totalSpaces"],
                "replacedPublicMapParkingAnchors": output["officialEnrichment"]["parking"]["replacedPublicMapParkingAnchors"],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
