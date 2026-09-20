"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { startVWorld, disposeVWorld } from "@/lib/vworld-client";
import { computeOpportunityScores } from "@/src/model";
import type { LocationEvidence, MapLayer } from "@/src/types";

const DAEGU_CENTER: [number, number] = [128.5967, 35.8714];

const DAEGU_RENDER_BOUNDS = {
  west: 128.3511837,
  south: 35.6067585,
  east: 128.8994336,
  north: 36.3271116,
};

const DAEGU_FOCUS_OUTER_BOUNDS = {
  west: 127.72,
  south: 34.95,
  east: 129.55,
  north: 36.95,
};

const CENTRAL_SERVICE_BOUNDS = {
  west: 128.565,
  south: 35.852,
  east: 128.615,
  north: 35.892,
};

const MIN_CAMERA_HEIGHT_M = 40;
const MAX_CAMERA_HEIGHT_M = 65_000;

type AdminGeometry = {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
};

type AdminFeature = {
  properties?: { officialName?: string };
  geometry: AdminGeometry;
};

type AdminBoundaryCollection = {
  features: AdminFeature[];
};

type TransitRecord = {
  station: string;
  latitude: number;
  longitude: number;
};

type TransitSnapshot = {
  records: TransitRecord[];
};

type CorridorGeometry = {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
};

type CorridorFeature = {
  properties: {
    zoneId: string;
    label: string;
    memberCellIds: string[];
    labelLon?: number;
    labelLat?: number;
    boundaryMeaning?: string;
    sourceProvider?: string;
  };
  geometry: CorridorGeometry;
};

type CorridorCollection = {
  features: CorridorFeature[];
};

type ContextAnchor = {
  anchorId: string;
  name: string;
  anchorType:
    | "education"
    | "healthcare"
    | "employment_public"
    | "industrial"
    | "transit"
    | "retail_market"
    | "culture_tourism"
    | "parking_access";
  subtype: string | null;
  longitude: number;
  latitude: number;
  confidence: number | null;
  quality: "public-map" | "official-linked" | "official";
  coordinateQuality?: "public-map" | "official";
  baseWeight?: number;
  capacityWeight?: number;
};

type ContextProfile = {
  zoneId: string;
  label: string;
  zoneKind: "locality" | "commercial_corridor";
  businessSignals?: {
    businessCount: number;
    businessesPerSqKm: number;
    businessDensityScore: number;
    businessDiversityScore: number;
  } | null;
  scores: Record<
    | "education"
    | "healthcare"
    | "employment_public"
    | "industrial"
    | "transit"
    | "retail_market"
    | "culture_tourism"
    | "parking_access",
    number
  >;
  officialZoneSignals?: {
    workplaceBusinesses: number;
    workplaceEmployees: number;
    workplaceEmployeeRank: number;
    workplaceEmploymentScore: number;
    workplaceSourceYear: number;
    residentPopulation: number;
    residentMale: number;
    residentFemale: number;
    residentPopulationChange: number;
    residentPopulationRank: number;
    residentPopulationScore: number;
    residentSourceMonth: string;
    quality: "official-snapshot";
    sourceId: string;
    residentSourceId: string;
  } | null;
  anchorEvidence: Record<
    string,
    {
      countWithinCatchment: number;
      nearestAnchors: Array<{
        anchorId: string;
        name: string;
        subtype: string | null;
        distanceM: number;
        decayWeight: number;
      }>;
    }
  >;
};

type ContextProfileDocument = {
  records: ContextProfile[];
};

type ContextAnchorDocument = {
  records: ContextAnchor[];
};

type CitywideZoneFeature = {
  properties: {
    zoneId: string;
    label: string;
    district?: string | null;
    labelLon?: number;
    labelLat?: number;
    quality?: string;
  };
  geometry: CorridorGeometry;
};

type CitywideZoneCollection = {
  features: CitywideZoneFeature[];
};

type CommercialPotentialProfile = {
  zoneId: string;
  label: string;
  district?: string | null;
  zoneKind: "locality" | "commercial_corridor";
  labelLon?: number | null;
  labelLat?: number | null;
  isCommercialCandidate: boolean;
  candidateRank?: number | null;
  candidateTier?: string | null;
  memberCellIds?: string[];
  commercialPotentialScore: number;
  businessCount: number;
  businessDensityScore: number;
  businessDiversityScore: number;
  transitScore: number;
  retailMarketScore: number;
  employmentPublicScore: number;
  cultureTourismScore: number;
  boundaryMeaning: string;
};

type CommercialPotentialFeature = {
  properties: CommercialPotentialProfile;
  geometry: CorridorGeometry;
};

type CommercialPotentialCollection = {
  metadata?: {
    coverage?: {
      candidateCount?: number;
    };
  };
  features: CommercialPotentialFeature[];
};

type CommercialPotentialProfileDocument = {
  records: CommercialPotentialProfile[];
};

type CandidateOverlayPoint = {
  zoneId: string;
  label: string;
  zoneKind: "locality" | "commercial_corridor";
  score: number;
  rank: number | null | undefined;
  memberCellIds: string[] | undefined;
  x: number;
  y: number;
};

type CandidateLabelBox = {
  zoneId: string;
  priority: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

function resolveCandidateLabelCollisions(boxes: CandidateLabelBox[]) {
  const accepted: CandidateLabelBox[] = [];
  for (const box of [...boxes].sort((left, right) => right.priority - left.priority)) {
    const overlaps = accepted.some(
      (kept) =>
        box.left < kept.right &&
        box.right > kept.left &&
        box.top < kept.bottom &&
        box.bottom > kept.top,
    );
    if (!overlaps) accepted.push(box);
  }
  return new Set(accepted.map((box) => box.zoneId));
}

type Props = {
  cells: LocationEvidence[];
  selectedCellId?: string;
  activeLayer: MapLayer;
  scope?: "central" | "citywide";
  selectedContextZoneId?: string;
  onSelect: (cellId: string) => void;
  onContextSelect?: (zoneId: string) => void;
  onUnavailable: (reason: string) => void;
};

function scoreForLayer(
  cell: LocationEvidence,
  cells: LocationEvidence[],
  layer: MapLayer,
) {
  const scores = computeOpportunityScores(cell, cells);
  if (layer === "opportunity") return scores.opportunityScore;
  if (layer === "demand") return scores.demandScore;
  if (layer === "transit") return scores.transit;
  if (layer === "buzz") return scores.buzz;
  if (layer === "spillover") return scores.spillover;
  if (layer === "rent") return scores.rentRelief;
  return cell.regenerationScore;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function scoreColor(Cesium: any, score: number | null, alpha: number) {
  if (score === null || !Number.isFinite(score)) {
    return Cesium.Color.fromCssColorString("#64748b").withAlpha(alpha);
  }
  const t = clamp(score / 100, 0, 1);
  if (t < 0.25) return Cesium.Color.fromCssColorString("#3d6073").withAlpha(alpha);
  if (t < 0.5) return Cesium.Color.fromCssColorString("#2f9e9a").withAlpha(alpha);
  if (t < 0.75) return Cesium.Color.fromCssColorString("#d5a548").withAlpha(alpha);
  return Cesium.Color.fromCssColorString("#ef7b45").withAlpha(alpha);
}

const LAYER_LABELS: Record<MapLayer, string> = {
  opportunity: "입지종합",
  demand: "수요여건",
  transit: "교통접근",
  buzz: "검색관심",
  spillover: "주변집객",
  regeneration: "도시재생",
  rent: "임대여건",
  education: "교육·대학",
  healthcare: "의료",
  employmentPublic: "업무·공공",
  industrial: "산업",
  transitHub: "교통거점",
  retailMarket: "시장·대형점포",
  cultureTourism: "문화·관광",
  parkingAccess: "주차·접근",
  residentPopulation: "거주인구",
  workplaceEmployment: "직장종사자",
  commercialPotential: "상권잠재",
  commercialDensity: "상업밀도",
  businessDiversity: "업종다양성",
};

const CONTEXT_LAYER_TO_ANCHOR_TYPE: Partial<
  Record<MapLayer, ContextAnchor["anchorType"]>
> = {
  education: "education",
  healthcare: "healthcare",
  employmentPublic: "employment_public",
  industrial: "industrial",
  transitHub: "transit",
  retailMarket: "retail_market",
  cultureTourism: "culture_tourism",
  parkingAccess: "parking_access",
};

function isContextLayer(layer: MapLayer) {
  return Boolean(CONTEXT_LAYER_TO_ANCHOR_TYPE[layer]);
}

function corridorRings(geometry: CorridorGeometry) {
  return geometry.type === "Polygon"
    ? [(geometry.coordinates as number[][][])[0]]
    : (geometry.coordinates as number[][][][]).map((polygon) => polygon[0]);
}

function pointInRing(lon: number, lat: number, ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i]?.[0];
    const yi = ring[i]?.[1];
    const xj = ring[j]?.[0];
    const yj = ring[j]?.[1];
    if (
      xi === undefined ||
      yi === undefined ||
      xj === undefined ||
      yj === undefined
    ) {
      continue;
    }
    const intersects =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function corridorContains(
  zone: { geometry: CorridorGeometry },
  lon: number,
  lat: number,
) {
  const polygons =
    zone.geometry.type === "Polygon"
      ? [zone.geometry.coordinates as number[][][]]
      : (zone.geometry.coordinates as number[][][][]);

  return polygons.some((polygon) => {
    const [outer, ...holes] = polygon;
    if (!outer || !pointInRing(lon, lat, outer)) return false;
    return !holes.some((hole) => pointInRing(lon, lat, hole));
  });
}

function ringArea(ring: number[][]) {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i]?.[0] ?? 0;
    const yi = ring[i]?.[1] ?? 0;
    const xj = ring[j]?.[0] ?? 0;
    const yj = ring[j]?.[1] ?? 0;
    area += xj * yi - xi * yj;
  }
  return Math.abs(area / 2);
}

