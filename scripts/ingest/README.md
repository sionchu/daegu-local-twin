# Snapshot ingestion boundary

The public V0 keeps expensive joins offline. Adapters should write normalized, provenance-stamped JSON under `public/data/` and must never put API keys in the browser bundle.

Committed refresh adapters now cover SEMAS businesses, Daegu Metro ridership, urban
decline, SGIS boundaries, REB rent/vacancy, NAVER DataLab public exports, and
OpenStreetMap road/market geometry used for visualization corridors. Every snapshot
preserves source, retrieval date, geography, semantics, and limitations.
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


## Daegu map boundary

`refresh_daegu_boundary.py` stores the public OpenStreetMap/Nominatim administrative
polygon for 대구광역시 as `public/data/daegu_boundary.geojson`. The application uses
this geometry only for the visible Daegu boundary outline; it does not hard-clamp camera
movement. Citywide mode separately applies a visual-only outside focus veil so neighboring
regions remain navigable but less prominent. Neither artifact is a commercial-area or
business-evidence input.

## Map-derived corridor zones

`refresh_corridor_zones.py` queries public OpenStreetMap/Nominatim geometry for the
named Daegu roads and market anchors and buffers those real map features in metres to
create `public/data/corridor_zones.geojson`. The output is
`modelled-map-derived`: it is for legible map visualization and is **not** an official
SEMAS commercial-area boundary. When an approved SEMAS `storeZone` service key is
available, its WGS84 polygon should replace this visualization boundary.

The committed NAVER DataLab snapshot compares five topics in one public result:
`동성로`, `교동`, `북성로`, `중앙로`, and `서문시장`. All eight LocalTwin
cells therefore have a mapped relative-interest level and momentum; these are relative
search-interest indices, not visit counts or sales.

## Daegu-wide commercial context

The citywide context pipeline deliberately separates official registries, public-map
coordinates, and controlled data.

1. `normalize_overture_context.py` normalizes Overture Places to
   `context_anchors.json`. Its locality output is only a fallback/debug artifact
   (`overture_context_zones.geojson`), not the canonical analysis-zone geometry.
2. `refresh_daegu_analysis_zones.py` converts the official SGIS 2025Q2
   `bnd_dong` Shapefile (EPSG:5179) into the canonical WGS84
   `daegu_analysis_zones.geojson`: exactly 150 official Daegu administrative dongs.
3. `enrich_official_context.py` enriches/replaces anchors with downloaded public
   registries: Daegu schools, registered factories, district resident population, and
   HIRA hospitals/pharmacies. It also writes compact per-layer client JSON under
   `public/data/context_anchors/`.
4. `derive_citywide_business_profiles.py` aggregates the official SEMAS 2026Q2 Daegu
   business CSV (118,357 rows) into the 150 official SGIS zones and five model corridors.
   All 118,357 valid Daegu business points currently map to an official SGIS locality.
5. `derive_context_graph.py` derives distance-decay anchor signals, official business
   structure, `NEAR` edges and `HAS_BUSINESS_PROFILE` edges.
6. `derive_citywide_commercial_candidates.py` combines the derived SEMAS density/diversity
   and transit/market/employment/culture/healthcare accessibility scores into a deterministic
   **commercial-potential review score**. It keeps the five central map-derived corridors and
   selects only evidence-qualified SGIS administrative-dong candidates, capped at two per
   district with a spatial-separation rule. It writes the 155-zone lightweight score/status
   table to `public/data/citywide_commercial_profiles.json` and keeps geometry only for
   the 19 selected candidates in `public/data/citywide_commercial_candidates.geojson`;
   the 150 SGIS geometries remain single-sourced in `daegu_analysis_zones.geojson`.

The candidate layer is modelled prioritization evidence. It is not an official commercial-area
designation, footfall observation, revenue forecast, success probability, or replacement for
missing citywide rent/search/living-population/card-spend observations.

Raw national/Daegu source downloads are **not committed**. The committed snapshots contain
only normalized data required to reproduce the product. Living-population, card-spend,
visitor-population and commuting-OD remain controlled-data slots until an approved DIP
aggregate export is available; the pipeline never fabricates those fields.

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
