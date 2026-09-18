"""Minimal RF-DETR + tracker + line-zone aggregate pipeline.

The script intentionally writes counts only. It is a local/offline adapter and
does not claim that a Daegu CCTV stream exists at any particular point.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Permitted local video path")
    parser.add_argument("--output", default="public/data/footfall.json")
    parser.add_argument("--zone", default="vision/zones.example.json")
    parser.add_argument("--camera-id", default="permitted-local-video")
    parser.add_argument("--source-mode", default="observed-demo-video", choices=["observed-demo-video", "public-authorized-stream"])
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    input_path = Path(args.input)
    if not input_path.exists():
        raise SystemExit(f"input video not found: {input_path}")
    try:
        import cv2
        import supervision as sv
        from rfdetr import RFDETRNano
        from trackers import ByteTrackTracker
    except ImportError as exc:
        raise SystemExit("Install vision/requirements.txt before running the offline pipeline.") from exc

    zone = json.loads(Path(args.zone).read_text(encoding="utf-8"))
    model = RFDETRNano()
    line = zone["line"]
    line_zone = sv.LineZone(start=sv.Point(*line["start"]), end=sv.Point(*line["end"]))
    capture = cv2.VideoCapture(str(input_path))
    fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
    tracker = ByteTrackTracker(frame_rate=fps, track_activation_threshold=0.45)
    bucket_seconds = int(zone.get("bucket_seconds", 300))
    buckets: dict[int, dict[str, float]] = defaultdict(lambda: {"in_count": 0, "out_count": 0, "occupancy_sum": 0, "frames": 0})
    frame_index = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        detections = model.predict(frame_rgb, threshold=0.45)
        detections = detections[detections.class_id == int(zone.get("person_class_id", 0))]
        tracked = tracker.update(detections)
        tracked = tracked[tracked.tracker_id != -1]
        crossed_in, crossed_out = line_zone.trigger(tracked)
        bucket = int((frame_index / fps) // bucket_seconds)
        buckets[bucket]["in_count"] += int(crossed_in.sum())
        buckets[bucket]["out_count"] += int(crossed_out.sum())
        buckets[bucket]["occupancy_sum"] += len(tracked)
        buckets[bucket]["frames"] += 1
        frame_index += 1
    capture.release()
    start = datetime.now(timezone.utc).replace(microsecond=0)
    records = []
    for bucket, values in sorted(buckets.items()):
        records.append({
            "camera_id": args.camera_id,
            "zone_id": "line-zone",
            "timestamp_bucket": (start + timedelta(seconds=bucket * bucket_seconds)).isoformat(),
            "in_count": values["in_count"],
            "out_count": values["out_count"],
            "occupancy_mean": round(values["occupancy_sum"] / max(values["frames"], 1), 2),
        })
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"mode": "observed", "sourceMode": args.source_mode, "records": records, "privacy": "aggregate counts only"}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(records)} aggregate buckets to {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
