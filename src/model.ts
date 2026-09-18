import type {
  BuildingMass,
  Footprint,
  LocalPoint,
  MassPatch,
  Scenario,
  SpatialWorkspace,
  WorkspaceAction,
} from "./types";

export const siteCenter = { lon: 127.11052, lat: 37.39483 };

const baseRectangle: Footprint = { kind: "rectangle", widthM: 44, depthM: 30 };
const lowerPolygon: Footprint = {
  kind: "polygon",
  points: [
    { xM: -29, yM: -14 },
    { xM: 22, yM: -14 },
    { xM: 29, yM: -3 },
    { xM: 18, yM: 15 },
    { xM: -24, yM: 15 },
  ],
};

const baseMass: BuildingMass = {
  id: "mass-a",
  name: "Office mass",
  center: siteCenter,
  footprint: baseRectangle,
  heightM: 28,
  floors: 8,
  position: { eastM: 0, northM: 0 },
  rotationDeg: 6,
};

export const initialState: SpatialWorkspace = {
  siteName: "Pangyo sample site",
  siteCenter,
  activeScenarioId: "A",
  compareScenarioId: "B",
  scenarios: [
    {
      id: "A",
      name: "Option A · Taller",
      intent: "Compact office mass under 30 m",
      createdBy: "human",
      mass: cloneMass(baseMass),
      analysisTime: "2026-09-18T15:00",
    },
    {
      id: "B",
      name: "Option B · Lower",
      parentId: "A",
      intent: "Lower polygon alternative",
      createdBy: "agent",
      mass: {
        ...cloneMass(baseMass),
        id: "mass-b",
        footprint: cloneFootprint(lowerPolygon),
        heightM: 18,
        floors: 5,
        position: { eastM: 0, northM: -5 },
        rotationDeg: -8,
      },
      analysisTime: "2026-09-18T15:00",
    },
  ],
};

export function getScenario(state: SpatialWorkspace, id: string): Scenario {
  const found = state.scenarios.find((scenario) => scenario.id === id);
  if (!found) throw new Error(`Unknown scenario: ${id}`);
  return found;
}

export function cloneFootprint(footprint: Footprint): Footprint {
  return footprint.kind === "rectangle"
    ? { ...footprint }
    : { kind: "polygon", points: footprint.points.map((point) => ({ ...point })) };
}

export function cloneMass(mass: BuildingMass): BuildingMass {
  return {
    ...mass,
    center: { ...mass.center },
    position: { ...mass.position },
    footprint: cloneFootprint(mass.footprint),
  };
}

export function footprintPoints(footprint: Footprint): LocalPoint[] {
  if (footprint.kind === "polygon") return footprint.points;
  const halfWidth = footprint.widthM / 2;
  const halfDepth = footprint.depthM / 2;
  return [
    { xM: -halfWidth, yM: -halfDepth },
    { xM: halfWidth, yM: -halfDepth },
    { xM: halfWidth, yM: halfDepth },
    { xM: -halfWidth, yM: halfDepth },
  ];
}

export function rotatedFootprintPoints(mass: BuildingMass): LocalPoint[] {
  const angle = (mass.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return footprintPoints(mass.footprint).map(({ xM, yM }) => ({
    xM: xM * cos - yM * sin,
    yM: xM * sin + yM * cos,
  }));
}

export function footprintBounds(mass: BuildingMass) {
  const points = rotatedFootprintPoints(mass);
  const xs = points.map((point) => point.xM);
  const ys = points.map((point) => point.yM);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    widthM: Math.max(...xs) - Math.min(...xs),
    depthM: Math.max(...ys) - Math.min(...ys),
  };
}

export function footprintAreaM2(footprint: Footprint) {
  const points = footprintPoints(footprint);
  return Math.abs(points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point.xM * next.yM - next.xM * point.yM;
  }, 0) / 2);
}

export function estimateGfa(mass: BuildingMass) {
  return Math.round(footprintAreaM2(mass.footprint) * mass.floors);
}

export function shadowPreview(mass: BuildingMass, analysisTime: string) {
  const hour = Number(analysisTime.slice(11, 13));
  const minute = Number(analysisTime.slice(14, 16));
  const localHour = Number.isFinite(hour) ? hour + (Number.isFinite(minute) ? minute / 60 : 0) : 12;
  const distanceFromNoon = Math.abs(localHour - 12);
  const lengthM = Math.round(mass.heightM * (0.58 + distanceFromNoon * 0.34) * 10) / 10;
  const bearingDeg = ((localHour - 12) * 15 + 180 + 360) % 360;
  return { lengthM, bearingDeg };
}

