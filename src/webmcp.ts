import type { ApplicationActions } from "./types";
import type { LocalTwinState } from "./types";

declare global {
  interface Document {
    modelContext?: {
      registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => Promise<void>;
    };
  }
}

type Bridge = ApplicationActions & { getState: () => LocalTwinState };

/** Optional WebMCP bridge; the human UI remains the primary interaction path. */
export function registerLocalTwinTools(bridge: Bridge) {
  if (!document.modelContext) return { supported: false, dispose: () => undefined };
  const controller = new AbortController();
  const register = (tool: unknown) => void document.modelContext!.registerTool(tool, { signal: controller.signal }).catch(() => undefined);
  register({
    name: "get_localtwin_state",
    title: "Read LocalTwin Daegu state",
    description: "Read candidates, selected corridor cells, and current map layer.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async () => bridge.getState(),
  });
  register({
    name: "select_localtwin_candidate",
    title: "Select a LocalTwin candidate",
    description: "Put a selected Daegu hex-equivalent cell into candidate A or B.",
    inputSchema: {
      type: "object",
      properties: { cellId: { type: "string" }, slot: { type: "string", enum: ["A", "B"] } },
      required: ["cellId", "slot"],
      additionalProperties: false,
    },
    execute: async (input: { cellId: string; slot: "A" | "B" }) => {
      bridge.selectCell(input.cellId, input.slot);
      return bridge.getState();
    },
  });
  register({
    name: "clone_localtwin_scenario",
    title: "Clone a LocalTwin business scenario",
    description: "Clone a candidate scenario before editing assumptions.",
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
  return { supported: true, dispose: () => controller.abort() };
}
