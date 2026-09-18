# SpaceLab architecture

## Canonical state

`BuildingMass` and `Scenario` are the domain objects. A `BuildingMass` contains a local-coordinate footprint, height, floors, position offset, rotation, and site center. A `Scenario` owns one mass plus its branch parent, intent, provenance, and analysis date/time. `SpatialWorkspace` holds the scenario collection and active/compare selections.

The reducer in `src/model.ts` is pure and owns state transitions. It normalizes numeric ranges and deep-clones footprints when branching so a branch cannot mutate its parent by reference.

## Shared application actions

`src/actions.ts` exposes `selectScenario`, `compareScenarios`, `cloneScenario`, `editBuildingMass`, `setMassFootprint`, and `setShadowTime`. React handlers and WebMCP tool executions call these same functions. This keeps human edits and agent edits on one state path.

## Adapters

- `src/vworld.ts` converts canonical local footprint points into geographic coordinates and renders Cesium/VWorld entities. It is optional and is never the source of scenario state.
- The fallback canvas is a UI rendering adapter for local development without an API key.
- `src/webmcp.ts` registers tools only when `document.modelContext` exists. It reports the same workspace and dispatches the same application actions.

## Deliberate V0 boundary

The shadow helper is a qualitative deterministic preview for comparing alternatives. It does not model legal criteria, neighboring parcel rights, detailed terrain, structural systems, or BIM semantics.
