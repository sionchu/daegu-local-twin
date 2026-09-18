# SpaceLab AI handoff

## Objective

Build a public `spacelab-ai` V0: a VWorld-backed Spatial Decision Canvas for early building-massing scenarios.

## Completed in this checkpoint

- Extracted the supplied `spacelab-ai-v0.zip` into this independent project directory.
- Defined canonical `BuildingMass`, `Scenario`, and `SpatialWorkspace` types with rectangle/free-polygon footprints.
- Added a shared application action surface used by React UI handlers and WebMCP.
- Added scenario cloning, position/rotation/height/floors/footprint editing, A/B comparison, and date/time shadow preview.
- Kept VWorld and fallback rendering in adapters; added local `.codex/.env` key loading plus hosted `VITE_VWORLD_API_KEY` boundary.
- Added architecture and Sites deployment notes.

## Verification evidence

Not run yet in this checkpoint. Next actions are dependency install, typecheck/build, local browser inspection, then independent GitHub repository creation and push through the signed-in GitHub session.

## Boundaries

- Do not commit any `.env`, API key, token, or generated secret.
- Do not claim live VWorld or real WebMCP acceptance until the corresponding runtime is opened and observed.
- Do not expand V0 into legal sunlight-right determination, full CAD/BIM, structural analysis, or production deployment without a new scope decision.
