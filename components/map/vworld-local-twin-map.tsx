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

const CENTRAL_SERVICE_BOUNDS = {
  west: 128.565,
  south: 35.852,
  east: 128.615,
  north: 35.892,
};

const MIN_CAMERA_HEIGHT_M = 220;
const MAX_CAMERA_HEIGHT_M = 16_000;

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
    boundaryMeaning?: string;
    sourceProvider?: string;
  };
  geometry: CorridorGeometry;
};

type CorridorCollection = {
  features: CorridorFeature[];
};

type Props = {
  cells: LocationEvidence[];
  selectedCellId?: string;
  activeLayer: MapLayer;
  onSelect: (cellId: string) => void;
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
};

function corridorRings(geometry: CorridorGeometry) {
  return geometry.type === "Polygon"
    ? [(geometry.coordinates as number[][][])[0]]
    : (geometry.coordinates as number[][][][]).map((polygon) => polygon[0]);
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

function configureSpatialLimits(viewer: any, Cesium: any) {
  const globe = viewer.scene?.globe;
  const controller = viewer.scene?.screenSpaceCameraController;
  const camera = viewer.camera;

  if (globe?.cartographicLimitRectangle !== undefined) {
    globe.cartographicLimitRectangle = Cesium.Rectangle.fromDegrees(
      DAEGU_RENDER_BOUNDS.west,
      DAEGU_RENDER_BOUNDS.south,
      DAEGU_RENDER_BOUNDS.east,
      DAEGU_RENDER_BOUNDS.north,
    );
  }

  if (controller) {
    controller.minimumZoomDistance = MIN_CAMERA_HEIGHT_M;
    controller.maximumZoomDistance = MAX_CAMERA_HEIGHT_M;
  }

  if (!camera?.positionCartographic) return () => undefined;

  camera.percentageChanged = 0.025;
  let adjusting = false;
  const clampCamera = () => {
    if (adjusting || !camera.positionCartographic) return;
    const cartographic = camera.positionCartographic;
    const lon = Cesium.Math.toDegrees(cartographic.longitude);
    const lat = Cesium.Math.toDegrees(cartographic.latitude);
    const height = cartographic.height;
    const nextLon = clamp(
      lon,
      CENTRAL_SERVICE_BOUNDS.west,
      CENTRAL_SERVICE_BOUNDS.east,
    );
    const nextLat = clamp(
      lat,
      CENTRAL_SERVICE_BOUNDS.south,
      CENTRAL_SERVICE_BOUNDS.north,
    );
    const nextHeight = clamp(
      height,
      MIN_CAMERA_HEIGHT_M,
      MAX_CAMERA_HEIGHT_M,
    );

    if (
      Math.abs(nextLon - lon) < 0.00001 &&
      Math.abs(nextLat - lat) < 0.00001 &&
      Math.abs(nextHeight - height) < 1
    ) {
      return;
    }

    adjusting = true;
    camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(nextLon, nextLat, nextHeight),
      orientation: {
        heading: camera.heading,
        pitch: camera.pitch,
        roll: camera.roll,
      },
    });
    viewer.scene?.requestRender?.();
    window.setTimeout(() => {
      adjusting = false;
    }, 0);
  };

  const removeChanged = camera.changed?.addEventListener?.(clampCamera);
  const removeMoveEnd = camera.moveEnd?.addEventListener?.(clampCamera);
  clampCamera();

  return () => {
    if (typeof removeChanged === "function") removeChanged();
    if (typeof removeMoveEnd === "function") removeMoveEnd();
  };
}