export function estimatedShadowLengthM(mass: BuildingMass, analysisTime: string) {
  return shadowPreview(mass, analysisTime).lengthM;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizePoint(point: LocalPoint): LocalPoint {
  return {
    xM: clamp(Number(point.xM) || 0, -200, 200),
    yM: clamp(Number(point.yM) || 0, -200, 200),
  };
}

function normalizeFootprint(footprint: Footprint): Footprint {
  if (!footprint || footprint.kind === "rectangle") {
    return {
      kind: "rectangle",
      widthM: clamp(Number(footprint?.widthM) || 12, 6, 200),
      depthM: clamp(Number(footprint?.depthM) || 12, 6, 200),
    };
  }
  const points = Array.isArray(footprint.points) ? footprint.points.map(normalizePoint) : [];
  return {
    kind: "polygon",
    points: points.length >= 3 ? points : footprintPoints(baseRectangle),
  };
}

function normalizePatch(patch: MassPatch): MassPatch {
  const normalized: MassPatch = {};
  if (patch.heightM !== undefined) normalized.heightM = clamp(Number(patch.heightM) || 6, 3, 120);
  if (patch.floors !== undefined) normalized.floors = Math.round(clamp(Number(patch.floors) || 1, 1, 40));
  if (patch.rotationDeg !== undefined) normalized.rotationDeg = clamp(Number(patch.rotationDeg) || 0, -180, 180);
  if (patch.position) {
    const position: Partial<BuildingMass["position"]> = {};
    if (patch.position.eastM !== undefined) position.eastM = clamp(Number(patch.position.eastM) || 0, -200, 200);
    if (patch.position.northM !== undefined) position.northM = clamp(Number(patch.position.northM) || 0, -200, 200);
    normalized.position = position;
  }
  if (patch.footprint) normalized.footprint = normalizeFootprint(patch.footprint);
  return normalized;
}

function applyMassPatch(mass: BuildingMass, patch: MassPatch) {
  const normalized = normalizePatch(patch);
  return {
    ...mass,
    ...normalized,
    position: { ...mass.position, ...normalized.position },
    footprint: normalized.footprint ? cloneFootprint(normalized.footprint) : cloneFootprint(mass.footprint),
  };
}

function nextScenarioId(scenarios: Scenario[]) {
  const ids = new Set(scenarios.map((scenario) => scenario.id));
  return ["C", "D", "E", "F", "G", "H"].find((id) => !ids.has(id)) ?? `S${scenarios.length + 1}`;
}

export function reducer(state: SpatialWorkspace, action: WorkspaceAction): SpatialWorkspace {
  switch (action.type) {
    case "SELECT_SCENARIO":
      getScenario(state, action.scenarioId);
      return { ...state, activeScenarioId: action.scenarioId };
    case "COMPARE_SCENARIOS":
      getScenario(state, action.primaryId);
      if (action.compareId) getScenario(state, action.compareId);
      return { ...state, activeScenarioId: action.primaryId, compareScenarioId: action.compareId };
    case "SET_SHADOW_TIME":
      getScenario(state, action.scenarioId);
      return {
        ...state,
        scenarios: state.scenarios.map((scenario) => scenario.id === action.scenarioId
          ? { ...scenario, analysisTime: action.value }
          : scenario),
      };
    case "EDIT_BUILDING_MASS":
      getScenario(state, action.scenarioId);
      return {
        ...state,
        scenarios: state.scenarios.map((scenario) => scenario.id === action.scenarioId
          ? { ...scenario, mass: applyMassPatch(scenario.mass, action.patch) }
          : scenario),
      };
    case "CLONE_SCENARIO": {
      const source = getScenario(state, action.sourceId);
      const id = nextScenarioId(state.scenarios);
      const next: Scenario = {
        ...source,
        id,
        parentId: source.id,
        name: action.name?.trim() || `Option ${id}`,
        createdBy: action.createdBy ?? "human",
        mass: { ...cloneMass(source.mass), id: `mass-${id.toLowerCase()}` },
      };
      return {
        ...state,
        scenarios: [...state.scenarios, next],
        activeScenarioId: id,
      };
    }
  }
}
