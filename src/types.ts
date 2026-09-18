export type GeoPoint = { lon: number; lat: number };

export type Site = {
  id: string;
  name: string;
  center: GeoPoint;
  source: "vworld" | "demo";
};

export type BusinessCategory = "cafe" | "restaurant" | "retail" | "beauty" | "service";

export const businessCategoryLabels: Record<BusinessCategory, string> = {
  cafe: "카페",
  restaurant: "음식점",
  retail: "소매",
  beauty: "뷰티",
  service: "생활서비스",
};

export type EvidenceQuality = "observed" | "official" | "modelled" | "demo";

export type MapLayer =
  | "opportunity"
  | "demand"
  | "transit"
  | "buzz"
  | "spillover"
  | "regeneration"
  | "rent";

export type LocationEvidence = {
  cellId: string;
  center: GeoPoint;
  boundary: GeoPoint[];
  label: string;
  district: string;
  poiCount: number;
  sameCategoryCount: number;
  sameCategoryCounts: Partial<Record<BusinessCategory, number>>;
  transitDemand: number | null;
  observedFootfall: number | null;
  footfallSource?: string;
  buzzLevel: number | null;
  buzzMomentum: number | null;
  spilloverScore: number | null;
  regenerationScore: number | null;
  rentBenchmark: number | null;
  vacancyBenchmark: number | null;
  evidenceQuality: EvidenceQuality;
  provenanceIds: string[];
  anchorStrength?: number | null;
};

export type StressPreset =
  | "base"
  | "footfallDown"
  | "conversionDown"
  | "costUp"
  | "rentUp"
  | "rateUp"
  | "combined";

export const stressPresetLabels: Record<StressPreset, string> = {
  base: "기본",
  footfallDown: "이동수요 -20%",
  conversionDown: "전환율 -20%",
  costUp: "원가율 +10%p",
  rentUp: "임대료 +10%",
  rateUp: "금리 +1%p",
  combined: "복합 악화",
};

export type StartupAssumptions = {
  category: BusinessCategory;
  depositKrw: number;
  monthlyRentKrw: number;
  managementFeeKrw: number;
  interiorKrw: number;
  equipmentKrw: number;
  initialInventoryKrw: number;
  permitAndSetupKrw: number;
  openingMarketingKrw: number;
  monthlyPayrollKrw: number;
  monthlyUtilitiesKrw: number;
  monthlyOtherFixedKrw: number;
  averageTicketKrw: number;
  variableCostRatio: number;
  operatingDaysPerMonth: number;
  assumedConversionRate: number;
  ownerCashKrw: number;
  grantKrw: number;
  assumedFinancingKrw: number;
  otherFundingKrw: number;
  financingAnnualRate: number;
  financingMonths: number;
  openingBufferMonths: number;
};

export type BusinessScenario = {
  id: string;
  name: string;
  parentId?: string;
  createdBy: "human" | "agent";
  locationCellId: string;
  assumptions: StartupAssumptions;
  stressPreset: StressPreset;
};

export type MonthlyTimelinePoint = {
  month: number;
  revenueKrw: number;
  operatingCashFlowKrw: number;
  cashBalanceKrw: number;
};

export type FinancialAnalysis = {
  startupCapitalNeedKrw: number;
  upfrontUsesKrw: number;
  openingWorkingCapitalKrw: number;
  monthlyFixedCostKrw: number;
  monthlyBreakEvenRevenueKrw: number;
  monthlyBreakEvenCustomers: number;
  breakEvenCustomersPerDay: number;
  requiredConversionRate: number | null;
  effectiveDailyFootfall: number | null;
  steadyStateRevenueKrw: number;
  fundingGapKrw: number;
  breakEvenMonth: number | null;
  cashRunwayMonths: number | null;
  paybackMonth: number | null;
  monthlyTimeline: MonthlyTimelinePoint[];
};

export type SupportProgram = {
  id: string;
  title: string;
  provider: string;
  sourceUrl: string;
  verifiedDate: string;
  status: "review" | "future";
  targetAgeMin?: number;
  targetAgeMax?: number;
  maxBusinessAgeYears?: number;
  geography?: string[];
  categoryNotes?: string[];
  supportType: "grant" | "rent-support" | "guarantee" | "loan" | "incubation";
  amountText?: string;
  notes: string[];
};

export type LocalTwinState = {
  site: Site;
  cells: LocationEvidence[];
  scenarios: BusinessScenario[];
  activeScenarioId?: string;
  compareScenarioId?: string;
  activeLayer: MapLayer;
};

export type LocalTwinAction =
  | { type: "SET_CELLS"; cells: LocationEvidence[] }
  | { type: "SET_LAYER"; layer: MapLayer }
  | { type: "SELECT_CELL"; cellId: string; slot?: "A" | "B" }
  | { type: "SET_SCENARIO_ASSUMPTIONS"; scenarioId: string; patch: Partial<StartupAssumptions> }
  | { type: "SET_SCENARIO_CATEGORY"; scenarioId: string; category: BusinessCategory }
  | { type: "SET_STRESS_PRESET"; scenarioId: string; preset: StressPreset }
  | { type: "CLONE_SCENARIO"; sourceId: string; name?: string; createdBy?: "human" | "agent" }
  | { type: "COMPARE_SCENARIOS"; primaryId: string; compareId?: string };

export type ApplicationActions = {
  selectCell: (cellId: string, slot?: "A" | "B") => void;
  setLayer: (layer: MapLayer) => void;
  setAssumptions: (scenarioId: string, patch: Partial<StartupAssumptions>) => void;
  setCategory: (scenarioId: string, category: BusinessCategory) => void;
  setStressPreset: (scenarioId: string, preset: StressPreset) => void;
  cloneScenario: (sourceId: string, name?: string, createdBy?: "human" | "agent") => void;
  compareScenarios: (primaryId: string, compareId?: string) => void;
};