function addDaeguBoundaryMask(
  viewer: any,
  Cesium: any,
  geometry: AdminGeometry | undefined,
) {
  if (!geometry) return [];
  const rings = displayRings(geometry).filter((ring) => ring.length >= 3);
  if (!rings.length) return [];

  const outer = [
    [DAEGU_RENDER_BOUNDS.west, DAEGU_RENDER_BOUNDS.south],
    [DAEGU_RENDER_BOUNDS.east, DAEGU_RENDER_BOUNDS.south],
    [DAEGU_RENDER_BOUNDS.east, DAEGU_RENDER_BOUNDS.north],
    [DAEGU_RENDER_BOUNDS.west, DAEGU_RENDER_BOUNDS.north],
    [DAEGU_RENDER_BOUNDS.west, DAEGU_RENDER_BOUNDS.south],
  ];
  const hierarchy = new Cesium.PolygonHierarchy(
    Cesium.Cartesian3.fromDegreesArray(outer.flat()),
    rings.map(
      (ring) =>
        new Cesium.PolygonHierarchy(
          Cesium.Cartesian3.fromDegreesArray(ring.flat()),
        ),
    ),
  );

  const mask = viewer.entities.add({
    name: "대구 행정경계 외곽 마스크",
    polygon: {
      hierarchy,
      material: Cesium.Color.fromCssColorString("#03070b").withAlpha(0.62),
      heightReference: Cesium.HeightReference?.CLAMP_TO_GROUND,
    },
  });

  const boundaries = rings.map((ring) =>
    viewer.entities.add({
      name: "대구광역시 경계",
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(ring.flat()),
        width: 2,
        material: Cesium.Color.fromCssColorString("#dbe7ea").withAlpha(0.42),
        clampToGround: true,
      },
    }),
  );

  return [mask, ...boundaries];
}

