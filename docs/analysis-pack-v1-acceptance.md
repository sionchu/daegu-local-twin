# Analysis Pack v1 runtime acceptance

Branch: `codex/analysis-pack-v1`

Status: NOT RUN

This gate must be executed in a local browser with the real VWorld key/domain configuration. GitHub CI only proves type/build/diff integrity.

## AP-01 VWorld scene sampling

- VWorld reaches `Live`.
- `scene.sampleHeightSupported === true`.
- Direct Sun Hours UI reports `City context: VWorld 3D`, not the planned-mass-only fallback.

Result: NOT RUN

## AP-02 Sun study point

- Create a mass.
- Pick a ground point using `Sun point`.
- Confirm the SUN marker appears.
- Confirm Direct Sun Hours changes when the selected point changes.

Result: NOT RUN

## AP-03 Existing-city occlusion

Choose a point near an existing VWorld 3D building or terrain obstruction.

- Record planned-mass-only direct sun duration.
- Confirm VWorld scene context can reduce the final direct-sun duration.
- Confirm SpaceLab's own planned mass is not double-counted by scene sampling.

Result: NOT RUN

## AP-04 Scenario delta

- Create/branch A and B with meaningfully different mass height/placement.
- Confirm Direct Sun Hours A/B can diverge from planned-mass geometry.
- Confirm city-context blocked times are shared while planned-mass shadow differs by scenario.

Result: NOT RUN

## AP-05 Viewpoint

- Pick a viewpoint on the map.
- Confirm VIEW marker appears.
- Set eye height to 1.7 m and open view.
- Switch A/B and reopen the same viewpoint.
- Confirm camera origin is repeatable and scenario geometry changes from the same observation point.

Result: NOT RUN

## AP-06 Planning metrics

Confirm for the selected parcel:

- site area > 0
- footprint equals current mass footprint
- estimated GFA matches footprint × floors
- planned coverage = footprint / site area
- planned FAR = estimated GFA / site area

These are plan metrics only and must not be presented as legal allowances.

Result: NOT RUN

## AP-07 WebMCP parity

If Site Tools is available:

- `set_sun_study_point`
- `set_viewpoint`
- `run_direct_sun_study`

Confirm `run_direct_sun_study` returns city-context-adjusted direct sun when VWorld scene-height sampling is supported, matching the UI result.

Result: NOT RUN

## Verification

After any runtime fix:

```bash
npm run typecheck
npm run build
git diff --check
```

Do not merge PR #2 until AP-01 through AP-06 pass. AP-07 may remain BLOCKED only if Site Tools itself is unavailable, but UI/agent result divergence must not be introduced.
