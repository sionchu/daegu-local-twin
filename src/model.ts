import type {
  BusinessCategory,
  BusinessScenario,
  FinancialAnalysis,
  GeoPoint,
  LocalTwinAction,
  LocalTwinState,
  LocationEvidence,
  StartupAssumptions,
  StressPreset,
} from "./types";

export const daeguCenter: GeoPoint = { lon: 128.5967, lat: 35.8714 };

export const demoSite = {
  id: "daegu-central-corridor",
  name: "대구 중앙도심 corridor",
  center: daeguCenter,
  source: "demo" as const,
};

export const defaultAssumptions = (category: BusinessCategory = "cafe"): StartupAssumptions => {
  const categoryDefaults: Record<BusinessCategory, Pick<StartupAssumptions, "averageTicketKrw" | "variableCostRatio" | "monthlyPayrollKrw" | "equipmentKrw">> = {
    cafe: { averageTicketKrw: 6_500, variableCostRatio: 0.32, monthlyPayrollKrw: 2_900_000, equipmentKrw: 18_000_000 },
    restaurant: { averageTicketKrw: 12_000, variableCostRatio: 0.40, monthlyPayrollKrw: 3_400_000, equipmentKrw: 25_000_000 },
    retail: { averageTicketKrw: 28_000, variableCostRatio: 0.55, monthlyPayrollKrw: 2_400_000, equipmentKrw: 12_000_000 },
    beauty: { averageTicketKrw: 45_000, variableCostRatio: 0.25, monthlyPayrollKrw: 3_200_000, equipmentKrw: 15_000_000 },
    service: { averageTicketKrw: 22_000, variableCostRatio: 0.28, monthlyPayrollKrw: 2_700_000, equipmentKrw: 10_000_000 },
  };
  return {
    category,
    depositKrw: 30_000_000,
    monthlyRentKrw: 2_600_000,
    managementFeeKrw: 350_000,
    interiorKrw: 38_000_000,
    equipmentKrw: categoryDefaults[category].equipmentKrw,
    initialInventoryKrw: 5_000_000,
    permitAndSetupKrw: 3_000_000,
    openingMarketingKrw: 4_000_000,
    monthlyPayrollKrw: categoryDefaults[category].monthlyPayrollKrw,
    monthlyUtilitiesKrw: 650_000,
    monthlyOtherFixedKrw: 450_000,
    averageTicketKrw: categoryDefaults[category].averageTicketKrw,
    variableCostRatio: categoryDefaults[category].variableCostRatio,
    operatingDaysPerMonth: 26,
    assumedConversionRate: 0.024,
    ownerCashKrw: 55_000_000,
    grantKrw: 0,
    assumedFinancingKrw: 35_000_000,
    otherFundingKrw: 0,
    financingAnnualRate: 0.055,
    financingMonths: 60,
    openingBufferMonths: 3,
  };
};

export function createScenario(
  locationCellId: string,
  id: string,
  name: string,
  category: BusinessCategory = "cafe",
  createdBy: "human" | "agent" = "human",
): BusinessScenario {
  return { id, name, createdBy, locationCellId, assumptions: defaultAssumptions(category), stressPreset: "base" };
}
export function initialState(cells: LocationEvidence[] = []): LocalTwinState {
  const first = cells[0]?.cellId ?? "hex-dongseongro-01";
  const second = cells[2]?.cellId ?? "hex-buksungro-01";
  const scenarios = [
    createScenario(first, "scenario-a", "후보 A · 동성로", "cafe"),
    createScenario(second, "scenario-b", "후보 B · 북성로", "cafe"),
  ];
  return {
    site: demoSite,
    cells,
    scenarios,
    activeScenarioId: scenarios[0].id,
    compareScenarioId: scenarios[1].id,
    activeLayer: "opportunity",
  };
}

export function getScenario(state: LocalTwinState, scenarioId: string) {
  const scenario = state.scenarios.find((item) => item.id === scenarioId);
  if (!scenario) throw new Error(`Unknown scenario: ${scenarioId}`);
  return scenario;
}

export function getCell(state: LocalTwinState, cellId: string) {
  const cell = state.cells.find((item) => item.cellId === cellId);
  if (!cell) throw new Error(`Unknown cell: ${cellId}`);
  return cell;
}

function nextScenarioId(scenarios: BusinessScenario[]) {
  let index = scenarios.length + 1;
  while (scenarios.some((scenario) => scenario.id === `scenario-${index}`)) index += 1;
  return `scenario-${index}`;
}

