import type { ApplicationActions, SpatialWorkspace } from "./types";

declare global {
  interface Document {
    modelContext?: {
      registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => Promise<void>;
    };
  }
}

type ToolBridge = ApplicationActions & {
  getState: () => SpatialWorkspace;
};

const pointSchema = {
  type: "object",
  properties: { xM: { type: "number" }, yM: { type: "number" } },
  required: ["xM", "yM"],
  additionalProperties: false,
};

const footprintSchema = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["rectangle", "polygon"] },
    widthM: { type: "number", minimum: 6, maximum: 200 },
    depthM: { type: "number", minimum: 6, maximum: 200 },
    points: { type: "array", minItems: 3, items: pointSchema },
  },
  required: ["kind"],
  additionalProperties: false,
};

export function registerSpaceLabTools(bridge: ToolBridge) {
  if (!document.modelContext) return { supported: false, dispose: () => undefined };

  const controller = new AbortController();
  const register = (tool: unknown) => {
    void document.modelContext!.registerTool(tool, { signal: controller.signal }).catch(() => undefined);
  };

  register({
    name: "get_spatial_workspace",
    title: "Read SpaceLab spatial workspace",
    description: "Read the current site, scenario branches, active option, comparison option, footprints, and model parameters.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async () => bridge.getState(),
  });

  register({
    name: "clone_scenario",
    title: "Branch a SpaceLab scenario",
    description: "Clone an existing design scenario to create a new alternative before editing it.",
    inputSchema: {
      type: "object",
      properties: { sourceId: { type: "string" }, name: { type: "string" } },
      required: ["sourceId"],
      additionalProperties: false,
    },
    execute: async (input: { sourceId: string; name?: string }) => {
      bridge.cloneScenario(input.sourceId, input.name, "agent");
      return bridge.getState();
    },
  });

  register({
    name: "edit_building_mass",
    title: "Edit a SpaceLab building mass",
    description: "Edit early-stage massing parameters. Dimensions are meters and rotation is degrees; this is not detailed BIM.",
    inputSchema: {
      type: "object",
      properties: {
        scenarioId: { type: "string" },
        heightM: { type: "number", minimum: 3, maximum: 120 },
        floors: { type: "number", minimum: 1, maximum: 40 },
        rotationDeg: { type: "number", minimum: -180, maximum: 180 },
        position: {
          type: "object",
          properties: {
            eastM: { type: "number", minimum: -200, maximum: 200 },
            northM: { type: "number", minimum: -200, maximum: 200 },
          },
          additionalProperties: false,
        },
        footprint: footprintSchema,
      },
      required: ["scenarioId"],
      additionalProperties: false,
    },
    execute: async (input: any) => {
      const { scenarioId, ...patch } = input;
      bridge.editBuildingMass(scenarioId, patch, "agent");
      return bridge.getState();
    },
  });

  register({
    name: "set_mass_footprint",
    title: "Set a rectangular or free-polygon footprint",
    description: "Replace one scenario's conceptual building footprint with a rectangle or local-coordinate polygon.",
    inputSchema: {
      type: "object",
      properties: { scenarioId: { type: "string" }, footprint: footprintSchema },
      required: ["scenarioId", "footprint"],
      additionalProperties: false,
    },
    execute: async (input: any) => {
      bridge.setMassFootprint(input.scenarioId, input.footprint, "agent");
      return bridge.getState();
    },
  });

  register({
    name: "set_shadow_time",
    title: "Set SpaceLab shadow preview time",
    description: "Set the local scenario date/time used for a qualitative shadow preview, not a statutory sunlight-right determination.",
    inputSchema: {
      type: "object",
      properties: {
        scenarioId: { type: "string" },
        localDateTime: { type: "string", description: "YYYY-MM-DDTHH:mm" },
      },
      required: ["scenarioId", "localDateTime"],
      additionalProperties: false,
    },
    execute: async (input: { scenarioId: string; localDateTime: string }) => {
      bridge.setShadowTime(input.scenarioId, input.localDateTime, "agent");
      return bridge.getState();
    },
  });

  register({
    name: "compare_scenarios",
    title: "Compare two SpaceLab scenarios",
    description: "Select a primary and comparison scenario in the shared SpaceLab workspace.",
    inputSchema: {
      type: "object",
      properties: { primaryId: { type: "string" }, compareId: { type: "string" } },
      required: ["primaryId", "compareId"],
      additionalProperties: false,
    },
    execute: async (input: { primaryId: string; compareId: string }) => {
      bridge.compareScenarios(input.primaryId, input.compareId);
      return bridge.getState();
    },
  });

  return { supported: true, dispose: () => controller.abort() };
}
