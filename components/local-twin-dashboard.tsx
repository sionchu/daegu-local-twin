"use client";

import dynamic from "next/dynamic";
import {
  ArrowLeftRight,
  DollarSign,
  MapPin,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createApplicationActions } from "@/src/actions";
import {
  analyzeFinancials,
  computeOpportunityScores,
  getScenario,
  initialState,
  reducer,
} from "@/src/model";
import type {
  BusinessCategory,
  BusinessScenario,
  EvidenceQuality,
  FinancialAnalysis,
  LocationEvidence,
  MapLayer,
  StartupAssumptions,
  StressPreset,
  SupportProgram,
} from "@/src/types";
import {
  businessCategoryLabels,
  stressPresetLabels,
} from "@/src/types";
import { registerLocalTwinTools } from "@/src/webmcp";

const LocalTwinMap = dynamic(
  () => import("@/components/map/local-twin-spatial-map"),
  {
    ssr: false,
    loading: () => (
      <div className="grid min-h-[520px] place-items-center rounded-2xl bg-slate-950 text-sm text-slate-400">
        VWorld 3D 공간 엔진을 준비하고 있습니다.
      </div>
    ),
  },
);

const chartLoading = () => (
  <div className="grid h-64 place-items-center rounded-xl border border-white/6 bg-white/[0.02] text-xs text-slate-600">
    분석 차트를 불러오는 중…
  </div>
);

const RentDemandScatterChart = dynamic(
  () =>
    import("@/components/charts/localtwin-charts").then(
      (module) => module.RentDemandScatterChart,
    ),
  { ssr: false, loading: chartLoading },
);
const OpportunityCompositionChart = dynamic(
  () =>
    import("@/components/charts/localtwin-charts").then(
      (module) => module.OpportunityCompositionChart,
    ),
  { ssr: false, loading: chartLoading },
);
const CashRunwayChart = dynamic(
  () =>
    import("@/components/charts/localtwin-charts").then(
      (module) => module.CashRunwayChart,
    ),
  { ssr: false, loading: chartLoading },
);
const FinanceBridgeChart = dynamic(
  () =>
    import("@/components/charts/localtwin-charts").then(
      (module) => module.FinanceBridgeChart,
    ),
  { ssr: false, loading: chartLoading },
);

type View = "map" | "compare" | "funding";

const layerLabels: Record<MapLayer, string> = {
  opportunity: "입지종합",
  demand: "수요여건",
  transit: "교통접근",
  buzz: "검색관심",
  spillover: "주변집객",
  regeneration: "도시재생",
  rent: "임대여건",
};

const viewMeta: Record<View, { index: string; label: string }> = {
  map: { index: "01", label: "상권지도" },
  compare: { index: "02", label: "후보비교" },
  funding: { index: "03", label: "자금계획" },
};

function formatMan(value: number) {
  return Math.round(value / 10_000).toLocaleString("ko-KR") + "만원";
}

function formatPercent(value: number | null) {
  return value === null || !Number.isFinite(value)
    ? "데이터 부족"
    : (value * 100).toFixed(1) + "%";
}

function formatNumber(value: number | null) {
  return value === null || !Number.isFinite(value)
    ? "데이터 부족"
    : Math.round(value).toLocaleString("ko-KR");
}

function formatRentPerSqm(value: number | null) {
  return value === null || !Number.isFinite(value)
    ? "데이터 부족"
    : (value / 1_000).toFixed(1) + "천원/㎡";
}

function rentBenchmarkNote(cell: LocationEvidence) {
  const areas = cell.rentBenchmarkSourceAreas ?? [];
  if (cell.rentBenchmarkMode === "exact") {
    return `R-ONE 2026 Q2 · ${areas[0] ?? "공식 상권"} 직접 매칭 · 점포 호가 아님`;
  }
  if (cell.rentBenchmarkMode === "proxy") {
    return "R-ONE 2026 Q2 · 인접 공식상권 기반 추정치 · 점포 호가 아님";
  }
  return "R-ONE 2026 Q2 참고 임대료 · 점포 호가 아님";
}

function qualityLabel(quality: EvidenceQuality) {
  if (quality === "official") return "공식";
  if (quality === "observed") return "관측";
  if (quality === "modelled") return "추정";
  return "시연";
}