export function reducer(state: LocalTwinState, action: LocalTwinAction): LocalTwinState {
  switch (action.type) {
    case "SET_CELLS":
      return { ...state, cells: action.cells };
    case "SET_LAYER":
      return { ...state, activeLayer: action.layer };
    case "SELECT_CELL": {
      const slot = action.slot ?? "A";
      const existingId = slot === "A" ? state.activeScenarioId : state.compareScenarioId;
      if (existingId) {
        return {
          ...state,
          scenarios: state.scenarios.map((scenario) => scenario.id === existingId
            ? { ...scenario, locationCellId: action.cellId }
            : scenario),
        };
      }
      const label = slot === "A" ? "후보 A" : "후보 B";
      const created = createScenario(action.cellId, nextScenarioId(state.scenarios), label);
      return {
        ...state,
        scenarios: [...state.scenarios, created],
        ...(slot === "A" ? { activeScenarioId: created.id } : { compareScenarioId: created.id }),
      };
    }
    case "SET_SCENARIO_ASSUMPTIONS":
      return {
        ...state,
        scenarios: state.scenarios.map((scenario) => scenario.id === action.scenarioId
          ? { ...scenario, assumptions: { ...scenario.assumptions, ...action.patch } }
          : scenario),
      };
    case "SET_SCENARIO_CATEGORY": {
      const defaults = defaultAssumptions(action.category);
      return {
        ...state,
        scenarios: state.scenarios.map((scenario) => scenario.id === action.scenarioId
          ? {
              ...scenario,
              assumptions: {
                ...scenario.assumptions,
                category: action.category,
                averageTicketKrw: defaults.averageTicketKrw,
                variableCostRatio: defaults.variableCostRatio,
                monthlyPayrollKrw: defaults.monthlyPayrollKrw,
                equipmentKrw: defaults.equipmentKrw,
              },
            }
          : scenario),
      };
    }
    case "SET_STRESS_PRESET":
      return {
        ...state,
        scenarios: state.scenarios.map((scenario) => scenario.id === action.scenarioId
          ? { ...scenario, stressPreset: action.preset }
          : scenario),
      };
    case "CLONE_SCENARIO": {
      const source = getScenario(state, action.sourceId);
      const id = nextScenarioId(state.scenarios);
      const clone: BusinessScenario = {
        ...source,
        id,
        name: action.name ?? `${source.name} 복제`,
        parentId: source.id,
        createdBy: action.createdBy ?? "human",
        assumptions: { ...source.assumptions },
      };
      return { ...state, scenarios: [...state.scenarios, clone], activeScenarioId: clone.id };
    }
    case "COMPARE_SCENARIOS":
      getScenario(state, action.primaryId);
      if (action.compareId) getScenario(state, action.compareId);
      return { ...state, activeScenarioId: action.primaryId, compareScenarioId: action.compareId };
    default:
      return state;
  }
}

export function distanceMeters(a: GeoPoint, b: GeoPoint) {
  const latScale = 111_320;
  const lonScale = latScale * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((b.lon - a.lon) * lonScale, (b.lat - a.lat) * latScale);
}

export function distanceDecay(distanceM: number, lambdaM = 350) {
  if (distanceM < 0 || lambdaM <= 0) throw new Error("Distance and lambda must be non-negative/positive.");
  return Math.exp(-distanceM / lambdaM);
}

export function spilloverContribution(anchorStrength: number, distanceM: number, lambdaM = 350) {
  return Math.max(0, anchorStrength) * distanceDecay(distanceM, lambdaM);
}

export function spilloverFromAnchors(target: GeoPoint, anchors: Array<{ center: GeoPoint; strength: number }>, lambdaM = 350) {
  return anchors.reduce((sum, anchor) => sum + spilloverContribution(anchor.strength, distanceMeters(target, anchor.center), lambdaM), 0);
}

export function normalizeMetric(values: Array<number | null | undefined>, value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const available = values.filter((item): item is number => item !== null && item !== undefined && Number.isFinite(item));
  if (!available.length) return null;
  const min = Math.min(...available);
  const max = Math.max(...available);
  if (max === min) return 50;
  return ((value - min) / (max - min)) * 100;
}

export type OpportunityScores = {
  footfall: number | null;
  transit: number | null;
  buzz: number | null;
  spillover: number | null;
  poiContext: number | null;
  demandScore: number | null;
  rentRelief: number | null;
  regeneration: number | null;
  opportunityScore: number | null;
};

