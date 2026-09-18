# SpaceLab AI real-site canvas acceptance — 2026-09-18

## Scope

Runtime acceptance for `codex/real-site-canvas-modeling` only. No product feature, architecture, or UI redesign was added during this acceptance run. The acceptance target is the canonical `Site` / `BuildingMass` / `Scenario` workflow with VWorld as the rendering and data adapter.

## Environment and source

- Repository: `sionchu/spacelab-ai`
- Branch: `codex/real-site-canvas-modeling`
- Acceptance commit: `5fbeef9c8c12847eef4afe74525925964ab2e493`
- Local runtime: `http://127.0.0.1:4176/`
- VWorld credentials: loaded from the user-local `C:\Users\getch\.codex\.env`; no key value is recorded here.
- Static checks run before browser acceptance: `npm run typecheck` PASS, `npm run build` PASS, `git diff --check` PASS.
- Visual evidence: the live VWorld map and A/B compare canvas were captured directly from the browser during this run. The captures showed VWorld satellite/3D imagery, the selected parcel state, and blue/teal A/B mass-shadow overlays.

## Production gate

**BLOCKED — not publicly reachable.** The current Sites project reports `access_mode=custom` with only the owner allowlisted. A fresh Codex browser opened `https://spacelab-ai.leeje92.chatgpt.site/` and observed the login page titled `로그인 필요`, heading `거의 다 됐습니다`, and `ChatGPT로 계속`. The SpaceLab application did not load for an unauthenticated visitor. The current live Site is Sites version 5; the target acceptance branch was not deployed during this run.

Therefore, production VWorld/A-B/solar/compare and production WebMCP results are not claimed as PASS.

## Local runtime acceptance

| Gate | Result | Actual observation |
|---|---|---|
| AC-01 VWorld Live | PASS | Header changed to `VWorld Live`; the canvas displayed live VWorld satellite/3D imagery. Browser error/warn log was empty. |
| AC-02 empty workspace | PASS | Before site selection, navigator showed `0 OPTIONS`, `REAL SITE Select a real site`, and `No massing options yet.` |
| AC-03 address search | PASS | Human UI search for `판교역` returned live Korean VWorld results, including `경기도 성남시 분당구 대왕판교로606번길 45 (삼평동)`. |
| AC-04 cadastral parcel | PASS | Selecting the live result showed `Selected parcel 4113510900106530000 VWORLD PARCEL`, the address, PNU `4113510900106530000`, and the real-site navigator state. |
| AC-05 rectangle mass | PASS | `＋ Rectangle` created `A / Option A`, `18m · 5 floors`, with the inspector showing `RECTANGLE` and a live shadow preview. |
| AC-06 map move | PASS | After `↔ Move` and a VWorld canvas click, canonical inspector position changed from East/North `0/0` to East `55.193931...` and North `68.913162...` meters. |
| AC-07 polygon mass | PASS | Four canvas vertices produced `4 vertices ready`; `Finish` created `B / Option B` with inspector `FREE POLYGON` and four visible local-meter points. |
| AC-08 height/floors/footprint sync | PASS | A was edited to height `24m`, floors `6`, width `40m`, depth `20m`; the navigator and inspector reflected those values and shadow length recalculated to `28.8m`. |
| AC-09 rotation sync | PASS | A rotation inspector changed from `0°` to `25°`; the active mass remained rendered and its shadow analysis remained visible in the same canonical inspector workflow. |
| AC-10 position sync | PASS | The same A edit exposed the non-zero East/North canonical position in the inspector and moved the rendered mass in the VWorld canvas. |
| AC-11 branch | PASS | `＋ Branch current option` created `C / Option C` with the navigator lineage marker `↳ B`. |
| AC-12 branch independence | PASS | C was edited to `12m`, `3 floors`, East `-30m`; B remained `18m · 5 floors`, proving branch edits did not mutate B. |
| AC-13 solar geometry | PASS | C at `2026-09-18 15:00 KST` showed altitude `39.8°`, azimuth `234.2°`, shadow `14.4m`. Moving the canonical timeline to `14:15` changed the result to altitude `46.5°`, azimuth `221.7°`, shadow `11.4m`. |
| AC-14 A/B shadow change | PASS | With A/B at `15:00 KST`, the visible compare values were A `28.8m`, B `21.6m`, delta `7.2m`. The canvas visibly rendered separate blue and teal A/B mass-shadow overlays. |
| AC-15 compare delta | PASS | Compare mode selected `B · Option B` and showed `HEIGHT A / B 24 / 18m`, `GFA Δ -6,378㎡`, `SHADOW A / B 28.8 / 21.6m`, `SHADOW Δ 7.2m`. |
| AC-16 delete scenario/entities | PASS | After the confirmed destructive acceptance action, C was removed from the navigator; the count changed from `3 OPTIONS` to `2 OPTIONS`, A became active, C disappeared from the canonical scenario list, and the VWorld canvas was re-rendered with the remaining A/B state. |

## WebMCP / ChatGPT Site Tools

**NOT RUN — supported Site Tools context unavailable.** The local page exposed no registered WebMCP tool list. A read-only page check returned `document.modelContext` as `undefined`; the browser WebMCP capability could not collect tools, and the Playwright WebMCP surface reported `No WebMCP tools registered on the page`. The Sites project also reported that the published Site does not declare an MCP server when queried for MCP connection details.

The requested calls `get_spatial_workspace`, `edit_building_mass`, and `compare_scenarios` were not invoked because no page-provided tool registration was available. No tool name or result was fabricated. Production Site Tools could not be checked because production is behind the observed owner login gate.

## Final production acceptance — 2026-09-18

The final gate was re-run against the deployed production URL after the reported audience change. The Sites access metadata still returned `access_mode=custom`, and a fresh Codex In-app Browser tab opened the production URL without a logged-in session.

### Production acceptance

* Public access: **BLOCKED** — the browser showed `로그인 필요`, `거의 다 됐습니다`, and `ChatGPT로 계속`; the SpaceLab application DOM did not render.
* VWorld: **NOT RUN** — the public session did not reach the application.
* Address search: **NOT RUN** — the public session did not reach the application.
* Parcel: **NOT RUN** — the public session did not reach the application.
* Rectangle: **NOT RUN** — the public session did not reach the application.
* Polygon: **NOT RUN** — the public session did not reach the application.
* Move: **NOT RUN** — the public session did not reach the application.
* Branch: **NOT RUN** — the public session did not reach the application.
* Shadow: **NOT RUN** — the public session did not reach the application.
* Compare: **NOT RUN** — the public session did not reach the application.

### WebMCP acceptance

* Tool discovery: **BLOCKED** — the production tab remained on the login gate, so the Site Tools surface was not available for the application.
* `get_spatial_workspace`: **NOT RUN**
* `edit_building_mass`: **NOT RUN**
* `compare_scenarios`: **NOT RUN**

### Final candidate disposition

**BLOCKED — no competition baseline tag was created.** The unauthenticated production gate must pass before production runtime and WebMCP results can be accepted as competition evidence.

## Aside execution note

Aside was attempted as requested. The installed CLI was `1.26.916.1741`; `aside --update`, `aside repl`, and `aside host list` all failed with `fetch failed` / daemon unavailable, so the same acceptance was executed in the Codex in-app browser. No credentials, API keys, or login codes were entered.

## Candidate disposition

**Not a baseline/tag candidate yet.** Local AC-01 through AC-16 passed, but the competition baseline still lacks an unauthenticated production gate and the three requested real WebMCP calls. No merge, tag, access-policy change, or production deployment was performed.
