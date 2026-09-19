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
- MapLibre GL JS 6
- deck.gl MapLibre-native overlay for extruded opportunity cells
- Turf.js for a selected-site catchment
- SunCalc for time-slider solar azimuth/altitude
- Recharts for demand, rent-vs-demand, cash-runway, and funding visualizations
- Vercel as the target hosting platform

The deterministic domain engine under `src/model.ts` remains the authority for all
financial numbers.

## Main interaction

```text
3D opportunity map
    ↓
time slider / sun lighting / DEM / buildings
    ↓
candidate A/B selection
    ↓
actual deposit + rent + business assumptions
    ↓
BEP · customers/day · required conversion
    ↓
12-month cash runway · payback · Funding Gap
    ↓
official support / guarantee / finance review candidates
```

## Evidence boundary

Every source-backed value must remain distinguishable as `observed`, `official`,
`modelled`, or `demo`.

The current central-Daegu corridor still contains an explicitly labelled demo snapshot
for several mobility, rent, and Buzz fields. The UI must not present those as measured
store-level facts or business-success probabilities.

Canonical source metadata lives in:

- `public/data/provenance.json`

Current product snapshots:

- `public/data/opportunity_cells.json`
- `public/data/transit.json`
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

The predev/prebuild hook copies MapLibre's ESM worker pair into `public/` so
Next/Turbopack resolves the Web Worker through a real HTTP URL.

Optional public map configuration:

```text
NEXT_PUBLIC_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/bright
NEXT_PUBLIC_DEM_TILEJSON_URL=https://demotiles.maplibre.org/terrain-tiles/tiles.json
```

## Verification

```bash
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run e2e
python -m unittest scripts.ingest.test_refresh_daegu_transit
python -m py_compile vision/analyze_footfall.py scripts/ingest/refresh_daegu_transit.py
```

GitHub Actions also starts the production Next.js build in Chromium and verifies the critical demo path: dashboard load, MapLibre initialization, time slider, candidate finance recalculation, and funding inputs. Failed browser runs retain screenshots, trace, video, and the HTML report as a short-lived Actions artifact.

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

- MapLibre GL JS
- vis.gl deck.gl
- shadcn/ui
- Recharts
- Turf.js
- SunCalc
- recent Next.js + MapLibre starter/toolkit patterns

See [`THIRD_PARTY.md`](./THIRD_PARTY.md) for license and attribution notes.

## Prototype notice

This is an independent competition prototype. It does not represent official iM Bank
affiliation, underwriting, approval, or a financial product. Regional rent/vacancy data
is a benchmark, not a point-store quote. Support, guarantee, and lending eligibility is
subject to each institution's review.
