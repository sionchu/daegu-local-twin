import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createApplicationActions } from "./actions";
import {
  analyzeFinancials,
  computeOpportunityScores,
  getCell,
  getScenario,
  initialState,
  reducer,
} from "./model";
import { probeVWorld } from "./vworld";
import { registerLocalTwinTools } from "./webmcp";
import {
  businessCategoryLabels,
  stressPresetLabels,
  type BusinessCategory,
  type BusinessScenario,
  type FinancialAnalysis,
  type LocalTwinState,
  type LocationEvidence,
  type MapLayer,
  type StartupAssumptions,
  type StressPreset,
  type SupportProgram,
} from "./types";
import "./styles.css";

type View = "map" | "compare" | "funding";
type ProviderStatus = "checking" | "live" | "fallback";
type ProvenanceSource = {
  id: string;
  title: string;
  provider: string;
  url: string;
  geographicLevel: string;
  freshness: string;
  fieldsUsed: string[];
  limitations: string;
  mode: "live" | "snapshot" | "demo";
};
type Provenance = {
  generatedAt: string;
  grid: { kind: string; resolution: string; note: string };
  sources: ProvenanceSource[];
  privacyBoundary: string[];
};

const apiKey = import.meta.env.VITE_VWORLD_API_KEY as string | undefined;
const vworldDomain = import.meta.env.VITE_VWORLD_DOMAIN as string | undefined;

const layerLabels: Record<MapLayer, string> = {
  opportunity: "종합 Opportunity",
  demand: "상권 수요",
  transit: "교통 접근",
  buzz: "Buzz / 관심도",
  spillover: "파생수요",
  regeneration: "도시재생 맥락",
  rent: "임대부담 Benchmark",
};

const qualityLabels: Record<LocationEvidence["evidenceQuality"], string> = {
  observed: "관측",
  official: "공식",
  modelled: "모델",
  demo: "데모",
};

const currencyFormatter = new Intl.NumberFormat("ko-KR");
const numberFormatter = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });

function formatKrw(value: number) {
  return `${currencyFormatter.format(Math.round(value))}원`;
}

function formatMan(value: number) {
  return `${numberFormatter.format(Math.round(value / 10_000))}만원`;
}

function formatPercent(value: number | null, digits = 1) {
  return value === null || !Number.isFinite(value) ? "데이터 부족" : `${(value * 100).toFixed(digits)}%`;
}

function formatNumber(value: number | null, digits = 0) {
  return value === null || !Number.isFinite(value) ? "데이터 부족" : value.toLocaleString("ko-KR", { maximumFractionDigits: digits });
}

function scoreColor(score: number | null) {
  if (score === null) return "#2b3542";
  const hue = 190 - Math.max(0, Math.min(100, score)) * 1.25;
  return `hsl(${hue} 78% ${Math.max(38, Math.min(67, 42 + score * 0.18))}%)`;
}

function metricScore(cell: LocationEvidence, cells: LocationEvidence[], layer: MapLayer) {
  const scores = computeOpportunityScores(cell, cells);
  if (layer === "opportunity") return scores.opportunityScore;
  if (layer === "demand") return scores.footfall;
  if (layer === "transit") return scores.transit;
  if (layer === "buzz") return scores.buzz;
  if (layer === "spillover") return scores.spillover;
  if (layer === "rent") return scores.rentRelief;
  return cell.regenerationScore;
}

function scenarioCell(state: LocalTwinState, scenario?: BusinessScenario) {
  return scenario ? state.cells.find((cell) => cell.cellId === scenario.locationCellId) : undefined;
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "teal" | "amber" | "blue" | "red" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function EvidenceBadge({ quality }: { quality: LocationEvidence["evidenceQuality"] }) {
  const tone = quality === "official" || quality === "observed" ? "teal" : quality === "modelled" ? "blue" : "amber";
  return <Badge tone={tone}>{qualityLabels[quality]}</Badge>;
}

function StatRow({ label, value, note, accent = false }: { label: string; value: React.ReactNode; note?: string; accent?: boolean }) {
  return <div className="stat-row"><span>{label}</span><strong className={accent ? "accent" : ""}>{value}</strong>{note && <small>{note}</small>}</div>;
}

function FieldBar({ label, value, note }: { label: string; value: number | null; note?: string }) {
  return <div className="field-bar"><div><span>{label}</span><b>{value === null ? "데이터 부족" : `${Math.round(value)} / 100`}</b></div><div className="bar-track"><i style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} /></div>{note && <small>{note}</small>}</div>;
}

