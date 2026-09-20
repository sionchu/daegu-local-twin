import {
  analyzeFinancials,
  computeOpportunityScores,
  getCell,
  getScenario,
} from "./model";
import type {
  ApplicationActions,
  BusinessCategory,
  LocalTwinState,
  StartupAssumptions,
  StressPreset,
} from "./types";

declare global {
  interface Document {
    modelContext?: {
      registerTool: (
        tool: unknown,
        options?: { signal?: AbortSignal },
      ) => Promise<void>;
    };
  }
}

export type LocalTwinToolActivity = {
  tool: string;
  title: string;
  mode: "read" | "action";
  source: "webmcp" | "demo";
  input?: unknown;
  occurredAt: string;
};

type Bridge = ApplicationActions & {
  getState: () => LocalTwinState;
  onToolActivity?: (activity: LocalTwinToolActivity) => void;
};

type ContextNode = {
  nodeId: string;
  nodeType: string;
  label?: string;
  district?: string | null;
  zoneKind?: string;
  quality?: string;
};

type ContextEdge = {
  from: string;
  to: string;
  relation: string;
  anchorType?: string;
  distanceM?: number;
  influenceWeight?: number;
  quality?: string;
};

type ContextGraph = {
  nodes: ContextNode[];
  edges: ContextEdge[];
};

type CorridorDocument = {
  features: Array<{
    properties: {
      zoneId: string;
      label: string;
      memberCellIds?: string[];
    };
  }>;
};

type ZoneProfileDocument = {
  records: Array<Record<string, unknown> & { zoneId: string }>;
};

export const LOCAL_TWIN_WEBMCP_TOOL_COUNT = 9;

const assumptionProperties = {
  depositKrw: { type: "number", minimum: 0 },
  monthlyRentKrw: { type: "number", minimum: 0 },
  managementFeeKrw: { type: "number", minimum: 0 },
  interiorKrw: { type: "number", minimum: 0 },
  equipmentKrw: { type: "number", minimum: 0 },
  initialInventoryKrw: { type: "number", minimum: 0 },
  permitAndSetupKrw: { type: "number", minimum: 0 },
  openingMarketingKrw: { type: "number", minimum: 0 },
  monthlyPayrollKrw: { type: "number", minimum: 0 },
  monthlyUtilitiesKrw: { type: "number", minimum: 0 },
  monthlyOtherFixedKrw: { type: "number", minimum: 0 },
  averageTicketKrw: { type: "number", exclusiveMinimum: 0 },
  variableCostRatio: { type: "number", minimum: 0, maximum: 0.99 },
  operatingDaysPerMonth: { type: "number", exclusiveMinimum: 0 },
  assumedCaptureRate: { type: "number", minimum: 0, maximum: 1 },
  ownerCashKrw: { type: "number", minimum: 0 },
  grantKrw: { type: "number", minimum: 0 },
  assumedFinancingKrw: { type: "number", minimum: 0 },
  otherFundingKrw: { type: "number", minimum: 0 },
  financingAnnualRate: { type: "number", minimum: 0 },
  financingMonths: { type: "number", minimum: 0 },
  openingBufferMonths: { type: "number", minimum: 0 },
} as const;

function scenarioIdOrActive(state: LocalTwinState, scenarioId?: string) {
  const resolved = scenarioId ?? state.activeScenarioId;
  if (!resolved) throw new Error("No active LocalTwin scenario.");
  return resolved;
}

function report(
  bridge: Bridge,
  tool: string,
  title: string,
  mode: "read" | "action",
  input?: unknown,
) {
  bridge.onToolActivity?.({
    tool,
    title,
    mode,
    source: "webmcp",
    input,
    occurredAt: new Date().toISOString(),
  });
}

