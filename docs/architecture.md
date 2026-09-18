# LocalTwin Daegu architecture

```text
official/public references + permitted local video
            ↓ offline adapters
provenance-stamped snapshots in public/data/*.json
            ↓
Vite static build → React opportunity map / A-B compare / funding plan
            ↓
pure deterministic financial engine + optional VWorld provider probe
```

The browser does not own API secrets or expensive joins. The committed corridor
dataset is a small demo snapshot and every record exposes its evidence quality and
provenance IDs. Point-level deposit, rent, management fee, startup costs and funding
inputs are user inputs; regional rent/vacancy values are benchmarks only.

The spatial layer uses one canonical hex-equivalent cell system for the corridor.
DemandScore is a transparent renormalized weighted index, not a success probability.
Spillover is an exponential straight-line distance-decay signal around anchors; it is
not measured cross-shopping or causal uplift.

The optional vision path is offline-only: RF-DETR person detections, a compatible
tracker, and line/zone aggregation produce only time-bucketed counts. No faces,
embeddings, names, or persistent cross-camera identity are part of the data model.