export function computeOpportunityScores(cell: LocationEvidence, allCells: LocationEvidence[]): OpportunityScores {
  const footfall = normalizeMetric(allCells.map((item) => item.observedFootfall), cell.observedFootfall);
  const transit = normalizeMetric(allCells.map((item) => item.transitDemand), cell.transitDemand);
  const buzz = normalizeMetric(allCells.map((item) => item.buzzLevel), cell.buzzLevel);
  const spillover = normalizeMetric(allCells.map((item) => item.spilloverScore), cell.spilloverScore);
  const poiContext = normalizeMetric(allCells.map((item) => item.poiCount), cell.poiCount);
  const weighted = [
    [footfall, 0.35],
    [transit, 0.20],
    [buzz, 0.20],
    [spillover, 0.15],
    [poiContext, 0.10],
  ] as Array<[number | null, number]>;
  const availableWeight = weighted.filter(([value]) => value !== null).reduce((sum, [, weight]) => sum + weight, 0);
  const demandScore = availableWeight
    ? weighted.reduce((sum, [value, weight]) => sum + (value === null ? 0 : value * (weight / availableWeight)), 0)
    : null;
  const rentRelief = normalizeMetric(
    allCells.map((item) => item.rentBenchmark === null ? null : -item.rentBenchmark),
    cell.rentBenchmark === null ? null : -cell.rentBenchmark,
  );
  const regeneration = cell.regenerationScore === null
    ? null
    : Math.max(0, Math.min(100, cell.regenerationScore));
  const opportunityWeighted = [
    [demandScore, 0.55],
    [rentRelief, 0.25],
    [regeneration, 0.20],
  ] as Array<[number | null, number]>;
  const opportunityWeight = opportunityWeighted
    .filter(([value]) => value !== null)
    .reduce((sum, [, weight]) => sum + weight, 0);
  const opportunityScore = opportunityWeight
    ? opportunityWeighted.reduce(
        (sum, [value, weight]) => sum + (value === null ? 0 : value * (weight / opportunityWeight)),
        0,
      )
    : null;
  return { footfall, transit, buzz, spillover, poiContext, demandScore, rentRelief, regeneration, opportunityScore };
}

function assertAssumptions(assumptions: StartupAssumptions) {
  if (assumptions.averageTicketKrw <= 0) throw new Error("Average ticket must be positive.");
  if (assumptions.variableCostRatio < 0 || assumptions.variableCostRatio >= 1) throw new Error("Variable cost ratio must be between 0 and 1.");
  if (assumptions.operatingDaysPerMonth <= 0) throw new Error("Operating days must be positive.");
  if (assumptions.financingMonths < 0) throw new Error("Financing months cannot be negative.");
  if (assumptions.openingBufferMonths < 0) throw new Error("Opening buffer months cannot be negative.");
}

export function monthlyDebtPayment(principal: number, annualRate: number, months: number) {
  if (principal <= 0 || months <= 0) return 0;
  if (annualRate <= 0) return principal / months;
  const rate = annualRate / 12;
  return principal * rate / (1 - (1 + rate) ** -months);
}

export function monthlyOperatingFixedCost(assumptions: StartupAssumptions) {
  return assumptions.monthlyRentKrw
    + assumptions.managementFeeKrw
    + assumptions.monthlyPayrollKrw
    + assumptions.monthlyUtilitiesKrw
    + assumptions.monthlyOtherFixedKrw;
}

export function monthlyFixedCost(assumptions: StartupAssumptions) {
  return monthlyOperatingFixedCost(assumptions)
    + monthlyDebtPayment(assumptions.assumedFinancingKrw, assumptions.financingAnnualRate, assumptions.financingMonths);
}

export function upfrontUses(assumptions: StartupAssumptions) {
  assertAssumptions(assumptions);
  return assumptions.depositKrw
    + assumptions.interiorKrw
    + assumptions.equipmentKrw
    + assumptions.initialInventoryKrw
    + assumptions.permitAndSetupKrw
    + assumptions.openingMarketingKrw;
}

export function startupCapitalNeed(assumptions: StartupAssumptions) {
  assertAssumptions(assumptions);
  const openingWorkingCapitalKrw = monthlyOperatingFixedCost(assumptions) * assumptions.openingBufferMonths;
  return upfrontUses(assumptions) + openingWorkingCapitalKrw;
}

export function contributionPerCustomer(assumptions: StartupAssumptions) {
  assertAssumptions(assumptions);
  return assumptions.averageTicketKrw * (1 - assumptions.variableCostRatio);
}

