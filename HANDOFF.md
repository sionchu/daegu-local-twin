# SpaceLab AI handoff

## Objective

Build a public `spacelab-ai` V0: a VWorld-backed Spatial Decision Canvas for early building-massing decisions.

## Completed in this checkpoint

- Defined canonical `BuildingMass`, `Scenario`, and `SpatialWorkspace` state with shared human/WebMCP application actions.
- Added rectangular/free-polygon mass editing, branching, A/B comparison, geolocation/date/time solar geometry, and shadow polygon rendering through the VWorld and fallback adapters.
- Added local `.codex/.env` key loading and hosted `VITE_VWORLD_API_KEY` / `VITE_VWORLD_DOMAIN` boundaries without committing secrets.
- Established the project visual source of truth in `DESIGN.md` from the supplied SpaceLab workstation specification.
- Reworked the UI without duplicating application state: canvas-first workstation layout, ancestry-aware Scenario Navigator, compact Design/Compare mode, engineering-style inspector, and bottom SUN / SHADOW timeline.

## Current checkpoint

- Design-pass commit `25e60e6dbcc852caa9d340c6dfc2035f61a6dad2` is pushed to the public GitHub repository and the connected Sites source repository.
- The matching private Sites version is deployed at `https://spacelab-ai.leeje92.chatgpt.site`.
- `src/webmcp.ts` was not changed; the design pass only changes presentation and local UI mode state.
- Competition baseline acceptance is recorded in `docs/competition-baseline-acceptance-2026-09-18.md`; the first gate is blocked because the production access mode is `custom` and a fresh browser receives the login gate.

## Verification evidence

- `npm install` → 25 packages audited, 0 vulnerabilities.
- `npm run typecheck` → exit 0 after the design pass.
- `npm run build` → exit 0; Vite production bundle emitted under ignored `dist/`.
- `git diff --check` → no whitespace errors.
- CUA local preview at `http://127.0.0.1:4175/` → direct screenshot showed `VWorld Live`, real VWorld imagery/terrain, A/B mass and shadow overlays, a canvas-docked SUN / SHADOW timeline, and Compare mode metrics (`33.6 / 21.6 m`, delta `12.0 m`).
- CUA Design mode screenshot → canvas remained dominant while Scenario Navigator, inspector, and timeline stayed visible without a permanent AI banner or duplicate scenario tree.

## Boundaries

- Do not commit any `.env`, API key, token, or generated secret.
- Do not claim live VWorld or real WebMCP acceptance until the corresponding runtime is opened and observed.
- Do not expand V0 into legal sunlight-right determination, full CAD/BIM, structural analysis, or unrelated product features.

## Next concrete action

The Site owner must decide whether to make the production audience public. Then rerun the unauthenticated visual gate and the three requested Site Tools calls without changing features, architecture, or UI.
