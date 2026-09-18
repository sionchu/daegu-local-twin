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

- `npm install` → 25 packages audited, 0 vulnerabilities.
- `npm run typecheck` → exit 0.
- `npm run build` → exit 0; Vite production bundle emitted under ignored `dist/`.
- Aside local browser inspection → initial workspace opened at `http://localhost:4173/`; A switched to free polygon, a fifth vertex was added and GFA changed from `10,560㎡` to `11,520㎡`; A branched to C; changing time from 15:00 to 09:00 changed the qualitative shadow bearing from `225°` to `135°`.
- Aside observed VWorld SDK initialization failure on this local run; fallback geometry remained interactive. WebMCP remained optional because the browser did not expose `document.modelContext`.
- Public repository created through the signed-in GitHub session: `https://github.com/sionchu/spacelab-ai`.
- `git push -u origin main` → remote `refs/heads/main` resolved to `ea8eec6ec9ad7d78d88e021a9ab42f1295db0d47`.

## Boundaries

- Do not commit any `.env`, API key, token, or generated secret.
- Do not claim live VWorld or real WebMCP acceptance until the corresponding runtime is opened and observed.
- Do not expand V0 into legal sunlight-right determination, full CAD/BIM, structural analysis, or production deployment without a new scope decision.