function MapCanvas({ cells, layer, selectedCellId, onSelect, state }: { cells: LocationEvidence[]; layer: MapLayer; selectedCellId?: string; onSelect: (cellId: string) => void; state: LocalTwinState }) {
  const minLon = 128.582;
  const maxLon = 128.612;
  const minLat = 35.861;
  const maxLat = 35.884;
  const project = (lon: number, lat: number) => ({ x: ((lon - minLon) / (maxLon - minLon)) * 1000, y: 760 - ((lat - minLat) / (maxLat - minLat)) * 700 });
  const candidateByCell = new Map(state.scenarios.map((scenario) => [scenario.locationCellId, scenario.id === state.activeScenarioId ? "A" : scenario.id === state.compareScenarioId ? "B" : ""]));
  return <div className="map-canvas-wrap">
    <svg className="map-canvas" viewBox="0 0 1000 760" role="img" aria-label="동성로 교동 북성로 기회 신호 지도">
      <defs>
        <pattern id="street-grid" width="70" height="70" patternUnits="userSpaceOnUse" patternTransform="rotate(12)">
          <path d="M 0 0 L 0 70 M 35 0 L 35 70" stroke="#1c2732" strokeWidth="1" />
        </pattern>
        <linearGradient id="corridor-gradient" x1="0" x2="1"><stop offset="0" stopColor="#5eead4" stopOpacity=".1" /><stop offset="1" stopColor="#f4b860" stopOpacity=".25" /></linearGradient>
      </defs>
      <rect width="1000" height="760" fill="#0e151d" />
      <rect width="1000" height="760" fill="url(#street-grid)" opacity=".62" />
      <path d="M110 660 C260 600 330 505 435 430 S640 280 880 125" fill="none" stroke="url(#corridor-gradient)" strokeWidth="76" strokeLinecap="round" opacity=".45" />
      <path d="M80 646 C270 574 337 496 449 420 S667 265 910 110" fill="none" stroke="#526171" strokeWidth="4" strokeDasharray="10 12" opacity=".7" />
      <text x="90" y="695" className="map-label muted">북성로</text>
      <text x="430" y="455" className="map-label">교동</text>
      <text x="795" y="125" className="map-label">동성로</text>
      <text x="66" y="96" className="map-caption">CENTRAL DAEGU · 0.5km GRID VIEW</text>
      <g className="station-markers">
        <circle cx="305" cy="555" r="7" /><circle cx="510" cy="399" r="7" /><circle cx="700" cy="260" r="7" />
        <text x="317" y="560">서문시장역</text><text x="522" y="404">중앙로역</text><text x="712" y="265">반월당역</text>
      </g>
      {cells.map((cell) => {
        const score = metricScore(cell, cells, layer);
        const points = cell.boundary.map((point) => { const projected = project(point.lon, point.lat); return `${projected.x},${projected.y}`; }).join(" ");
        const center = project(cell.center.lon, cell.center.lat);
        const slot = candidateByCell.get(cell.cellId);
        return <g key={cell.cellId} className={`map-cell ${selectedCellId === cell.cellId ? "selected" : ""}`} onClick={() => onSelect(cell.cellId)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(cell.cellId); }} aria-label={`${cell.label}, ${layerLabels[layer]} ${score === null ? "데이터 부족" : Math.round(score)}`}>
          <polygon points={points} fill={scoreColor(score)} fillOpacity={selectedCellId === cell.cellId ? ".86" : ".66"} stroke={selectedCellId === cell.cellId ? "#fff" : "#b7d6d5"} strokeWidth={selectedCellId === cell.cellId ? "4" : "1.5"} />
          <circle cx={center.x} cy={center.y} r={slot ? 17 : 5} fill={slot === "A" ? "#0b1018" : slot === "B" ? "#f4b860" : "#d6fffa"} stroke={slot ? "#fff" : "none"} strokeWidth="3" />
          {slot && <text x={center.x} y={center.y + 5} textAnchor="middle" className="candidate-letter">{slot}</text>}
          <text x={center.x} y={center.y + (slot ? 34 : 19)} textAnchor="middle" className="cell-name">{cell.label.replace(" · ", " ")}</text>
          {score !== null && <text x={center.x} y={center.y - 16} textAnchor="middle" className="cell-score">{Math.round(score)}</text>}
        </g>;
      })}
      <g className="north-arrow" transform="translate(914 70)"><path d="M0 32 L11 0 L22 32 L11 25 Z" fill="#d8fff8" /><text x="11" y="49" textAnchor="middle">N</text></g>
    </svg>
    <div className="map-attribution">육각형 셀 · 거리감쇠 파생수요 · 일부 데모 데이터</div>
  </div>;
}

