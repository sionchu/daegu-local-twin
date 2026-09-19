# LocalTwin Daegu design system

## Visual thesis

LocalTwin은 AI 대시보드가 아니라 **상권 검토 데스크**로 보인다. 실제 3D 지도를
주 작업면으로 두고, 오른쪽 검토 패널에서 입지요약 → 관계도 → 사업성 순으로 읽는다.

화면은 지도와 검토표의 실무 도구처럼 차분해야 하며, 반복적인 카드·과한 그라데이션·
AI 등급 연출은 사용하지 않는다.

## Interface rules

- Maximum three primary views: **상권지도, 후보비교, 자금계획**.
- The map stays visually dominant on desktop; the review panel remains alongside it from 1024 px.
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
- The selected location shows one relation graph linking transport demand, search interest, rent, regeneration, and nearby attraction signals. The graph expresses review structure, not causality.
- Charts answer a decision question:
  - where is demand high relative to rent?
  - how fast does cash deplete?
  - how is startup funding composed?
- Mobile must reflow without page-level horizontal overflow.
- Focus states remain visible and reduced-motion settings are respected.
