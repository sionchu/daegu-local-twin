# Vercel deployment

LocalTwin Daegu is a standard Next.js App Router application.

## Recommended deployment

1. Import `sionchu/daegu-local-twin` into Vercel.
2. Use Node.js 22. The repository pins npm 11.6 because npm 10.9.x has a known Arborist peer-resolution crash with Vitest's optional peer graph.
3. Keep the framework preset as Next.js.
4. No secret is required for the default public basemap/DEM setup.
5. Optional public environment values:

```text
NEXT_PUBLIC_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/bright
NEXT_PUBLIC_DEM_TILEJSON_URL=https://demotiles.maplibre.org/terrain-tiles/tiles.json
NEXT_PUBLIC_MAP_ATTRIBUTION=OpenStreetMap contributors
```

6. Deploy from `main` after CI passes.

## Demo reliability

The authoritative application data is committed under `public/data/`, so financial,
scenario, chart, and evidence views do not depend on a live backend. The basemap,
building vectors, and DEM are remote public map resources. If those providers are
temporarily unavailable, the decision engine and charts remain usable.

## Future server-side adapters

If Naver, public-data APIs, or financial partner APIs are connected later, keep
credentials only in Vercel server environment variables and expose narrow Next.js
Route Handlers. Do not put client secrets in `NEXT_PUBLIC_*`.