function MapView({ state, actions, selectedCellId, setSelectedCellId, providerStatus, provenance }: { state: LocalTwinState; actions: ReturnType<typeof createApplicationActions>; selectedCellId?: string; setSelectedCellId: (id: string) => void; providerStatus: ProviderStatus; provenance?: Provenance }) {
  const cell = state.cells.find((item) => item.cellId === selectedCellId) ?? state.cells[0];
  const scores = cell ? computeOpportunityScores(cell, state.cells) : undefined;
  const active = state.activeScenarioId ? getScenario(state, state.activeScenarioId) : undefined;
  const compare = state.compareScenarioId ? getScenario(state, state.compareScenarioId) : undefined;
  return <section className="view map-view">
    <div className="map-main">
      <div className="view-kicker"><span>01 / OPPORTUNITY MAP</span><Badge tone={providerStatus === "live" ? "teal" : "amber"}>{providerStatus === "live" ? "VWorld 3D live" : providerStatus === "checking" ? "지도 상태 확인 중" : "Demo geometry"}</Badge></div>
      <div className="hero-copy"><h1>사람이 많은 곳보다,<br /><em>내가 버틸 수 있는 곳.</em></h1><p>동성로–교동–북성로의 수요 신호를 실제 점포 조건과 함께 비교합니다.</p></div>
      <div className="map-toolbar" aria-label="지도 레이어 선택">{(Object.keys(layerLabels) as MapLayer[]).map((layer) => <button key={layer} className={state.activeLayer === layer ? "active" : ""} onClick={() => actions.setLayer(layer)}>{layerLabels[layer]}</button>)}</div>
      <MapCanvas cells={state.cells} layer={state.activeLayer} selectedCellId={selectedCellId} onSelect={setSelectedCellId} state={state} />
      <div className="legend"><span><i className="legend-low" />낮음</span><span><i className="legend-mid" />중간</span><span><i className="legend-high" />높음</span><small>{state.activeLayer === "rent" ? "임대부담 완화 신호 · 높을수록 부담 낮음" : state.activeLayer === "opportunity" ? "수요 + 임대부담 완화 + 도시재생 · 절대 매출/성공확률 아님" : "정규화 0–100 · 절대 매출/성공확률 아님"}</small></div>
    </div>
    <aside className="evidence-panel">
      <div className="panel-heading"><div><span className="eyebrow">SELECTED CELL</span><h2>{cell?.label ?? "셀을 불러오는 중"}</h2></div>{cell && <EvidenceBadge quality={cell.evidenceQuality} />}</div>
      {cell && scores ? <>
        <div className="signal-score"><div><span>종합 Opportunity</span><strong>{scores.opportunityScore === null ? "—" : Math.round(scores.opportunityScore)}</strong></div><p>수요 55% · 임대부담 완화 25% · 도시재생 20%. 누락 지표는 가용 가중치만 재정규화합니다.</p></div>
        <div className="evidence-section"><div className="section-title"><span>수요 분해</span><small>DemandScore</small></div>
          <FieldBar label="관련 보행량 proxy" value={scores.footfall} note={`${formatNumber(cell.observedFootfall)}명/일 · ${cell.footfallSource ?? "출처 미상"}`} />
          <FieldBar label="교통 접근" value={scores.transit} note={`${formatNumber(cell.transitDemand)} 승하차 proxy`} />
          <FieldBar label="Buzz / 관심도" value={scores.buzz} note={`관심도 ${formatNumber(cell.buzzLevel)} · 모멘텀 ${cell.buzzMomentum === null ? "—" : `${cell.buzzMomentum > 0 ? "+" : ""}${(cell.buzzMomentum * 100).toFixed(0)}%`}`} />
          <FieldBar label="파생수요" value={scores.spillover} note="거리감쇠 기반 · 주변 목적지 영향" />
          <FieldBar label="POI / 업종 맥락" value={scores.poiContext} note={`${formatNumber(cell.poiCount)}개 POI · 선택 업종 ${cell.sameCategoryCount}개`} />
        </div>
        <div className="evidence-grid"><StatRow label="도시재생 맥락" value={cell.regenerationScore === null ? "데이터 부족" : `${cell.regenerationScore}/100`} note="성공 예측 아님" /><StatRow label="임대 benchmark" value={cell.rentBenchmark === null ? "데이터 부족" : formatMan(cell.rentBenchmark)} note="상권/지역 기준" /><StatRow label="공실 benchmark" value={cell.vacancyBenchmark === null ? "데이터 부족" : `${cell.vacancyBenchmark.toFixed(1)}%`} note="점포별 공실 아님" /><StatRow label="동일 업종" value={`${cell.sameCategoryCount}개`} note="snapshot / demo" /></div>
        <div className="candidate-actions"><p>입지의 신호는 판단이 아니라 입력값입니다. 실제 임대조건을 넣은 뒤 금융 결과를 확인하세요.</p><div><button className="slot-button slot-a" onClick={() => { actions.selectCell(cell.cellId, "A"); setSelectedCellId(cell.cellId); }}>A로 선택</button><button className="slot-button slot-b" onClick={() => { actions.selectCell(cell.cellId, "B"); setSelectedCellId(cell.cellId); }}>B로 선택</button></div></div>
        <div className="selected-pair"><div><span>A</span><strong>{scenarioCell(state, active)?.label ?? "선택 전"}</strong></div><div><span>B</span><strong>{scenarioCell(state, compare)?.label ?? "선택 전"}</strong></div></div>
        <details className="provenance-details"><summary>출처와 데이터 경계 보기</summary><p>이 셀의 provenance ID: {cell.provenanceIds.join(", ")}</p>{provenance?.sources.filter((source) => cell.provenanceIds.includes(source.id)).map((source) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>)}<small>공모전 데모 — 일부 데이터는 공개자료 Snapshot 또는 시연용 가정입니다.</small></details>
      </> : <div className="loading-copy">공간 셀 snapshot을 불러오고 있습니다.</div>}
    </aside>
  </section>;
}

