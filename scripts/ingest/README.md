# Snapshot ingestion boundary

The public V0 keeps expensive joins offline. Adapters should write normalized, provenance-stamped JSON under `public/data/` and must never put API keys in the browser bundle.

Committed refresh adapters now cover SEMAS businesses, Daegu Metro ridership, urban
decline, SGIS boundaries, REB rent/vacancy, and NAVER DataLab public exports. Every
snapshot preserves source, retrieval date, geography, semantics, and limitations.
Credentials never enter the browser bundle or committed artifacts.

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


## Cell market evidence derivation

After transit, REB, and NAVER snapshots are refreshed, regenerate the remaining market
inputs with:

```bash
python scripts/ingest/derive_market_evidence.py
```

This network-free step:
- computes `transitDemand` from official 10:00–22:00 station ridership using 450 m
  exponential distance decay;
- sets `observedFootfall` to `null`;
- maps NAVER relative interest only to exact corridor concepts;
- maps REB rent/vacancy only where an explicit official-area name match is supported;
- derives anchor strength and 350 m neighboring spillover;
- writes `public/data/cell_market_evidence.json` for audit.

REB rent stays in KRW/㎡ and is never converted into a storefront's total monthly rent.