function corridorArea(zone: { geometry: CorridorGeometry }) {
  return corridorRings(zone.geometry).reduce((sum, ring) => sum + ringArea(ring), 0);
}

function zoneScore(
  zone: CorridorFeature,
  cells: LocationEvidence[],
  activeLayer: MapLayer,
) {
  const values = zone.properties.memberCellIds
    .map((cellId) => cells.find((cell) => cell.cellId === cellId))
    .filter((cell): cell is LocationEvidence => Boolean(cell))
    .map((cell) => scoreForLayer(cell, cells, activeLayer))
    .filter((value): value is number => value !== null && Number.isFinite(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function zoneCenter(zone: CorridorFeature, cells: LocationEvidence[]) {
  if (
    typeof zone.properties.labelLon === "number" &&
    typeof zone.properties.labelLat === "number"
  ) {
    return [zone.properties.labelLon, zone.properties.labelLat] as [number, number];
  }

  const members = zone.properties.memberCellIds
    .map((cellId) => cells.find((cell) => cell.cellId === cellId))
    .filter((cell): cell is LocationEvidence => Boolean(cell));
  if (!members.length) return DAEGU_CENTER;
  return [
    members.reduce((sum, cell) => sum + cell.center.lon, 0) / members.length,
    members.reduce((sum, cell) => sum + cell.center.lat, 0) / members.length,
  ] as [number, number];
}

function displayRings(geometry: AdminGeometry) {
  const rings =
    geometry.type === "Polygon"
      ? [(geometry.coordinates as number[][][])[0]]
      : (geometry.coordinates as number[][][][]).map((polygon) => polygon[0]);

  return rings.map((ring) => {
    const step = Math.max(1, Math.ceil(ring.length / 420));
    const sampled = ring.filter((_, index) => index % step === 0);
    if (sampled.length && sampled[sampled.length - 1] !== ring[ring.length - 1]) {
      sampled.push(ring[ring.length - 1]);
    }
    return sampled;
  });
}

async function showVWorldBuildings(map: any) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const layer = map?.getLayerElement?.("facility_build");
    if (layer) {
      layer.show?.();
      return true;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 150));
  }
  return false;
}

function ringCenter(ring: number[][]) {
  if (!ring.length) return DAEGU_CENTER;
  const sum = ring.reduce(
    (acc, point) => [acc[0] + point[0], acc[1] + point[1]],
    [0, 0],
  );
  return [sum[0] / ring.length, sum[1] / ring.length] as [number, number];
}

function configureCameraControls(viewer: any) {
  const controller = viewer.scene?.screenSpaceCameraController;
  if (!controller) return () => undefined;

  controller.minimumZoomDistance = MIN_CAMERA_HEIGHT_M;
  controller.maximumZoomDistance = MAX_CAMERA_HEIGHT_M;
  controller.enableRotate = true;
  controller.enableTranslate = true;
  controller.enableZoom = true;
  controller.enableTilt = true;
  controller.enableLook = true;

  return () => undefined;
}

function addCitywideOutsideFocusVeil(viewer: any, Cesium: any) {
  const inner = DAEGU_RENDER_BOUNDS;
  const outer = DAEGU_FOCUS_OUTER_BOUNDS;
  const bands = [
    [outer.west, outer.south, outer.east, inner.south],
    [outer.west, inner.north, outer.east, outer.north],
    [outer.west, inner.south, inner.west, inner.north],
    [inner.east, inner.south, outer.east, inner.north],
  ] as Array<[number, number, number, number]>;

  return bands.map(([west, south, east, north], index) =>
    viewer.entities.add({
      id: `localtwin-daegu-focus-veil-${index}`,
      name: "대구 외곽 시각 억제",
      rectangle: {
        coordinates: Cesium.Rectangle.fromDegrees(west, south, east, north),
        material: Cesium.Color.fromCssColorString("#02060a").withAlpha(0.46),
        height: 0,
        heightReference: Cesium.HeightReference?.CLAMP_TO_GROUND,
      },
    }),
  );
}

function addDaeguBoundaryOutline(
  viewer: any,
  Cesium: any,
  geometry: AdminGeometry | undefined,
) {
  if (!geometry) return [];
  const rings = displayRings(geometry).filter((ring) => ring.length >= 3);
  if (!rings.length) return [];

  return rings.map((ring) =>
    viewer.entities.add({
      name: "대구광역시 경계",
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(ring.flat()),
        width: 2.4,
        material: Cesium.Color.fromCssColorString("#dbe7ea").withAlpha(0.58),
        clampToGround: true,
      },
    }),
  );
}

