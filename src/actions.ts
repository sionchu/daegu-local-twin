import type { Dispatch } from "react";
import type { ApplicationActions, LocalTwinAction, LocalTwinState, StartupAssumptions } from "./types";

export function createApplicationActions(
  dispatch: Dispatch<LocalTwinAction>,
  getState: () => LocalTwinState,
): ApplicationActions {
  const requireScenario = (scenarioId: string) => {
    if (!getState().scenarios.some((scenario) => scenario.id === scenarioId)) throw new Error(`Unknown scenario: ${scenarioId}`);
  };
  const requireCell = (cellId: string) => {
    if (!getState().cells.some((cell) => cell.cellId === cellId)) throw new Error(`Unknown cell: ${cellId}`);
  };
  return {
    selectCell: (cellId, slot = "A") => {
      requireCell(cellId);
      dispatch({ type: "SELECT_CELL", cellId, slot });
    },
    setLayer: (layer) => dispatch({ type: "SET_LAYER", layer }),
    setAssumptions: (scenarioId, patch: Partial<StartupAssumptions>) => {
      requireScenario(scenarioId);
      dispatch({ type: "SET_SCENARIO_ASSUMPTIONS", scenarioId, patch });
    },
    setCategory: (scenarioId, category) => {
      requireScenario(scenarioId);
      dispatch({ type: "SET_SCENARIO_CATEGORY", scenarioId, category });
    },
    setStressPreset: (scenarioId, preset) => {
      requireScenario(scenarioId);
      dispatch({ type: "SET_STRESS_PRESET", scenarioId, preset });
    },
    cloneScenario: (sourceId, name, createdBy = "human") => {
      requireScenario(sourceId);
      dispatch({ type: "CLONE_SCENARIO", sourceId, name, createdBy });
    },
    compareScenarios: (primaryId, compareId) => {
      requireScenario(primaryId);
      if (compareId) requireScenario(compareId);
      dispatch({ type: "COMPARE_SCENARIOS", primaryId, compareId });
    },
  };
}
