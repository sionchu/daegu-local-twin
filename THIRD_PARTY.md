# Third-party and source notices

LocalTwin Daegu contains project-authored source code plus dependencies and provider
data governed by their own licenses and terms.

## Web / visualization dependencies

- **Next.js** — MIT.
- **React** — MIT.
- **MapLibre GL JS** — BSD-3-Clause.
- **deck.gl** — MIT.
- **Turf.js** — MIT.
- **SunCalc** — BSD-2-Clause.
- **Recharts** — MIT.
- **shadcn/ui patterns** — MIT. Local UI primitives are repository-owned copies/patterns,
  not a bundled hosted component service.
- **Tailwind CSS** — MIT.

## Map providers

- **OpenFreeMap** provides the default hosted style/vector source used by the demo.
  Map data is OpenStreetMap-derived; preserve the provider/OpenStreetMap attribution
  shown by the map and review provider terms before production-scale use.
- **MapLibre demo terrain tiles** provide the default raster-DEM demo endpoint.
  This is a prototype dependency and should be replaced with a deployment-approved DEM
  provider or self-hosted source before production use.

## Optional computer vision

- **RF-DETR** — Apache-2.0 upstream project.
- **trackers / ByteTrackTracker** — use the installed package's license and notices.
- **Supervision** — follow the installed upstream license and notices.
- **OpenCV / NumPy** — follow their upstream licenses.

## Public-data providers

Public-data source URLs and retrieval limitations are recorded in
`public/data/provenance.json`. This repository does **not** relicense provider datasets.

## Reuse policy

Recent GitHub projects may be inspected for implementation patterns, but LocalTwin does
not copy third-party project code wholesale. Any direct reuse must preserve the
applicable license and attribution.