function NumberField({ label, value, onChange, suffix = "원", step = 1, min = 0 }: { label: string; value: number; onChange: (value: number) => void; suffix?: string; step?: number; min?: number }) {
  return <label className="number-field"><span>{label}</span><div><input type="number" value={Number.isFinite(value) ? value : 0} min={min} step={step} onChange={(event) => onChange(Number(event.target.value))} /><small>{suffix}</small></div></label>;
}

function AssumptionEditor({ scenario, onPatch }: { scenario: BusinessScenario; onPatch: (patch: Partial<StartupAssumptions>) => void }) {
  const a = scenario.assumptions;
  return <div className="assumption-editor">
    <div className="assumption-grid primary-inputs"><NumberField label="실제 보증금" value={a.depositKrw} onChange={(value) => onPatch({ depositKrw: value })} /><NumberField label="실제 월세" value={a.monthlyRentKrw} onChange={(value) => onPatch({ monthlyRentKrw: value })} /><NumberField label="관리비" value={a.managementFeeKrw} onChange={(value) => onPatch({ managementFeeKrw: value })} /></div>
    <details className="assumptions-more"><summary>창업비용·운영 가정 편집</summary><div className="assumption-grid"><NumberField label="인테리어" value={a.interiorKrw} onChange={(value) => onPatch({ interiorKrw: value })} /><NumberField label="장비" value={a.equipmentKrw} onChange={(value) => onPatch({ equipmentKrw: value })} /><NumberField label="초기재고" value={a.initialInventoryKrw} onChange={(value) => onPatch({ initialInventoryKrw: value })} /><NumberField label="인허가/셋업" value={a.permitAndSetupKrw} onChange={(value) => onPatch({ permitAndSetupKrw: value })} /><NumberField label="오픈 마케팅" value={a.openingMarketingKrw} onChange={(value) => onPatch({ openingMarketingKrw: value })} /><NumberField label="월 인건비" value={a.monthlyPayrollKrw} onChange={(value) => onPatch({ monthlyPayrollKrw: value })} /><NumberField label="월 유틸리티" value={a.monthlyUtilitiesKrw} onChange={(value) => onPatch({ monthlyUtilitiesKrw: value })} /><NumberField label="기타 고정비" value={a.monthlyOtherFixedKrw} onChange={(value) => onPatch({ monthlyOtherFixedKrw: value })} /><NumberField label="객단가" value={a.averageTicketKrw} onChange={(value) => onPatch({ averageTicketKrw: value })} /><NumberField label="월 영업일" value={a.operatingDaysPerMonth} suffix="일" onChange={(value) => onPatch({ operatingDaysPerMonth: value })} /><NumberField label="원가율" value={a.variableCostRatio * 100} suffix="%" step={0.1} onChange={(value) => onPatch({ variableCostRatio: value / 100 })} /><NumberField label="가정 전환율" value={a.assumedConversionRate * 100} suffix="%" step={0.1} onChange={(value) => onPatch({ assumedConversionRate: value / 100 })} /><NumberField label="오픈 버퍼" value={a.openingBufferMonths} suffix="개월" step={0.5} onChange={(value) => onPatch({ openingBufferMonths: value })} /></div></details>
    <div className="funding-mini"><span>자기자금</span><NumberField label="자기자금" value={a.ownerCashKrw} onChange={(value) => onPatch({ ownerCashKrw: value })} /><span>지원금</span><NumberField label="지원금" value={a.grantKrw} onChange={(value) => onPatch({ grantKrw: value })} /><span>가정 조달</span><NumberField label="가정 조달" value={a.assumedFinancingKrw} onChange={(value) => onPatch({ assumedFinancingKrw: value })} /><span>기타 조달</span><NumberField label="기타 조달" value={a.otherFundingKrw} onChange={(value) => onPatch({ otherFundingKrw: value })} /></div>
  </div>;
}

