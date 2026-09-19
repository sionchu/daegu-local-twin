# Vercel deployment

LocalTwin Daegu is a standard Next.js App Router application.

## Recommended deployment

1. Import `sionchu/daegu-local-twin` into Vercel.
2. Use Node.js 22. The repository pins npm 11.6 because npm 10.9.x has a known Arborist peer-resolution crash with Vitest's optional peer graph.
3. Keep the framework preset as Next.js.
4. Configure the production VWorld browser key as a server-held environment value:

```text
VWORLD_API_KEY=...
VWORLD_DOMAIN=daegu-local-twin.vercel.app
```

The WebGL client receives the key at runtime, so the same host must also be allowlisted
for that key in VWorld. Do not commit the key.

5. Optional MapLibre fallback environment values:

```text
NEXT_PUBLIC_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/bright
NEXT_PUBLIC_MAP_ATTRIBUTION=OpenStreetMap contributors
```

The built-in DEM fallback uses the AWS Open Data Terrain Tiles Terrarium endpoint.
Set `NEXT_PUBLIC_DEM_TILEJSON_URL` only when overriding it with another
deployment-approved raster-dem TileJSON source.

6. Deploy from `main` after CI passes.

## Demo reliability

The authoritative application data is committed under `public/data/`, so financial,
scenario, chart, and evidence views do not depend on a live backend. VWorld is the
primary 3D scene. If its key, host allowlist, or SDK is unavailable, the client switches
to the lazy MapLibre fallback; the deterministic decision engine and charts remain usable.

## Future server-side adapters

If Naver, public-data APIs, or financial partner APIs are connected later, keep
credentials only in Vercel server environment variables and expose narrow Next.js
Route Handlers. Do not put client secrets in `NEXT_PUBLIC_*`.