export default function VWorldLocalTwinMap({
  cells,
  selectedCellId,
  activeLayer,
  scope = "central",
  selectedContextZoneId,
  onSelect,
  onContextSelect,
  onUnavailable,
}: Props) {
  const viewerRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contextEntitiesRef = useRef<any[]>([]);
  const cellEntitiesRef = useRef<any[]>([]);
  const contextLayerEntitiesRef = useRef<any[]>([]);
  const focusVeilEntitiesRef = useRef<any[]>([]);
  const clickCleanupRef = useRef<(() => void) | null>(null);
  const cameraControlCleanupRef = useRef<(() => void) | null>(null);
  const hoveredZoneCellIdRef = useRef<string | null>(null);
  const scopeRef = useRef<"central" | "citywide">(scope);
  const citywideZonesRef = useRef<CitywideZoneFeature[]>([]);
  const commercialZonesRef = useRef<CommercialPotentialFeature[]>([]);
  const contextProfilesRef = useRef<Record<string, ContextProfile>>({});
  const onContextSelectRef = useRef(onContextSelect);
  const initialSelectionRef = useRef(true);
  const initialContextSelectionRef = useRef(true);
  const [hoveredZoneCellId, setHoveredZoneCellId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [buildingsReady, setBuildingsReady] = useState(false);
  const [corridors, setCorridors] = useState<CorridorFeature[]>([]);
  const [citywideZones, setCitywideZones] = useState<CitywideZoneFeature[]>([]);
  const [commercialZones, setCommercialZones] = useState<CommercialPotentialFeature[]>([]);
  const [commercialProfiles, setCommercialProfiles] =
    useState<CommercialPotentialProfile[]>([]);
  const [contextProfiles, setContextProfiles] = useState<Record<string, ContextProfile>>({});
  const [contextAnchors, setContextAnchors] = useState<ContextAnchor[]>([]);
  const [candidateOverlayPoints, setCandidateOverlayPoints] =
    useState<CandidateOverlayPoint[]>([]);
  const contextAnchorCacheRef = useRef<Record<string, ContextAnchor[]>>({});
  const containerId = "localtwin-vworld-map";

  scopeRef.current = scope;
  citywideZonesRef.current = citywideZones;
  commercialZonesRef.current = commercialZones;
  contextProfilesRef.current = contextProfiles;
  onContextSelectRef.current = onContextSelect;

  const selectedCell = useMemo(
    () => cells.find((cell) => cell.cellId === selectedCellId),
    [cells, selectedCellId],
  );

  const clearEntities = useCallback((entities: any[]) => {
    const viewer = viewerRef.current;
    if (!viewer?.entities) return;
    entities.forEach((entity) => viewer.entities.remove(entity));
    entities.length = 0;
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const configResponse = await fetch("/api/vworld/config", { cache: "no-store" });
        const config = (await configResponse.json()) as {
          enabled?: boolean;
          apiKey?: string;
        };
        if (!config.enabled || !config.apiKey) {
          throw new Error("VWorld client key is not configured for this host");
        }

        const { viewer, map } = await startVWorld(
          containerId,
          config.apiKey,
          DAEGU_CENTER[0],
          DAEGU_CENTER[1],
        );
        if (cancelled) {
          disposeVWorld(viewer);
          return;
        }

        viewerRef.current = viewer;
        mapRef.current = map;

        if (viewer.scene) {
          viewer.scene.requestRenderMode = true;
          viewer.scene.maximumRenderTimeChange = Number.POSITIVE_INFINITY;
          if (viewer.scene.globe) viewer.scene.globe.enableLighting = false;
          viewer.scene.fxaa = true;
        }
        if (viewer.clock) viewer.clock.shouldAnimate = false;
        viewer.shadows = false;

        const Cesium = window.Cesium;
        cameraControlCleanupRef.current = configureCameraControls(viewer);

        const [
          adminResponse,
          transitResponse,
          corridorResponse,
          daeguResponse,
          contextProfileResponse,
        ] = await Promise.all([
          fetch("/data/admin_dong_boundaries.geojson"),
          fetch("/data/transit_station_locations.json"),
          fetch("/data/corridor_zones.geojson"),
          fetch("/data/daegu_boundary.geojson"),
          fetch("/data/corridor_context_profiles.json"),
        ]);
        const admin = (await adminResponse.json()) as AdminBoundaryCollection;
        const transit = (await transitResponse.json()) as TransitSnapshot;
        const corridorData = (await corridorResponse.json()) as CorridorCollection;
        const daeguBoundary = (await daeguResponse.json()) as AdminBoundaryCollection;
        const contextProfileData =
          (await contextProfileResponse.json()) as ContextProfileDocument;
        setCorridors(corridorData.features ?? []);
        setContextProfiles((current) => ({
          ...current,
          ...Object.fromEntries(
            (contextProfileData.records ?? []).map((profile) => [
              profile.zoneId,
              profile,
            ]),
          ),
        }));

        const boundaryEntities = addDaeguBoundaryOutline(
          viewer,
          Cesium,
          daeguBoundary.features?.[0]?.geometry,
        );
        contextEntitiesRef.current.push(...boundaryEntities);

        for (const feature of admin.features ?? []) {
          for (const ring of displayRings(feature.geometry)) {
            if (ring.length < 3) continue;
            const positions = Cesium.Cartesian3.fromDegreesArray(ring.flat());
            const line = viewer.entities.add({
              name: `${feature.properties?.officialName ?? "행정동"} 경계`,
              polyline: {
                positions,
                width: 1.25,
                material: Cesium.Color.fromCssColorString("#9fb6c5").withAlpha(0.42),
                clampToGround: true,
              },
            });
            contextEntitiesRef.current.push(line);

            const [lon, lat] = ringCenter(ring);
            const label = viewer.entities.add({
              position: Cesium.Cartesian3.fromDegrees(lon, lat),
              label: {
                text: feature.properties?.officialName ?? "",
                font: "10px sans-serif",
                fillColor: Cesium.Color.fromCssColorString("#b7c7d1").withAlpha(0.78),
                outlineColor: Cesium.Color.fromCssColorString("#071018"),
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                heightReference: Cesium.HeightReference?.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                distanceDisplayCondition: new Cesium.DistanceDisplayCondition(900, 4600),
              },
            });
            contextEntitiesRef.current.push(label);
          }
        }

        for (const station of transit.records ?? []) {
          const stationEntity = viewer.entities.add({
            id: `localtwin-station-${station.station}`,
            name: station.station,
            position: Cesium.Cartesian3.fromDegrees(station.longitude, station.latitude),
            point: {
              pixelSize: 8,
              color: Cesium.Color.fromCssColorString("#67b7dc"),
              outlineColor: Cesium.Color.fromCssColorString("#071018"),
              outlineWidth: 2,
              heightReference: Cesium.HeightReference?.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: {
              text: station.station,
              font: "11px sans-serif",
              fillColor: Cesium.Color.WHITE,
              outlineColor: Cesium.Color.fromCssColorString("#071018"),
              outlineWidth: 3,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              pixelOffset: new Cesium.Cartesian2(0, -18),
              heightReference: Cesium.HeightReference?.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5200),
            },
          });
          contextEntitiesRef.current.push(stationEntity);
        }

        const handler = viewer.screenSpaceEventHandler;
        const clickType = Cesium.ScreenSpaceEventType.LEFT_CLICK;
        const moveType = Cesium.ScreenSpaceEventType.MOUSE_MOVE;
        const originalClick = handler?.getInputAction?.(clickType);
        const originalMove = handler?.getInputAction?.(moveType);

        const pickIdsAt = (position: any): string[] => {
          const drilled = viewer.scene?.drillPick?.(position, 16) ?? [];
          return drilled
            .map((picked: any) => picked?.id?.id)
            .filter((entityId: unknown): entityId is string => typeof entityId === "string");
        };

        const zoneCellIdFromIds = (entityIds: string[]) => {
          const commercialGeometryId = entityIds.find(
            (id) =>
              id.startsWith("localtwin-commercial-") &&
              !id.endsWith("::label"),
          );
          if (commercialGeometryId) {
            return (
              commercialGeometryId
                .slice("localtwin-commercial-".length)
                .split("::")[0] || null
            );
          }

          const entityId = entityIds.find((id) => id.startsWith("localtwin-zone-"));
          if (entityId) {
            return entityId.slice("localtwin-zone-".length).split("::")[0] || null;
          }

          const commercialLabelIds = entityIds.filter(
            (id) =>
              id.startsWith("localtwin-commercial-") &&
              id.endsWith("::label"),
          );
          if (commercialLabelIds.length === 1) {
            return (
              commercialLabelIds[0]
                .slice("localtwin-commercial-".length)
                .split("::")[0] || null
            );
          }

          return null;
        };

        const zoneCellIdAtPosition = (position: any) => {
          const ellipsoid = viewer.scene?.globe?.ellipsoid;
          const cartesian = viewer.camera?.pickEllipsoid?.(position, ellipsoid);
          if (!cartesian) return null;

          const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
          const lon = Cesium.Math.toDegrees(cartographic.longitude);
          const lat = Cesium.Math.toDegrees(cartographic.latitude);

          if (scopeRef.current === "citywide") {
            const commercialMatching = commercialZonesRef.current
              .filter(
                (zone) =>
                  zone.properties.isCommercialCandidate &&
                  corridorContains(zone, lon, lat),
              )
              .sort((left, right) => corridorArea(left) - corridorArea(right));
            if (commercialMatching[0]) {
              return commercialMatching[0].properties.zoneId;
            }

            const matching = citywideZonesRef.current
              .filter((zone) => corridorContains(zone, lon, lat))
              .sort((left, right) => corridorArea(left) - corridorArea(right));
            return matching[0]?.properties.zoneId ?? null;
          }

          const matching = (corridorData.features ?? [])
            .filter((zone) => corridorContains(zone, lon, lat))
            .sort((left, right) => corridorArea(left) - corridorArea(right));

          const zone = matching[0];
          return zone?.properties.memberCellIds?.[0] ?? null;
        };

        const updateHoveredZone = (cellId: string | null) => {
          if (hoveredZoneCellIdRef.current === cellId) return;
          hoveredZoneCellIdRef.current = cellId;
          setHoveredZoneCellId(cellId);
          if (containerRef.current) {
            containerRef.current.style.cursor = cellId ? "pointer" : "";
          }
        };

        const callback = (movement: any) => {
          const entityIds = pickIdsAt(movement.position);
          if (scopeRef.current === "central") {
            const cellEntityId = entityIds.find((id) => id.startsWith("localtwin-cell-"));
            if (cellEntityId) {
              onSelect(cellEntityId.slice("localtwin-cell-".length));
              return;
            }
          }

          const zoneId =
            zoneCellIdFromIds(entityIds) ?? zoneCellIdAtPosition(movement.position);
          if (zoneId) {
            if (scopeRef.current === "citywide") {
              onContextSelectRef.current?.(zoneId);
            } else {
              onSelect(zoneId);
            }
          } else if (typeof originalClick === "function") {
            originalClick(movement);
          }
        };

        const handleMouseMove = (movement: any) => {
          const entityIds = pickIdsAt(movement.endPosition);
          updateHoveredZone(
            zoneCellIdFromIds(entityIds) ?? zoneCellIdAtPosition(movement.endPosition),
          );
          if (typeof originalMove === "function") originalMove(movement);
        };

        handler?.setInputAction?.(callback, clickType);
        handler?.setInputAction?.(handleMouseMove, moveType);
        clickCleanupRef.current = () => {
          if (!handler) return;
          updateHoveredZone(null);
          if (typeof originalClick === "function") handler.setInputAction(originalClick, clickType);
          else handler.removeInputAction(clickType);
          if (typeof originalMove === "function") handler.setInputAction(originalMove, moveType);
          else handler.removeInputAction(moveType);
        };

        setReady(true);
        viewer.scene?.requestRender?.();

        void showVWorldBuildings(map).then((shown) => {
          if (cancelled) return;
          setBuildingsReady(shown);
          viewer.scene?.requestRender?.();
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        onUnavailable(reason);
      }
    })();

    return () => {
      cancelled = true;
      clickCleanupRef.current?.();
      cameraControlCleanupRef.current?.();
      cameraControlCleanupRef.current = null;
      clearEntities(cellEntitiesRef.current);
      clearEntities(contextLayerEntitiesRef.current);
      clearEntities(focusVeilEntitiesRef.current);
      clearEntities(contextEntitiesRef.current);
      setBuildingsReady(false);
      disposeVWorld(viewerRef.current);
      viewerRef.current = null;
      mapRef.current = null;
    };
  }, [clearEntities, onSelect, onUnavailable]);

  useEffect(() => {
    if (commercialZones.length) return;
    let cancelled = false;
    void fetch("/data/citywide_commercial_candidates.geojson")
      .then((response) => response.json() as Promise<CommercialPotentialCollection>)
      .then((document) => {
        if (!cancelled) setCommercialZones(document.features ?? []);
      })
      .catch(() => {
        if (!cancelled) setCommercialZones([]);
      });
    return () => {
      cancelled = true;
    };
  }, [commercialZones.length]);

  useEffect(() => {
    if (
      scope !== "citywide" ||
      (citywideZones.length && commercialProfiles.length)
    ) {
      return;
    }
    let cancelled = false;

    void Promise.all([
      fetch("/data/daegu_analysis_zones.geojson").then(
        (response) => response.json() as Promise<CitywideZoneCollection>,
      ),
      fetch("/data/zone_context_profiles.json").then(
        (response) => response.json() as Promise<ContextProfileDocument>,
      ),
      fetch("/data/citywide_commercial_profiles.json").then(
        (response) => response.json() as Promise<CommercialPotentialProfileDocument>,
      ),
    ])
      .then(([zoneDocument, profileDocument, commercialProfileDocument]) => {
        if (cancelled) return;
        setCitywideZones(zoneDocument.features ?? []);
        setCommercialProfiles(commercialProfileDocument.records ?? []);
        setContextProfiles((current) => ({
          ...current,
          ...Object.fromEntries(
            (profileDocument.records ?? []).map((profile) => [
              profile.zoneId,
              profile,
            ]),
          ),
        }));
      })
      .catch(() => {
        if (cancelled) return;
        setCitywideZones([]);
        setCommercialProfiles([]);
      });

    return () => {
      cancelled = true;
    };
  }, [
    citywideZones.length,
    commercialProfiles.length,
    scope,
  ]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = window.Cesium;
    if (!ready || !viewer?.entities || !Cesium) return;

    clearEntities(focusVeilEntitiesRef.current);
    if (scope === "citywide") {
      focusVeilEntitiesRef.current.push(...addCitywideOutsideFocusVeil(viewer, Cesium));
    }
    viewer.scene?.requestRender?.();

    return () => {
      clearEntities(focusVeilEntitiesRef.current);
    };
  }, [clearEntities, ready, scope]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = window.Cesium;
    if (!ready || !viewer?.entities || !Cesium || scope !== "central") return;

    clearEntities(cellEntitiesRef.current);

    for (const zone of corridors) {
      const memberCells = zone.properties.memberCellIds
        .map((cellId) => cells.find((cell) => cell.cellId === cellId))
        .filter((cell): cell is LocationEvidence => Boolean(cell));
      if (!memberCells.length) continue;

      const selected = memberCells.some((cell) => cell.cellId === selectedCellId);
      const hasCandidateOverlay = commercialZones.some(
        (candidate) =>
          candidate.properties.isCommercialCandidate &&
          candidate.properties.zoneId === zone.properties.zoneId,
      );
      const contextAnchorType = CONTEXT_LAYER_TO_ANCHOR_TYPE[activeLayer];
      const score = contextAnchorType
        ? contextProfiles[zone.properties.zoneId]?.scores?.[contextAnchorType] ?? null
        : zoneScore(zone, cells, activeLayer);
      const primaryCellId = memberCells[0].cellId;
      const hovered = hoveredZoneCellId === primaryCellId;
      const hoverActive = hoveredZoneCellId !== null;
      const fillAlpha = hovered ? 0.24 : selected ? 0.16 : hoverActive ? 0.02 : 0.045;
      const borderAlpha = hovered ? 0.92 : selected ? 0.78 : hoverActive ? 0.12 : 0.34;
      const fill = scoreColor(Cesium, score, fillAlpha);
      const border = scoreColor(Cesium, score, borderAlpha);

      corridorRings(zone.geometry).forEach((ring, ringIndex) => {
        if (!ring?.length) return;
        const closed = [...ring];
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
          closed.push(first);
        }

        const positions = Cesium.Cartesian3.fromDegreesArray(closed.flat());
        const entity = viewer.entities.add({
          id: `localtwin-zone-${primaryCellId}::${ringIndex}`,
          name: `${zone.properties.label} 분석권역`,
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray(closed.flat()),
            material: fill,
            height: 0,
            heightReference: Cesium.HeightReference?.CLAMP_TO_GROUND,
          },
          polyline: {
            positions,
            width: hovered ? 5 : selected ? 3.5 : hoverActive ? 1 : 1.5,
            material:
              hovered && Cesium.PolylineGlowMaterialProperty
                ? new Cesium.PolylineGlowMaterialProperty({
                    glowPower: 0.22,
                    taperPower: 0.45,
                    color: border,
                  })
                : border,
            clampToGround: true,
          },
        });
        cellEntitiesRef.current.push(entity);
      });

      const [zoneLon, zoneLat] = zoneCenter(zone, cells);
      const zoneLabel = viewer.entities.add({
        id: `localtwin-zone-${primaryCellId}::label`,
        position: Cesium.Cartesian3.fromDegrees(zoneLon, zoneLat),
        label: {
          show: (hovered || selected) && !hasCandidateOverlay,
          text: `${zone.properties.label}\n${score === null ? "데이터 부족" : Math.round(score) + " / 100"}`,
          font: hovered
            ? "bold 16px sans-serif"
            : selected
              ? "bold 15px sans-serif"
              : "bold 12px sans-serif",
          fillColor: Cesium.Color.WHITE.withAlpha(hoverActive && !hovered && !selected ? 0.42 : 1),
          outlineColor: Cesium.Color.fromCssColorString("#071018"),
          outlineWidth: hovered || selected ? 3 : 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          showBackground: hovered || selected,
          backgroundColor: Cesium.Color.fromCssColorString("#071018").withAlpha(
            hovered ? 0.94 : 0.86,
          ),
          backgroundPadding: new Cesium.Cartesian2(9, 7),
          heightReference: Cesium.HeightReference?.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 6500),
        },
      });
      cellEntitiesRef.current.push(zoneLabel);
    }

    // Exact candidate cells remain selectable but secondary to the corridor layer.
    for (const cell of cells) {
      const selected = cell.cellId === selectedCellId;
      const point = viewer.entities.add({
        id: `localtwin-cell-${cell.cellId}`,
        name: cell.label,
        position: Cesium.Cartesian3.fromDegrees(cell.center.lon, cell.center.lat),
        point: {
          pixelSize: selected ? 11 : 5,
          color: selected
            ? Cesium.Color.WHITE
            : Cesium.Color.fromCssColorString("#cbd5e1").withAlpha(0.72),
          outlineColor: Cesium.Color.fromCssColorString("#071018"),
          outlineWidth: 2,
          heightReference: Cesium.HeightReference?.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: undefined,
      });
      cellEntitiesRef.current.push(point);
    }

    const centralCandidates = commercialZones.filter((zone) => {
      if (!zone.properties.isCommercialCandidate) return false;
      const { labelLon, labelLat } = zone.properties;
      return (
        typeof labelLon === "number" &&
        typeof labelLat === "number" &&
        labelLon >= CENTRAL_SERVICE_BOUNDS.west &&
        labelLon <= CENTRAL_SERVICE_BOUNDS.east &&
        labelLat >= CENTRAL_SERVICE_BOUNDS.south &&
        labelLat <= CENTRAL_SERVICE_BOUNDS.north
      );
    });

    for (const candidate of centralCandidates) {
      const selected =
        candidate.properties.memberCellIds?.includes(selectedCellId ?? "") ?? false;
      const potential = candidate.properties.commercialPotentialScore;
      const plateFill = scoreColor(Cesium, potential, selected ? 0.28 : 0.12);
      const edge = scoreColor(Cesium, potential, selected ? 1 : 0.72);

      corridorRings(candidate.geometry).forEach((ring, ringIndex) => {
        if (!ring?.length) return;
        const closed = [...ring];
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
          closed.push(first);
        }

        cellEntitiesRef.current.push(
          viewer.entities.add({
            id: `localtwin-central-candidate-${candidate.properties.zoneId}::${ringIndex}`,
            name: `${candidate.properties.label} 상권 후보`,
            polygon: {
              hierarchy: Cesium.Cartesian3.fromDegreesArray(closed.flat()),
              material: plateFill,
              height: 12,
              heightReference:
                Cesium.HeightReference?.RELATIVE_TO_GROUND ??
                Cesium.HeightReference?.CLAMP_TO_GROUND,
            },
            polyline: {
              positions: Cesium.Cartesian3.fromDegreesArray(closed.flat()),
              width: selected ? 4.8 : 2.4,
              material: edge,
              clampToGround: true,
            },
          }),
        );
      });
    }

    viewer.scene?.requestRender?.();
  }, [
    activeLayer,
    cells,
    clearEntities,
    commercialZones,
    contextProfiles,
    corridors,
    hoveredZoneCellId,
    ready,
    scope,
    selectedCellId,
  ]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = window.Cesium;
    if (
      !ready ||
      !viewer?.entities ||
      !Cesium ||
      scope !== "citywide" ||
      !citywideZones.length ||
      !commercialProfiles.length ||
      !commercialZones.length
    ) {
      return;
    }

    clearEntities(cellEntitiesRef.current);
    const anchorType = CONTEXT_LAYER_TO_ANCHOR_TYPE[activeLayer];
    const commercialByZone = new Map(
      commercialProfiles.map((profile) => [profile.zoneId, profile]),
    );

    for (const zone of citywideZones) {
      const profile = contextProfiles[zone.properties.zoneId];
      const commercialProfile = commercialByZone.get(zone.properties.zoneId);
      const score =
        activeLayer === "residentPopulation"
          ? profile?.officialZoneSignals?.residentPopulationScore ?? null
          : activeLayer === "workplaceEmployment"
            ? profile?.officialZoneSignals?.workplaceEmploymentScore ?? null
            : activeLayer === "commercialPotential"
            ? commercialProfile?.commercialPotentialScore ?? null
            : anchorType
            ? profile?.scores?.[anchorType] ?? null
            : activeLayer === "commercialDensity"
              ? profile?.businessSignals?.businessDensityScore ?? null
              : activeLayer === "businessDiversity"
                ? profile?.businessSignals?.businessDiversityScore ?? null
                : null;
      const selected = selectedContextZoneId === zone.properties.zoneId;
      const hovered = hoveredZoneCellId === zone.properties.zoneId;
      const hoverActive = hoveredZoneCellId !== null;
      const isCandidate = Boolean(commercialProfile?.isCommercialCandidate);
      const fill = scoreColor(
        Cesium,
        score,
        hovered
          ? 0.28
          : selected
            ? 0.22
            : hoverActive
              ? 0.018
              : isCandidate
                ? 0.065
                : 0.045,
      );
      const border = scoreColor(
        Cesium,
        score,
        hovered ? 0.92 : selected ? 0.82 : hoverActive ? 0.12 : isCandidate ? 0.38 : 0.28,
      );

      corridorRings(zone.geometry).forEach((ring, ringIndex) => {
        if (!ring?.length) return;
        const closed = [...ring];
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
          closed.push(first);
        }

        const positions = Cesium.Cartesian3.fromDegreesArray(closed.flat());
        const entity = viewer.entities.add({
          id: `localtwin-zone-${zone.properties.zoneId}::${ringIndex}`,
          name: `${zone.properties.label} 전역 분석권역`,
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray(closed.flat()),
            material: fill,
            height: 0,
            heightReference: Cesium.HeightReference?.CLAMP_TO_GROUND,
          },
          polyline: {
            positions,
            width: hovered ? 4.5 : selected ? 3.2 : hoverActive ? 0.7 : 1.2,
            material: border,
            clampToGround: true,
          },
        });
        cellEntitiesRef.current.push(entity);
      });

      if (
        !isCandidate &&
        typeof zone.properties.labelLon === "number" &&
        typeof zone.properties.labelLat === "number"
      ) {
        const label = viewer.entities.add({
          id: `localtwin-zone-${zone.properties.zoneId}::label`,
          position: Cesium.Cartesian3.fromDegrees(
            zone.properties.labelLon,
            zone.properties.labelLat,
          ),
          label: {
            text:
              hovered || selected
                ? `${zone.properties.label}\n${score === null ? "데이터 미연결" : Math.round(score) + " / 100"}`
                : zone.properties.label,
            font: hovered || selected ? "bold 14px sans-serif" : "10px sans-serif",
            fillColor: Cesium.Color.WHITE.withAlpha(
              hoverActive && !hovered && !selected ? 0.28 : 0.68,
            ),
            outlineColor: Cesium.Color.fromCssColorString("#071018"),
            outlineWidth: hovered || selected ? 3 : 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            showBackground: hovered || selected,
            backgroundColor: Cesium.Color.fromCssColorString("#071018").withAlpha(0.9),
            backgroundPadding: new Cesium.Cartesian2(8, 6),
            heightReference: Cesium.HeightReference?.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 25_000),
          },
        });
        cellEntitiesRef.current.push(label);
      }
    }

    const candidateZones = commercialZones.filter(
      (zone) => zone.properties.isCommercialCandidate,
    );
    for (const candidate of candidateZones) {
      const selected = selectedContextZoneId === candidate.properties.zoneId;
      const hovered = hoveredZoneCellId === candidate.properties.zoneId;
      const elevationM = selected ? 30 : hovered ? 24 : 18;
      const potential = candidate.properties.commercialPotentialScore;
      const plateFill = scoreColor(
        Cesium,
        potential,
        selected ? 0.38 : hovered ? 0.31 : 0.19,
      );
      const edge = scoreColor(
        Cesium,
        potential,
        selected ? 1 : hovered ? 0.96 : 0.76,
      );

      corridorRings(candidate.geometry).forEach((ring, ringIndex) => {
        if (!ring?.length) return;
        const closed = [...ring];
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
          closed.push(first);
        }

        const entity = viewer.entities.add({
          id: `localtwin-commercial-${candidate.properties.zoneId}::${ringIndex}`,
          name: `${candidate.properties.label} 상권 후보`,
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray(closed.flat()),
            material: plateFill,
            height: elevationM,
            heightReference:
              Cesium.HeightReference?.RELATIVE_TO_GROUND ??
              Cesium.HeightReference?.CLAMP_TO_GROUND,
          },
        });
        cellEntitiesRef.current.push(entity);

        const groundEdge = viewer.entities.add({
          id: `localtwin-commercial-${candidate.properties.zoneId}::edge-${ringIndex}`,
          name: `${candidate.properties.label} 상권 후보 경계`,
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(closed.flat()),
            width: selected ? 5.5 : hovered ? 4.5 : 2.6,
            material:
              (selected || hovered) && Cesium.PolylineGlowMaterialProperty
                ? new Cesium.PolylineGlowMaterialProperty({
                    glowPower: 0.18,
                    taperPower: 0.45,
                    color: edge,
                  })
                : edge,
            clampToGround: true,
          },
        });
        cellEntitiesRef.current.push(groundEdge);
      });

    }

    viewer.scene?.requestRender?.();
  }, [
    activeLayer,
    citywideZones,
    clearEntities,
    commercialProfiles,
    commercialZones,
    contextProfiles,
    hoveredZoneCellId,
    ready,
    scope,
    selectedContextZoneId,
  ]);

  useEffect(() => {
    const anchorType = CONTEXT_LAYER_TO_ANCHOR_TYPE[activeLayer];
    if (!ready || !anchorType) {
      setContextAnchors([]);
      return;
    }

    const cached = contextAnchorCacheRef.current[anchorType];
    if (cached) {
      setContextAnchors(cached);
      return;
    }

    let cancelled = false;
    setContextAnchors([]);

    void fetch("/data/context_anchors/" + anchorType + ".json")
      .then((response) => {
        if (!response.ok) throw new Error("배후시설 데이터를 불러오지 못했습니다.");
        return response.json() as Promise<ContextAnchorDocument>;
      })
      .then((document) => {
        if (cancelled) return;
        const records = document.records ?? [];
        contextAnchorCacheRef.current[anchorType] = records;
        setContextAnchors(records);
      })
      .catch(() => {
        if (!cancelled) setContextAnchors([]);
      });

    return () => {
      cancelled = true;
    };
  }, [activeLayer, ready]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = window.Cesium;
    if (!ready || !viewer?.entities || !Cesium) return;

    clearEntities(contextLayerEntitiesRef.current);
    const anchorType = CONTEXT_LAYER_TO_ANCHOR_TYPE[activeLayer];
    if (!anchorType) {
      viewer.scene?.requestRender?.();
      return;
    }

    const anchorBounds =
      scope === "citywide" ? DAEGU_RENDER_BOUNDS : CENTRAL_SERVICE_BOUNDS;
    const visibleAnchors = contextAnchors
      .filter(
        (anchor) =>
          anchor.anchorType === anchorType &&
          anchor.longitude >= anchorBounds.west &&
          anchor.longitude <= anchorBounds.east &&
          anchor.latitude >= anchorBounds.south &&
          anchor.latitude <= anchorBounds.north,
      )
      .sort(
        (left, right) =>
          (right.confidence ?? 0) - (left.confidence ?? 0) ||
          left.name.localeCompare(right.name, "ko"),
      )
      .slice(0, scope === "citywide" ? 320 : 140);

    for (const anchor of visibleAnchors) {
      const entity = viewer.entities.add({
        id: `context-anchor-${anchor.anchorId}`,
        name: anchor.name,
        position: Cesium.Cartesian3.fromDegrees(anchor.longitude, anchor.latitude),
        point: {
          pixelSize: 7,
          color: Cesium.Color.fromCssColorString("#d7fbf4").withAlpha(0.92),
          outlineColor: Cesium.Color.fromCssColorString("#0f766e"),
          outlineWidth: 2,
          heightReference: Cesium.HeightReference?.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: anchor.name,
          font: "10px sans-serif",
          fillColor: Cesium.Color.fromCssColorString("#e6f6f7"),
          outlineColor: Cesium.Color.fromCssColorString("#071018"),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -15),
          heightReference: Cesium.HeightReference?.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2200),
        },
      });
      contextLayerEntitiesRef.current.push(entity);
    }

    viewer.scene?.requestRender?.();
  }, [activeLayer, clearEntities, contextAnchors, ready, scope]);

  useEffect(() => {
    if (!ready) return;
    hoveredZoneCellIdRef.current = null;
    setHoveredZoneCellId(null);

    const timer = window.setTimeout(() => {
      const viewer = viewerRef.current;
      const Cesium = window.Cesium;
      if (!viewer?.camera || !Cesium) return;

      if (scope === "citywide") {
        const candidatePositions = commercialZones
          .filter((zone) => zone.properties.isCommercialCandidate)
          .map((zone) => {
            const { labelLon, labelLat } = zone.properties;
            if (typeof labelLon !== "number" || typeof labelLat !== "number") return null;
            return Cesium.Cartesian3.fromDegrees(labelLon, labelLat, 0);
          })
          .filter((position): position is any => Boolean(position));

        if (
          candidatePositions.length &&
          Cesium.BoundingSphere?.fromPoints &&
          Cesium.HeadingPitchRange &&
          typeof viewer.camera.flyToBoundingSphere === "function"
        ) {
          const sphere = Cesium.BoundingSphere.fromPoints(candidatePositions);
          viewer.camera.flyToBoundingSphere(sphere, {
            offset: new Cesium.HeadingPitchRange(
              0,
              Cesium.Math.toRadians(-90),
              Math.max(sphere.radius * 2.7, 13_000),
            ),
            duration: 0.8,
          });
        } else {
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(
              DAEGU_CENTER[0],
              DAEGU_CENTER[1],
              18_000,
            ),
            orientation: {
              heading: 0,
              pitch: Cesium.Math.toRadians(-90),
              roll: 0,
            },
            duration: 0.8,
          });
        }
      } else {
        const target = Cesium.Cartesian3.fromDegrees(
          DAEGU_CENTER[0],
          DAEGU_CENTER[1],
          0,
        );
        if (
          typeof viewer.camera.flyToBoundingSphere === "function" &&
          Cesium.BoundingSphere &&
          Cesium.HeadingPitchRange
        ) {
          viewer.camera.flyToBoundingSphere(
            new Cesium.BoundingSphere(target, 35),
            {
              offset: new Cesium.HeadingPitchRange(
                0,
                Cesium.Math.toRadians(-52),
                3_000,
              ),
              duration: 0.6,
            },
          );
        } else {
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(
              DAEGU_CENTER[0],
              DAEGU_CENTER[1],
              3_000,
            ),
            orientation: {
              heading: 0,
              pitch: Cesium.Math.toRadians(-90),
              roll: 0,
            },
            duration: 0.6,
          });
        }
      }
      viewer.scene?.requestRender?.();
    }, 220);
    return () => window.clearTimeout(timer);
  }, [commercialZones, ready, scope]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = window.Cesium;
    if (
      !ready ||
      scope !== "citywide" ||
      !selectedContextZoneId ||
      !viewer?.camera ||
      !Cesium
    ) {
      return;
    }

    if (initialContextSelectionRef.current) {
      initialContextSelectionRef.current = false;
      return;
    }

    const commercialZone = commercialZones.find(
      (zone) => zone.properties.zoneId === selectedContextZoneId,
    );
    const localityZone = citywideZones.find(
      (zone) => zone.properties.zoneId === selectedContextZoneId,
    );
    const properties = commercialZone?.properties ?? localityZone?.properties;
    if (
      !properties ||
      typeof properties.labelLon !== "number" ||
      typeof properties.labelLat !== "number"
    ) {
      return;
    }

    const isCandidate = Boolean(commercialZone?.properties.isCommercialCandidate);
    const isPreciseCorridor =
      commercialZone?.properties.zoneKind === "commercial_corridor";
    const target = Cesium.Cartesian3.fromDegrees(
      properties.labelLon,
      properties.labelLat,
      0,
    );

    if (
      typeof viewer.camera.flyToBoundingSphere === "function" &&
      Cesium.BoundingSphere &&
      Cesium.HeadingPitchRange
    ) {
      viewer.camera.flyToBoundingSphere(
        new Cesium.BoundingSphere(target, 45),
        {
          offset: new Cesium.HeadingPitchRange(
            viewer.camera.heading,
            Cesium.Math.toRadians(isCandidate ? -58 : -70),
            isPreciseCorridor ? 4_500 : isCandidate ? 6_500 : 9_000,
          ),
          duration: 0.7,
        },
      );
    } else {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          properties.labelLon,
          properties.labelLat,
          isPreciseCorridor ? 4_500 : isCandidate ? 6_500 : 9_000,
        ),
        orientation: {
          heading: viewer.camera.heading,
          pitch: Cesium.Math.toRadians(-90),
          roll: 0,
        },
        duration: 0.7,
      });
    }
    viewer.scene?.requestRender?.();
  }, [
    citywideZones,
    commercialZones,
    ready,
    scope,
    selectedContextZoneId,
  ]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = window.Cesium;
    const container = containerRef.current;
    if (
      !ready ||
      !viewer?.scene ||
      !Cesium ||
      !container ||
      !commercialZones.length
    ) {
      setCandidateOverlayPoints([]);
      return;
    }

    let frame: number | null = null;
    const updateOverlay = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const canvas = viewer.scene?.canvas;
        if (!canvas || !containerRef.current) return;

        const canvasRect = canvas.getBoundingClientRect();
        const containerRect = containerRef.current.getBoundingClientRect();
        const next = commercialZones
          .filter((zone) => zone.properties.isCommercialCandidate)
          .filter((zone) => {
            if (scope === "citywide") return true;
            if (zone.properties.zoneKind !== "commercial_corridor") return false;
            const { labelLon, labelLat } = zone.properties;
            return (
              typeof labelLon === "number" &&
              typeof labelLat === "number" &&
              labelLon >= CENTRAL_SERVICE_BOUNDS.west &&
              labelLon <= CENTRAL_SERVICE_BOUNDS.east &&
              labelLat >= CENTRAL_SERVICE_BOUNDS.south &&
              labelLat <= CENTRAL_SERVICE_BOUNDS.north
            );
          })
          .map((zone) => {
            const { labelLon, labelLat } = zone.properties;
            if (typeof labelLon !== "number" || typeof labelLat !== "number") {
              return null;
            }
            const world = Cesium.Cartesian3.fromDegrees(labelLon, labelLat, 40);
            const screen = Cesium.SceneTransforms.wgs84ToWindowCoordinates(
              viewer.scene,
              world,
            );
            if (!screen) return null;
            if (
              screen.x < -16 ||
              screen.y < -16 ||
              screen.x > canvas.clientWidth + 16 ||
              screen.y > canvas.clientHeight + 16
            ) {
              return null;
            }
            return {
              zoneId: zone.properties.zoneId,
              label: zone.properties.label,
              zoneKind: zone.properties.zoneKind,
              score: zone.properties.commercialPotentialScore,
              rank: zone.properties.candidateRank,
              memberCellIds: zone.properties.memberCellIds,
              x: canvasRect.left - containerRect.left + screen.x,
              y: canvasRect.top - containerRect.top + screen.y,
            } satisfies CandidateOverlayPoint;
          })
          .filter(
            (point): point is CandidateOverlayPoint => point !== null,
          );

        setCandidateOverlayPoints(next);
      });
    };

    viewer.scene.postRender.addEventListener(updateOverlay);
    viewer.scene.requestRender?.();
    updateOverlay();

    const settleTimers = [350, 1_000].map((delay) =>
      window.setTimeout(() => {
        viewer.scene?.requestRender?.();
        updateOverlay();
      }, delay),
    );

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      settleTimers.forEach((timer) => window.clearTimeout(timer));
      viewer.scene?.postRender?.removeEventListener?.(updateOverlay);
      setCandidateOverlayPoints([]);
    };
  }, [commercialZones, ready, scope]);

  useEffect(() => {
    if (!ready || !containerRef.current) return;
    const observer = new ResizeObserver(() => {
      mapRef.current?.updateSize?.();
      viewerRef.current?.resize?.();
      viewerRef.current?.scene?.requestRender?.();
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [ready]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = window.Cesium;
    if (
      !ready ||
      !viewer?.camera ||
      !Cesium ||
      !selectedCell ||
      scope !== "central"
    ) {
      return;
    }

    if (initialSelectionRef.current) {
      initialSelectionRef.current = false;
      return;
    }

    const selectedCorridor = corridors.find((zone) =>
      zone.properties.memberCellIds.includes(selectedCell.cellId),
    );
    const [targetLon, targetLat] = selectedCorridor
      ? zoneCenter(selectedCorridor, cells)
      : [selectedCell.center.lon, selectedCell.center.lat];

    const target = Cesium.Cartesian3.fromDegrees(targetLon, targetLat, 0);
    if (
      typeof viewer.camera.flyToBoundingSphere === "function" &&
      Cesium.BoundingSphere &&
      Cesium.HeadingPitchRange
    ) {
      viewer.camera.flyToBoundingSphere(
        new Cesium.BoundingSphere(target, 35),
        {
          offset: new Cesium.HeadingPitchRange(
            viewer.camera.heading,
            viewer.camera.pitch,
            1_100,
          ),
          duration: 0.65,
        },
      );
      return;
    }

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(targetLon, targetLat, 1_100),
      orientation: {
        heading: viewer.camera.heading,
        pitch: Cesium.Math.toRadians(-90),
        roll: 0,
      },
      duration: 0.65,
    });
  }, [cells, corridors, ready, scope, selectedCell]);

  const visibleCandidateLabelIds = useMemo(() => {
    const boxes = candidateOverlayPoints.flatMap((point) => {
      const selected =
        scope === "citywide"
          ? selectedContextZoneId === point.zoneId
          : point.memberCellIds?.includes(selectedCellId ?? "") ?? false;
      const topCandidate =
        scope === "citywide"
          ? point.zoneKind === "locality" &&
            (point.rank ?? Number.POSITIVE_INFINITY) <= 5
          : point.zoneKind === "commercial_corridor" &&
            (point.rank ?? Number.POSITIVE_INFINITY) <= 3;
      if (!selected && !topCandidate) return [];

      const compact = !selected;
      const labelWidth = compact
        ? 76
        : Math.min(150, Math.max(92, point.label.length * 11 + 54));
      const totalWidth = labelWidth + 30;
      const totalHeight = 34;
      const padding = scope === "central" ? 12 : 8;

      return [
        {
          zoneId: point.zoneId,
          priority: selected ? 10_000 : 1_000 - (point.rank ?? 999),
          left: point.x - totalWidth / 2 - padding,
          right: point.x + totalWidth / 2 + padding,
          top: point.y - totalHeight / 2 - padding,
          bottom: point.y + totalHeight / 2 + padding,
        },
      ];
    });
    return resolveCandidateLabelCollisions(boxes);
  }, [
    candidateOverlayPoints,
    scope,
    selectedCellId,
    selectedContextZoneId,
  ]);

  return (
    <div
      className="relative h-full min-h-[520px] overflow-hidden rounded-2xl bg-[#071018]"
      data-testid="spatial-map"
      data-map-engine="vworld"
      data-buildings={buildingsReady ? "facility_build" : "unavailable"}
      data-spatial-focus={scope === "citywide" ? "daegu-citywide" : "daegu-central"}
      data-camera-controls="free"
      data-citywide-camera={scope === "citywide" ? "candidate-bounds" : ""}
      data-hovered-zone={hoveredZoneCellId ?? ""}
    >
      <div ref={containerRef} id={containerId} className="absolute inset-0 h-full w-full" />
      {ready && candidateOverlayPoints.length ? (
        <>
          <div
            className="pointer-events-none absolute inset-0 z-[9]"
            data-testid={scope === "citywide" ? "citywide-candidate-overlay" : "central-candidate-overlay"}
            data-candidate-count={candidateOverlayPoints.length}
          >
            {candidateOverlayPoints.map((point) => {
              const selected =
                scope === "citywide"
                  ? selectedContextZoneId === point.zoneId
                  : point.memberCellIds?.includes(selectedCellId ?? "") ?? false;
              const topCandidate =
                scope === "citywide"
                  ? point.zoneKind === "locality" &&
                    (point.rank ?? Number.POSITIVE_INFINITY) <= 5
                  : point.zoneKind === "commercial_corridor" &&
                    (point.rank ?? Number.POSITIVE_INFINITY) <= 3;
              const showLabel =
                (selected || topCandidate) &&
                visibleCandidateLabelIds.has(point.zoneId);

              return (
                <button
                  key={point.zoneId}
                  type="button"
                  className={[
                    "pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 border-0 bg-transparent p-0 text-inherit transition duration-200 hover:scale-105 focus-visible:scale-105 focus-visible:outline-none",
                    selected ? "z-[4] scale-105 brightness-110" : "",
                  ].join(" ")}
                  data-selected={selected ? "true" : "false"}
                  style={{ left: point.x, top: point.y }}
                  aria-label={point.label + " 상권 후보"}
                  title={
                    point.label +
                    " · 상권잠재 " +
                    Math.round(point.score) +
                    " / 100"
                  }
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (scope === "citywide") {
                      onContextSelect?.(point.zoneId);
                    } else if (point.memberCellIds?.[0]) {
                      onSelect(point.memberCellIds[0]);
                    }
                  }}
                >
                  <span
                    className={[
                      "citywide-candidate-pulse-core relative block shrink-0 rounded-full border-2 border-emerald-50 bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.62)]",
                      selected
                        ? "h-[19px] w-[19px] bg-teal-400 shadow-[0_0_32px_rgba(45,212,191,0.95)]"
                        : topCandidate
                          ? "h-4 w-4 bg-emerald-300 shadow-[0_0_24px_rgba(52,211,153,0.8)]"
                          : "h-[13px] w-[13px]",
                    ].join(" ")}
                  />
                  {showLabel ? (
                    <span
                      className="flex max-w-32 items-center gap-1 whitespace-nowrap rounded-full border border-white/10 bg-slate-950/82 px-2 py-1 text-[9px] leading-none text-slate-200 opacity-100 shadow-lg backdrop-blur-md transition"
                      data-testid="citywide-candidate-label"
                      data-collision-resolved="true"
                      data-label-mode={selected ? "selected" : "rank"}
                    >
                      {selected ? (
                        <span className="truncate">{point.label}</span>
                      ) : (
                        <span className="text-slate-400">#{point.rank}</span>
                      )}
                      <strong className="text-[9px] text-emerald-200">
                        {Math.round(point.score)}
                      </strong>
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-xl border border-emerald-300/12 bg-slate-950/78 px-3 py-2 text-[10px] leading-4 text-slate-300 backdrop-blur-md">
            <div className="flex items-center gap-2 font-semibold text-white">
              <span className="citywide-candidate-legend-dot relative inline-block h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.72)]" />
              상권 후보 {candidateOverlayPoints.length}곳
            </div>
            <div className="mt-0.5 text-[9px] text-slate-500">
              {scope === "citywide"
                ? "pulse marker는 후보 위치 · 클릭하면 분석/카메라 이동"
                : "전역과 같은 후보 경계/순위 표현 · corridor 클릭 시 후보 선택"}
            </div>
          </div>
        </>
      ) : null}
      {!ready ? (
        <div className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/82 px-3 py-1.5 text-[11px] text-slate-100 backdrop-blur">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300" />
          3D 지도를 불러오는 중
        </div>
      ) : null}
      <div className="absolute bottom-3 left-3 z-10 max-w-[88%] rounded-lg border border-white/10 bg-slate-950/82 px-3 py-2 text-[10px] leading-4 text-slate-300 backdrop-blur">
        <div className="font-semibold text-white">
          {LAYER_LABELS[activeLayer]} 시각화 · 진한 색일수록 신호 높음
        </div>
        <div>
          {scope === "citywide"
            ? "띄워진 상권후보를 우선 클릭해 전역 상권분석을 확인합니다 · 일반 권역은 SGIS 행정동 분석단위 · 대구 외곽은 시각적으로 낮춰 표시 · "
            : "전역과 같은 상권후보 경계를 겹쳐 표시하고 corridor를 클릭하면 후보가 선택됩니다 · 분석권역은 공식 상권 경계가 아님 · "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
            className="pointer-events-auto text-slate-200 underline underline-offset-2"
          >
            © OpenStreetMap contributors
          </a>
        </div>
      </div>
    </div>
  );
}
