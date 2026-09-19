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
- The primary spatial overlay is a filled/bordered corridor polygon derived from real
  road/market geometry. It is explicitly labelled as a model corridor, not an official
  commercial-district boundary.
- Exact candidate cells remain secondary selectable points inside those corridors.
- Persistent corridor labels, transit anchors, official administrative boundaries, and
  VWorld buildings must make the geography legible at a glance.
- The MapLibre/deck.gl path is a lazy reliability fallback, not the primary visual layer.
- Charts answer a decision question:
  - when is demand concentrated?
  - where is demand high relative to rent?
  - how fast does cash deplete?
  - how is startup funding composed?
- Mobile must reflow without page-level horizontal overflow.
- Focus states remain visible and reduced-motion settings are respected.