function financialAnalysisFor(state: LocalTwinState, scenarioId?: string) {
  const resolvedScenarioId = scenarioIdOrActive(state, scenarioId);
  const scenario = getScenario(state, resolvedScenarioId);
  const cell = getCell(state, scenario.locationCellId);
  const analysis = analyzeFinancials(
    scenario.assumptions,
    cell.transitDemand,
    scenario.stressPreset,
  );
  const baseAnalysis = analyzeFinancials(
    scenario.assumptions,
    cell.transitDemand,
    "base",
  );

  return {
    scenario: {
      id: scenario.id,
      name: scenario.name,
      category: scenario.assumptions.category,
      stressPreset: scenario.stressPreset,
      locationCellId: scenario.locationCellId,
      locationLabel: cell.label,
    },
    assumptions: scenario.assumptions,
    evidence: {
      transitDemand: cell.transitDemand,
      observedFootfall: cell.observedFootfall,
      rentBenchmarkKrwPerSqm: cell.rentBenchmarkKrwPerSqm,
      evidenceQuality: cell.evidenceQuality,
      provenanceIds: cell.provenanceIds,
      opportunity: computeOpportunityScores(cell, state.cells),
    },
    analysis,
    baseAnalysis,
    semantics: {
      financialNumbers: "deterministic-src/model.ts",
      observedFootfall:
        cell.observedFootfall === null
          ? "missing-not-fabricated"
          : "observed",
      note: "AI may explain these outputs but must not invent revenue, footfall, approval, or success probability.",
    },
  };
}

async function candidateContext(targetId: string, category?: BusinessCategory) {
  const [graphResponse, corridorResponse, profileResponse] = await Promise.all([
    fetch("/data/context_graph.json"),
    fetch("/data/corridor_zones.geojson"),
    fetch("/data/zone_context_profiles.json"),
  ]);
  if (!graphResponse.ok || !corridorResponse.ok || !profileResponse.ok) {
    throw new Error("LocalTwin context evidence is unavailable.");
  }

  const graph = (await graphResponse.json()) as ContextGraph;
  const corridors = (await corridorResponse.json()) as CorridorDocument;
  const profiles = (await profileResponse.json()) as ZoneProfileDocument;

  const nodeById = new Map(graph.nodes.map((node) => [node.nodeId, node]));
  let zoneId = nodeById.has(targetId) ? targetId : undefined;

  if (!zoneId) {
    zoneId = corridors.features.find((feature) =>
      feature.properties.memberCellIds?.includes(targetId),
    )?.properties.zoneId;
  }
  if (!zoneId) {
    throw new Error(`No analysis zone found for target: ${targetId}`);
  }

  const perType = new Map<string, Array<ContextEdge>>();
  for (const edge of graph.edges) {
    if (edge.from !== zoneId || edge.relation !== "NEAR") continue;
    const key = edge.anchorType ?? "other";
    const bucket = perType.get(key) ?? [];
    bucket.push(edge);
    perType.set(key, bucket);
  }

  const evidence = [...perType.entries()]
    .flatMap(([anchorType, edges]) =>
      [...edges]
        .sort(
          (left, right) =>
            (right.influenceWeight ?? 0) - (left.influenceWeight ?? 0),
        )
        .slice(0, 2)
        .map((edge) => ({
          anchorType,
          label: nodeById.get(edge.to)?.label ?? edge.to,
          distanceM: edge.distanceM ?? null,
          influenceWeight: edge.influenceWeight ?? null,
          quality: nodeById.get(edge.to)?.quality ?? edge.quality ?? null,
        })),
    )
    .sort(
      (left, right) =>
        (right.influenceWeight ?? 0) - (left.influenceWeight ?? 0),
    )
    .slice(0, 10);

  const profile = profiles.records.find((row) => row.zoneId === zoneId);
  return {
    zoneId,
    zone: nodeById.get(zoneId) ?? null,
    category: category ?? null,
    profile: profile ?? null,
    topEvidence: evidence,
    semantics: {
      relation: "derived-proximity-context",
      note: "NEAR/influence edges are contextual evidence, not observed footfall, sales, employment, or causal success probability.",
    },
  };
}