export default function VWorldLocalTwinMap({
  cells,
  selectedCellId,
  activeLayer,
  onSelect,
  onUnavailable,
}: Props) {
  const viewerRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contextEntitiesRef = useRef<any[]>([]);
  const cellEntitiesRef = useRef<any[]>([]);
  const clickCleanupRef = useRef<(() => void) | null>(null);
  const spatialLimitCleanupRef = useRef<(() => void) | null>(null);
  const initialSelectionRef = useRef(true);
  const [ready, setReady] = useState(false);
  const [buildingsReady, setBuildingsReady] = useState(false);
  const [corridors, setCorridors] = useState<CorridorFeature[]>([]);
  const containerId = "localtwin-vworld-map";

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
        spatialLimitCleanupRef.current = configureSpatialLimits(viewer, Cesium);

        const [adminResponse, transitResponse, corridorResponse, daeguResponse] =
          await Promise.all([
            fetch("/data/admin_dong_boundaries.geojson"),
            fetch("/data/transit_station_locations.json"),
            fetch("/data/corridor_zones.geojson"),
            fetch("/data/daegu_boundary.geojson"),
          ]);
        const admin = (await adminResponse.json()) as AdminBoundaryCollection;
        const transit = (await transitResponse.json()) as TransitSnapshot;
        const corridorData = (await corridorResponse.json()) as CorridorCollection;
        const daeguBoundary = (await daeguResponse.json()) as AdminBoundaryCollection;
        setCorridors(corridorData.features ?? []);

        const maskEntities = addDaeguBoundaryMask(
          viewer,
          Cesium,
          daeguBoundary.features?.[0]?.geometry,
        );
        contextEntitiesRef.current.push(...maskEntities);

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
        const originalClick = handler?.getInputAction?.(clickType);
        const callback = (movement: any) => {
          const picked = viewer.scene?.pick?.(movement.position);
          const entityId = picked?.id?.id;
          if (typeof entityId === "string" && entityId.startsWith("localtwin-cell-")) {
            onSelect(entityId.slice("localtwin-cell-".length));
          } else if (typeof entityId === "string" && entityId.startsWith("localtwin-zone-")) {
            const primaryCellId = entityId
              .slice("localtwin-zone-".length)
              .split("::")[0];
            if (primaryCellId) onSelect(primaryCellId);
          } else if (typeof originalClick === "function") {
            originalClick(movement);
          }
        };
        handler?.setInputAction?.(callback, clickType);
        clickCleanupRef.current = () => {
          if (!handler) return;
          if (typeof originalClick === "function") handler.setInputAction(originalClick, clickType);
          else handler.removeInputAction(clickType);
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
      spatialLimitCleanupRef.current?.();
      spatialLimitCleanupRef.current = null;
      clearEntities(cellEntitiesRef.current);
      clearEntities(contextEntitiesRef.current);
      setBuildingsReady(false);
      disposeVWorld(viewerRef.current);
      viewerRef.current = null;
      mapRef.current = null;
    };
  }, [clearEntities, onSelect, onUnavailable]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = window.Cesium;
    if (!ready || !viewer?.entities || !Cesium) return;

    clearEntities(cellEntitiesRef.current);

    for (const zone of corridors) {
      const memberCells = zone.properties.memberCellIds
        .map((cellId) => cells.find((cell) => cell.cellId === cellId))
        .filter((cell): cell is LocationEvidence => Boolean(cell));
      if (!memberCells.length) continue;

      const selected = memberCells.some((cell) => cell.cellId === selectedCellId);
      const score = zoneScore(zone, cells, activeLayer);
      const fill = scoreColor(Cesium, score, selected ? 0.30 : 0.17);
      const border = scoreColor(Cesium, score, selected ? 1 : 0.82);
      const primaryCellId = memberCells[0].cellId;

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
            width: selected ? 5 : 3,
            material: border,
            clampToGround: true,
          },
        });
        cellEntitiesRef.current.push(entity);
      });

      const [zoneLon, zoneLat] = zoneCenter(zone, cells);
      const zoneLabel = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(zoneLon, zoneLat),
        label: {
          text: `${zone.properties.label}\n${score === null ? "데이터 부족" : Math.round(score) + " / 100"}`,
          font: selected ? "bold 16px sans-serif" : "bold 13px sans-serif",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.fromCssColorString("#071018"),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString("#071018").withAlpha(
            selected ? 0.88 : 0.70,
          ),
          backgroundPadding: new Cesium.Cartesian2(8, 6),
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
        label: selected
          ? {
              text: cell.label,
              font: "11px sans-serif",
              fillColor: Cesium.Color.WHITE,
              outlineColor: Cesium.Color.fromCssColorString("#071018"),
              outlineWidth: 3,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              pixelOffset: new Cesium.Cartesian2(0, -18),
              heightReference: Cesium.HeightReference?.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            }
          : undefined,
      });
      cellEntitiesRef.current.push(point);
    }

    viewer.scene?.requestRender?.();
  }, [activeLayer, cells, clearEntities, corridors, ready, selectedCellId]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      const viewer = viewerRef.current;
      const Cesium = window.Cesium;
      if (!viewer?.camera || !Cesium) return;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          DAEGU_CENTER[0],
          DAEGU_CENTER[1],
          1500,
        ),
        orientation: {
          heading: 0,
          pitch: Cesium.Math.toRadians(-52),
          roll: 0,
        },
        duration: 0.6,
      });
      viewer.scene?.requestRender?.();
    }, 650);
    return () => window.clearTimeout(timer);
  }, [ready]);

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
    if (!ready || !viewer?.camera || !Cesium || !selectedCell) return;

    if (initialSelectionRef.current) {
      initialSelectionRef.current = false;
      return;
    }

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        selectedCell.center.lon,
        selectedCell.center.lat,
        720,
      ),
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-52),
        roll: 0,
      },
      duration: 0.75,
    });
  }, [ready, selectedCell]);

  return (
    <div
      className="relative h-full min-h-[520px] overflow-hidden rounded-2xl bg-[#071018]"
      data-testid="spatial-map"
      data-map-engine="vworld"
      data-buildings={buildingsReady ? "facility_build" : "unavailable"}
      data-spatial-limited="daegu-central"
    >
      <div ref={containerRef} id={containerId} className="absolute inset-0 h-full w-full" />
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
          상권권역 = 실제 도로·시장 기반 분석영역 · 공식 상권 경계 아님 · 대구 밖 지도 제한 ·{" "}
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