function qualityVariant(quality: EvidenceQuality) {
  if (quality === "demo") return "amber" as const;
  if (quality === "modelled") return "blue" as const;
  return "default" as const;
}

function DeferredSection({
  render,
}: {
  render: () => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible || !ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setVisible(true);
        observer.disconnect();
      },
      { rootMargin: "240px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <div ref={ref} className="min-h-[520px]" data-testid="deferred-map-charts">
      {visible ? (
        render()
      ) : (
        <div className="grid h-[520px] place-items-center rounded-2xl border border-white/6 bg-white/[0.015] text-xs text-slate-600">
          스크롤하면 분석 차트를 불러옵니다.
        </div>
      )}
    </div>
  );
}

function MetricTile({
  label,
  value,
  note,
  accent = false,
}: {
  label: string;
  value: string;
  note?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.035] p-3.5">
      <div className="text-[11px] font-medium text-slate-500">
        {label}
      </div>
      <div
        className={
          "mt-1 text-xl font-semibold tracking-tight " +
          (accent ? "text-[color:var(--primary)]" : "text-slate-100")
        }
      >
        {value}
      </div>
      {note ? <div className="mt-1 text-[10px] leading-4 text-slate-500">{note}</div> : null}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  note,
  emphasis = false,
}: {
  label: string;
  value: string;
  note?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="text-[11px] font-medium text-slate-400">{label}</div>
        {note ? <div className="mt-1 text-[10px] leading-4 text-slate-600">{note}</div> : null}
      </div>
      <div
        className={
          "shrink-0 text-right text-sm font-semibold " +
          (emphasis ? "text-emerald-200" : "text-slate-100")
        }
      >
        {value}
      </div>
    </div>
  );
}

function MarketRelationGraph({
  cell,
  scores,
}: {
  cell: LocationEvidence;
  scores: ReturnType<typeof computeOpportunityScores>;
}) {
  const nodes = [
    { label: "교통 수요", value: formatNumber(cell.transitDemand), score: scores.transit, x: 58, y: 50 },
    { label: "검색 관심", value: Math.round(scores.buzz ?? 0) + " / 100", score: scores.buzz, x: 242, y: 50 },
    { label: "임대 여건", value: formatRentPerSqm(cell.rentBenchmarkKrwPerSqm), score: scores.rentRelief, x: 42, y: 166 },
    { label: "도시재생", value: Math.round(scores.regeneration ?? 0) + " / 100", score: scores.regeneration, x: 258, y: 166 },
    { label: "주변 집객", value: Math.round(scores.spillover ?? 0) + " / 100", score: scores.spillover, x: 150, y: 212 },
  ];

  return (
    <div
      key={cell.cellId}
      className="relation-panel rounded-2xl border border-white/8 bg-[#08131c]/92 p-4"
      data-testid="market-relation-graph"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold text-slate-200">입지 관계도</div>
          <div className="mt-1 text-[10px] leading-4 text-slate-600">
            선택한 후보지와 주요 입지여건의 연결 구조
          </div>
        </div>
        <Badge variant="outline">관계형 보기</Badge>
      </div>
      <svg
        className="mt-2 h-[226px] w-full overflow-visible"
        viewBox="0 0 300 240"
        role="img"
        aria-label={cell.label + " 입지 관계도"}
      >
        {nodes.map((node, index) => (
          <line
            key={"edge-" + node.label}
            className="relation-edge"
            x1={150}
            y1={120}
            x2={node.x}
            y2={node.y}
            pathLength={1}
            stroke="rgba(103,183,220,0.72)"
            strokeOpacity={0.28 + Math.max(0, Math.min(100, node.score ?? 0)) / 150}
            strokeWidth={1.4 + Math.max(0, Math.min(100, node.score ?? 0)) / 80}
            style={{ animationDelay: index * 70 + "ms" }}
          />
        ))}
        <g className="relation-node relation-node-center" style={{ animationDelay: "120ms" }}>
          <circle cx="150" cy="120" r="34" fill="#102630" stroke="#5eead4" strokeWidth="2" />
          <text x="150" y="116" textAnchor="middle" fill="#dffcf6" fontSize="11" fontWeight="700">
            선택 입지
          </text>
          <text x="150" y="133" textAnchor="middle" fill="#5eead4" fontSize="13" fontWeight="700">
            {Math.round(scores.opportunityScore ?? 0)} / 100
          </text>
        </g>
        {nodes.map((node, index) => (
          <g
            key={node.label}
            className="relation-node"
            style={{ animationDelay: 220 + index * 80 + "ms" }}
          >
            <circle
              cx={node.x}
              cy={node.y}
              r="25"
              fill="rgba(10,27,38,0.96)"
              stroke="rgba(167,190,201,0.42)"
              strokeWidth="1.2"
            />
            <text x={node.x} y={node.y - 2} textAnchor="middle" fill="#dbe7ea" fontSize="9.5" fontWeight="600">
              {node.label}
            </text>
            <text x={node.x} y={node.y + 13} textAnchor="middle" fill="#8fa7b4" fontSize="8.5">
              {node.value}
            </text>
          </g>
        ))}
      </svg>
      <div className="border-t border-white/6 pt-3 text-[10px] leading-4 text-slate-600">
        관계선은 인과관계를 뜻하지 않으며, LocalTwin이 사용하는 입지 검토 항목의 연결 구조를 보여줍니다.
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  suffix = "원",
  step = 10_000,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  step?: number;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-[11px] font-medium text-slate-400">{label}</span>
      <div className="flex h-10 items-center rounded-xl border border-white/10 bg-slate-950/55 px-3">
        <input
          className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none"
          type="number"
          min={0}
          step={step}
          value={Number.isFinite(value) ? value : 0}
          onChange={(event) => onChange(Math.max(0, Number(event.target.value)))}
        />
        <span className="ml-2 text-[10px] text-slate-500">{suffix}</span>
      </div>
    </label>
  );
}

