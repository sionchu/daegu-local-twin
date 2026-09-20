# Third-party and source notices

LocalTwin Daegu contains project-authored source code plus dependencies and provider
data governed by their own licenses and terms.

## Web / visualization dependencies

- **Next.js** — MIT.
- **React** — MIT.
- **VWorld WebGL 3.0 / Cesium runtime** — hosted spatial runtime and provider data remain
  subject to VWorld/Cesium terms and attribution requirements.
- **MapLibre GL JS** — BSD-3-Clause; used only as the failure fallback.
- **deck.gl** — MIT; used only by the MapLibre fallback.
- **Turf.js** — MIT.
- **Recharts** — MIT.
- **shadcn/ui patterns** — MIT. Local UI primitives are repository-owned copies/patterns,
  not a bundled hosted component service.
- **Tailwind CSS** — MIT.

## Map providers

- **VWorld** provides the primary Korean 3D city/terrain context. The client key must be
  service-domain restricted; LocalTwin overlays remain project-authored/modelled data.
- **OpenStreetMap / Nominatim** provides the Daegu administrative boundary used for
  render-range limiting and real road/market geometry used to derive the LocalTwin
  visualization corridors. The buffered corridors are modelled overlays, not official
  commercial-area boundaries. Preserve OpenStreetMap attribution and ODbL terms.
- **Overture Maps Foundation** provides the temporary Daegu-wide locality polygons and
  public-map POIs used only where a more authoritative coordinate registry is not yet
  available. Places/division source quality is preserved and official HIRA/education/
  factory data takes precedence when it can be linked.
- **OpenFreeMap** provides the hosted style/vector source used by the fallback renderer.
  Map data is OpenStreetMap-derived; preserve the provider/OpenStreetMap attribution
  shown by the map and review provider terms before production-scale use.
- **AWS Open Data Terrain Tiles** (`elevation-tiles-prod`) provide the default
  raster-DEM fallback in Terrarium encoding. The dataset is managed by Mapzen/Tilezen;
  preserve the full Joerd terrain-data attribution requirements documented at
  `https://github.com/tilezen/joerd/blob/master/docs/attribution.md`.
  `NEXT_PUBLIC_DEM_TILEJSON_URL` may override this with a deployment-approved source.

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