export function applyStressPreset(assumptions: StartupAssumptions, preset: StressPreset): StartupAssumptions {
  const next = { ...assumptions };
  if (["conversionDown", "combined"].includes(preset)) next.assumedConversionRate *= 0.8;
  if (["costUp", "combined"].includes(preset)) next.variableCostRatio = Math.min(0.99, next.variableCostRatio + 0.10);
  if (["rentUp", "combined"].includes(preset)) next.monthlyRentKrw *= 1.10;
  if (["rateUp", "combined"].includes(preset)) next.financingAnnualRate += 0.01;
  return next;
}

export function analyzeFinancials(
  rawAssumptions: StartupAssumptions,
  relevantDailyFootfall: number | null,
  preset: StressPreset = "base",
): FinancialAnalysis {
  const assumptions = applyStressPreset(rawAssumptions, preset);
  assertAssumptions(assumptions);
  const monthlyFixedCostKrw = monthlyFixedCost(assumptions);
  const openingWorkingCapitalKrw = monthlyOperatingFixedCost(assumptions) * assumptions.openingBufferMonths;
  const startupCapitalNeedKrw = startupCapitalNeed(assumptions);
  const contribution = contributionPerCustomer(assumptions);
  const monthlyBreakEvenCustomers = monthlyFixedCostKrw / contribution;
  const breakEvenCustomersPerDay = monthlyBreakEvenCustomers / assumptions.operatingDaysPerMonth;
  const monthlyBreakEvenRevenueKrw = monthlyFixedCostKrw / (1 - assumptions.variableCostRatio);
  const effectiveDailyFootfall = relevantDailyFootfall && relevantDailyFootfall > 0
    ? relevantDailyFootfall * (["footfallDown", "combined"].includes(preset) ? 0.8 : 1)
    : null;
  const requiredConversionRate = effectiveDailyFootfall && effectiveDailyFootfall > 0
    ? breakEvenCustomersPerDay / effectiveDailyFootfall
    : null;
  const steadyStateRevenueKrw = effectiveDailyFootfall && effectiveDailyFootfall > 0
    ? effectiveDailyFootfall * assumptions.assumedConversionRate * assumptions.averageTicketKrw * assumptions.operatingDaysPerMonth
    : 0;
  const sourceCashKrw = assumptions.ownerCashKrw + assumptions.grantKrw + assumptions.assumedFinancingKrw + assumptions.otherFundingKrw;
  const fundingGapKrw = Math.max(0, startupCapitalNeedKrw - sourceCashKrw);
  const upfrontUsesKrw = upfrontUses(assumptions);
  const initialCash = sourceCashKrw - upfrontUsesKrw;
  const ramp = [0.60, 0.70, 0.80, 0.90, 1, 1, 1, 1, 1, 1, 1, 1];
  let cash = initialCash;
  let cumulativeOperatingCash = 0;
  const monthlyTimeline = ramp.map((factor, index) => {
    const revenueKrw = steadyStateRevenueKrw * factor;
    const operatingCashFlowKrw = revenueKrw * (1 - assumptions.variableCostRatio) - monthlyFixedCostKrw;
    cumulativeOperatingCash += operatingCashFlowKrw;
    cash += operatingCashFlowKrw;
    return { month: index + 1, revenueKrw, operatingCashFlowKrw, cashBalanceKrw: cash };
  });
  const firstNegative = initialCash < 0 ? 0 : monthlyTimeline.find((point) => point.cashBalanceKrw < 0)?.month ?? null;
  const breakEvenMonth = monthlyTimeline.find((point) => point.operatingCashFlowKrw >= 0)?.month ?? null;
  const paybackMonth = assumptions.ownerCashKrw <= 0
    ? 0
    : monthlyTimeline.find((_, index) => monthlyTimeline.slice(0, index + 1).reduce((sum, point) => sum + point.operatingCashFlowKrw, 0) >= assumptions.ownerCashKrw)?.month ?? null;
  return {
    startupCapitalNeedKrw,
    upfrontUsesKrw,
    openingWorkingCapitalKrw,
    monthlyFixedCostKrw,
    monthlyBreakEvenRevenueKrw,
    monthlyBreakEvenCustomers,
    breakEvenCustomersPerDay,
    requiredConversionRate,
    effectiveDailyFootfall,
    steadyStateRevenueKrw,
    fundingGapKrw,
    breakEvenMonth,
    cashRunwayMonths: firstNegative,
    paybackMonth,
    monthlyTimeline,
  };
}