function ScenarioEditor({
  scenario,
  cell,
  analysis,
  allCells,
  label,
  onPatch,
  onCategory,
  onStress,
}: {
  scenario: BusinessScenario;
  cell: LocationEvidence;
  analysis: FinancialAnalysis;
  allCells: LocationEvidence[];
  label: "A" | "B";
  onPatch: (patch: Partial<StartupAssumptions>) => void;
  onCategory: (category: BusinessCategory) => void;
  onStress: (preset: StressPreset) => void;
}) {
  const scores = computeOpportunityScores(cell, allCells);

  return (
    <Card className="overflow-hidden" data-testid={`scenario-${label.toLowerCase()}`}>
      <CardHeader className="border-b border-white/8">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={
                "grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-black " +
                (label === "A"
                  ? "bg-emerald-300 text-slate-950"
                  : "bg-amber-300 text-slate-950")
              }
            >
              {label}
            </div>
            <div className="min-w-0">
              <CardTitle className="truncate text-base">{cell.label}</CardTitle>
              <CardDescription>{cell.district}</CardDescription>
            </div>
          </div>
          <Badge variant={qualityVariant(cell.evidenceQuality)}>
            {qualityLabel(cell.evidenceQuality)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        <div className="grid grid-cols-3 gap-2">
          <MetricTile
            label="월 손익분기 매출"
            value={formatMan(analysis.monthlyBreakEvenRevenueKrw)}
          />
          <MetricTile
            label="필요 고객"
            value={Math.ceil(analysis.breakEvenCustomersPerDay) + "명/일"}
          />
          <MetricTile
            label="필요 수요전환율"
            value={formatPercent(analysis.requiredCaptureRate)}
            accent
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className="mb-1.5 block text-[11px] font-medium text-slate-400">
              업종
            </span>
            <select
              className="h-10 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 text-sm text-slate-100 outline-none focus:border-emerald-300/50"
              value={scenario.assumptions.category}
              onChange={(event) => onCategory(event.target.value as BusinessCategory)}
            >
              {(Object.keys(businessCategoryLabels) as BusinessCategory[]).map(
                (category) => (
                  <option key={category} value={category}>
                    {businessCategoryLabels[category]}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            <span className="mb-1.5 block text-[11px] font-medium text-slate-400">
              조건변화
            </span>
            <select
              className="h-10 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 text-sm text-slate-100 outline-none focus:border-amber-300/50"
              value={scenario.stressPreset}
              onChange={(event) => onStress(event.target.value as StressPreset)}
            >
              {(Object.keys(stressPresetLabels) as StressPreset[]).map((preset) => (
                <option key={preset} value={preset}>
                  {stressPresetLabels[preset]}
                </option>
              ))}
            </select>
          </label>
          <NumberField
            label="실제 보증금"
            value={scenario.assumptions.depositKrw}
            onChange={(value) => onPatch({ depositKrw: value })}
          />
          <NumberField
            label="실제 월세"
            value={scenario.assumptions.monthlyRentKrw}
            onChange={(value) => onPatch({ monthlyRentKrw: value })}
          />
          <NumberField
            label="자기자금"
            value={scenario.assumptions.ownerCashKrw}
            onChange={(value) => onPatch({ ownerCashKrw: value })}
          />
          <NumberField
            label="객단가"
            value={scenario.assumptions.averageTicketKrw}
            onChange={(value) => onPatch({ averageTicketKrw: value })}
            step={500}
          />
          <NumberField
            label="가정 수요전환율"
            value={scenario.assumptions.assumedCaptureRate * 100}
            onChange={(value) => onPatch({ assumedCaptureRate: value / 100 })}
            suffix="%"
            step={0.01}
          />
          <NumberField
            label="원가율"
            value={scenario.assumptions.variableCostRatio * 100}
            onChange={(value) =>
              onPatch({ variableCostRatio: Math.min(0.95, value / 100) })
            }
            suffix="%"
            step={0.5}
          />
        </div>

        <div className="grid grid-cols-3 gap-2 border-t border-white/8 pt-4">
          <div>
            <div className="text-[10px] text-slate-500">자금 버팀기간</div>
            <div className="mt-1 text-sm font-semibold text-slate-100">
              {analysis.cashRunwayMonths === null
                ? "12개월+"
                : analysis.cashRunwayMonths + "개월"}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">
              부족자금
            </div>
            <div className="mt-1 text-sm font-semibold text-amber-200">
              {formatMan(analysis.fundingGapKrw)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">
              입지종합
            </div>
            <div className="mt-1 text-sm font-semibold text-emerald-200">
              {Math.round(scores.opportunityScore ?? 0)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function LocalTwinDashboard() {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState());
  const stateRef = useRef(state);
  stateRef.current = state;

  const [view, setView] = useState<View>("map");
  const [selectedCellId, setSelectedCellId] = useState<string>();
  const [programs, setPrograms] = useState<SupportProgram[]>([]);
  const [dataError, setDataError] = useState<string>();

  const actions = useMemo(
    () => createApplicationActions(dispatch, () => stateRef.current),
    [],
  );

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/data/opportunity_cells.json").then((response) => response.json()),
      fetch("/data/support_programs.json").then((response) => response.json()),
    ])
      .then(([cells, supportPrograms]) => {
        if (!alive) return;
        dispatch({ type: "SET_CELLS", cells });
        setSelectedCellId(cells[0]?.cellId);
        setPrograms(supportPrograms);
      })
      .catch(() => {
        if (alive) {
          setDataError("상권 데이터를 불러오지 못했습니다. 새로고침 후 다시 시도하세요.");
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const bridge = registerLocalTwinTools({
      ...actions,
      getState: () => stateRef.current,
    });
    return bridge.dispose;
  }, [actions]);

  const handleMapSelect = useCallback((cellId: string) => {
    setSelectedCellId(cellId);
  }, []);

  const selectedCell = state.cells.find((cell) => cell.cellId === selectedCellId);
  const selectedScores = selectedCell
    ? computeOpportunityScores(selectedCell, state.cells)
    : null;

  const activeScenario = state.activeScenarioId
    ? getScenario(state, state.activeScenarioId)
    : undefined;
  const compareScenario = state.compareScenarioId
    ? getScenario(state, state.compareScenarioId)
    : undefined;
  const activeCell = activeScenario
    ? state.cells.find((cell) => cell.cellId === activeScenario.locationCellId)
    : undefined;
  const compareCell = compareScenario
    ? state.cells.find((cell) => cell.cellId === compareScenario.locationCellId)
    : undefined;

  const activeAnalysis =
    activeScenario && activeCell
      ? analyzeFinancials(
          activeScenario.assumptions,
          activeCell.transitDemand,
          activeScenario.stressPreset,
        )
      : null;
  const activeBaseAnalysis =
    activeScenario && activeCell
      ? analyzeFinancials(activeScenario.assumptions, activeCell.transitDemand, "base")
      : null;
  const activeStressPreset: StressPreset =
    activeScenario?.stressPreset === "base" || !activeScenario
      ? "combined"
      : activeScenario.stressPreset;
  const activeStressAnalysis =
    activeScenario && activeCell
      ? analyzeFinancials(
          activeScenario.assumptions,
          activeCell.transitDemand,
          activeStressPreset,
        )
      : null;

  const compareAnalysis =
    compareScenario && compareCell
      ? analyzeFinancials(
          compareScenario.assumptions,
          compareCell.transitDemand,
          compareScenario.stressPreset,
        )
      : null;

  if (!state.cells.length && !dataError) {
    return (
      <div className="grid min-h-screen place-items-center bg-[color:var(--background)] text-sm text-slate-400">
        LocalTwin 데이터를 준비하고 있습니다.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
      <header className="sticky top-0 z-50 border-b border-white/8 bg-[color:var(--background)]/88 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1680px] flex-col items-stretch gap-3 px-5 py-3 md:flex-row md:items-center md:gap-6 lg:px-8">
          <button
            className="group shrink-0 text-left"
            onClick={() => setView("map")}
            aria-label="LocalTwin Daegu 홈"
          >
            <div className="flex items-baseline gap-2">
              <div className="text-[15px] font-extrabold tracking-[-0.035em] text-white transition group-hover:text-emerald-100">
                LocalTwin
              </div>
              <div className="text-[11px] font-semibold tracking-[0.12em] text-emerald-300">
                DAEGU
              </div>
            </div>
            <div className="mt-0.5 text-[9px] font-medium tracking-[0.08em] text-slate-500">
              대구 상권·창업 검토
            </div>
          </button>

          <nav className="localtwin-no-scrollbar flex min-w-0 w-full items-center gap-5 overflow-x-auto border-t border-white/6 pt-2 md:ml-auto md:w-auto md:justify-end md:gap-7 md:border-t-0 md:pt-0">
            {(Object.keys(viewMeta) as View[]).map((item) => (
              <button
                key={item}
                onClick={() => setView(item)}
                className={
                  "border-b px-0.5 py-2 text-xs font-medium transition " +
                  (view === item
                    ? "border-emerald-300 text-white"
                    : "border-transparent text-slate-500 hover:text-slate-200")
                }
              >
                {viewMeta[item].label}
              </button>
            ))}
          </nav>

        </div>
      </header>

      <main className="mx-auto max-w-[1680px] space-y-6 px-4 py-6 sm:px-5 lg:px-8">
        {dataError ? (
          <div className="rounded-xl border border-rose-300/20 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">
            {dataError}
          </div>
        ) : null}

        {selectedCell && selectedScores ? (
          <div className={view === "map" ? "contents" : "hidden"}>
            <section className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_350px] xl:grid-cols-[minmax(0,1fr)_370px]">
              <Card className="min-w-0 overflow-hidden">
                <CardHeader className="gap-5 border-b border-white/8 px-5 pb-4 pt-5 sm:px-6">
                  <div>
                    <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold tracking-[0.08em] text-emerald-300">
                      <MapPin className="h-3.5 w-3.5" />
                      대구 중앙도심 · 상권분석 지도
                    </div>
                    <h1 className="text-[28px] font-semibold leading-[1.18] tracking-[-0.035em] text-white">
                      상권 입지 검토
                    </h1>
                    <p className="mt-2 max-w-3xl text-xs leading-5 text-slate-500">
                      교통·수요·임대·도시재생 여건을 실제 도시 공간에서 함께 비교합니다.
                    </p>
                  </div>

                  <div className="localtwin-no-scrollbar flex gap-2 overflow-x-auto pt-1 pb-1">
                    {(Object.keys(layerLabels) as MapLayer[]).map((layer) => (
                      <Button
                        key={layer}
                        size="sm"
                        variant={state.activeLayer === layer ? "default" : "outline"}
                        className="shrink-0 rounded-full px-3 text-[11px]"
                        onClick={() => actions.setLayer(layer)}
                      >
                        {layerLabels[layer]}
                      </Button>
                    ))}
                  </div>
                </CardHeader>

                <CardContent className="p-3 sm:p-4">
                  <div className="h-[58vh] min-h-[520px] max-h-[760px] lg:h-[calc(100vh-210px)] lg:min-h-[560px]">
                    <LocalTwinMap
                      cells={state.cells}
                      selectedCellId={selectedCellId}
                      activeLayer={state.activeLayer}
                      onSelect={handleMapSelect}
                    />
                  </div>

                </CardContent>
              </Card>

              <aside data-testid="candidate-panel" className="localtwin-panel-scroll space-y-4 lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-96px)] lg:overflow-y-auto lg:pr-1">
                <Card>
                  <CardHeader className="border-b border-white/8">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                          선택 입지
                        </div>
                        <CardTitle className="mt-1 text-xl">{selectedCell.label}</CardTitle>
                        <CardDescription>{selectedCell.district}</CardDescription>
                      </div>
                      <Badge variant={qualityVariant(selectedCell.evidenceQuality)}>
                        {qualityLabel(selectedCell.evidenceQuality)}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-4">
                    <div className="flex items-end justify-between gap-4 pb-3">
                      <div>
                        <div className="text-[11px] text-slate-500">입지종합</div>
                        <div className="mt-1 text-5xl font-semibold tracking-[-0.06em] text-white">
                          {Math.round(selectedScores.opportunityScore ?? 0)}
                        </div>
                      </div>
                      <div className="text-right text-[10px] leading-4 text-slate-500">
                        상대평가 / 100
                        <br />
                        수요 55 · 임대 25 · 재생 20
                      </div>
                    </div>

                    <div className="divide-y divide-white/6 border-y border-white/6">
                      <SummaryRow
                        label="교통기반 수요"
                        value={formatNumber(selectedCell.transitDemand)}
                        note="공식 역 승하차를 거리감쇠한 대체지표"
                      />
                      <SummaryRow
                        label="참고 임대료"
                        value={formatRentPerSqm(selectedCell.rentBenchmarkKrwPerSqm)}
                        note={rentBenchmarkNote(selectedCell)}
                      />
                      <SummaryRow
                        label="검색관심 변화"
                        value={
                          selectedCell.buzzMomentum === null
                            ? "데이터 부족"
                            : (selectedCell.buzzMomentum >= 0 ? "+" : "") +
                              (selectedCell.buzzMomentum * 100).toFixed(0) +
                              "%"
                        }
                      />
                      <SummaryRow
                        label="주변집객 신호"
                        value={Math.round(selectedScores.spillover ?? 0) + " / 100"}
                      />
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <Button
                        variant="outline"
                        onClick={() => actions.selectCell(selectedCell.cellId, "A")}
                      >
                        후보 A로 지정
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => actions.selectCell(selectedCell.cellId, "B")}
                      >
                        후보 B로 지정
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <MarketRelationGraph cell={selectedCell} scores={selectedScores} />

                {activeAnalysis && activeCell ? (
                  <Card>
                    <CardHeader>
                      <div className="flex items-center gap-2 text-emerald-200">
                        <WalletCards className="h-4 w-4" />
                        <CardTitle>후보 A 사업성</CardTitle>
                      </div>
                      <CardDescription>{activeCell.label}</CardDescription>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 gap-2">
                      <MetricTile
                        label="월 손익분기"
                        value={formatMan(activeAnalysis.monthlyBreakEvenRevenueKrw)}
                      />
                      <MetricTile
                        label="필요 고객"
                        value={Math.ceil(activeAnalysis.breakEvenCustomersPerDay) + "명/일"}
                      />
                      <MetricTile
                        label="필요 수요전환율"
                        value={formatPercent(activeAnalysis.requiredCaptureRate)}
                        accent
                      />
                      <MetricTile
                        label="부족자금"
                        value={formatMan(activeAnalysis.fundingGapKrw)}
                      />
                    </CardContent>
                  </Card>
                ) : null}

              </aside>
            </section>

            <DeferredSection
              render={() => (
                <section className="grid gap-5 lg:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <div className="flex items-center gap-2">
                        <DollarSign className="h-4 w-4 text-amber-200" />
                        <CardTitle>임대여건과 수요</CardTitle>
                      </div>
                      <CardDescription>
                        공식 상권 참고 임대료가 연결된 후보만 표시합니다. ㎡당 환산임대료와
                        추정 수요여건의 상대적 위치를 비교합니다.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <RentDemandScatterChart
                        cells={state.cells}
                        selectedCellId={selectedCellId}
                      />
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-sky-200" />
                        <CardTitle>입지종합 구성</CardTitle>
                      </div>
                      <CardDescription>
                        종합점수만 보여주지 않고 주요 입지 신호를 항목별로 나눠 확인합니다.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <OpportunityCompositionChart scores={selectedScores} />
                    </CardContent>
                  </Card>

                  {activeBaseAnalysis && activeStressAnalysis ? (
                    <Card>
                      <CardHeader>
                        <div className="flex items-center gap-2">
                          <WalletCards className="h-4 w-4 text-emerald-200" />
                          <CardTitle>12개월 현금흐름</CardTitle>
                        </div>
                        <CardDescription>
                          기본 조건과 {stressPresetLabels[activeStressPreset]} 조건을 비교합니다.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <CashRunwayChart
                          base={activeBaseAnalysis}
                          stressed={activeStressAnalysis}
                          stressLabel={stressPresetLabels[activeStressPreset]}
                        />
                      </CardContent>
                    </Card>
                  ) : null}
                </section>
              )}
            />
          </div>
        ) : null}

        {view === "compare" &&
        activeScenario &&
        compareScenario &&
        activeCell &&
        compareCell &&
        activeAnalysis &&
        compareAnalysis ? (
          <section className="space-y-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
                  <ArrowLeftRight className="h-3.5 w-3.5" />
                  후보지 비교
                </div>
                <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-white">
                  같은 업종, 다른 입지 조건.
                </h1>
                <p className="mt-2 text-xs text-slate-500">
                  실제 임대·비용 조건을 바꾸면 손익분기와 자금 버팀기간이 즉시 다시 계산됩니다.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => actions.cloneScenario(activeScenario.id)}
              >
                현재 A 복제
              </Button>
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <ScenarioEditor
                scenario={activeScenario}
                cell={activeCell}
                analysis={activeAnalysis}
                allCells={state.cells}
                label="A"
                onPatch={(patch) => actions.setAssumptions(activeScenario.id, patch)}
                onCategory={(category) => actions.setCategory(activeScenario.id, category)}
                onStress={(preset) => actions.setStressPreset(activeScenario.id, preset)}
              />
              <ScenarioEditor
                scenario={compareScenario}
                cell={compareCell}
                analysis={compareAnalysis}
                allCells={state.cells}
                label="B"
                onPatch={(patch) => actions.setAssumptions(compareScenario.id, patch)}
                onCategory={(category) => actions.setCategory(compareScenario.id, category)}
                onStress={(preset) => actions.setStressPreset(compareScenario.id, preset)}
              />
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>비교 핵심</CardTitle>
                  <CardDescription>
                    필요한 수요전환율과 부족자금이 후보지별로 어떻게 달라지는지 비교합니다.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <MetricTile
                    label="A 필요 수요전환율"
                    value={formatPercent(activeAnalysis.requiredCaptureRate)}
                    accent
                  />
                  <MetricTile
                    label="B 필요 수요전환율"
                    value={formatPercent(compareAnalysis.requiredCaptureRate)}
                  />
                  <MetricTile
                    label="A 부족자금"
                    value={formatMan(activeAnalysis.fundingGapKrw)}
                  />
                  <MetricTile
                    label="B 부족자금"
                    value={formatMan(compareAnalysis.fundingGapKrw)}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>입지 비용-수요 포지션</CardTitle>
                  <CardDescription>
                    전체 분석권역 안에서 A/B 후보의 임대여건과 수요 위치를 비교합니다.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <RentDemandScatterChart
                    cells={state.cells}
                    selectedCellId={activeCell.cellId}
                  />
                </CardContent>
              </Card>
            </div>
          </section>
        ) : null}

        {view === "funding" && activeScenario && activeCell && activeAnalysis ? (
          <section className="space-y-5">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
                <WalletCards className="h-3.5 w-3.5" />
                자금계획
              </div>
              <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-white">
                필요한 돈과 검토 경로를 한 화면에.
              </h1>
              <p className="mt-2 text-xs text-slate-500">
                조달액은 승인 예측이 아니라 현재 입력한 자금조달 조건을 정리한 값입니다.
              </p>
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
              <Card data-testid="funding-structure">
                <CardHeader>
                  <CardTitle>{activeCell.label} · 자금구조</CardTitle>
                  <CardDescription>
                    보증금은 초기 현금 필요에 포함하지만 운영비로 이중 차감하지 않습니다.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <MetricTile
                      label="총 창업 필요"
                      value={formatMan(activeAnalysis.startupCapitalNeedKrw)}
                    />
                    <MetricTile
                      label="초기 지출"
                      value={formatMan(activeAnalysis.upfrontUsesKrw)}
                    />
                    <MetricTile
                      label="운전자금"
                      value={formatMan(activeAnalysis.openingWorkingCapitalKrw)}
                    />
                    <MetricTile
                      label="부족자금"
                      value={formatMan(activeAnalysis.fundingGapKrw)}
                      accent
                    />
                  </div>
                  <FinanceBridgeChart analysis={activeAnalysis} />

                  <div className="grid gap-3 md:grid-cols-2">
                    <NumberField
                      label="자기자금"
                      value={activeScenario.assumptions.ownerCashKrw}
                      onChange={(value) =>
                        actions.setAssumptions(activeScenario.id, { ownerCashKrw: value })
                      }
                    />
                    <NumberField
                      label="지원금"
                      value={activeScenario.assumptions.grantKrw}
                      onChange={(value) =>
                        actions.setAssumptions(activeScenario.id, { grantKrw: value })
                      }
                    />
                    <NumberField
                      label="가정 정책금융"
                      value={activeScenario.assumptions.assumedFinancingKrw}
                      onChange={(value) =>
                        actions.setAssumptions(activeScenario.id, {
                          assumedFinancingKrw: value,
                        })
                      }
                    />
                    <NumberField
                      label="기타 조달"
                      value={activeScenario.assumptions.otherFundingKrw}
                      onChange={(value) =>
                        actions.setAssumptions(activeScenario.id, { otherFundingKrw: value })
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>공식 지원·금융 검토 후보</CardTitle>
                  <CardDescription>
                    개인의 연령·업력·세부 자격 자동판정은 아직 하지 않습니다.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {programs.map((program) => (
                    <a
                      key={program.id}
                      href={program.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-xl border border-white/8 bg-white/[0.025] p-4 transition hover:border-emerald-300/25 hover:bg-white/[0.045]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold text-white">
                            {program.title}
                          </div>
                          <div className="mt-1 text-[10px] text-slate-500">
                            {program.provider}
                          </div>
                        </div>
                        <Badge variant={program.status === "future" ? "outline" : "blue"}>
                          {program.status === "future" ? "향후 상담" : "검토 후보"}
                        </Badge>
                      </div>
                      <div className="mt-3 text-[10px] leading-4 text-slate-500">
                        {program.amountText ?? "지원규모는 공식 원문 확인"} · {program.notes[0]}
                      </div>
                    </a>
                  ))}
                  <div className="rounded-xl border border-amber-300/15 bg-amber-300/[0.06] p-3 text-[10px] leading-4 text-amber-100/75">
                    실제 지원·보증·대출 여부와 한도는 기관 심사에 따릅니다. iM Bank의
                    공식 제휴·승인을 의미하지 않는 독립 공모전 프로토타입입니다.
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>
        ) : null}
      </main>

      <footer className="border-t border-white/8 px-4 py-4 text-center text-[10px] text-slate-600">
        LocalTwin Daegu · 공식·공개자료 + 검토용 추정치 + 사용자 입력 조건 · 절대 매출·성공확률 예측이 아님
      </footer>
    </div>
  );
}
