import { describe, expect, it } from "vitest";
import {
  analyzeFinancials,
  computeOpportunityScores,
  createScenario,
  distanceDecay,
  initialState,
  monthlyFixedCost,
  normalizeMetric,
  reducer,
  spilloverContribution,
  startupCapitalNeed,
  upfrontUses,
} from "./model";
import type { LocationEvidence, StartupAssumptions } from "./types";

const assumptions: StartupAssumptions = {
  category: "cafe",
  depositKrw: 10_000_000,
  monthlyRentKrw: 1_000_000,
  managementFeeKrw: 100_000,
  interiorKrw: 4_000_000,
  equipmentKrw: 3_000_000,
  initialInventoryKrw: 1_000_000,
  permitAndSetupKrw: 500_000,
  openingMarketingKrw: 500_000,
  monthlyPayrollKrw: 1_000_000,
  monthlyUtilitiesKrw: 200_000,
  monthlyOtherFixedKrw: 100_000,
  averageTicketKrw: 10_000,
  variableCostRatio: 0.25,
  operatingDaysPerMonth: 25,
  assumedCaptureRate: 0.04,
  ownerCashKrw: 24_000_000,
  grantKrw: 1_000_000,
  assumedFinancingKrw: 0,
  otherFundingKrw: 0,
  financingAnnualRate: 0,
  financingMonths: 60,
  openingBufferMonths: 2,
};

const cell = (cellId: string, footfall: number, rent: number): LocationEvidence => ({
  cellId,
  center: { lon: 128.59 + footfall / 1_000_000, lat: 35.87 },
  boundary: [],
  label: cellId,
  district: "중구",
  poiCount: footfall / 10,
  sameCategoryCount: 4,
  sameCategoryCounts: { cafe: 4 },
  transitDemand: footfall,
  observedFootfall: footfall,
  buzzLevel: footfall / 10,
  buzzMomentum: 0.1,
  spilloverScore: footfall / 10,
  regenerationScore: 50,
  rentBenchmarkKrwPerSqm: rent,
  vacancyBenchmark: 10,
  evidenceQuality: "demo",
  provenanceIds: ["test"],
});

