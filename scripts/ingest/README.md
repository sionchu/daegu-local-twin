# Snapshot ingestion boundary

The public V0 keeps expensive joins offline. Adapters should write normalized, provenance-stamped JSON under `public/data/` and must never put API keys in the browser bundle.

Planned refresh adapters:

- `fetch_businesses.py` — 소상공인시장진흥공단 상가(상권)정보
- `fetch_transit.py` — 대구교통공사 역별 승하차
- `fetch_regeneration.py` — 도시재생 진단정보
- `fetch_rent_benchmark.py` — 한국부동산원 상업용 benchmark
- `fetch_buzz.py` — Naver DataLab/Blog Search through a server-side or local credential

The committed corridor files are intentionally marked `demo` or `snapshot`. A refresh script must preserve the source, retrieval date, geographic level, and limitations for every field it writes.

## Official SEMAS business snapshot

`normalize_semas_businesses.py` accepts the official SEMAS file-data ZIP or its Daegu CSV member. For a ZIP, it selects the single CSV whose `시도명` is `대구광역시`; it does not infer or generate records from other regions.

The corridor filter is the exact point-in-polygon union of every `boundary` in `public/data/opportunity_cells.json`. Boundary points are included, so the filter covers the named 동성로·교동·북성로 corridor cells and the other cells currently present on the LocalTwin map. Source rows are deduplicated after filtering by `상가업소번호`, retaining the first row in source order. The normalized output keeps source major/mid/small codes and names under `sourceCategory`; `category` is the separate LocalTwin mapping. No status field is emitted unless the source provides one, and no density or same-category counts are calculated here.

Example PowerShell invocation:

```powershell
python scripts/ingest/normalize_semas_businesses.py `
  --source C:\path\to\official-semas-snapshot.zip `
  --cells public/data/opportunity_cells.json `
  --output public/data/businesses.json `
  --report C:\path\to\semas-quality.json
```


## Cell spatial evidence derivation

After the official SEMAS business snapshot, urban-decline snapshot, and Jung-gu
administrative-dong boundaries are committed, refresh the modelled cell-level join with:

```bash
python scripts/ingest/derive_cell_evidence.py
```

The derivation is network-free and updates only:
- `poiCount` and LocalTwin category counts from official SEMAS point records;
- cell-center → official administrative-dong assignment;
- `regenerationScore = qualifyingSectorCount / 3 * 100` as a **modelled context score**;
- `public/data/cell_spatial_evidence.json` as the audit sidecar.

It does not alter transit, rent, Buzz, spillover, or mobility/footfall values.
