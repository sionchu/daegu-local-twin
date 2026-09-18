# Analysis Pack v1 runtime acceptance

Branch: `codex/analysis-pack-v1`

Status: AP-01–AP-06 PASS; AP-07 BLOCKED

This gate must be executed in a local browser with the real VWorld key/domain configuration. GitHub CI only proves type/build/diff integrity.

## AP-01 VWorld scene sampling

- VWorld reaches `Live`.
- `scene.sampleHeightSupported === true`.
- Direct Sun Hours UI reports `City context: VWorld 3D`, not the planned-mass-only fallback.

Result: PASS

Evidence: Local runtime reached `VWorld Live`. After the scene-height sampling completed,
the UI reported `City context: VWorld 3D` (the supported branch is only rendered when
`sampleHeightSupported` and `sampleHeightMostDetailed` are available).

## AP-02 Sun study point

- Create a mass.
- Pick a ground point using `Sun point`.
- Confirm the SUN marker appears.
- Confirm Direct Sun Hours changes when the selected point changes.

Result: PASS

Evidence: A rectangular mass was created and the visible `SUN` marker was placed with
`Sun point`. Screen-picked points produced different measured values after sampling:
`(700,450)` → `5h 30m`, `(500,430)` → `6h`, and `(430,430)` → `6h 15m`.

## AP-03 Existing-city occlusion

Choose a point near an existing VWorld 3D building or terrain obstruction.

- Record planned-mass-only direct sun duration.
- Confirm VWorld scene context can reduce the final direct-sun duration.
- Confirm SpaceLab's own planned mass is not double-counted by scene sampling.

Result: PASS

Evidence: In the visible dense VWorld 3D high-rise context, point `(600,540)` reported
planned-mass-only Direct Sun `3h 30m` with `Planned-mass shadow: 0m` while sampling.
After sampling, the same point reported Direct Sun `30m`, `City context: VWorld 3D`, and
the planned-mass shadow remained `0m`. This is an observed city-context reduction without
double-counting the SpaceLab mass.

## AP-04 Scenario delta

- Create/branch A and B with meaningfully different mass height/placement.
- Confirm Direct Sun Hours A/B can diverge from planned-mass geometry.
- Confirm city-context blocked times are shared while planned-mass shadow differs by scenario.

Result: PASS

Evidence: B was branched from A, changed to `40m` and moved to approximately
`East -48.79m / North 43.20m`; A remained `18m`. With the same selected study point and
VWorld context, Compare reported `HEIGHT A / B 40 / 18m`, `SHADOW Δ 26.4m`, and
`DIRECT SUN A / B 0m / 30m`. The UI showed the active and compare geometry over the same
VWorld scene.

## AP-05 Viewpoint

- Pick a viewpoint on the map.
- Confirm VIEW marker appears.
- Set eye height to 1.7 m and open view.
- Switch A/B and reopen the same viewpoint.
- Confirm camera origin is repeatable and scenario geometry changes from the same observation point.

Result: PASS

Evidence: A viewpoint was picked, the UI displayed `VIEWPOINT 1.7m EYE`, and `Open view`
placed the camera in the selected 3D scene. Switching A/B and reopening the same viewpoint
preserved the `1.7m` eye height and camera origin while the scenario geometry changed.

## AP-06 Planning metrics

Confirm for the selected parcel:

- site area > 0
- footprint equals current mass footprint
- estimated GFA matches footprint × floors
- planned coverage = footprint / site area
- planned FAR = estimated GFA / site area

These are plan metrics only and must not be presented as legal allowances.

Result: PASS

Evidence: The selected parcel reported `Site area 1,880㎡`, current footprint `768㎡`,
`Estimated GFA 3,840㎡`, `Planned coverage 40.9%`, and `Planned FAR 204.3%`.
These match `768 × 5 = 3,840`, `768 / 1,880 = 40.9%`, and
`3,840 / 1,880 = 204.3%`.

## AP-07 WebMCP parity

If Site Tools is available:

- `set_sun_study_point`
- `set_viewpoint`
- `run_direct_sun_study`

Confirm `run_direct_sun_study` returns city-context-adjusted direct sun when VWorld scene-height sampling is supported, matching the UI result.

Result: BLOCKED

Evidence: The local UI displayed `Site Tools Connected`, but the available WebMCP
connector was attached to `about:blank` rather than the local SpaceLab tab and returned no
collected tools. No WebMCP result was substituted for an actual call.

## Verification

After the runtime acceptance:

```bash
npm run typecheck
npm run build
git diff --check
```

Do not merge PR #2 until AP-01 through AP-06 pass. AP-07 may remain BLOCKED only if Site Tools itself is unavailable, but UI/agent result divergence must not be introduced.
