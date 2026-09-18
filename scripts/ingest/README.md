# Snapshot ingestion boundary

The public V0 keeps expensive joins offline. Adapters should write normalized, provenance-stamped JSON under `public/data/` and must never put API keys in the browser bundle.

Planned refresh adapters:

- `fetch_businesses.py` — 소상공인시장진흥공단 상가(상권)정보
- `fetch_transit.py` — 대구교통공사 역별 승하차
- `fetch_regeneration.py` — 도시재생 진단정보
- `fetch_rent_benchmark.py` — 한국부동산원 상업용 benchmark
- `fetch_buzz.py` — Naver DataLab/Blog Search through a server-side or local credential

The committed corridor files are intentionally marked `demo` or `snapshot`. A refresh script must preserve the source, retrieval date, geographic level, and limitations for every field it writes.
