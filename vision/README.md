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
