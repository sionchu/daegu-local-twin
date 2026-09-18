import type { Dispatch } from "react";
import type { ApplicationActions, Footprint, MassPatch, SpatialWorkspace, WorkspaceAction } from "./types";

/**
 * The application action surface is shared by human UI handlers and WebMCP.
 * Adapters can observe or render the resulting canonical workspace, but they
 * do not mutate scenarios directly.
 */
export function createApplicationActions(
  dispatch: Dispatch<WorkspaceAction>,
  getState: () => SpatialWorkspace,
): ApplicationActions {
  const requireScenario = (scenarioId: string) => {
    if (!getState().scenarios.some((scenario) => scenario.id === scenarioId)) {
      throw new Error(`Unknown scenario: ${scenarioId}`);
    }
  };

  return {
    selectScenario: (scenarioId) => {
      requireScenario(scenarioId);
      dispatch({ type: "SELECT_SCENARIO", scenarioId });
    },
    compareScenarios: (primaryId, compareId) => {
      requireScenario(primaryId);
      if (compareId) requireScenario(compareId);
      dispatch({ type: "COMPARE_SCENARIOS", primaryId, compareId });
    },
    cloneScenario: (sourceId, name, createdBy = "human") => {
      requireScenario(sourceId);
      dispatch({ type: "CLONE_SCENARIO", sourceId, name, createdBy });
    },
    editBuildingMass: (scenarioId, patch, source = "human") => {
      requireScenario(scenarioId);
      dispatch({ type: "EDIT_BUILDING_MASS", scenarioId, patch, source });
    },
    setMassFootprint: (scenarioId, footprint, source = "human") => {
      requireScenario(scenarioId);
      dispatch({ type: "EDIT_BUILDING_MASS", scenarioId, patch: { footprint }, source });
    },
    setShadowTime: (scenarioId, value, source = "human") => {
      requireScenario(scenarioId);
      dispatch({ type: "SET_SHADOW_TIME", scenarioId, value, source });
    },
  };
}
