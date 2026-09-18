import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createApplicationActions } from "./actions";
import {
  estimateGfa,
  footprintAreaM2,
  footprintBounds,
  footprintPoints,
  getScenario,
  initialState,
  reducer,
  rotatedFootprintPoints,
  shadowPreview,
} from "./model";
import type { BuildingMass, Footprint, LocalPoint, SpatialWorkspace } from "./types";
import { registerSpaceLabTools } from "./webmcp";
import { renderScenario, setShadowMode, setShadowTime, startVWorld } from "./vworld";
import "./styles.css";

const apiKey = import.meta.env.VITE_VWORLD_API_KEY as string | undefined;

function Meter({ label, value, suffix = "" }: { label: string; value: string | number; suffix?: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}{suffix}</strong></div>;
}

type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
};

function Slider({ label, value, min, max, step = 1, suffix = "", onChange }: SliderProps) {
  return <label className="control">
    <div><span>{label}</span><b>{value}{suffix}</b></div>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
  </label>;
}

function clonePolygon(footprint: Footprint): Footprint {
  return footprint.kind === "polygon"
    ? { kind: "polygon", points: footprint.points.map((point) => ({ ...point })) }
    : { kind: "polygon", points: footprintPoints(footprint) };
}

function footprintCssPolygon(mass: BuildingMass) {
  const points = rotatedFootprintPoints(mass);
  const xs = points.map((point) => point.xM);
  const ys = points.map((point) => point.yM);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(...xs) - minX || 1;
  const depth = Math.max(...ys) - minY || 1;
  return points.map((point) => `${((point.xM - minX) / width) * 100}% ${((point.yM - minY) / depth) * 100}%`).join(", ");
}

function FootprintEditor({ footprint, onChange }: { footprint: Footprint; onChange: (next: Footprint) => void }) {
  const setRectangleDimension = (key: "widthM" | "depthM", value: number) => {
    const rectangle = footprint.kind === "rectangle"
      ? footprint
      : { kind: "rectangle" as const, widthM: 44, depthM: 30 };
    onChange({ ...rectangle, [key]: value });
  };

  const setPoint = (index: number, key: keyof LocalPoint, value: number) => {
    if (footprint.kind !== "polygon") return;
    onChange({
      kind: "polygon",
      points: footprint.points.map((point, pointIndex) => pointIndex === index ? { ...point, [key]: value } : point),
    });
  };

  const addPoint = () => {
    if (footprint.kind !== "polygon") return;
    const previous = footprint.points[footprint.points.length - 1] ?? { xM: 20, yM: 0 };
    onChange({ kind: "polygon", points: [...footprint.points, { xM: previous.xM - 8, yM: previous.yM + 8 }] });
  };

  const removePoint = (index: number) => {
    if (footprint.kind !== "polygon" || footprint.points.length <= 3) return;
    onChange({ kind: "polygon", points: footprint.points.filter((_, pointIndex) => pointIndex !== index) });
  };

  return <div className="control footprint-editor">
    <div className="field-heading"><span>Footprint</span><b>{footprint.kind === "polygon" ? "free polygon" : "rectangle"}</b></div>
    <div className="segmented" role="group" aria-label="Footprint type">
      <button className={footprint.kind === "rectangle" ? "selected" : ""} onClick={() => onChange(footprint.kind === "rectangle" ? footprint : { kind: "rectangle", widthM: 44, depthM: 30 })}>Rectangle</button>
      <button className={footprint.kind === "polygon" ? "selected" : ""} onClick={() => onChange(clonePolygon(footprint))}>Free polygon</button>
    </div>
    {footprint.kind === "rectangle" ? <div className="two-fields">
      <label><span>Width</span><input type="number" min={6} max={200} value={footprint.widthM} onChange={(event) => setRectangleDimension("widthM", Number(event.target.value))} /></label>
      <label><span>Depth</span><input type="number" min={6} max={200} value={footprint.depthM} onChange={(event) => setRectangleDimension("depthM", Number(event.target.value))} /></label>
    </div> : <div className="polygon-editor">
      <div className="polygon-toolbar"><span>{footprint.points.length} vertices · local meters</span><button className="quiet-button" onClick={addPoint}>＋ vertex</button></div>
      {footprint.points.map((point, index) => <div className="point-row" key={`point-${index}`}>
        <span>P{index + 1}</span>
        <input aria-label={`P${index + 1} east`} type="number" step="1" value={point.xM} onChange={(event) => setPoint(index, "xM", Number(event.target.value))} />
        <input aria-label={`P${index + 1} north`} type="number" step="1" value={point.yM} onChange={(event) => setPoint(index, "yM", Number(event.target.value))} />
        <button className="remove-point" aria-label={`Remove P${index + 1}`} disabled={footprint.points.length <= 3} onClick={() => removePoint(index)}>×</button>
      </div>)}
    </div>}
  </div>;
}

