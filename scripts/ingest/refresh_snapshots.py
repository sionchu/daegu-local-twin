"""Guarded refresh entry point for LocalTwin data adapters.

This V0 does not silently fetch or overwrite public data. Use this file to verify
that an adapter has a source URL and an output path before adding a real adapter.
"""

from __future__ import annotations

import argparse
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate the LocalTwin snapshot boundary.")
    parser.add_argument("--source", help="Source URL or local export to be reviewed.")
    parser.add_argument("--output", default="public/data", help="Normalized output directory.")
    args = parser.parse_args()
    output = Path(args.output)
    print(f"output directory: {output}")
    if not args.source:
        print("No source supplied. Existing committed snapshots are unchanged.")
        return 0
    print("Source received for manual adapter implementation:", args.source)
    print("No network fetch or overwrite is performed by this V0 guard.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
