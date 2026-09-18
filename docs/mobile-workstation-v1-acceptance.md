# Mobile Workstation v1 acceptance

Branch: `codex/mobile-workstation-v1`

Status: NOT RUN

This gate fixes the current iPhone layout regression where the 300px inspector consumes most of the viewport and map controls overlap.

## MW-01 Mobile canvas

Test around 390×844 and 430×932 CSS pixels.

- VWorld canvas occupies the full workspace width.
- Right inspector is not permanently docked.
- Search and modeling toolbar do not force the canvas into a narrow column.

Result: NOT RUN

## MW-02 Top bar

- SpaceLab brand remains readable.
- Scenario drawer, Design/Compare, and Edit controls fit without overlap.
- Desktop VWorld / Site Tools status text is hidden on narrow mobile widths.

Result: NOT RUN

## MW-03 Scenario drawer

- Tap the menu button.
- Scenario panel opens from the left over the canvas.
- Tap the scrim or a scenario to close it.

Result: NOT RUN

## MW-04 Inspector drawer

- Tap EDIT.
- Inspector opens from the right over the canvas.
- Inspector remains vertically scrollable.
- Tap the scrim to close it.

Result: NOT RUN

## MW-05 Canvas controls

- Address search fits the viewport.
- Modeling toolbar scrolls horizontally instead of wrapping over the map.
- Tool hints remain inside the viewport.

Result: NOT RUN

## MW-06 Analysis dock

- Bottom shadow/sun panel remains usable.
- It does not occupy more than roughly one third of the mobile viewport.
- Inputs and slider remain reachable.

Result: NOT RUN

## Desktop regression

At 1440×900:

- existing 240px navigator + canvas + 320px inspector layout remains unchanged.

Result: NOT RUN

## Verification

```bash
npm run typecheck
npm run build
git diff --check
```