function activityForChange(previous: SpatialWorkspace, next: SpatialWorkspace) {
  if (previous.scenarios.length !== next.scenarios.length) {
    const added = next.scenarios.find((scenario) => !previous.scenarios.some((old) => old.id === scenario.id));
    return added ? `Created ${added.id} from ${added.parentId ?? "workspace"}` : "Scenario list updated";
  }
  if (previous.activeScenarioId !== next.activeScenarioId) return `Selected ${next.activeScenarioId}`;
  if (previous.compareScenarioId !== next.compareScenarioId) return `Comparing ${next.activeScenarioId} and ${next.compareScenarioId ?? "none"}`;
  const changed = next.scenarios.find((scenario) => {
    const old = previous.scenarios.find((candidate) => candidate.id === scenario.id);
    return old && (old.analysisTime !== scenario.analysisTime || JSON.stringify(old.mass) !== JSON.stringify(scenario.mass));
  });
  if (changed) return changed.analysisTime !== previous.scenarios.find((scenario) => scenario.id === changed.id)?.analysisTime
    ? `Updated shadow time for ${changed.id}`
    : `Edited ${changed.id} mass`;
  return "Workspace updated";
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  const previousStateRef = useRef(state);
  const [activity, setActivity] = useState<string[]>(["Spatial workspace initialized"]);
  const [vworldReady, setVworldReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [webMcp, setWebMcp] = useState(false);
  stateRef.current = state;

  const actions = useMemo(() => createApplicationActions((action) => {
    // Keep the bridge result synchronous for WebMCP callers while React
    // schedules the same action through its reducer for the human UI.
    stateRef.current = reducer(stateRef.current, action);
    dispatch(action);
  }, () => stateRef.current), []);

  const active = getScenario(state, state.activeScenarioId);
  const compare = state.compareScenarioId ? getScenario(state, state.compareScenarioId) : undefined;
  const activeShadow = shadowPreview(active.mass, active.analysisTime);
  const compareShadow = compare ? shadowPreview(compare.mass, compare.analysisTime) : undefined;
  const activeBounds = footprintBounds(active.mass);

  useEffect(() => {
    const previous = previousStateRef.current;
    if (previous !== state) setActivity((items) => [activityForChange(previous, state), ...items].slice(0, 8));
    previousStateRef.current = state;
  }, [state]);

  useEffect(() => {
    const registration = registerSpaceLabTools({ ...actions, getState: () => stateRef.current });
    setWebMcp(registration.supported);
    return registration.dispose;
  }, [actions]);

  useEffect(() => {
    if (!apiKey) return undefined;
    let cancelled = false;
    startVWorld("vworld-map", apiKey, state.siteCenter.lon, state.siteCenter.lat)
      .then(() => { if (!cancelled) setVworldReady(true); })
      .catch((error) => { if (!cancelled) setMapError(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, [state.siteCenter.lat, state.siteCenter.lon]);

  useEffect(() => {
    if (!vworldReady) return;
    state.scenarios.forEach((scenario) => renderScenario(scenario, scenario.id === state.activeScenarioId));
    setShadowMode(true);
    setShadowTime(active.analysisTime);
  }, [active.analysisTime, state.activeScenarioId, state.scenarios, vworldReady]);

  const statusLabel = vworldReady ? "VWorld 3D live" : mapError ? "VWorld unavailable" : apiKey ? "Connecting VWorld" : "Demo geometry";

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark">S</div><div><strong>SpaceLab</strong><span>Spatial Decision Canvas</span></div></div>
      <div className="top-actions"><span className={`pill ${vworldReady ? "live" : ""}`}>{statusLabel}</span><span className={`pill ${webMcp ? "live" : ""}`}>{webMcp ? "WebMCP connected" : "WebMCP optional"}</span></div>
    </header>

    <section className="workspace">
      <aside className="left-panel panel">
        <div className="eyebrow">SCENARIO GRAPH</div>
        <h2>Branch the real world.</h2>
        <p className="muted">현실 공간을 기준으로 대안을 만들고, 같은 모델 상태로 편집·분석·비교합니다.</p>
        <div className="scenario-list">
          {state.scenarios.map((scenario) => <button key={scenario.id} className={`scenario-card ${scenario.id === active.id ? "active" : ""}`} onClick={() => actions.selectScenario(scenario.id)}>
            <span className="scenario-id">{scenario.id}</span>
            <div><strong>{scenario.name}</strong><small>{scenario.intent}</small><span className="scenario-meta"><em>{scenario.mass.footprint.kind === "polygon" ? "POLY" : "RECT"}</em> · {scenario.createdBy}</span></div>
            <i>{scenario.parentId ? `↳ ${scenario.parentId}` : "BASE"}</i>
          </button>)}
        </div>
        <button className="primary" onClick={() => actions.cloneScenario(active.id, undefined, "human")}>＋ Branch from {active.id}</button>
        <div className="mini-tree"><span>BASE</span>{state.scenarios.map((scenario) => <span key={scenario.id}>{scenario.parentId ? "↳" : "→"} {scenario.id}</span>)}</div>
        <div className="left-note"><strong>Shared action surface</strong><span>Human controls and WebMCP call the same application actions.</span></div>
      </aside>

      <section className="canvas-wrap">
        <div id="vworld-map" className={`vworld-canvas ${vworldReady ? "ready" : ""}`}></div>
        {!vworldReady && <div className="fallback-world">
          <div className="terrain-grid"></div><div className="fake-road road-a"></div><div className="fake-road road-b"></div>
          <div className="context-building b1"></div><div className="context-building b2"></div><div className="context-building b3"></div>
          <div className="candidate-mass" style={{
            width: `${Math.max(116, activeBounds.widthM * 3.1)}px`,
            height: `${Math.max(96, activeBounds.depthM * 3.1)}px`,
            clipPath: `polygon(${footprintCssPolygon(active.mass)})`,
            transform: `translate(calc(-50% + ${active.mass.position.eastM * 2}px), calc(-50% - ${active.mass.position.northM * 2}px))`,
          }}><span>{active.id}</span></div>
          <div className="shadow-shape" style={{ width: `${Math.max(80, activeShadow.lengthM * 5)}px`, transform: `translate(-12%, 75%) rotate(${activeShadow.bearingDeg - 90}deg)` }}></div>
          <div className="fallback-note">{mapError ? "VWorld unavailable · demo geometry" : apiKey ? "VWorld loading…" : "VITE_VWORLD_API_KEY 미주입 · demo geometry"}</div>
        </div>}
        {mapError && <div className="error-banner">{mapError}</div>}
        <div className="canvas-title"><span>{state.siteName}</span><strong>{active.name}</strong></div>
        <div className="canvas-legend"><span><i className="legend-dot active-dot"></i>{active.id} active</span>{compare && <span><i className="legend-dot compare-dot"></i>{compare.id} compare</span>}</div>
        <div className="command-hint">Try in ChatGPT Site Tools: “B안을 20m로 낮추고 남쪽으로 5m 옮겨줘.”</div>
      </section>

      <aside className="right-panel panel">
        <div className="eyebrow">PARAMETRIC MASS</div><h2>{active.id} · Model</h2>
        <Slider label="Height" value={active.mass.heightM} min={3} max={80} suffix="m" onChange={(heightM) => actions.editBuildingMass(active.id, { heightM })} />
        <Slider label="Rotation" value={active.mass.rotationDeg} min={-180} max={180} suffix="°" onChange={(rotationDeg) => actions.editBuildingMass(active.id, { rotationDeg })} />
        <Slider label="East / West" value={active.mass.position.eastM} min={-60} max={60} suffix="m" onChange={(eastM) => actions.editBuildingMass(active.id, { position: { eastM } })} />
        <Slider label="North / South" value={active.mass.position.northM} min={-60} max={60} suffix="m" onChange={(northM) => actions.editBuildingMass(active.id, { position: { northM } })} />
        <label className="control"><div><span>Floors</span><b>{active.mass.floors}</b></div><input type="number" min={1} max={40} value={active.mass.floors} onChange={(event) => actions.editBuildingMass(active.id, { floors: Number(event.target.value) })} /></label>
        <FootprintEditor footprint={active.mass.footprint} onChange={(footprint) => actions.setMassFootprint(active.id, footprint)} />
        <label className="control"><div><span>Shadow preview time</span><b>KST</b></div><input type="datetime-local" value={active.analysisTime} onChange={(event) => actions.setShadowTime(active.id, event.target.value)} /></label>
        <div className="metrics-grid"><Meter label="Estimated GFA" value={estimateGfa(active.mass).toLocaleString()} suffix="㎡" /><Meter label="Footprint" value={Math.round(footprintAreaM2(active.mass.footprint))} suffix="㎡" /><Meter label="Shadow length*" value={activeShadow.lengthM} suffix="m" /><Meter label="Shadow bearing" value={Math.round(activeShadow.bearingDeg)} suffix="°" /></div>
        <small className="boundary">*Qualitative pre-feasibility preview. Not a statutory sunlight-right determination.</small>
      </aside>
    </section>

    <section className="bottom-panel panel">
      <div className="compare-head"><div><div className="eyebrow">COMPARE</div><h2>Scenario delta</h2></div><select value={state.compareScenarioId ?? ""} onChange={(event) => actions.compareScenarios(active.id, event.target.value || undefined)}><option value="">No comparison</option>{state.scenarios.filter((scenario) => scenario.id !== active.id).map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.id} · {scenario.name}</option>)}</select></div>
      {compare ? <div className="compare-grid">
        <Meter label={`${active.id} Height`} value={active.mass.heightM} suffix="m" /><Meter label={`${compare.id} Height`} value={compare.mass.heightM} suffix="m" />
        <Meter label="Height Δ" value={(active.mass.heightM - compare.mass.heightM).toFixed(1)} suffix="m" /><Meter label="GFA Δ" value={(estimateGfa(active.mass) - estimateGfa(compare.mass)).toLocaleString()} suffix="㎡" /><Meter label="Shadow Δ*" value={(activeShadow.lengthM - (compareShadow?.lengthM ?? 0)).toFixed(1)} suffix="m" />
      </div> : <p className="muted">Select another scenario to compare.</p>}
      <div className="activity-strip">{activity.slice(0, 5).map((item, index) => <span key={`${item}-${index}`}>✓ {item}</span>)}</div>
    </section>
  </main>;
}
