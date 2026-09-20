"use client";

import dynamic from "next/dynamic";
import {
  ArrowLeftRight,
  DollarSign,
  MapPin,
  TrendingUp,
  WalletCards,
  Sparkles,
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
import AiBusinessConsultant from "@/components/ai-business-consultant";
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
import {
  LOCAL_TWIN_WEBMCP_TOOL_COUNT,
  registerLocalTwinTools,
  type LocalTwinToolActivity,
} from "@/src/webmcp";

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
type MapScope = "central" | "citywide";

type ZoneContextProfile = {
  zoneId: string;
  label: string;
  district?: string | null;
  zoneKind: "locality" | "commercial_corridor";
  memberCellIds: string[];
  scores: {
    education: number;
    healthcare: number;
    employment_public: number;
    industrial: number;
    transit: number;
    retail_market: number;
    culture_tourism: number;
    parking_access: number;
  };
  anchorEvidence: Record<
    string,
    {
      countWithinCatchment: number;
      nearestAnchors: Array<{
        anchorId: string;
        name: string;
        subtype: string | null;
        distanceM: number;
        decayWeight: number;
      }>;
    }
  >;
  specialSignals?: {
    higherEducationProximity?: number;
    marketAnchorProximity?: number;
    majorTransitProximity?: number;
  };
  businessSignals?: {
    businessCount: number;
    businessesPerSqKm: number;
    businessDensityScore: number;
    businessDiversityScore: number;
    categoryCounts: Record<BusinessCategory, number>;
    categoryDensityScores: Record<BusinessCategory, number>;
    topMajorCategories: Array<{ name: string; count: number }>;
    topMidCategories: Array<{ name: string; count: number }>;
    quality: "official-snapshot";
    sourceDatasetId: string;
    sourceDate: string;
  } | null;
  officialZoneSignals?: {
    workplaceBusinesses: number;
    workplaceEmployees: number;
    workplaceEmployeeRank: number;
    workplaceEmploymentScore: number;
    workplaceSourceYear: number;
    residentPopulation: number;
    residentMale: number;
    residentFemale: number;
    residentPopulationChange: number;
    residentPopulationRank: number;
    residentPopulationScore: number;
    residentSourceMonth: string;
    quality: "official-snapshot";
    sourceId: string;
    residentSourceId: string;
  } | null;
  officialDistrictSignals?: {
    schoolCount?: number | null;
    healthcareFacilityCount?: number | null;
    registeredFactoryCount?: number | null;
    residentPopulation?: {
      population?: number | null;
      households?: number | null;
      personsPerHousehold?: number | null;
      male?: number | null;
      female?: number | null;
    } | null;
    spatialResolution?: string;
  };
  classificationAvailability?: {
    businessDistrict?: string;
    residentialLife?: string;
    commuting?: string;
    finalFunctionalProfile?: string;
  };
};

type ZoneContextProfileDocument = {
  records: ZoneContextProfile[];
};

type CitywideCommercialZone = {
  zoneId: string;
  label: string;
  district?: string | null;
  zoneKind: "locality" | "commercial_corridor";
  labelLon?: number | null;
  labelLat?: number | null;
  isCommercialCandidate: boolean;
  candidateRank?: number | null;
  candidateTier?: "strong" | "review" | "emerging" | "precise-corridor" | null;
  commercialPotentialScore: number;
  businessCount: number;
  businessDensityScore: number;
  businessDiversityScore: number;
  transitScore: number;
  retailMarketScore: number;
  employmentPublicScore: number;
  cultureTourismScore: number;
  healthcareScore: number;
  boundaryMeaning: string;
  selectionMeaning: string;
};

type CitywideCommercialProfileDocument = {
  metadata?: {
    coverage?: {
      profileCount?: number;
      localityZoneCount?: number;
      localityCandidateCount?: number;
      centralCorridorCount?: number;
      candidateCount?: number;
    };
  };
  records: CitywideCommercialZone[];
};

type HousingDistrictCapacity = {
  district: string;
  complexRecords: number;
  households: number;
};

type HousingZonePartial = {
  zoneId: string;
  district: string;
  label: string;
  partialComplexRecords: number;
  partialHouseholds: number;
  linkQuality: "official-name-exact-partial";
};

type HousingCapacityDocument = {
  coverage: {
    daeguComplexRecords: number;
    daeguHouseholds: number;
    districtCount: number;
    exactNameLinkedComplexRecords: number;
    exactNameLinkedHouseholds: number;
    exactNameLinkedZoneCount: number;
    rowCoveragePct: number;
    householdCoveragePct: number;
  };
  byDistrict: HousingDistrictCapacity[];
  exactNameLinkedZones: HousingZonePartial[];
};

const layerLabels: Record<MapLayer, string> = {
  opportunity: "입지종합",
  demand: "수요여건",
  transit: "교통접근",
  buzz: "검색관심",
  spillover: "주변집객",
  regeneration: "도시재생",
  rent: "임대여건",
  education: "교육·대학",
  healthcare: "의료",
  employmentPublic: "업무·공공",
  industrial: "산업",
  transitHub: "교통거점",
  retailMarket: "시장·대형점포",
  cultureTourism: "문화·관광",
  parkingAccess: "주차·접근",
  residentPopulation: "거주인구",
  workplaceEmployment: "직장종사자",
  commercialPotential: "상권잠재",
  commercialDensity: "상업밀도",
  businessDiversity: "업종다양성",
};

const commercialLayers: MapLayer[] = [
  "opportunity",
  "demand",
  "transit",
  "buzz",
  "spillover",
  "regeneration",
  "rent",
];

const contextLayers: MapLayer[] = [
  "education",
  "healthcare",
  "employmentPublic",
  "industrial",
  "transitHub",
  "retailMarket",
  "cultureTourism",
  "parkingAccess",
];

const citywideCommercialLayers: MapLayer[] = [
  "commercialPotential",
  "workplaceEmployment",
  "residentPopulation",
  "commercialDensity",
  "transitHub",
];

const citywideContextLayers: MapLayer[] = [
  "retailMarket",
  "parkingAccess",
  "education",
  "healthcare",
  "industrial",
  "cultureTourism",
];

const contextLayerProfileKey: Partial<
  Record<MapLayer, keyof ZoneContextProfile["scores"]>
> = {
  education: "education",
  healthcare: "healthcare",
  employmentPublic: "employment_public",
  industrial: "industrial",
  transitHub: "transit",
  retailMarket: "retail_market",
  cultureTourism: "culture_tourism",
  parkingAccess: "parking_access",
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
  contextProfile,
}: {
  cell: LocationEvidence;
  scores: ReturnType<typeof computeOpportunityScores>;
  contextProfile?: ZoneContextProfile;
}) {
  const contextNodes = contextProfile
    ? [
        { key: "education", label: "교육·대학", score: contextProfile.scores.education, x: 160, y: 38 },
        { key: "healthcare", label: "의료", score: contextProfile.scores.healthcare, x: 268, y: 76 },
        { key: "employment_public", label: "업무·공공", score: contextProfile.scores.employment_public, x: 294, y: 158 },
        { key: "industrial", label: "산업", score: contextProfile.scores.industrial, x: 260, y: 240 },
        { key: "transit", label: "교통거점", score: contextProfile.scores.transit, x: 160, y: 278 },
        { key: "retail_market", label: "시장·대형점포", score: contextProfile.scores.retail_market, x: 60, y: 240 },
        { key: "culture_tourism", label: "문화·관광", score: contextProfile.scores.culture_tourism, x: 26, y: 158 },
        { key: "parking_access", label: "주차·접근", score: contextProfile.scores.parking_access, x: 52, y: 76 },
      ]
    : [
        { key: "transit", label: "교통 수요", score: scores.transit ?? 0, x: 58, y: 50 },
        { key: "buzz", label: "검색 관심", score: scores.buzz ?? 0, x: 242, y: 50 },
        { key: "rent", label: "임대 여건", score: scores.rentRelief ?? 0, x: 42, y: 166 },
        { key: "regeneration", label: "도시재생", score: scores.regeneration ?? 0, x: 258, y: 166 },
        { key: "spillover", label: "주변 집객", score: scores.spillover ?? 0, x: 150, y: 212 },
      ];

  const centerX = contextProfile ? 160 : 150;
  const centerY = contextProfile ? 158 : 120;
  const strongestAnchors = contextProfile
    ? [...contextNodes]
        .sort((left, right) => right.score - left.score)
        .slice(0, 3)
        .map((node) => ({
          label: node.label,
          anchor:
            contextProfile.anchorEvidence[node.key]?.nearestAnchors?.[0]?.name ??
            "가까운 시설 정보 없음",
        }))
    : [];

  return (
    <div
      key={cell.cellId + ":" + (contextProfile?.zoneId ?? "base")}
      className="relation-panel rounded-2xl border border-white/8 bg-[#08131c]/92 p-4"
      data-testid="market-relation-graph"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold text-slate-200">입지 관계도</div>
          <div className="mt-1 text-[10px] leading-4 text-slate-600">
            {contextProfile
              ? "실제 배후시설 위치와 거리감쇠로 계산한 권역 연결 구조"
              : "선택한 후보지와 주요 입지여건의 연결 구조"}
          </div>
        </div>
        <Badge variant="outline">{contextProfile ? "배후시설 그래프" : "관계형 보기"}</Badge>
      </div>
      <svg
        className={contextProfile ? "mt-2 h-[282px] w-full overflow-visible" : "mt-2 h-[226px] w-full overflow-visible"}
        viewBox={contextProfile ? "0 0 320 310" : "0 0 300 240"}
        role="img"
        aria-label={cell.label + " 입지 관계도"}
      >
        {contextNodes.map((node, index) => (
          <line
            key={"edge-" + node.label}
            className="relation-edge"
            x1={centerX}
            y1={centerY}
            x2={node.x}
            y2={node.y}
            pathLength={1}
            stroke="rgba(103,183,220,0.72)"
            strokeOpacity={0.22 + Math.max(0, Math.min(100, node.score)) / 140}
            strokeWidth={1.2 + Math.max(0, Math.min(100, node.score)) / 70}
            style={{ animationDelay: index * 55 + "ms" }}
          />
        ))}
        <g className="relation-node relation-node-center" style={{ animationDelay: "120ms" }}>
          <circle cx={centerX} cy={centerY} r="36" fill="#102630" stroke="#5eead4" strokeWidth="2" />
          <text x={centerX} y={centerY - 4} textAnchor="middle" fill="#dffcf6" fontSize="11" fontWeight="700">
            {contextProfile ? contextProfile.label : "선택 입지"}
          </text>
          <text x={centerX} y={centerY + 14} textAnchor="middle" fill="#5eead4" fontSize="13" fontWeight="700">
            {contextProfile ? "배후시설" : Math.round(scores.opportunityScore ?? 0) + " / 100"}
          </text>
        </g>
        {contextNodes.map((node, index) => (
          <g
            key={node.label}
            className="relation-node"
            style={{ animationDelay: 210 + index * 65 + "ms" }}
          >
            <circle
              cx={node.x}
              cy={node.y}
              r={contextProfile ? 25 : 25}
              fill="rgba(10,27,38,0.96)"
              stroke="rgba(167,190,201,0.42)"
              strokeWidth="1.2"
            />
            <text x={node.x} y={node.y - 2} textAnchor="middle" fill="#dbe7ea" fontSize="9" fontWeight="600">
              {node.label}
            </text>
            <text x={node.x} y={node.y + 13} textAnchor="middle" fill="#8fa7b4" fontSize="8.5">
              {Math.round(node.score)} / 100
            </text>
          </g>
        ))}
      </svg>
      {strongestAnchors.length ? (
        <div className="space-y-1 border-t border-white/6 pt-3 text-[10px] leading-4 text-slate-500">
          {strongestAnchors.map((item) => (
            <div key={item.label} className="flex gap-2">
              <span className="w-16 shrink-0 text-slate-400">{item.label}</span>
              <span className="min-w-0 truncate">{item.anchor}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-3 border-t border-white/6 pt-3 text-[10px] leading-4 text-slate-600">
        관계선은 인과관계가 아니라 접근성과 검토 구조를 뜻합니다. 공식 시설자료를 우선하고 공개지도 POI로 공간을 보완한 거리감쇠 상대지표이며 이용자수·매출을 뜻하지 않습니다.
      </div>
    </div>
  );
}

function CitywideContextPanel({
  profile,
  commercialZone,
  candidateCount,
  housingDistrict,
  housingZonePartial,
  housingCoveragePct,
  activeLayer,
}: {
  profile?: ZoneContextProfile;
  commercialZone?: CitywideCommercialZone;
  candidateCount?: number;
  housingDistrict?: HousingDistrictCapacity;
  housingZonePartial?: HousingZonePartial;
  housingCoveragePct?: number;
  activeLayer: MapLayer;
}) {
  if (!profile) {
    return (
      <Card data-testid="citywide-context-panel">
        <CardHeader>
          <CardTitle>대구 전역 상권·배후환경</CardTitle>
          <CardDescription>
            상권후보와 지역을 선택하면 점포구조·교통·시장·업무·교육·의료 등 전역 여건을 함께 확인할 수 있습니다.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const activeKey = contextLayerProfileKey[activeLayer];
  const activeScore =
    activeLayer === "residentPopulation"
      ? profile.officialZoneSignals?.residentPopulationScore ?? 0
      : activeLayer === "workplaceEmployment"
        ? profile.officialZoneSignals?.workplaceEmploymentScore ?? 0
        : activeLayer === "commercialPotential"
        ? commercialZone?.commercialPotentialScore ?? 0
        : activeLayer === "commercialDensity"
          ? profile.businessSignals?.businessDensityScore ?? 0
          : activeLayer === "businessDiversity"
            ? profile.businessSignals?.businessDiversityScore ?? 0
            : activeKey
              ? profile.scores[activeKey]
              : 0;
  const activeMetricNote =
    activeLayer === "residentPopulation"
      ? "행안부 2026-08 주민등록인구 · 대구 150개 권역 순위 기반 / 100"
      : activeLayer === "workplaceEmployment"
        ? "KOSIS 2024 종사자수 · 대구 150개 동 순위 기반 / 100"
        : activeLayer === "commercialPotential"
        ? "SEMAS 점포구조 + 교통·시장·업무·문화 접근성 결합 / 100"
        : activeLayer === "commercialDensity"
          ? "SEMAS 2026Q2 점포밀도 상대지표 / 100"
          : activeLayer === "businessDiversity"
            ? "SEMAS 2026Q2 업종다양성 / 100"
            : "거리감쇠 상대지표 / 100";
  const rows = contextLayers.map((layer) => {
    const key = contextLayerProfileKey[layer]!;
    const evidence = profile.anchorEvidence[key];
    return {
      layer,
      key,
      score: profile.scores[key],
      count: evidence?.countWithinCatchment ?? 0,
      nearest: evidence?.nearestAnchors?.[0],
    };
  });
  const strongest = [...rows].sort((a, b) => b.score - a.score).slice(0, 4);
  const candidateReasons = commercialZone
    ? [
        {
          label: "점포밀도",
          score: commercialZone.businessDensityScore,
          detail: commercialZone.businessCount.toLocaleString("ko-KR") + "개 점포",
        },
        {
          label: "직장수요",
          score: profile.officialZoneSignals?.workplaceEmploymentScore ?? 0,
          detail: profile.officialZoneSignals
            ? profile.officialZoneSignals.workplaceEmployees.toLocaleString("ko-KR") + "명 종사자"
            : "공식값 미연결",
        },
        {
          label: "거주수요",
          score: profile.officialZoneSignals?.residentPopulationScore ?? 0,
          detail: profile.officialZoneSignals
            ? profile.officialZoneSignals.residentPopulation.toLocaleString("ko-KR") + "명 거주"
            : "공식값 미연결",
        },
        {
          label: "교통접근",
          score: commercialZone.transitScore,
          detail: "교통거점 접근성",
        },
        {
          label: "시장·집객",
          score: commercialZone.retailMarketScore,
          detail: "시장·대형점포 접근성",
        },
        {
          label: "업종다양성",
          score: commercialZone.businessDiversityScore,
          detail: "SEMAS 업종구조",
        },
      ]
        .sort((left, right) => right.score - left.score)
        .slice(0, 3)
    : [];

  return (
    <div className="space-y-4" data-testid="citywide-context-panel">
      <Card>
        <CardHeader className="border-b border-white/8">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-medium text-slate-500">대구 전역 상권·지역맥락</div>
              <CardTitle className="mt-1 text-xl">{profile.label}</CardTitle>
              <CardDescription>{profile.district ?? "대구광역시"}</CardDescription>
            </div>
            <Badge variant={commercialZone?.isCommercialCandidate ? "default" : "outline"}>
              {commercialZone?.isCommercialCandidate
                ? commercialZone.zoneKind === "commercial_corridor"
                  ? "정밀 상권"
                  : "상권 후보" + (commercialZone.candidateRank ? " #" + commercialZone.candidateRank : "")
                : "일반 분석권역"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="flex items-end justify-between border-b border-white/6 pb-4">
            <div>
              <div className="text-[11px] text-slate-500">{layerLabels[activeLayer]}</div>
              <div className="mt-1 text-4xl font-semibold tracking-[-0.05em] text-white">
                {Math.round(activeScore)}
              </div>
            </div>
            <div className="text-right text-[10px] leading-4 text-slate-500">
              {activeMetricNote}
              <br />
              {activeLayer === "residentPopulation"
                ? "주민등록지 기준 인구이며 생활인구·방문인구가 아님"
                : activeLayer === "workplaceEmployment"
                  ? "사업체 소재지 기준 종사자수이며 거주·통근인구가 아님"
                  : citywideCommercialLayers.includes(activeLayer)
                  ? "상권 검토용 상대지표이며 매출·성공확률을 뜻하지 않음"
                  : "이용자수·매출을 뜻하지 않음"}
            </div>
          </div>

          {commercialZone ? (
            <div
              className="mt-4 rounded-xl border border-emerald-300/12 bg-emerald-300/[0.035] p-3"
              data-testid="citywide-commercial-analysis"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-semibold text-emerald-100">전역 상권분석</div>
                  <div className="mt-1 text-[9px] leading-4 text-slate-500">
                    SEMAS 점포구조와 교통·시장·업무·문화 접근성을 결합한 후보 선별입니다.
                  </div>
                </div>
                <Badge variant={commercialZone.isCommercialCandidate ? "default" : "outline"}>
                  {commercialZone.zoneKind === "commercial_corridor"
                    ? "중앙 정밀상권"
                    : commercialZone.isCommercialCandidate
                      ? "후보 " + (commercialZone.candidateRank ? "#" + commercialZone.candidateRank : "")
                      : "후보 기준 미달"}
                </Badge>
              </div>

              {commercialZone.isCommercialCandidate ? (
                <div
                  className="mt-3 rounded-lg border border-emerald-300/12 bg-black/10 p-2.5"
                  data-testid="candidate-rationale"
                >
                  <div className="text-[9px] font-semibold text-emerald-100">
                    왜 후보인가
                  </div>
                  <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
                    {candidateReasons.map((reason) => (
                      <div
                        key={reason.label}
                        className="rounded-md border border-white/6 bg-white/[0.025] px-2 py-1.5"
                      >
                        <div className="flex items-center justify-between gap-2 text-[9px]">
                          <span className="font-medium text-slate-300">{reason.label}</span>
                          <span className="font-semibold text-emerald-100">
                            {Math.round(reason.score)}
                          </span>
                        </div>
                        <div className="mt-0.5 truncate text-[8px] text-slate-600">
                          {reason.detail}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-3 grid grid-cols-3 gap-2">
                <MetricTile
                  label="상권잠재"
                  value={Math.round(commercialZone.commercialPotentialScore) + " / 100"}
                  note={
                    commercialZone.isCommercialCandidate
                      ? "전역 검토 우선순위"
                      : "전역 후보선정 기준 미달"
                  }
                  accent={commercialZone.isCommercialCandidate}
                />
                <MetricTile
                  label="점포수"
                  value={commercialZone.businessCount.toLocaleString("ko-KR") + "개"}
                  note="SEMAS 2026Q2"
                />
                <MetricTile
                  label="업종다양성"
                  value={Math.round(commercialZone.businessDiversityScore) + " / 100"}
                  note="공식 점포구조 기반"
                />
                <MetricTile
                  label="교통접근"
                  value={Math.round(commercialZone.transitScore) + " / 100"}
                  note="교통거점 거리감쇠"
                />
                <MetricTile
                  label="시장·집객"
                  value={Math.round(commercialZone.retailMarketScore) + " / 100"}
                  note="시장·대형점포 접근성"
                />
                <MetricTile
                  label="업무·공공"
                  value={Math.round(commercialZone.employmentPublicScore) + " / 100"}
                  note="업무·공공 앵커 접근성"
                />
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5 text-[9px] text-slate-500">
                <span className="rounded-full border border-white/8 px-2 py-1">
                  전역 후보 {candidateCount ?? "—"}개
                </span>
                <span className="rounded-full border border-white/8 px-2 py-1">
                  전역 직접값 미확보: 검색·임대료·생활인구·카드·OD
                </span>
              </div>
              <div className="mt-3 text-[9px] leading-4 text-slate-600">
                {commercialZone.boundaryMeaning} · 후보점수는 매출·유동인구·성공확률을 의미하지 않습니다.
              </div>
            </div>
          ) : null}

          {profile.officialZoneSignals ? (
            <div
              className="mt-4 rounded-xl border border-cyan-300/12 bg-cyan-300/[0.03] p-3"
              data-testid="resident-population-panel"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-semibold text-cyan-100">
                    행정동 거주인구
                  </div>
                  <div className="mt-1 text-[9px] text-slate-600">
                    행정안전부 {profile.officialZoneSignals.residentSourceMonth} · 주민등록인구
                  </div>
                </div>
                <Badge variant="outline">공식 snapshot</Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <MetricTile
                  label="거주인구"
                  value={profile.officialZoneSignals.residentPopulation.toLocaleString("ko-KR") + "명"}
                  note="주민등록지 기준"
                  accent={activeLayer === "residentPopulation"}
                />
                <MetricTile
                  label="전월 증감"
                  value={
                    (profile.officialZoneSignals.residentPopulationChange > 0 ? "+" : "") +
                    profile.officialZoneSignals.residentPopulationChange.toLocaleString("ko-KR") +
                    "명"
                  }
                  note="2026-07 대비"
                />
                <MetricTile
                  label="대구 순위"
                  value={"#" + profile.officialZoneSignals.residentPopulationRank}
                  note="150개 분석권역 중"
                />
                <MetricTile
                  label="거주강도"
                  value={Math.round(profile.officialZoneSignals.residentPopulationScore) + " / 100"}
                  note="인구 순위 기반"
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[9px] text-slate-500">
                <span>남 {profile.officialZoneSignals.residentMale.toLocaleString("ko-KR")}명</span>
                <span>여 {profile.officialZoneSignals.residentFemale.toLocaleString("ko-KR")}명</span>
              </div>
              <div className="mt-3 text-[9px] leading-4 text-slate-600">
                주민등록인구는 주거생활권의 공식 기초증거입니다. 통신 기반 생활인구·방문인구·시간대별
                체류인구와는 다르며, 생활인구·OD가 없어 최종 주거생활권/통근형 분류는 아직 확정하지 않습니다.
              </div>
            </div>
          ) : null}

          {profile.officialZoneSignals ? (
            <div
              className="mt-4 rounded-xl border border-violet-300/12 bg-violet-300/[0.035] p-3"
              data-testid="workplace-employment-panel"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-semibold text-violet-100">
                    직장 종사자
                  </div>
                  <div className="mt-1 text-[9px] text-slate-600">
                    KOSIS 전국사업체조사 {profile.officialZoneSignals.workplaceSourceYear} · 행정동 직접값
                  </div>
                </div>
                <Badge variant="outline">공식 snapshot</Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <MetricTile
                  label="종사자"
                  value={profile.officialZoneSignals.workplaceEmployees.toLocaleString("ko-KR") + "명"}
                  note="사업체 소재지 기준"
                  accent={activeLayer === "workplaceEmployment"}
                />
                <MetricTile
                  label="사업체"
                  value={profile.officialZoneSignals.workplaceBusinesses.toLocaleString("ko-KR") + "개"}
                  note="전산업"
                />
                <MetricTile
                  label="대구 순위"
                  value={"#" + profile.officialZoneSignals.workplaceEmployeeRank}
                  note="150개 행정동 중"
                />
                <MetricTile
                  label="직장강도"
                  value={Math.round(profile.officialZoneSignals.workplaceEmploymentScore) + " / 100"}
                  note="종사자 순위 기반"
                />
              </div>
              <div className="mt-3 text-[9px] leading-4 text-slate-600">
                업무지구성의 공식 증거입니다. 거주지 기준 취업자·통근 유입·시간대별 체류인구와는
                다르며, OD·생활인구가 없어 최종 업무지구/통근형 분류는 아직 확정하지 않습니다.
              </div>
            </div>
          ) : null}

          {profile.officialDistrictSignals ? (
            <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-white/6 bg-white/[0.018] p-3 sm:grid-cols-4">
              <div>
                <div className="text-[9px] text-slate-600">구·군 주민등록인구</div>
                <div className="mt-1 text-xs font-semibold text-slate-200">
                  {profile.officialDistrictSignals.residentPopulation?.population
                    ? profile.officialDistrictSignals.residentPopulation.population.toLocaleString("ko-KR") + "명"
                    : "미연결"}
                </div>
              </div>
              <div>
                <div className="text-[9px] text-slate-600">공식 학교</div>
                <div className="mt-1 text-xs font-semibold text-slate-200">
                  {profile.officialDistrictSignals.schoolCount == null
                    ? "미연결"
                    : profile.officialDistrictSignals.schoolCount.toLocaleString("ko-KR") + "개"}
                </div>
              </div>
              <div>
                <div className="text-[9px] text-slate-600">공식 의료시설</div>
                <div className="mt-1 text-xs font-semibold text-slate-200">
                  {profile.officialDistrictSignals.healthcareFacilityCount == null
                    ? "미연결"
                    : profile.officialDistrictSignals.healthcareFacilityCount.toLocaleString("ko-KR") + "개"}
                </div>
              </div>
              <div>
                <div className="text-[9px] text-slate-600">등록 공장</div>
                <div className="mt-1 text-xs font-semibold text-slate-200">
                  {profile.officialDistrictSignals.registeredFactoryCount == null
                    ? "미연결"
                    : profile.officialDistrictSignals.registeredFactoryCount.toLocaleString("ko-KR") + "개"}
                </div>
              </div>
              <div className="col-span-2 text-[9px] leading-4 text-slate-600 sm:col-span-4">
                대구광역시·대구교육청 공식자료의 구·군 단위 참고값이며, 아래 권역별 접근성 점수와 공간 해상도가 다릅니다.
              </div>
            </div>
          ) : null}

          {housingDistrict ? (
            <div
              className="mt-4 rounded-xl border border-sky-300/10 bg-sky-300/[0.025] p-3"
              data-testid="housing-capacity-panel"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-semibold text-slate-300">
                    공동주택 주거용량
                  </div>
                  <div className="mt-1 text-[9px] text-slate-600">
                    한국부동산원 2026-08-31 · 구·군 전체 공식 집계
                  </div>
                </div>
                <Badge variant="outline">공식 snapshot</Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[9px] text-slate-600">공동주택 세대</div>
                  <div className="mt-1 text-base font-semibold text-slate-100">
                    {housingDistrict.households.toLocaleString("ko-KR")}세대
                  </div>
                </div>
                <div>
                  <div className="text-[9px] text-slate-600">공동주택 단지</div>
                  <div className="mt-1 text-base font-semibold text-slate-100">
                    {housingDistrict.complexRecords.toLocaleString("ko-KR")}개
                  </div>
                </div>
              </div>
              {housingZonePartial ? (
                <div className="mt-3 rounded-lg border border-white/6 bg-slate-950/35 px-2.5 py-2 text-[9px] leading-4 text-slate-500">
                  {profile.label} exact-name 부분연결:{" "}
                  <span className="font-semibold text-slate-300">
                    {housingZonePartial.partialHouseholds.toLocaleString("ko-KR")}세대
                  </span>
                  {" · "}
                  {housingZonePartial.partialComplexRecords.toLocaleString("ko-KR")}개 단지
                </div>
              ) : (
                <div className="mt-3 text-[9px] leading-4 text-slate-600">
                  이 권역은 법정동명과 SGIS 행정동명의 exact-name 부분연결이 없습니다.
                </div>
              )}
              <div className="mt-2 text-[9px] leading-4 text-slate-600">
                동 단위 연결은 원본 세대수의 {housingCoveragePct?.toFixed(2) ?? "32.84"}%만
                보수적으로 연결된 부분집계입니다. 주민등록·생활인구가 아니며 상권잠재 점수에는
                사용하지 않습니다.
              </div>
            </div>
          ) : null}

          {profile.businessSignals ? (
            <div className="mt-4 rounded-xl border border-white/6 bg-white/[0.018] p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] font-semibold text-slate-300">공식 상가업소 구조</div>
                  <div className="mt-1 text-[9px] text-slate-600">SEMAS 2026Q2 · 영업 중 업소 기준</div>
                </div>
                <Badge variant="outline">공식 snapshot</Badge>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div>
                  <div className="text-[9px] text-slate-600">점포수</div>
                  <div className="mt-1 text-xs font-semibold text-slate-100">
                    {profile.businessSignals.businessCount.toLocaleString("ko-KR")}개
                  </div>
                </div>
                <div>
                  <div className="text-[9px] text-slate-600">점포밀도</div>
                  <div className="mt-1 text-xs font-semibold text-slate-100">
                    {Math.round(profile.businessSignals.businessesPerSqKm).toLocaleString("ko-KR")}개/㎢
                  </div>
                </div>
                <div>
                  <div className="text-[9px] text-slate-600">업종다양성</div>
                  <div className="mt-1 text-xs font-semibold text-slate-100">
                    {Math.round(profile.businessSignals.businessDiversityScore)} / 100
                  </div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-5 gap-1.5">
                {(Object.keys(businessCategoryLabels) as BusinessCategory[]).map((category) => (
                  <div key={category} className="rounded-lg bg-slate-950/45 px-2 py-2 text-center">
                    <div className="text-[8px] text-slate-600">{businessCategoryLabels[category]}</div>
                    <div className="mt-1 text-[10px] font-semibold text-slate-300">
                      {(profile.businessSignals?.categoryCounts[category] ?? 0).toLocaleString("ko-KR")}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-2 divide-y divide-white/6">
            {rows.map((row) => (
              <div key={row.layer} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-medium text-slate-300">
                    {layerLabels[row.layer]}
                  </span>
                  <span className="text-sm font-semibold text-slate-100">
                    {Math.round(row.score)} / 100
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3 text-[10px] text-slate-600">
                  <span>{row.count.toLocaleString("ko-KR")}개 시설 연결</span>
                  <span className="truncate text-right">
                    {row.nearest
                      ? row.nearest.name + " · " + Math.round(row.nearest.distanceM) + "m"
                      : "가까운 시설 없음"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>주요 배후시설</CardTitle>
          <CardDescription>현재 권역에서 영향 신호가 큰 항목과 가장 가까운 시설입니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {strongest.map((row) => (
            <div key={row.layer} className="rounded-xl border border-white/7 bg-white/[0.025] p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-slate-200">{layerLabels[row.layer]}</span>
                <span className="text-xs font-semibold text-emerald-200">{Math.round(row.score)}</span>
              </div>
              <div className="mt-1 text-[10px] leading-4 text-slate-500">
                {row.nearest
                  ? row.nearest.name + " · 약 " + Math.round(row.nearest.distanceM) + "m"
                  : "연결된 가까운 시설이 없습니다."}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>지역 성격 분류 준비상태</CardTitle>
          <CardDescription>
            업무지구·주거생활권·통근형 분류는 직장인구·거주인구·생활인구·OD를 확보한 뒤 활성화합니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-amber-300/10 bg-amber-300/5 px-3 py-3 text-[10px] leading-5 text-amber-100/75">
            현재 값은 시설의 위치와 거리감쇠를 이용한 배후시설 접근성입니다. 생활인구·카드·통근 OD는
            D-데이터허브/DIP 반출승인 집계결과가 확보되기 전까지 임의로 생성하지 않습니다.
          </div>
        </CardContent>
      </Card>
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
  const [mapScope, setMapScope] = useState<MapScope>("central");
  const [selectedCellId, setSelectedCellId] = useState<string>();
  const [selectedContextZoneId, setSelectedContextZoneId] = useState<string>();
  const [programs, setPrograms] = useState<SupportProgram[]>([]);
  const [contextProfiles, setContextProfiles] = useState<ZoneContextProfile[]>([]);
  const [citywideContextProfiles, setCitywideContextProfiles] = useState<ZoneContextProfile[]>([]);
  const [citywideCommercialProfiles, setCitywideCommercialProfiles] =
    useState<CitywideCommercialZone[]>([]);
  const [citywideCandidateCount, setCitywideCandidateCount] = useState(0);
  const [housingCapacity, setHousingCapacity] = useState<HousingCapacityDocument>();
  const [dataError, setDataError] = useState<string>();
  const [aiOpen, setAiOpen] = useState(false);
  const [webMcpSupported, setWebMcpSupported] = useState(false);
  const [aiActivities, setAiActivities] = useState<LocalTwinToolActivity[]>([]);

  const actions = useMemo(
    () => createApplicationActions(dispatch, () => stateRef.current),
    [],
  );

  const recordAiActivity = useCallback((activity: LocalTwinToolActivity) => {
    setAiActivities((current) => [activity, ...current].slice(0, 20));
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/data/opportunity_cells.json").then((response) => response.json()),
      fetch("/data/support_programs.json").then((response) => response.json()),
      fetch("/data/corridor_context_profiles.json").then(
        (response) => response.json() as Promise<ZoneContextProfileDocument>,
      ),
    ])
      .then(([cells, supportPrograms, contextProfileDocument]) => {
        if (!alive) return;
        dispatch({ type: "SET_CELLS", cells });
        setSelectedCellId(cells[0]?.cellId);
        setPrograms(supportPrograms);
        setContextProfiles(contextProfileDocument.records ?? []);
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
    if (
      mapScope !== "citywide" ||
      (citywideContextProfiles.length &&
        citywideCommercialProfiles.length &&
        housingCapacity)
    ) {
      return;
    }
    let alive = true;

    Promise.all([
      fetch("/data/zone_context_profiles.json").then((response) => {
        if (!response.ok) throw new Error("대구 전역 배후시설 데이터를 불러오지 못했습니다.");
        return response.json() as Promise<ZoneContextProfileDocument>;
      }),
      fetch("/data/citywide_commercial_profiles.json").then((response) => {
        if (!response.ok) throw new Error("대구 전역 상권후보 데이터를 불러오지 못했습니다.");
        return response.json() as Promise<CitywideCommercialProfileDocument>;
      }),
      fetch("/data/housing_capacity.json").then((response) => {
        if (!response.ok) throw new Error("대구 전역 공동주택 데이터를 불러오지 못했습니다.");
        return response.json() as Promise<HousingCapacityDocument>;
      }),
    ])
      .then(([profileDocument, commercialDocument, housingDocument]) => {
        if (!alive) return;
        const profiles = profileDocument.records ?? [];
        const commercialProfiles = commercialDocument.records ?? [];
        setCitywideContextProfiles(profiles);
        setCitywideCommercialProfiles(commercialProfiles);
        setHousingCapacity(housingDocument);
        setCitywideCandidateCount(
          commercialDocument.metadata?.coverage?.candidateCount ??
            commercialProfiles.filter((zone) => zone.isCommercialCandidate).length,
        );

        const defaultCommercialZone = [...commercialProfiles]
          .filter(
            (zone) =>
              zone.zoneKind === "locality" &&
              zone.isCommercialCandidate &&
              typeof zone.candidateRank === "number",
          )
          .sort(
            (left, right) =>
              (left.candidateRank ?? Number.POSITIVE_INFINITY) -
              (right.candidateRank ?? Number.POSITIVE_INFINITY),
          )[0];
        const defaultProfile =
          profiles.find((profile) => profile.zoneId === defaultCommercialZone?.zoneId) ??
          profiles.find((profile) => profile.zoneKind === "locality") ??
          profiles[0];
        setSelectedContextZoneId((current) => current ?? defaultProfile?.zoneId);
      })
      .catch(() => {
        if (alive) setDataError("대구 전역 상권·배후시설 데이터를 불러오지 못했습니다.");
      });

    return () => {
      alive = false;
    };
  }, [
    citywideCommercialProfiles.length,
    citywideContextProfiles.length,
    housingCapacity,
    mapScope,
  ]);

  const handleScopeChange = useCallback(
    (nextScope: MapScope) => {
      setMapScope(nextScope);
      if (nextScope === "citywide") {
        actions.setLayer("commercialPotential");
      } else if (
        stateRef.current.activeLayer === "commercialPotential" ||
        citywideCommercialLayers.includes(stateRef.current.activeLayer) ||
        citywideContextLayers.includes(stateRef.current.activeLayer)
      ) {
        actions.setLayer("opportunity");
      }
    },
    [actions],
  );

  useEffect(() => {
    const bridge = registerLocalTwinTools({
      ...actions,
      getState: () => stateRef.current,
      onToolActivity: recordAiActivity,
    });
    setWebMcpSupported(bridge.supported);
    return () => {
      bridge.dispose();
      setWebMcpSupported(false);
    };
  }, [actions, recordAiActivity]);

  const handleAiDemoStress = useCallback(
    (preset: StressPreset) => {
      const scenarioId = stateRef.current.activeScenarioId;
      if (!scenarioId) return;
      actions.setStressPreset(scenarioId, preset);
      recordAiActivity({
        tool: "apply_stress_condition",
        title: "불리조건 적용",
        mode: "action",
        source: "demo",
        input: { scenarioId, preset },
        occurredAt: new Date().toISOString(),
      });
    },
    [actions, recordAiActivity],
  );

  const handleAiOpenCompare = useCallback(() => {
    const current = stateRef.current;
    if (!current.activeScenarioId || !current.compareScenarioId) return;
    actions.compareScenarios(
      current.activeScenarioId,
      current.compareScenarioId,
    );
    setView("compare");
    recordAiActivity({
      tool: "compare_candidates",
      title: "후보 비교 설정",
      mode: "action",
      source: "demo",
      input: {
        primaryScenarioId: current.activeScenarioId,
        compareScenarioId: current.compareScenarioId,
      },
      occurredAt: new Date().toISOString(),
    });
  }, [actions, recordAiActivity]);

  const handleAiPromptDemo = useCallback(
    (prompt: string) => {
      const current = stateRef.current;
      const primaryId = current.activeScenarioId;
      const compareId = current.compareScenarioId;
      if (!primaryId || !compareId) return;

      const categoryByKeyword: Array<[string, BusinessCategory]> = [
        ["카페", "cafe"],
        ["음식점", "restaurant"],
        ["식당", "restaurant"],
        ["소매", "retail"],
        ["뷰티", "beauty"],
        ["미용", "beauty"],
        ["서비스", "service"],
      ];
      const category =
        categoryByKeyword.find(([keyword]) => prompt.includes(keyword))?.[1];

      const money = (pattern: RegExp) => {
        const match = prompt.match(pattern);
        if (!match) return undefined;
        const value = Number(match[1].replace(/,/g, ""));
        const unit = match[2];
        if (!Number.isFinite(value)) return undefined;
        if (unit === "억" || unit === "억원") return value * 100_000_000;
        if (unit === "천만" || unit === "천만원") return value * 10_000_000;
        return value * 10_000;
      };

      const ownerCashKrw = money(
        /자기자금[^0-9]*([0-9,.]+)\s*(억원|억|천만원|천만|만원|만)/,
      );
      const monthlyRentKrw = money(
        /월세[^0-9]*([0-9,.]+)\s*(만원|만)/,
      );

      const candidateAliases = [
        ["동성로", "dongseongro"],
        ["교동", "gyodong"],
        ["북성로", "buksungro"],
        ["중앙로", "jungangro"],
        ["서문시장", "seomun"],
      ] as const;
      const mentionedCells = candidateAliases
        .filter(([label]) => prompt.includes(label))
        .map(([label, token]) =>
          current.cells.find(
            (cell) =>
              cell.label.includes(label) ||
              cell.cellId.includes(token),
          ),
        )
        .filter((cell): cell is LocationEvidence => Boolean(cell));

      if (mentionedCells[0]) {
        actions.selectCell(mentionedCells[0].cellId, "A");
        recordAiActivity({
          tool: "select_localtwin_candidate",
          title: "후보 A 선택",
          mode: "action",
          source: "demo",
          input: { cellId: mentionedCells[0].cellId, slot: "A" },
          occurredAt: new Date().toISOString(),
        });
      }
      if (mentionedCells[1]) {
        actions.selectCell(mentionedCells[1].cellId, "B");
        recordAiActivity({
          tool: "select_localtwin_candidate",
          title: "후보 B 선택",
          mode: "action",
          source: "demo",
          input: { cellId: mentionedCells[1].cellId, slot: "B" },
          occurredAt: new Date().toISOString(),
        });
      }

      if (category) {
        actions.setCategory(primaryId, category);
        actions.setCategory(compareId, category);
        recordAiActivity({
          tool: "set_business_category",
          title: "업종 변경",
          mode: "action",
          source: "demo",
          input: { primaryId, compareId, category },
          occurredAt: new Date().toISOString(),
        });
      }

      const patch = {
        ...(ownerCashKrw !== undefined ? { ownerCashKrw } : {}),
        ...(monthlyRentKrw !== undefined ? { monthlyRentKrw } : {}),
      };
      if (Object.keys(patch).length) {
        actions.setAssumptions(primaryId, patch);
        actions.setAssumptions(compareId, patch);
        recordAiActivity({
          tool: "set_business_assumptions",
          title: "창업조건 변경",
          mode: "action",
          source: "demo",
          input: { primaryId, compareId, patch },
          occurredAt: new Date().toISOString(),
        });
      }

      const stress: StressPreset =
        /수요|매출/.test(prompt) && /20\s*%/.test(prompt)
          ? "conversionDown"
          : "base";
      actions.setStressPreset(primaryId, stress);
      actions.setStressPreset(compareId, stress);
      recordAiActivity({
        tool: "apply_stress_condition",
        title: "불리조건 적용",
        mode: "action",
        source: "demo",
        input: { primaryId, compareId, preset: stress },
        occurredAt: new Date().toISOString(),
      });

      actions.compareScenarios(primaryId, compareId);
      recordAiActivity({
        tool: "compare_candidates",
        title: "후보 비교 설정",
        mode: "action",
        source: "demo",
        input: { primaryScenarioId: primaryId, compareScenarioId: compareId },
        occurredAt: new Date().toISOString(),
      });
      setView("compare");
    },
    [actions, recordAiActivity],
  );

  const handleMapSelect = useCallback((cellId: string) => {
    setSelectedCellId(cellId);
  }, []);

  const selectedCell = state.cells.find((cell) => cell.cellId === selectedCellId);
  const selectedScores = selectedCell
    ? computeOpportunityScores(selectedCell, state.cells)
    : null;
  const selectedContextProfile = selectedCellId
    ? contextProfiles.find(
        (profile) =>
          profile.zoneKind === "commercial_corridor" &&
          profile.memberCellIds.includes(selectedCellId),
      )
    : undefined;
  const selectedCitywideContextProfile = selectedContextZoneId
    ? citywideContextProfiles.find((profile) => profile.zoneId === selectedContextZoneId)
    : undefined;
  const selectedCitywideCommercialZone = selectedContextZoneId
    ? citywideCommercialProfiles.find((zone) => zone.zoneId === selectedContextZoneId)
    : undefined;
  const selectedHousingDistrict = selectedCitywideContextProfile?.district
    ? housingCapacity?.byDistrict.find(
        (row) => row.district === selectedCitywideContextProfile.district,
      )
    : undefined;
  const selectedHousingZonePartial = selectedContextZoneId
    ? housingCapacity?.exactNameLinkedZones.find(
        (row) => row.zoneId === selectedContextZoneId,
      )
    : undefined;

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

          <Button
            size="sm"
            className="shrink-0 gap-1.5 rounded-full"
            onClick={() => setAiOpen(true)}
            aria-label="AI 창업분석"
          >
            <Sparkles className="h-3.5 w-3.5" />
            AI 창업분석
          </Button>
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
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold tracking-[0.08em] text-emerald-300">
                        <MapPin className="h-3.5 w-3.5" />
                        {mapScope === "central"
                          ? "대구 중앙도심 · 상권분석 지도"
                          : "대구광역시 · 전역 상권·배후환경 분석"}
                      </div>
                      <h1 className="text-[28px] font-semibold leading-[1.18] tracking-[-0.035em] text-white">
                        {mapScope === "central" ? "상권 입지 검토" : "대구 전역 상권 분석"}
                      </h1>
                      <p className="mt-2 max-w-3xl text-xs leading-5 text-slate-500">
                        {mapScope === "central"
                          ? "교통·수요·임대·도시재생 여건을 실제 도시 공간에서 함께 비교합니다."
                          : "상권잠재·점포구조·교통·시장·업무 신호와 교육·의료·산업·문화관광 배후환경을 대구 전역에서 함께 비교합니다."}
                      </p>
                    </div>
                    <div className="flex rounded-xl border border-white/8 bg-white/[0.025] p-1">
                      <button
                        className={
                          "rounded-lg px-3 py-1.5 text-[11px] font-medium transition " +
                          (mapScope === "central"
                            ? "bg-white/10 text-white"
                            : "text-slate-500 hover:text-slate-200")
                        }
                        onClick={() => handleScopeChange("central")}
                      >
                        중앙도심
                      </button>
                      <button
                        className={
                          "rounded-lg px-3 py-1.5 text-[11px] font-medium transition " +
                          (mapScope === "citywide"
                            ? "bg-white/10 text-white"
                            : "text-slate-500 hover:text-slate-200")
                        }
                        onClick={() => handleScopeChange("citywide")}
                      >
                        대구 전체
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="w-12 shrink-0 text-[10px] font-medium text-slate-600">
                        {mapScope === "central" ? "상권지표" : "상권분석"}
                      </span>
                      <div className="localtwin-no-scrollbar flex gap-2 overflow-x-auto py-1">
                        {(mapScope === "central" ? commercialLayers : citywideCommercialLayers).map(
                          (layer) => (
                            <Button
                              key={layer}
                              size="sm"
                              variant={state.activeLayer === layer ? "default" : "outline"}
                              className="shrink-0 rounded-full px-3 text-[11px]"
                              onClick={() => actions.setLayer(layer)}
                            >
                              {layerLabels[layer]}
                            </Button>
                          ),
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-12 shrink-0 text-[10px] font-medium text-slate-600">
                        {mapScope === "central" ? "배후시설" : "배후환경"}
                      </span>
                      <div className="localtwin-no-scrollbar flex gap-2 overflow-x-auto py-1">
                        {(mapScope === "central" ? contextLayers : citywideContextLayers).map(
                          (layer) => (
                            <Button
                              key={layer}
                              size="sm"
                              variant={state.activeLayer === layer ? "default" : "outline"}
                              className="shrink-0 rounded-full px-3 text-[11px]"
                              onClick={() => actions.setLayer(layer)}
                            >
                              {layerLabels[layer]}
                            </Button>
                          ),
                        )}
                      </div>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-3 sm:p-4">
                  <div className="h-[58vh] min-h-[520px] max-h-[760px] lg:h-[calc(100vh-210px)] lg:min-h-[560px]">
                    <LocalTwinMap
                      cells={state.cells}
                      selectedCellId={selectedCellId}
                      activeLayer={state.activeLayer}
                      scope={mapScope}
                      selectedContextZoneId={selectedContextZoneId}
                      onSelect={handleMapSelect}
                      onContextSelect={setSelectedContextZoneId}
                    />
                  </div>

                </CardContent>
              </Card>

              <aside data-testid="candidate-panel" className="localtwin-panel-scroll space-y-4 lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-96px)] lg:overflow-y-auto lg:pr-1">
                {mapScope === "citywide" ? (
                  <CitywideContextPanel
                    profile={selectedCitywideContextProfile}
                    commercialZone={selectedCitywideCommercialZone}
                    candidateCount={citywideCandidateCount}
                    housingDistrict={selectedHousingDistrict}
                    housingZonePartial={selectedHousingZonePartial}
                    housingCoveragePct={housingCapacity?.coverage.householdCoveragePct}
                    activeLayer={state.activeLayer}
                  />
                ) : (
                  <>
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

                <MarketRelationGraph
                  cell={selectedCell}
                  scores={selectedScores}
                  contextProfile={selectedContextProfile}
                />

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
                  </>
                )}
              </aside>
            </section>

            {mapScope === "central" ? (
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
            ) : null}
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

      <AiBusinessConsultant
        open={aiOpen}
        webMcpSupported={webMcpSupported}
        toolCount={LOCAL_TWIN_WEBMCP_TOOL_COUNT}
        activeScenario={activeScenario}
        compareScenario={compareScenario}
        activeCell={activeCell}
        compareCell={compareCell}
        activeAnalysis={activeAnalysis}
        compareAnalysis={compareAnalysis}
        activities={aiActivities}
        onClose={() => setAiOpen(false)}
        onDemoStress={handleAiDemoStress}
        onRunPromptDemo={handleAiPromptDemo}
        onOpenCompare={handleAiOpenCompare}
      />
    </div>
  );
}