describe("deterministic financial engine", () => {
  it("calculates startup capital and keeps working-capital reserve distinct from upfront uses", () => {
    expect(upfrontUses(assumptions)).toBe(19_000_000);
    expect(startupCapitalNeed(assumptions)).toBe(23_800_000);

    const fullyFunded = {
      ...assumptions,
      ownerCashKrw: 23_800_000,
      grantKrw: 0,
      assumedFinancingKrw: 0,
      otherFundingKrw: 0,
    };
    const result = analyzeFinancials(fullyFunded, null);
    expect(result.openingWorkingCapitalKrw).toBe(4_800_000);
    expect(result.monthlyTimeline[0].cashBalanceKrw).toBe(2_400_000);
    expect(result.fundingGapKrw).toBe(0);
  });

  it("includes financing payment in monthly fixed cost", () => {
    expect(monthlyFixedCost(assumptions)).toBe(2_400_000);
  });

  it("calculates break-even revenue, customers, conversion and funding gap", () => {
    const result = analyzeFinancials(assumptions, 2_000);
    expect(result.monthlyBreakEvenRevenueKrw).toBe(3_200_000);
    expect(result.monthlyBreakEvenCustomers).toBeCloseTo(320, 2);
    expect(result.breakEvenCustomersPerDay).toBeCloseTo(12.8, 2);
    expect(result.requiredCaptureRate).toBeCloseTo(0.0064, 5);
    expect(result.fundingGapKrw).toBe(0);
  });

  it("produces a 12-month timeline and bounded milestones", () => {
    const result = analyzeFinancials(assumptions, 2_000);
    expect(result.monthlyTimeline).toHaveLength(12);
    expect(result.breakEvenMonth).not.toBeNull();
    expect(result.cashRunwayMonths).toBeNull();
    expect(result.paybackMonth).not.toBeNull();
  });

  it("separates footfall stress from capture-rate stress", () => {
    const base = analyzeFinancials(assumptions, 2_000, "base");
    const footfallDown = analyzeFinancials(assumptions, 2_000, "footfallDown");
    const conversionDown = analyzeFinancials(assumptions, 2_000, "conversionDown");

    expect(footfallDown.effectiveDailyDemandProxy).toBe(1_600);
    expect(conversionDown.effectiveDailyDemandProxy).toBe(2_000);
    expect(footfallDown.requiredCaptureRate!).toBeGreaterThan(base.requiredCaptureRate!);
    expect(conversionDown.requiredCaptureRate).toBeCloseTo(base.requiredCaptureRate!, 8);
    expect(footfallDown.steadyStateRevenueKrw).toBeLessThan(base.steadyStateRevenueKrw);
    expect(conversionDown.steadyStateRevenueKrw).toBeLessThan(base.steadyStateRevenueKrw);
  });

  it("applies every stress preset through the same engine", () => {
    const base = analyzeFinancials(assumptions, 2_000, "base");
    for (const preset of ["footfallDown", "conversionDown", "costUp", "rentUp", "rateUp", "combined"] as const) {
      const stressed = analyzeFinancials(assumptions, 2_000, preset);
      expect(stressed.monthlyBreakEvenRevenueKrw).toBeGreaterThanOrEqual(base.monthlyBreakEvenRevenueKrw);
      expect(stressed.fundingGapKrw).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("spatial normalization and state", () => {
  it("keeps missing metrics null and renormalizes available score weights", () => {
    expect(normalizeMetric([null, 10, 20], null)).toBeNull();
    const a = cell("a", 100, 2_000_000);
    const b = { ...cell("b", 200, 4_000_000), transitDemand: null, buzzLevel: null };
    const scores = computeOpportunityScores(a, [a, b]);
    expect(scores.demandScore).not.toBeNull();
    expect(scores.opportunityScore).not.toBeNull();
    expect(scores.transit).toBe(50);
    expect(normalizeMetric([null, null], null)).toBeNull();
  });

  it("makes opportunity distinct from pure demand by including rent relief and regeneration", () => {
    const highDemandHighCost = { ...cell("a", 300, 6_000_000), regenerationScore: 0 };
    const middle = { ...cell("b", 200, 3_000_000), regenerationScore: 50 };
    const lowDemandLowCost = { ...cell("c", 100, 1_000_000), regenerationScore: 100 };
    const scores = computeOpportunityScores(highDemandHighCost, [highDemandHighCost, middle, lowDemandLowCost]);
    expect(scores.demandScore).toBeCloseTo(100, 6);
    expect(scores.opportunityScore).toBeCloseTo(55, 6);
  });

  it("has monotonic distance decay and spillover", () => {
    expect(distanceDecay(100)).toBeGreaterThan(distanceDecay(300));
    expect(spilloverContribution(80, 100)).toBeGreaterThan(spilloverContribution(80, 300));
  });

  it("selects A and B, clones scenarios, and does not mutate siblings", () => {
    const a = cell("a", 100, 2_000_000);
    const b = cell("b", 200, 3_000_000);
    const base = initialState([a, b]);
    const selected = reducer(base, { type: "SELECT_CELL", cellId: "b", slot: "A" });
    expect(selected.scenarios.find((item) => item.id === "scenario-a")?.locationCellId).toBe("b");
    const compared = reducer(selected, { type: "COMPARE_SCENARIOS", primaryId: "scenario-a", compareId: "scenario-b" });
    const cloned = reducer(compared, { type: "CLONE_SCENARIO", sourceId: "scenario-a" });
    expect(cloned.scenarios).toHaveLength(3);
    const originalA = cloned.scenarios.find((item) => item.id === "scenario-a")!;
    const originalB = cloned.scenarios.find((item) => item.id === "scenario-b")!;
    const edited = reducer(cloned, { type: "SET_SCENARIO_ASSUMPTIONS", scenarioId: originalA.id, patch: { monthlyRentKrw: 9_000_000 } });
    expect(edited.scenarios.find((item) => item.id === originalA.id)!.assumptions.monthlyRentKrw).toBe(9_000_000);
    expect(edited.scenarios.find((item) => item.id === originalB.id)!.assumptions.monthlyRentKrw).toBe(originalB.assumptions.monthlyRentKrw);
  });

  it("updates category-sensitive defaults without overwriting location-specific rent", () => {
    const a = cell("a", 100, 2_000_000);
    const base = initialState([a]);
    const scenario = base.scenarios[0];
    const customRent = reducer(base, {
      type: "SET_SCENARIO_ASSUMPTIONS",
      scenarioId: scenario.id,
      patch: { monthlyRentKrw: 1_234_567 },
    });
    const changed = reducer(customRent, {
      type: "SET_SCENARIO_CATEGORY",
      scenarioId: scenario.id,
      category: "restaurant",
    });
    const updated = changed.scenarios.find((item) => item.id === scenario.id)!;
    expect(updated.assumptions.monthlyRentKrw).toBe(1_234_567);
    expect(updated.assumptions.averageTicketKrw).toBe(12_000);
    expect(updated.assumptions.variableCostRatio).toBe(0.40);
    expect(updated.assumptions.equipmentKrw).toBe(25_000_000);
  });

  it("can create a scenario through the shared scenario concept", () => {
    expect(createScenario("a", "x", "후보", "restaurant").assumptions.category).toBe("restaurant");
  });
});