function FinancialMetricGrid({ analysis, footfall }: { analysis: FinancialAnalysis; footfall: number | null }) {
  return <div className="financial-metric-grid"><div className="signature-chain"><div><span>관련 보행량</span><strong>{footfall === null ? "—" : `${formatNumber(footfall)}명/일`}</strong><small>proxy</small></div><i>↓</i><div><span>필요 고객수</span><strong>{Math.ceil(analysis.breakEvenCustomersPerDay)}명/일</strong><small>손익분기</small></div><i>↓</i><div><span>필요 전환율</span><strong className="accent">{formatPercent(analysis.requiredConversionRate)}</strong><small>보행→구매</small></div></div><div className="metric-side"><StatRow label="월 손익분기 매출" value={formatMan(analysis.monthlyBreakEvenRevenueKrw)} accent /><StatRow label="총 필요 창업자금" value={formatMan(analysis.startupCapitalNeedKrw)} /><StatRow label="Funding Gap" value={formatMan(analysis.fundingGapKrw)} accent={analysis.fundingGapKrw > 0} /></div></div>;
}

function CashTimeline({ analysis }: { analysis: FinancialAnalysis }) {
  const max = Math.max(...analysis.monthlyTimeline.map((point) => Math.abs(point.cashBalanceKrw)), 1);
  return <div className="timeline"><div className="timeline-header"><span>12개월 현금흐름</span><small>월별 가정 ramp · 예측 사실 아님</small></div>{analysis.monthlyTimeline.map((point) => <div className="timeline-row" key={point.month}><span>M{point.month}</span><div className="timeline-bar"><i className={point.cashBalanceKrw < 0 ? "negative" : "positive"} style={{ width: `${Math.min(100, Math.max(3, Math.abs(point.cashBalanceKrw) / max * 100))}%` }} /></div><b>{formatMan(point.cashBalanceKrw)}</b></div>)}</div>;
}

