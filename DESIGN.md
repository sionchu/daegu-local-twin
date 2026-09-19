# LocalTwin Daegu design system

## Visual thesis

A spatial evidence desk for a founder making a cash-risk decision: dark slate surfaces,
teal demand signals, amber cost/risk signals, and a real 3D map as the primary working
surface.

The product should feel like a decision instrument, not a generic analytics dashboard.

## Interface rules

- Maximum three primary views: **3D 기회지도, 후보비교, 자금계획**.
- The map stays visually dominant on desktop.
- Teal represents positive/demand evidence and candidate A.
- Amber represents cost/stress attention and candidate B.
- Every normalized metric shows its source/status nearby.
- `demo` / `modelled` / `official` is textual, never color-only.
- VWorld city context is geographic context, never opportunity evidence.
- Official administrative boundaries are thin context lines.
- Opportunity cells are soft translucent surfaces/halos and are explicitly labelled as
  model analysis units, not real commercial-district boundaries.
- Persistent place labels and transit anchors must make each cell spatially legible.
- The MapLibre/deck.gl path is a lazy reliability fallback, not the primary visual layer.
- Time slider must affect solar lighting and chart focus without implying causal demand
  measurement.
- Charts answer a decision question:
  - when is demand concentrated?
  - where is demand high relative to rent?
  - how fast does cash deplete?
  - how is startup funding composed?
- Mobile must reflow without page-level horizontal overflow.
- Focus states remain visible and reduced-motion settings are respected.
