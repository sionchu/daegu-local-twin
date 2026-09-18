import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createApplicationActions } from "./actions";
import {
  estimateGfa,
  footprintAreaM2,
  footprintPoints,
  computeShadowPolygon,
  getScenario,
  initialState,
  reducer,
  rotatedFootprintPoints,
} from "./model";
import type { BuildingMass, Footprint, LocalPoint } from "./types";
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
    <div className="control-line"><span>{label}</span><span className="value-editor"><input aria-label={`${label} value`} type="number" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />{suffix && <em>{suffix}</em>}</span></div>
    <input className="range-input" aria-label={`${label} slider`} type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
  </label>;
}

function datePart(value: string) {
  return value.slice(0, 10);
}

function timePart(value: string) {
  return value.slice(11, 16);
}

function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : 900;
}

function timeFromMinutes(value: number) {
  const minutes = Math.min(1_080, Math.max(540, value));
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function withDateAndTime(current: string, date: string, time: string) {
  return `${date || datePart(current)}T${time || timePart(current)}`;
}

function solarValue(value: number, suffix = "°") {
  return Number.isFinite(value) ? `${value.toFixed(1)}${suffix}` : "—";
}

function clonePolygon(footprint: Footprint): Footprint {
  return footprint.kind === "polygon"
    ? { kind: "polygon", points: footprint.points.map((point) => ({ ...point })) }
    : { kind: "polygon", points: footprintPoints(footprint) };
}

function massLocalPoints(mass: BuildingMass) {
  return rotatedFootprintPoints(mass).map((point) => ({
    xM: point.xM + mass.position.eastM,
    yM: point.yM + mass.position.northM,
  }));
}

function svgPoints(points: LocalPoint[]) {
  return points.map(({ xM, yM }) => `${160 + xM * 1.15},${120 - yM * 1.15}`).join(" ");
}

function shadowBearing(shadow: ReturnType<typeof computeShadowPolygon>) {
  return shadow.solar.isDaylight ? Math.round((shadow.solar.azimuthDeg + 180) % 360) : "—";
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

  return <section className="inspector-section footprint-editor">
    <div className="section-heading"><span>FOOTPRINT</span><b>{footprint.kind === "polygon" ? "FREE POLYGON" : "RECTANGLE"}</b></div>
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
  </section>;
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  const [vworldReady, setVworldReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [webMcp, setWebMcp] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<"design" | "compare">("design");
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  stateRef.current = state;

  const actions = useMemo(() => createApplicationActions((action) => {
    // Keep the bridge result synchronous for WebMCP callers while React
    // schedules the same action through its reducer for the human UI.
    stateRef.current = reducer(stateRef.current, action);
    dispatch(action);
  }, () => stateRef.current), []);

  const active = getScenario(state, state.activeScenarioId);
  const compare = state.compareScenarioId ? getScenario(state, state.compareScenarioId) : undefined;
  const activeShadow = computeShadowPolygon(active.mass, active.analysisTime, state.timeZoneOffsetMinutes);
  const compareShadow = compare ? computeShadowPolygon(compare.mass, compare.analysisTime, state.timeZoneOffsetMinutes) : undefined;

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
    state.scenarios.forEach((scenario) => renderScenario(scenario, scenario.id === state.activeScenarioId, state.timeZoneOffsetMinutes));
    setShadowMode(true);
    setShadowTime(active.analysisTime, state.timeZoneOffsetMinutes);
  }, [active.analysisTime, state.activeScenarioId, state.scenarios, state.timeZoneOffsetMinutes, vworldReady]);

  const activeDate = datePart(active.analysisTime);
  const activeTime = timePart(active.analysisTime);
  const activeMinutes = minutesFromTime(activeTime);

  return <main className={`app-shell ${workspaceMode === "compare" ? "compare-mode" : ""}`}>
    <header className="topbar">
      <div className="brand"><div className="brand-mark" aria-hidden="true">S</div><div><strong>SpaceLab</strong><span>/ {state.siteName}</span></div></div>
      <button className="navigator-toggle" aria-label="Open scenario navigator" aria-expanded={navigatorOpen} onClick={() => setNavigatorOpen((open) => !open)}>SCENARIOS</button>
      <nav className="mode-switch" aria-label="Workspace mode">
        <button className={workspaceMode === "design" ? "selected" : ""} onClick={() => setWorkspaceMode("design")}>Design</button>
        <button className={workspaceMode === "compare" ? "selected" : ""} onClick={() => setWorkspaceMode("compare")}>Compare</button>
      </nav>
      <div className="top-status">
        <span className={`runtime-status ${vworldReady ? "live" : mapError ? "attention" : ""}`}><i aria-hidden="true"></i>VWorld <b>{vworldReady ? "Live" : mapError ? "Error" : "Demo"}</b></span>
        <span className={`runtime-status ${webMcp ? "live" : ""}`}><i aria-hidden="true"></i>Site Tools <b>{webMcp ? "Connected" : "Optional"}</b></span>
      </div>
    </header>

    <section className="workspace">
      <aside className={`left-panel panel ${navigatorOpen ? "open" : ""}`}>
        <div className="panel-heading"><div><div className="eyebrow">SCENARIOS</div><span className="panel-caption">DESIGN HISTORY</span></div><span className="option-count">{state.scenarios.length} OPTIONS</span></div>
        <div className="scenario-navigator">
          <div className="navigator-base"><strong>BASE</strong><span>Real-world context</span></div>
          {state.scenarios.map((scenario) => <button key={scenario.id} className={`scenario-row ${scenario.id === active.id ? "active" : ""}`} data-scenario={scenario.id} onClick={() => { actions.selectScenario(scenario.id); setNavigatorOpen(false); }}>
            <span className="scenario-marker">{scenario.id}</span>
            <span className="scenario-copy"><strong>{scenario.name}</strong><small>{scenario.mass.heightM}m · {scenario.mass.floors} floors <em>{scenario.createdBy === "agent" ? "✦" : "•"}</em></small></span>
            <span className="scenario-ancestry">{scenario.parentId ? `↳ ${scenario.parentId}` : "BASE"}</span>
          </button>)}
        </div>
        <button className="primary branch-button" onClick={() => actions.cloneScenario(active.id, undefined, "human")}>＋ Branch current option</button>
      </aside>

      <section className="canvas-wrap">
        <div id="vworld-map" className={`vworld-canvas ${vworldReady ? "ready" : ""}`}></div>
        {!vworldReady && <div className="fallback-world">
          <div className="terrain-grid"></div><div className="fake-road road-a"></div><div className="fake-road road-b"></div>
          <div className="context-building b1"></div><div className="context-building b2"></div><div className="context-building b3"></div>
          <svg className="analysis-overlay" viewBox="0 0 320 240" aria-label="Solar shadow analysis">
            {compareShadow && compareShadow.points.length >= 3 && <polygon className="fallback-shadow compare" points={svgPoints(compareShadow.points)} />}
            {activeShadow.points.length >= 3 && <polygon className="fallback-shadow active" points={svgPoints(activeShadow.points)} />}
            {compare && <polygon className="fallback-mass compare" points={svgPoints(massLocalPoints(compare.mass))} />}
            <polygon className="fallback-mass active" points={svgPoints(massLocalPoints(active.mass))} />
          </svg>
          <div className="fallback-note">{mapError ? "VWorld unavailable · solar shadow overlay" : apiKey ? "VWorld loading…" : "VITE_VWORLD_API_KEY 미주입 · solar shadow overlay"}</div>
        </div>}
        {mapError && <div className="error-banner">{mapError}</div>}
        <div className="canvas-title"><span>LIVE SITE / {state.siteName}</span><strong>{active.id} · {active.name}</strong></div>
        <div className="canvas-legend"><span><i className="legend-dot active-dot"></i>{active.id} active</span>{compare && <span><i className="legend-dot compare-dot"></i>{compare.id} compare</span>}</div>
        <section className="analysis-dock" aria-label="Sun and shadow analysis">
          <div className="analysis-topline">
            <div className="analysis-title"><div className="eyebrow">SUN / SHADOW</div><strong>{activeTime} KST</strong><span>Altitude {solarValue(activeShadow.solar.elevationDeg)} · Azimuth {solarValue(activeShadow.solar.azimuthDeg)} · Shadow {activeShadow.solar.isDaylight ? `${activeShadow.lengthM.toFixed(1)}m` : "—"}</span></div>
            <div className="analysis-fields"><label>Date<input aria-label="Shadow date" type="date" value={activeDate} onChange={(event) => actions.setShadowTime(active.id, withDateAndTime(active.analysisTime, event.target.value, activeTime))} /></label><label>Time<input aria-label="Shadow time" type="time" value={activeTime} onChange={(event) => actions.setShadowTime(active.id, withDateAndTime(active.analysisTime, activeDate, event.target.value))} /></label></div>
          </div>
          <div className="timeline"><span>09:00</span><input aria-label="Shadow time timeline" type="range" min={540} max={1080} step={15} value={Math.min(1080, Math.max(540, activeMinutes))} onChange={(event) => actions.setShadowTime(active.id, withDateAndTime(active.analysisTime, activeDate, timeFromMinutes(Number(event.target.value))))} /><span>18:00</span></div>
          {workspaceMode === "compare" && <div className="compare-drawer">
            <div className="compare-drawer-head"><div><div className="eyebrow">COMPARE</div><strong>A / B scenario delta</strong></div><select aria-label="Compare scenario" value={state.compareScenarioId ?? ""} onChange={(event) => actions.compareScenarios(active.id, event.target.value || undefined)}><option value="">No comparison</option>{state.scenarios.filter((scenario) => scenario.id !== active.id).map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.id} · {scenario.name}</option>)}</select></div>
            {compare ? <div className="compare-grid"><Meter label="Height A / B" value={`${active.mass.heightM} / ${compare.mass.heightM}`} suffix="m" /><Meter label="GFA Δ" value={(estimateGfa(active.mass) - estimateGfa(compare.mass)).toLocaleString()} suffix="㎡" /><Meter label="Shadow A / B" value={`${activeShadow.lengthM.toFixed(1)} / ${(compareShadow?.lengthM ?? 0).toFixed(1)}`} suffix="m" /><Meter label="Shadow Δ" value={(activeShadow.lengthM - (compareShadow?.lengthM ?? 0)).toFixed(1)} suffix="m" /></div> : <p className="muted">Select another scenario to compare.</p>}
          </div>}
        </section>
      </section>

      <aside className="right-panel panel">
        <div className="inspector-heading"><span className="inspector-scenario" data-scenario={active.id}>{active.id}</span><div><div className="eyebrow">INSPECTOR</div><h2>{active.name}</h2></div></div>
        <section className="inspector-section"><div className="section-heading"><span>MASS</span><b>{active.mass.footprint.kind === "polygon" ? "POLYGON" : "RECTANGLE"}</b></div>
        <Slider label="Height" value={active.mass.heightM} min={3} max={80} suffix="m" onChange={(heightM) => actions.editBuildingMass(active.id, { heightM })} />
        <Slider label="Rotation" value={active.mass.rotationDeg} min={-180} max={180} suffix="°" onChange={(rotationDeg) => actions.editBuildingMass(active.id, { rotationDeg })} />
        <label className="control"><div className="control-line"><span>Floors</span><span className="value-editor"><input aria-label="Floors" type="number" min={1} max={40} value={active.mass.floors} onChange={(event) => actions.editBuildingMass(active.id, { floors: Number(event.target.value) })} /></span></div></label>
        </section>
        <section className="inspector-section"><div className="section-heading"><span>POSITION</span><b>LOCAL METERS</b></div>
        <Slider label="East" value={active.mass.position.eastM} min={-60} max={60} suffix="m" onChange={(eastM) => actions.editBuildingMass(active.id, { position: { eastM } })} />
        <Slider label="North" value={active.mass.position.northM} min={-60} max={60} suffix="m" onChange={(northM) => actions.editBuildingMass(active.id, { position: { northM } })} />
        </section>
        <FootprintEditor footprint={active.mass.footprint} onChange={(footprint) => actions.setMassFootprint(active.id, footprint)} />
        <section className="inspector-section"><div className="section-heading"><span>SHADOW</span><b>{activeTime} KST</b></div><div className="readout-list"><div><span>Solar altitude</span><strong>{solarValue(activeShadow.solar.elevationDeg)}</strong></div><div><span>Azimuth</span><strong>{solarValue(activeShadow.solar.azimuthDeg)}</strong></div><div><span>Shadow length</span><strong>{activeShadow.solar.isDaylight ? `${activeShadow.lengthM.toFixed(1)}m` : "—"}</strong></div><div><span>Shadow bearing</span><strong>{shadowBearing(activeShadow)}{activeShadow.solar.isDaylight ? "°" : ""}</strong></div></div></section>
        <section className="inspector-section"><div className="section-heading"><span>ANALYSIS</span><b>CANONICAL STATE</b></div><div className="readout-list"><div><span>Estimated GFA</span><strong>{estimateGfa(active.mass).toLocaleString()}㎡</strong></div><div><span>Footprint</span><strong>{Math.round(footprintAreaM2(active.mass.footprint))}㎡</strong></div></div></section>
        <small className="boundary">*Geometric solar preview. Not a statutory sunlight-right determination.</small>
      </aside>
    </section>
  </main>;
}