function ScenarioPanel({ state, scenario, label, actions }: { state: LocalTwinState; scenario?: BusinessScenario; label: "A" | "B"; actions: ReturnType<typeof createApplicationActions> }) {
  if (!scenario) return <div className="empty-card"><span>후보 {label}</span><h3>지도에서 입지를 선택하세요</h3></div>;
  const cell = scenarioCell(state, scenario);
  const analysis = cell ? analyzeFinancials(scenario.assumptions, cell.observedFootfall, scenario.stressPreset) : null;
  return <article className={`scenario-panel scenario-${label.toLowerCase()}`}><div className="scenario-heading"><div><span className="scenario-letter">{label}</span><div><span className="eyebrow">CANDIDATE {label}</span><h3>{cell?.label ?? "셀 로딩 중"}</h3></div></div>{cell && <EvidenceBadge quality={cell.evidenceQuality} />}</div><div className="scenario-meta"><select aria-label={`후보 ${label} 업종`} value={scenario.assumptions.category} onChange={(event) => actions.setCategory(scenario.id, event.target.value as BusinessCategory)}>{(Object.keys(businessCategoryLabels) as BusinessCategory[]).map((category) => <option key={category} value={category}>{businessCategoryLabels[category]}</option>)}</select><span>{cell?.district}</span><span>동일 업종 {cell ? cell.sameCategoryCounts[scenario.assumptions.category] ?? cell.sameCategoryCount : "—"}개</span></div>{analysis && <FinancialMetricGrid analysis={analysis} footfall={analysis.effectiveDailyFootfall} />}<AssumptionEditor scenario={scenario} onPatch={(patch) => actions.setAssumptions(scenario.id, patch)} /><div className="scenario-stress"><label>Stress preset<select value={scenario.stressPreset} onChange={(event) => actions.setStressPreset(scenario.id, event.target.value as StressPreset)}>{(Object.keys(stressPresetLabels) as StressPreset[]).map((preset) => <option key={preset} value={preset}>{stressPresetLabels[preset]}</option>)}</select></label>{analysis && <div className="stress-readout"><span>현금고갈</span><b>{analysis.cashRunwayMonths === null ? "12개월 내 없음" : `${analysis.cashRunwayMonths}개월`}</b><span>손익분기 월</span><b>{analysis.breakEvenMonth === null ? "12개월 내 없음" : `M${analysis.breakEvenMonth}`}</b><span>자기자금 회수</span><b>{analysis.paybackMonth === null ? "12개월 내 미회수" : `M${analysis.paybackMonth}`}</b></div>}</div>{analysis && <CashTimeline analysis={analysis} />}</article>;
}

function CompareView({ state, actions }: { state: LocalTwinState; actions: ReturnType<typeof createApplicationActions> }) {
  const active = state.activeScenarioId ? getScenario(state, state.activeScenarioId) : undefined;
  const compare = state.compareScenarioId ? getScenario(state, state.compareScenarioId) : undefined;
  const activeCell = scenarioCell(state, active);
  const compareCell = scenarioCell(state, compare);
  const activeAnalysis = active && activeCell ? analyzeFinancials(active.assumptions, activeCell.observedFootfall, active.stressPreset) : null;
  const compareAnalysis = compare && compareCell ? analyzeFinancials(compare.assumptions, compareCell.observedFootfall, compare.stressPreset) : null;
  return <section className="view compare-view"><div className="view-heading"><div><span className="view-kicker">02 / CANDIDATE COMPARE</span><h1>같은 업종, 다른 생존 조건.</h1><p>임대료와 자기자본을 입력하면 입지 신호가 금융 판단으로 연결됩니다.</p></div><button className="secondary-button" onClick={() => active && actions.cloneScenario(active.id)}>현재 후보 복제</button></div><div className="compare-summary"><div><span>Signature metric</span><strong>{activeAnalysis && compareAnalysis ? `필요 전환율 ${formatPercent(activeAnalysis.requiredConversionRate)} vs ${formatPercent(compareAnalysis.requiredConversionRate)}` : "두 후보를 선택하세요"}</strong><small>관련 보행량 proxy를 분모로 사용합니다.</small></div><div><span>Funding Gap</span><strong>{activeAnalysis && compareAnalysis ? `${formatMan(activeAnalysis.fundingGapKrw)} vs ${formatMan(compareAnalysis.fundingGapKrw)}` : "—"}</strong></div></div><div className="scenario-grid"><ScenarioPanel state={state} scenario={active} label="A" actions={actions} /><ScenarioPanel state={state} scenario={compare} label="B" actions={actions} /></div><div className="compare-footnote"><span>해석</span><p>{activeAnalysis && compareAnalysis && activeCell && compareCell ? (activeAnalysis.requiredConversionRate !== null && compareAnalysis.requiredConversionRate !== null && activeAnalysis.requiredConversionRate < compareAnalysis.requiredConversionRate ? `후보 A는 후보 B보다 필요한 보행→구매 전환율이 낮습니다. 단, 이 결과는 현재 입력한 임대·비용·전환 가정에 대한 결정론적 계산입니다.` : `후보 B는 후보 A보다 필요한 보행→구매 전환율이 낮습니다. 단, 이 결과는 현재 입력한 임대·비용·전환 가정에 대한 결정론적 계산입니다.`) : "지도에서 A와 B를 선택한 뒤 실제 점포 조건을 입력하세요."}</p></div></section>;
}