/** Optional WebMCP bridge; the human UI remains the primary interaction path. */
export function registerLocalTwinTools(bridge: Bridge) {
  if (!document.modelContext) {
    return {
      supported: false,
      toolCount: LOCAL_TWIN_WEBMCP_TOOL_COUNT,
      dispose: () => undefined,
    };
  }

  const controller = new AbortController();
  const register = (tool: unknown) =>
    void document
      .modelContext!.registerTool(tool, { signal: controller.signal })
      .catch(() => undefined);

  register({
    name: "get_localtwin_state",
    title: "Read LocalTwin Daegu state",
    description:
      "Read candidates, business scenarios, assumptions, selected cells, and current map layer before deciding which LocalTwin tool to use.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async () => {
      report(
        bridge,
        "get_localtwin_state",
        "현재 분석상태 읽기",
        "read",
      );
      return bridge.getState();
    },
  });

  register({
    name: "select_localtwin_candidate",
    title: "Select a LocalTwin candidate",
    description:
      "Put a selected Daegu analysis cell into candidate A or B. Use get_localtwin_state first to map the user's place name to a cellId.",
    inputSchema: {
      type: "object",
      properties: {
        cellId: { type: "string" },
        slot: { type: "string", enum: ["A", "B"] },
      },
      required: ["cellId", "slot"],
      additionalProperties: false,
    },
    execute: async (input: { cellId: string; slot: "A" | "B" }) => {
      bridge.selectCell(input.cellId, input.slot);
      report(
        bridge,
        "select_localtwin_candidate",
        `후보 ${input.slot} 선택`,
        "action",
        input,
      );
      return { accepted: true, ...input };
    },
  });

  register({
    name: "set_business_assumptions",
    title: "Update LocalTwin business assumptions",
    description:
      "Update deterministic startup assumptions such as rent, owner cash, average ticket, payroll, financing, or operating days. Omit fields that should remain unchanged.",
    inputSchema: {
      type: "object",
      properties: {
        scenarioId: { type: "string" },
        ...assumptionProperties,
      },
      additionalProperties: false,
    },
    execute: async (
      input: { scenarioId?: string } & Partial<StartupAssumptions>,
    ) => {
      const state = bridge.getState();
      const scenarioId = scenarioIdOrActive(state, input.scenarioId);
      const { scenarioId: _scenarioId, category: _category, ...patch } = input;
      bridge.setAssumptions(
        scenarioId,
        patch as Partial<StartupAssumptions>,
      );
      report(
        bridge,
        "set_business_assumptions",
        "창업조건 변경",
        "action",
        { scenarioId, patch },
      );
      return { accepted: true, scenarioId, patch };
    },
  });

  register({
    name: "set_business_category",
    title: "Set LocalTwin business category",
    description:
      "Set the business category for a scenario. Category defaults update ticket, cost ratio, payroll, and equipment assumptions using LocalTwin deterministic defaults.",
    inputSchema: {
      type: "object",
      properties: {
        scenarioId: { type: "string" },
        category: {
          type: "string",
          enum: ["cafe", "restaurant", "retail", "beauty", "service"],
        },
      },
      required: ["category"],
      additionalProperties: false,
    },
    execute: async (input: {
      scenarioId?: string;
      category: BusinessCategory;
    }) => {
      const scenarioId = scenarioIdOrActive(
        bridge.getState(),
        input.scenarioId,
      );
      bridge.setCategory(scenarioId, input.category);
      report(
        bridge,
        "set_business_category",
        "업종 변경",
        "action",
        { scenarioId, category: input.category },
      );
      return {
        accepted: true,
        scenarioId,
        category: input.category,
      };
    },
  });

  register({
    name: "apply_stress_condition",
    title: "Apply a LocalTwin stress condition",
    description:
      "Apply one of LocalTwin's deterministic downside presets to a business scenario.",
    inputSchema: {
      type: "object",
      properties: {
        scenarioId: { type: "string" },
        preset: {
          type: "string",
          enum: [
            "base",
            "footfallDown",
            "conversionDown",
            "costUp",
            "rentUp",
            "rateUp",
            "combined",
          ],
        },
      },
      required: ["preset"],
      additionalProperties: false,
    },
    execute: async (input: {
      scenarioId?: string;
      preset: StressPreset;
    }) => {
      const scenarioId = scenarioIdOrActive(
        bridge.getState(),
        input.scenarioId,
      );
      bridge.setStressPreset(scenarioId, input.preset);
      report(
        bridge,
        "apply_stress_condition",
        "불리조건 적용",
        "action",
        { scenarioId, preset: input.preset },
      );
      return { accepted: true, scenarioId, preset: input.preset };
    },
  });

  register({
    name: "compare_candidates",
    title: "Compare LocalTwin scenarios",
    description:
      "Set which two existing LocalTwin scenarios are compared. Read state first to get scenario IDs.",
    inputSchema: {
      type: "object",
      properties: {
        primaryScenarioId: { type: "string" },
        compareScenarioId: { type: "string" },
      },
      required: ["primaryScenarioId", "compareScenarioId"],
      additionalProperties: false,
    },
    execute: async (input: {
      primaryScenarioId: string;
      compareScenarioId: string;
    }) => {
      bridge.compareScenarios(
        input.primaryScenarioId,
        input.compareScenarioId,
      );
      report(
        bridge,
        "compare_candidates",
        "후보 비교 설정",
        "action",
        input,
      );
      return { accepted: true, ...input };
    },
  });

  register({
    name: "get_financial_analysis",
    title: "Read deterministic LocalTwin financial analysis",
    description:
      "Return break-even revenue/customers, required capture rate, startup need, funding gap, and 12-month cash flow calculated by src/model.ts. The AI must explain these outputs rather than inventing new financial numbers.",
    inputSchema: {
      type: "object",
      properties: { scenarioId: { type: "string" } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async (input: { scenarioId?: string }) => {
      const output = financialAnalysisFor(
        bridge.getState(),
        input.scenarioId,
      );
      report(
        bridge,
        "get_financial_analysis",
        "재무분석 읽기",
        "read",
        { scenarioId: output.scenario.id },
      );
      return output;
    },
  });

  register({
    name: "get_candidate_context",
    title: "Read LocalTwin candidate context evidence",
    description:
      "Return a compact Graph-RAG style 1-hop evidence packet for a corridor/SGIS zone or member cell. Includes only top proximity evidence plus the canonical zone profile and preserves evidence semantics.",
    inputSchema: {
      type: "object",
      properties: {
        targetId: { type: "string" },
        category: {
          type: "string",
          enum: ["cafe", "restaurant", "retail", "beauty", "service"],
        },
      },
      required: ["targetId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async (input: {
      targetId: string;
      category?: BusinessCategory;
    }) => {
      const output = await candidateContext(
        input.targetId,
        input.category,
      );
      report(
        bridge,
        "get_candidate_context",
        "상권 근거 조회",
        "read",
        input,
      );
      return output;
    },
  });

  register({
    name: "clone_localtwin_scenario",
    title: "Clone a LocalTwin business scenario",
    description:
      "Clone a candidate scenario before editing assumptions. The clone is marked as agent-created when invoked through WebMCP.",
    inputSchema: {
      type: "object",
      properties: {
        sourceId: { type: "string" },
        name: { type: "string" },
      },
      required: ["sourceId"],
      additionalProperties: false,
    },
    execute: async (input: { sourceId: string; name?: string }) => {
      bridge.cloneScenario(input.sourceId, input.name, "agent");
      report(
        bridge,
        "clone_localtwin_scenario",
        "시나리오 복제",
        "action",
        input,
      );
      return { accepted: true, ...input };
    },
  });

  return {
    supported: true,
    toolCount: LOCAL_TWIN_WEBMCP_TOOL_COUNT,
    dispose: () => controller.abort(),
  };
}
