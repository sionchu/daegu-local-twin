# LocalTwin Daegu architecture

```text
Codex Aside browser
    ↓ official/public source artifacts
Git-reviewed normalized snapshots in public/data
    ↓
Next.js App Router
    ├─ deterministic finance/scenario engine
    ├─ MapLibre GL JS basemap + DEM + OSM buildings
    ├─ deck.gl opportunity/catchment overlays
    ├─ SunCalc time-of-day lighting
    ├─ Turf spatial helpers
    └─ Recharts decision charts
    ↓
Vercel deployment
```

The browser UI owns no source credentials. Current V0 uses committed snapshots so the
decision engine remains deterministic and demoable without a live backend.

## Spatial semantics

- The corridor uses one canonical hex-equivalent cell system.
- The extruded cell height is a **data index**, not physical building height.
- OpenStreetMap-derived buildings are rendered as a separate 3D layer.
- Terrain is a MapLibre raster-DEM visualization layer.
- The selected candidate gets a Turf-generated 300 m geodesic catchment.
- SunCalc provides solar azimuth/altitude for the time slider; MapLibre lighting and
  hillshade direction use it as a visualization input.
- The current time-demand chart uses an explicitly labelled demo intraday profile over
  the modelled daily mobility proxy. The committed transit snapshot preserves daily
  business-hour aggregates, so the intraday curve itself is not an observation.

## Decision semantics

DemandScore is a transparent weighted signal, not success probability. Transit demand
is a station-ridership distance-decay proxy; NAVER is relative search interest; REB rent
is an official area benchmark in KRW/㎡; spillover is a deterministic neighboring-anchor
index. Opportunity adds rent relief and regeneration context. Financial outputs come
only from the deterministic engine in `src/model.ts`, which applies a scenario capture
rate to the mobility proxy rather than claiming observed storefront conversion.

## Optional AI/CV

RF-DETR + ByteTrackTracker + Supervision runs offline/edge-side on permitted video and
emits aggregate counts only. It is a micro-footfall refinement, not the primary V0
mobility dependency.