function FundingView({ state, actions, programs, provenance }: { state: LocalTwinState; actions: ReturnType<typeof createApplicationActions>; programs: SupportProgram[]; provenance?: Provenance }) {
  const scenario = state.activeScenarioId ? getScenario(state, state.activeScenarioId) : undefined;
  const cell = scenarioCell(state, scenario);
  const analysis = scenario && cell ? analyzeFinancials(scenario.assumptions, cell.observedFootfall, scenario.stressPreset) : null;
  const a = scenario?.assumptions;
  const sources = a ? a.ownerCashKrw + a.grantKrw + a.assumedFinancingKrw + a.otherFundingKrw : 0;
  return <section className="view funding-view"><div className="view-heading"><div><span className="view-kicker">03 / FUNDING PLAN</span><h1>필요 자금과 검토 경로를 한 화면에.</h1><p>조달액은 승인 예측이 아니라, 현재 입력한 가정에 대한 funding stack입니다.</p></div><label className="scenario-picker">기준 후보<select value={scenario?.id ?? ""} onChange={(event) => actions.compareScenarios(event.target.value, state.compareScenarioId)}>{state.scenarios.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>{scenario && cell && a && analysis ? <><div className="funding-layout"><div className="funding-card"><div className="card-title"><span>FUNDING STACK</span><Badge tone={analysis.fundingGapKrw > 0 ? "amber" : "teal"}>{analysis.fundingGapKrw > 0 ? "추가 조달 검토" : "현재 가정상 충족"}</Badge></div><div className="funding-stack"><div className="stack-line"><span>총 필요 창업자금</span><strong>{formatMan(analysis.startupCapitalNeedKrw)}</strong><i style={{ width: "100%" }} /></div><div className="stack-line owner"><span>자기자금</span><strong>{formatMan(a.ownerCashKrw)}</strong><i style={{ width: `${Math.min(100, a.ownerCashKrw / Math.max(analysis.startupCapitalNeedKrw, 1) * 100)}%` }} /></div><div className="stack-line grant"><span>지원금 / 사업화지원</span><strong>{formatMan(a.grantKrw)}</strong><i style={{ width: `${Math.min(100, a.grantKrw / Math.max(analysis.startupCapitalNeedKrw, 1) * 100)}%` }} /></div><div className="stack-line financing"><span>보증·정책금융 검토액</span><strong>{formatMan(a.assumedFinancingKrw)}</strong><i style={{ width: `${Math.min(100, a.assumedFinancingKrw / Math.max(analysis.startupCapitalNeedKrw, 1) * 100)}%` }} /></div><div className="stack-line other"><span>기타 조달</span><strong>{formatMan(a.otherFundingKrw)}</strong><i style={{ width: `${Math.min(100, a.otherFundingKrw / Math.max(analysis.startupCapitalNeedKrw, 1) * 100)}%` }} /></div></div><div className="funding-gap"><span>Funding Gap</span><strong>{formatMan(analysis.fundingGapKrw)}</strong><small>총 필요자금 − 입력한 조달원</small></div><div className="funding-inputs"><NumberField label="자기자금" value={a.ownerCashKrw} onChange={(value) => actions.setAssumptions(scenario.id, { ownerCashKrw: value })} /><NumberField label="지원금" value={a.grantKrw} onChange={(value) => actions.setAssumptions(scenario.id, { grantKrw: value })} /><NumberField label="가정 조달" value={a.assumedFinancingKrw} onChange={(value) => actions.setAssumptions(scenario.id, { assumedFinancingKrw: value })} /><NumberField label="기타 조달" value={a.otherFundingKrw} onChange={(value) => actions.setAssumptions(scenario.id, { otherFundingKrw: value })} /></div></div><div className="review-card"><div className="card-title"><span>REVIEW ITEMS</span><small>{cell.label} · {businessCategoryLabels[a.category]}</small></div><p className="review-intro">현재 데모에 등록된 공식 지원·금융 검토 후보입니다. 아직 개인의 연령·업력·세부 자격을 자동 판정하지 않으며, 선정·보증·대출 여부와 한도는 기관 심사에 따릅니다.</p><div className="program-list">{programs.map((program) => <article className="program-item" key={program.id}><div><Badge tone={program.supportType === "guarantee" ? "blue" : program.status === "future" ? "neutral" : "teal"}>{program.status === "future" ? "향후 상담" : "검토 후보"}</Badge><h3>{program.title}</h3><p>{program.provider} · {program.amountText ?? "규모는 원문 확인"}</p></div><ul>{program.notes.slice(0, 2).map((note) => <li key={note}>{note}</li>)}</ul><a href={program.sourceUrl} target="_blank" rel="noreferrer">공식 원문 열기 ↗</a></article>)}</div></div></div><div className="disclaimer"><strong>중요한 경계</strong><span>총 조달 가능액이 아닙니다. 실제 지원·보증·대출 여부와 한도는 기관 심사에 따릅니다.</span><span>iM Bank와의 공식 제휴·승인을 의미하지 않는 독립 공모전 프로토타입입니다.</span><span>현재 입력 조달 합계: {formatMan(sources)} · 자금부족: {formatMan(analysis.fundingGapKrw)}</span></div><details className="source-register"><summary>데이터 출처 레지스터 ({provenance?.sources.length ?? 0})</summary>{provenance?.sources.map((source) => <div key={source.id}><strong>{source.title}</strong><span>{source.provider} · {source.mode} · {source.geographicLevel}</span><a href={source.url} target="_blank" rel="noreferrer">{source.url}</a></div>)}</details></> : <div className="empty-card"><h3>기준 후보를 먼저 선택하세요.</h3><p>기회지도에서 A를 지정하면 자금 스택과 검토 후보가 나타납니다.</p></div>}</section>;
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState());
  const stateRef = useRef(state);
  const [view, setView] = useState<View>("map");
  const [selectedCellId, setSelectedCellId] = useState<string>();
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>("checking");
  const [provenance, setProvenance] = useState<Provenance>();
  const [programs, setPrograms] = useState<SupportProgram[]>([]);
  const [dataError, setDataError] = useState<string>();
  stateRef.current = state;
  const actions = useMemo(() => createApplicationActions(dispatch, () => stateRef.current), []);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/data/opportunity_cells.json").then((response) => response.json()),
      fetch("/data/provenance.json").then((response) => response.json()),
      fetch("/data/support_programs.json").then((response) => response.json()),
    ]).then(([cells, sourceRegister, supportPrograms]) => {
      if (!alive) return;
      dispatch({ type: "SET_CELLS", cells });
      setSelectedCellId(cells[0]?.cellId);
      setProvenance(sourceRegister);
      setPrograms(supportPrograms);
    }).catch(() => alive && setDataError("데모 snapshot을 불러오지 못했습니다. 새로고침 후 다시 시도하세요."));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    probeVWorld(apiKey, vworldDomain).then((live) => alive && setProviderStatus(live ? "live" : "fallback"));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const bridge = registerLocalTwinTools({ ...actions, getState: () => stateRef.current });
    return bridge.dispose;
  }, [actions]);

  return <div className="app-shell"><header className="topbar"><a className="brand" href="#top" onClick={() => setView("map")}><span className="brand-mark">LT</span><span><strong>LocalTwin</strong><small>DAEGU / V0</small></span></a><nav className="primary-nav" aria-label="주요 화면"><button className={view === "map" ? "active" : ""} onClick={() => setView("map")}><span>01</span>기회지도</button><button className={view === "compare" ? "active" : ""} onClick={() => setView("compare")}><span>02</span>후보비교</button><button className={view === "funding" ? "active" : ""} onClick={() => setView("funding")}><span>03</span>자금계획</button></nav><div className="topbar-status"><span className={`status-dot ${providerStatus === "live" ? "live" : ""}`} />{providerStatus === "live" ? "VWorld 연결" : "Snapshot mode"}<span className="divider" /><span>대구 중앙도심</span></div></header><main id="top">{dataError && <div className="data-error" role="status">{dataError}</div>}{view === "map" && <MapView state={state} actions={actions} selectedCellId={selectedCellId} setSelectedCellId={setSelectedCellId} providerStatus={providerStatus} provenance={provenance} />}{view === "compare" && <CompareView state={state} actions={actions} />}{view === "funding" && <FundingView state={state} actions={actions} programs={programs} provenance={provenance} />}</main><footer><span>공모전 데모 — 일부 데이터는 공개자료 Snapshot 또는 시연용 가정</span><span>독립 프로토타입 · 전문 회계·법률·세무·대출 자문 대체 아님</span></footer></div>;
}
