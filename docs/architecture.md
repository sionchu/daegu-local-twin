# SpaceLab architecture

## Canonical state

`Site`, `BuildingMass`, and `Scenario` are the domain objects. `Site` owns the selected real-world parcel center, VWorld cadastral boundary, optional PNU/address provenance, and is the georeference for all local mass geometry. Selecting a new site clears the previous scenario graph rather than silently reusing geometry on another parcel.

`BuildingMass` and `Scenario` remain the design objects. A `BuildingMass` contains a local-coordinate footprint, height, floors, position offset, rotation, and site center. A `Scenario` owns one mass plus its branch parent, intent, provenance, and analysis date/time. `SpatialWorkspace` holds the scenario collection and active/compare selections.

The reducer in `src/model.ts` is pure and owns state transitions. It normalizes numeric ranges and deep-clones footprints when branching so a branch cannot mutate its parent by reference.

## Shared application actions

`src/actions.ts` exposes `selectScenario`, `compareScenarios`, `cloneScenario`, `editBuildingMass`, `setMassFootprint`, and `setShadowTime`. React handlers and WebMCP tool executions call these same functions. This keeps human edits and agent edits on one state path.

## Adapters

- `src/vworld.ts` converts canonical local footprint points into geographic coordinates and renders Cesium/VWorld entities. It is optional and is never the source of scenario state.
- The fallback canvas is a UI rendering adapter for local development without an API key.
- `src/webmcp.ts` registers tools only when `document.modelContext` exists. It reports the same workspace and dispatches the same application actions.

## Deliberate V0 boundary

The shadow helper is a qualitative deterministic preview for comparing alternatives. It does not model legal criteria, neighboring parcel rights, detailed terrain, structural systems, or BIM semantics.


## Real-site adapter

`src/vworld-api.ts` keeps external data outside canonical state transitions:

1. VWorld Search API resolves a Korean address to EPSG:4326 coordinates.
2. VWorld Data API queries `LP_PA_CBND_BUBUN` with a point geometry filter.
3. The resulting parcel polygon is normalized into canonical `Site`.
4. UI and WebMCP both call `setSite`; neither mutates renderer state directly.

The VWorld/Cesium canvas also exposes point picking for parcel selection, free-polygon drawing, and click-to-move mass placement. These interactions convert geographic clicks into the site's local meter coordinates before dispatching canonical application actions.
