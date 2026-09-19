"use client";

import dynamic from "next/dynamic";
import {
  ArrowLeftRight,
  Clock3,
  Database,
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

const DemandTimelineChart = dynamic(
  () =>
    import("@/components/charts/localtwin-charts").then(
      (module) => module.DemandTimelineChart,
    ),
  { ssr: false, loading: chartLoading },
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

type ProvenanceSource = {
  id: string;
  title: string;
  provider: string;
  url: string;
  geographicLevel: string;
  freshness: string;
  fieldsUsed: string[];
  limitations: string | string[];
  mode: "live" | "snapshot" | "official-snapshot" | "public-snapshot" | "modelled" | "demo";
};

type Provenance = {
  generatedAt: string;
  sources: ProvenanceSource[];
};

const layerLabels: Record<MapLayer, string> = {
  opportunity: "종합",
  demand: "수요",
  transit: "교통",
  buzz: "관심도",
  spillover: "파생수요",
  regeneration: "재생맥락",
  rent: "임대여력",
};

const viewMeta: Record<View, { index: string; label: string }> = {
  map: { index: "01", label: "3D 기회지도" },
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

function qualityLabel(quality: EvidenceQuality) {
  if (quality === "official") return "공식";
  if (quality === "observed") return "관측";
  if (quality === "modelled") return "모델";
  return "데모";
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
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
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
            label="월 BEP"
            value={formatMan(analysis.monthlyBreakEvenRevenueKrw)}
          />
          <MetricTile
            label="필요 고객"
            value={Math.ceil(analysis.breakEvenCustomersPerDay) + "명/일"}
          />
          <MetricTile
            label="필요 포착률"
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
              Stress
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
            label="가정 포착률"
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
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Runway</div>
            <div className="mt-1 text-sm font-semibold text-slate-100">
              {analysis.cashRunwayMonths === null
                ? "12개월+"
                : analysis.cashRunwayMonths + "개월"}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">
              Funding Gap
            </div>
            <div className="mt-1 text-sm font-semibold text-amber-200">
              {formatMan(analysis.fundingGapKrw)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">
              Opportunity
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
  const [provenance, setProvenance] = useState<Provenance>();
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
      fetch("/data/provenance.json").then((response) => response.json()),
    ])
      .then(([cells, supportPrograms, sourceRegister]) => {
        if (!alive) return;
        dispatch({ type: "SET_CELLS", cells });
        setSelectedCellId(cells[0]?.cellId);
        setPrograms(supportPrograms);
        setProvenance(sourceRegister);
      })
      .catch(() => {
        if (alive) {
          setDataError("데이터 snapshot을 불러오지 못했습니다. 새로고침 후 다시 시도하세요.");
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

  const currentHour = 18;

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
        <div className="mx-auto flex max-w-[1680px] items-center gap-4 px-4 py-3 lg:px-6">
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
            <div className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.19em] text-slate-500">
              Spatial Finance Twin
            </div>
          </button>

          <nav className="ml-auto flex min-w-0 items-center gap-1 rounded-xl border border-white/8 bg-white/[0.025] p-1">
            {(Object.keys(viewMeta) as View[]).map((item) => (
              <button
                key={item}
                onClick={() => setView(item)}
                className={
                  "rounded-lg px-3 py-2 text-xs font-medium transition " +
                  (view === item
                    ? "bg-white/10 text-white"
                    : "text-slate-500 hover:text-slate-200")
                }
              >
                <span className="mr-1.5 text-[9px] text-slate-600">
                  {viewMeta[item].index}
                </span>
                <span className="hidden sm:inline">{viewMeta[item].label}</span>
              </button>
            ))}
          </nav>

        </div>
      </header>

      <main className="mx-auto max-w-[1680px] space-y-5 px-4 py-5 lg:px-6">
        {dataError ? (
          <div className="rounded-xl border border-rose-300/20 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">
            {dataError}
          </div>
        ) : null}

        {selectedCell && selectedScores ? (
          <div className={view === "map" ? "contents" : "hidden"}>
            <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_370px]">
              <Card className="min-w-0 overflow-hidden">
                <CardHeader className="gap-3 border-b border-white/8 pb-3">
                  <div>
                    <div className="mb-1.5 flex items-center gap-2 text-[10px] font-semibold tracking-[0.08em] text-emerald-300">
                      <MapPin className="h-3.5 w-3.5" />
                      대구 중구 · 3D 상권지도
                    </div>
                    <h1 className="text-2xl font-semibold tracking-[-0.035em] text-white">
                      창업 기회지도
                    </h1>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      수요·임대부담·재생맥락을 실제 도시 공간에서 비교합니다.
                    </p>
                  </div>

                  <div className="flex gap-1.5 overflow-x-auto pb-1">
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

                <CardContent className="p-2.5 md:p-3">
                  <div className="h-[62vh] min-h-[560px] max-h-[780px]">
                    <LocalTwinMap
                      cells={state.cells}
                      selectedCellId={selectedCellId}
                      activeLayer={state.activeLayer}
                      onSelect={handleMapSelect}
                    />
                  </div>

                </CardContent>
              </Card>

              <aside className="space-y-4">
                <Card>
                  <CardHeader className="border-b border-white/8">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                          분석 후보
                        </div>
                        <CardTitle className="mt-1 text-xl">{selectedCell.label}</CardTitle>
                        <CardDescription>{selectedCell.district}</CardDescription>
                      </div>
                      <Badge variant={qualityVariant(selectedCell.evidenceQuality)}>
                        {qualityLabel(selectedCell.evidenceQuality)}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-5">
                    <div className="flex items-end justify-between gap-4">
                      <div>
                        <div className="text-[11px] text-slate-500">기회지수</div>
                        <div className="mt-1 text-5xl font-semibold tracking-[-0.06em] text-white">
                          {Math.round(selectedScores.opportunityScore ?? 0)}
                        </div>
                      </div>
                      <div className="text-right text-[10px] leading-4 text-slate-500">
                        상대지표 / 100
                        <br />
                        수요 55 · 임대 25 · 재생 20
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <MetricTile
                        label="이동수요"
                        value={formatNumber(selectedCell.transitDemand)}
                        note="공식 역 승하차 × 거리감쇠 · 점포 앞 보행량 아님"
                      />
                      <MetricTile
                        label="임대 benchmark"
                        value={formatRentPerSqm(selectedCell.rentBenchmarkKrwPerSqm)}
                        note="R-ONE 2026 Q2 기반 · 정확매칭/공간보간 benchmark · 점포 호가 아님"
                      />
                      <MetricTile
                        label="관심도 변화"
                        value={
                          selectedCell.buzzMomentum === null
                            ? "데이터 부족"
                            : (selectedCell.buzzMomentum >= 0 ? "+" : "") +
                              (selectedCell.buzzMomentum * 100).toFixed(0) +
                              "%"
                        }
                      />
                      <MetricTile
                        label="파생수요"
                        value={Math.round(selectedScores.spillover ?? 0) + " / 100"}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant="outline"
                        onClick={() => actions.selectCell(selectedCell.cellId, "A")}
                      >
                        A로 선택
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => actions.selectCell(selectedCell.cellId, "B")}
                      >
                        B로 선택
                      </Button>
                    </div>

                  </CardContent>
                </Card>

                {activeAnalysis && activeCell ? (
                  <Card>
                    <CardHeader>
                      <div className="flex items-center gap-2 text-emerald-200">
                        <WalletCards className="h-4 w-4" />
                        <CardTitle>후보 A 손익</CardTitle>
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
                        label="필요 포착률"
                        value={formatPercent(activeAnalysis.requiredCaptureRate)}
                        accent
                      />
                      <MetricTile
                        label="자금부족"
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
                        <Clock3 className="h-4 w-4 text-emerald-200" />
                        <CardTitle>시간대별 이동수요</CardTitle>
                      </div>
                      <CardDescription>
                        공식 역 승하차에서 파생한 일 이동수요 proxy에 시연용 시간 분포를
                        적용합니다. 시간대 곡선 자체는 관측치가 아닙니다.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <DemandTimelineChart
                        dailyDemand={selectedCell.transitDemand}
                        currentHour={currentHour}
                      />
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <div className="flex items-center gap-2">
                        <DollarSign className="h-4 w-4 text-amber-200" />
                        <CardTitle>임대료 vs 수요</CardTitle>
                      </div>
                      <CardDescription>
                        공식 상권 임대 benchmark가 연결된 셀만 표시합니다. ㎡당 환산임대료와
                        모델 수요의 상대적 위치를 비교합니다.
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
                        <CardTitle>Opportunity 분해</CardTitle>
                      </div>
                      <CardDescription>
                        하나의 magic score로 숨기지 않고 주요 신호를 분리합니다.
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
                          <CardTitle>12개월 Cash Runway</CardTitle>
                        </div>
                        <CardDescription>
                          기본 가정과 {stressPresetLabels[activeStressPreset]} 시나리오 비교.
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
                  Candidate compare
                </div>
                <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-white">
                  같은 업종, 다른 생존 조건.
                </h1>
                <p className="mt-2 text-xs text-slate-500">
                  실제 임대·비용 가정을 바꾸면 손익분기와 현금고갈 조건이 즉시 다시 계산됩니다.
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
                    낮은 포착 부담과 낮은 Funding Gap이 같은 입지에서 동시에 나타나는지 확인합니다.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <MetricTile
                    label="A 필요 포착률"
                    value={formatPercent(activeAnalysis.requiredCaptureRate)}
                    accent
                  />
                  <MetricTile
                    label="B 필요 포착률"
                    value={formatPercent(compareAnalysis.requiredCaptureRate)}
                  />
                  <MetricTile
                    label="A Funding Gap"
                    value={formatMan(activeAnalysis.fundingGapKrw)}
                  />
                  <MetricTile
                    label="B Funding Gap"
                    value={formatMan(compareAnalysis.fundingGapKrw)}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>입지 비용-수요 포지션</CardTitle>
                  <CardDescription>
                    전체 corridor 안에서 A/B 후보가 어느 위치에 놓이는지 확인합니다.
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
                Funding plan
              </div>
              <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-white">
                필요한 돈과 검토 경로를 한 화면에.
              </h1>
              <p className="mt-2 text-xs text-slate-500">
                조달액은 승인 예측이 아니라 현재 입력한 가정에 대한 funding stack입니다.
              </p>
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
              <Card data-testid="funding-structure">
                <CardHeader>
                  <CardTitle>{activeCell.label} · Funding structure</CardTitle>
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
                      label="Funding Gap"
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
        LocalTwin Daegu · 공식/공개 snapshot + 결정론적 파생 + 사용자 시나리오 가정 · 절대 매출/성공확률 예측이 아님
      </footer>
    </div>
  );
}
