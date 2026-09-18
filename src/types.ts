export type GeoPoint = { lon: number; lat: number };

export type LocalPoint = { xM: number; yM: number };

export type RectangleFootprint = {
  kind: "rectangle";
  widthM: number;
  depthM: number;
};

export type PolygonFootprint = {
  kind: "polygon";
  points: LocalPoint[];
};

export type Footprint = RectangleFootprint | PolygonFootprint;

export type MassPosition = {
  eastM: number;
  northM: number;
};

/** Canonical domain object. Rendering adapters consume this object but do not own it. */
export type BuildingMass = {
  id: string;
  name: string;
  center: GeoPoint;
  footprint: Footprint;
  heightM: number;
  floors: number;
  position: MassPosition;
  rotationDeg: number;
};

/** A branchable design alternative and its analysis time are canonical scenario state. */
export type Scenario = {
  id: string;
  name: string;
  parentId?: string;
  intent: string;
  createdBy: "human" | "agent";
  mass: BuildingMass;
  analysisTime: string;
};

export type SpatialWorkspace = {
  siteName: string;
  siteCenter: GeoPoint;
  scenarios: Scenario[];
  activeScenarioId: string;
  compareScenarioId?: string;
};

export type MassPatch = Partial<Pick<BuildingMass, "heightM" | "floors" | "rotationDeg" | "footprint">> & {
  position?: Partial<MassPosition>;
};

export type ActionSource = "human" | "agent";

export type WorkspaceAction =
  | { type: "SELECT_SCENARIO"; scenarioId: string }
  | { type: "COMPARE_SCENARIOS"; primaryId: string; compareId?: string }
  | { type: "CLONE_SCENARIO"; sourceId: string; name?: string; createdBy?: ActionSource }
  | { type: "EDIT_BUILDING_MASS"; scenarioId: string; patch: MassPatch; source?: ActionSource }
  | { type: "SET_SHADOW_TIME"; scenarioId: string; value: string; source?: ActionSource };

export type ApplicationActions = {
  selectScenario: (scenarioId: string) => void;
  compareScenarios: (primaryId: string, compareId?: string) => void;
  cloneScenario: (sourceId: string, name?: string, createdBy?: ActionSource) => void;
  editBuildingMass: (scenarioId: string, patch: MassPatch, source?: ActionSource) => void;
  setMassFootprint: (scenarioId: string, footprint: Footprint, source?: ActionSource) => void;
  setShadowTime: (scenarioId: string, value: string, source?: ActionSource) => void;
};
