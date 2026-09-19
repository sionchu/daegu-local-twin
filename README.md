# LocalTwin Daegu

**대구 청년창업을 위한 3D 상권·자금 디지털트윈**

LocalTwin Daegu는 단순히 “사람이 많은 곳”을 추천하는 상권분석기가 아니라,
대구의 이동수요·Buzz·임대부담·도시재생 신호와 실제 창업비용을 함께 계산해
**내 조건으로 버틸 수 있는 입지**를 비교하는 2026 AI Blockchain Challenge in
Daegu 프로토타입입니다.

## Current product

The public UI is being migrated to a spatial-finance dashboard built with:

- Next.js 16 / React 19 / TypeScript
- Tailwind CSS 4 + local shadcn/ui-style primitives
- VWorld WebGL 3.0 as the primary Korean 3D city context
- VWorld's Cesium viewer for LocalTwin polygons, labels, transit anchors, and camera focus
- MapLibre GL JS 6 + deck.gl retained as a lazy fallback only
- Recharts loaded on demand for demand, rent-vs-demand, cash-runway, and funding visualizations
- Vercel as the target hosting platform

The deterministic domain engine under `src/model.ts` remains the authority for all
financial numbers.

## Main interaction

```text
VWorld 3D opportunity scene
    ↓
official admin boundaries / analysis-cell halos / transit anchors
    ↓
VWorld 3D buildings + rent-aware spatial comparison
    ↓
candidate A/B selection
    ↓
actual deposit + rent + business assumptions
    ↓
BEP · customers/day · required capture rate
    ↓
12-month cash runway · payback · Funding Gap
    ↓
official support / guarantee / finance review candidates
```

## Evidence boundary

Every source-backed value must remain distinguishable as `observed`, `official`,
`modelled`, or `demo`.

The current central-Daegu corridor is built from reviewed official/public snapshots:
SEMAS businesses, Daegu Metro station ridership, REB commercial rent/vacancy, NAVER
DataLab relative search interest, official urban-decline indicators, and SGIS
administrative-dong boundaries. LocalTwin then derives cell-level mobility, rent mapping,
regeneration context, rent benchmarks, and spillover deterministically. Cells without
an exact R-ONE commercial-area name use an explicitly modelled distance-decay blend of
the exact-mapped official R-ONE benchmarks; this remains a benchmark, not a store quote.

The derived cell values are `modelled`, not official store-level observations.
`observedFootfall` is intentionally null because the public build has no measured
storefront micro-footfall. Financial scenarios use the station-ridership mobility proxy
with a user-editable capture-rate assumption.

Canonical source metadata lives in:

- `public/data/provenance.json`

Current product snapshots:

- `public/data/opportunity_cells.json`
- `public/data/cell_spatial_evidence.json`
- `public/data/cell_market_evidence.json`
- `public/data/admin_dong_boundaries.geojson`
- `public/data/transit.json`
- `public/data/transit_station_locations.json`
- `public/data/businesses.json`
- `public/data/rent_benchmark.json`
- `public/data/regeneration.json`
- `public/data/buzz.json`
- `public/data/footfall.json`
- `public/data/support_programs.json`

Browser-based source collection is owned by the Codex Aside workflow. See
[`docs/CRAWL_HANDOFF.md`](./docs/CRAWL_HANDOFF.md). Git-side code consumes only the
reviewed artifact and normalizes it deterministically. Agent roles, branch ownership,
and PR handoff rules are canonicalized in [`docs/AGENT_WORKFLOW.md`](./docs/AGENT_WORKFLOW.md).

## Run locally

```bash
npx --yes npm@11.6.0 install --no-package-lock
npm run dev
```

Open http://localhost:3000.

Configure VWorld locally with:

```text
VWORLD_API_KEY=...
VWORLD_DOMAIN=localhost
```

The VWorld key is delivered to the browser at runtime because WebGL 3.0 is a client SDK.
Do not commit the key, and restrict it to the deployed service domain in VWorld.

MapLibre remains a failure fallback. The predev/prebuild hook copies its ESM worker pair
into `public/` so Next/Turbopack resolves the Web Worker through a real HTTP URL.

Optional fallback-map configuration:

```text
NEXT_PUBLIC_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/bright
```

The default DEM uses AWS Open Data Terrain Tiles in Terrarium encoding. Set
`NEXT_PUBLIC_DEM_TILEJSON_URL` only to override that fallback with another raster-dem
TileJSON endpoint.

## Verification

```bash
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run e2e
python -m unittest discover -s scripts/ingest -p 'test_*.py'
python -m compileall -q scripts/ingest vision
```

GitHub Actions also starts the production Next.js build in Chromium and verifies the critical evidence path: dashboard load, spatial-map contract, deferred chart loading, time slider, candidate finance recalculation, and funding inputs. CI has no VWorld key, so this path deliberately exercises the MapLibre fallback; production VWorld is checked separately in deployment QA. Failed browser runs retain screenshots, trace, video, and the HTML report as a short-lived Actions artifact.

## Optional vision pipeline

The CV path is not required to render the web product. A permitted local video can be
processed offline with RF-DETR + ByteTrackTracker + Supervision to produce aggregate
footfall buckets. No face recognition, identity, or cross-camera re-identification is
part of the product.

See [`vision/README.md`](./vision/README.md).

## Deployment

Target deployment is Vercel. See [`VERCEL_DEPLOY.md`](./VERCEL_DEPLOY.md).

## Recent implementation references

The UI/geometry direction was informed by current upstream projects rather than copied
wholesale:

- VWorld WebGL 3.0 / Cesium
- MapLibre GL JS fallback
- vis.gl deck.gl fallback
- shadcn/ui
- Recharts
- Turf.js
- recent Next.js + MapLibre starter/toolkit patterns

See [`THIRD_PARTY.md`](./THIRD_PARTY.md) for license and attribution notes.

## Prototype notice

This is an independent competition prototype. It does not represent official iM Bank
affiliation, underwriting, approval, or a financial product. Regional rent/vacancy data
is a benchmark, not a point-store quote. Support, guarantee, and lending eligibility is
subject to each institution's review.
