# Optional footfall pipeline

This offline path accepts a permitted local video, detects `person` with RF-DETR, tracks detections, applies a line or polygon zone, and writes aggregate buckets to `public/data/footfall.json`.

It does not store faces, crops, embeddings, names, biometric attributes, or persistent cross-camera identity. The input video must be legally obtained or authorized before processing.

## Run

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r vision/requirements.txt
python vision/analyze_footfall.py --input .\permitted-demo.mp4 --output public/data/footfall.json --zone vision/zones.example.json
```

The public V0 can consume a committed aggregate snapshot even when local GPU inference is unavailable. That snapshot must remain labelled `demo`.

## Versioned implementation

The current optional stack is pinned in `vision/requirements.txt`: RF-DETR 1.10.1, Supervision 0.30.4, and `trackers` 2.6.0. Tracking uses `trackers.ByteTrackTracker.update()`; Supervision provides `LineZone` counting. This keeps the V0 off the deprecated legacy `sv.ByteTrack` integration path.

The repository verifies Python syntax in CI, but it does **not** claim an observed footfall result until this script is executed on a permitted video and the generated aggregate is reviewed.
