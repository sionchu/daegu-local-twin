# SpaceLab Design System

## Design intent

SpaceLab is a professional spatial decision workstation for early building-massing decisions. The real-world 3D site is the primary object; AI, WebMCP, status, and analysis controls remain subordinate to the spatial canvas.

The V0 experience is desktop-first at 1440×900 and above, with 1180px as the minimum supported workstation width. The visual tone is calm, precise, spatial, and technically credible.

## Design principles

- Canvas first: preserve the largest possible uninterrupted view of the site.
- Evidence over decoration: geometry, solar state, and scenario deltas lead the hierarchy.
- Professional before AI: SpaceLab reads as a spatial editor before an AI surface.
- One canonical state: human controls and WebMCP remain views over the same scenario actions.
- Scenario history matters: alternatives communicate ancestry in one navigator.

## Foundations

### Color roles and semantic tokens

Dark workstation roles are canonical:

```css
--color-app-chrome: #0B0D10;
--color-surface-primary: #111418;
--color-surface-elevated: #171A1F;
--color-border: #292D33;
--color-text-primary: #F1F3F5;
--color-text-secondary: #9299A2;
--color-text-tertiary: #656C75;
--color-scenario-a: #5ED8D1;
--color-scenario-b: #829BFF;
--color-status-live: #73D69A;
--color-status-attention: #E8B86A;
--color-status-invalid: #E47786;
```

Scenario A uses the cool cyan/teal role and Scenario B uses restrained blue/violet. The same role is used for mass geometry, shadow polygon, navigator mark, comparison metric, and label. Gradients are not used in application chrome.

### Typography

Use Inter when available, followed by system UI fallbacks. Product and object names use 14–17px semibold. Panel headings use 10–12px uppercase text with tracked lettering. Property labels use 11–12px; values use 13–14px medium. Primary analysis values may use 22–28px. Geometry and analysis values use tabular numerals.

### Spacing scale

Use a compact 4px base rhythm with 8px, 12px, 16px, 20px, and 24px steps. Docked panels use 16px internal padding; canvas overlays use 12–16px. Prefer spacing and borders over shadows.

### Layout and containers

The application uses a 50px top bar and a three-part workspace: 230–250px scenario navigator, flexible 3D canvas, and 300–330px inspector. The canvas owns the remaining space and the bottom analysis timeline. The main canvas has no rounded card container. Docked panels are flush to the chrome with 0–4px radii.

Below 1180px, the scenario navigator may collapse into a drawer while the inspector remains available. Mobile is not a V0 target.

### Borders, radii, shadows, and surfaces

Use `--color-border` 1px borders for hierarchy. Docked panels use 0–4px radii, inputs and buttons use 5–7px, and floating palettes use at most 8px. Avoid backdrop blur on docked panels and reserve shadows for transient floating surfaces.

## Components

### Buttons and inputs

Buttons are compact, explicit, and action-oriented. Primary actions use the active scenario accent; quiet actions use a transparent surface and border. Numeric geometry inputs must remain available alongside continuous sliders. Focus-visible states use a clear scenario-accent outline.

### Scenario navigator

The left panel is one ancestry-aware navigator, not a card list plus a duplicate mini-tree. Each row shows scenario id, name, essential mass summary, creator mark, and parent connector. Human and Agent scenarios have equal visual weight; Agent-created rows may use a subtle star mark.

### Inspector

The right panel follows the selected scenario and reads like an engineering property editor. Use aligned labels and values grouped under MASS, POSITION, SHADOW, and FOOTPRINT. Do not turn analysis into a dashboard KPI grid.

### Spatial canvas and analysis

The canvas may show only site title, active/compare legend, camera/runtime state, and contextual analysis. The SUN / SHADOW timeline is docked to the bottom edge of the canvas. Compare is a first-class compact mode/drawer with A/B values and deltas.

### Status and fallback

VWorld and Site Tools status are small and quiet in the top bar. Demo geometry is an intentional context mode, not an error screen. Runtime failures may appear as compact technical notifications.

## Interaction

Motion is functional only: mass edits, branch creation, compare transition, inspector selection, and agent-applied edits use 150–280ms transitions. Respect `prefers-reduced-motion`.

All interactive controls must be keyboard reachable, visibly focused, labelled, and maintain at least a comfortable workstation target size. Color must not be the only signal for scenario identity; ids and labels remain visible.

## Do / Don't

- Do keep the VWorld canvas visually dominant.
- Do keep scenario color consistent across geometry, shadow, navigator, and comparison.
- Do use concise technical labels and tabular values.
- Don't add generic AI gradients, permanent chatbot banners, glass panels, floating KPI cards, or decorative analytics.
- Don't duplicate canonical scenario or application-action logic for visual presentation.

## Implementation notes

`src/styles.css` owns the semantic tokens and workstation layout. `src/App.tsx` owns the human presentation only; canonical state and shared actions remain in `src/model.ts`, `src/types.ts`, and `src/actions.ts`. VWorld and fallback rendering remain adapters. Add new visual values to the semantic token block before using them in components.
