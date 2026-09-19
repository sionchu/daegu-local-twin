"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { startVWorld, disposeVWorld } from "@/lib/vworld-client";
import { computeOpportunityScores } from "@/src/model";
import type { LocationEvidence, MapLayer } from "@/src/types";

const DAEGU_CENTER: [number, number] = [128.5967, 35.8714];

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

type BuildingGeometry = {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
};

type BuildingFeature = {
  properties?: { heightM?: number; source?: string };
  geometry: BuildingGeometry;
};

type BuildingCollection = {
  features?: BuildingFeature[];
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
  if (t < 0.5) {
    return Cesium.Color.fromCssColorString("#46cbbb").withAlpha(alpha);
  }
  return Cesium.Color.fromCssColorString("#f4b860").withAlpha(alpha);
}

function closedDegrees(cell: LocationEvidence) {
  const points = cell.boundary.map((point) => [point.lon, point.lat]);
  if (points.length) points.push(points[0]);
  return points.flat();
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

function buildingOuterRings(geometry: BuildingGeometry) {
  return geometry.type === "Polygon"
    ? [(geometry.coordinates as number[][][])[0]]
    : (geometry.coordinates as number[][][][]).map((polygon) => polygon[0]);
}

function ringCenter(ring: number[][]) {
  if (!ring.length) return DAEGU_CENTER;
  const sum = ring.reduce(
    (acc, point) => [acc[0] + point[0], acc[1] + point[1]],
    [0, 0],
  );
  return [sum[0] / ring.length, sum[1] / ring.length] as [number, number];
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
  const initialSelectionRef = useRef(true);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("VWorld 3D 연결 중");
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
          if (viewer.scene.globe) viewer.scene.globe.enableLighting = true;
          viewer.scene.fxaa = true;
        }
        if (viewer.clock) viewer.clock.shouldAnimate = false;
        viewer.shadows = false;

        const Cesium = window.Cesium;
        const nativeBuildingLayer = map.getLayerElement?.("facility_build");
        nativeBuildingLayer?.show?.();
        const hasNativeBuildingLayer = Boolean(nativeBuildingLayer);

        const [adminResponse, transitResponse, buildingsResponse] = await Promise.all([
          fetch("/data/admin_dong_boundaries.geojson"),
          fetch("/data/transit_station_locations.json"),
          hasNativeBuildingLayer
            ? Promise.resolve(null)
            : fetch(
                `/api/buildings?lon=${DAEGU_CENTER[0]}&lat=${DAEGU_CENTER[1]}&radius=650`,
              ).catch(() => null),
        ]);
        const admin = (await adminResponse.json()) as AdminBoundaryCollection;
        const transit = (await transitResponse.json()) as TransitSnapshot;
        const buildings = buildingsResponse?.ok
          ? ((await buildingsResponse.json()) as BuildingCollection)
          : { features: [] };

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

        let buildingCount = 0;
        viewer.entities.suspendEvents?.();
        try {
          for (const [featureIndex, feature] of (buildings.features ?? []).slice(0, 420).entries()) {
            const heightM = clamp(Number(feature.properties?.heightM ?? 9), 3, 180);
            for (const [ringIndex, ring] of buildingOuterRings(feature.geometry).entries()) {
              if (!ring || ring.length < 4) continue;
              const coordinates = ring.flat();
              const building = viewer.entities.add({
                id: `localtwin-building-${featureIndex}-${ringIndex}`,
                name: "주변 건물",
                polygon: {
                  hierarchy: Cesium.Cartesian3.fromDegreesArray(coordinates),
                  height: 0,
                  extrudedHeight: heightM,
                  material: Cesium.Color.fromCssColorString("#91a0ad").withAlpha(0.34),
                  outline: false,
                  heightReference: Cesium.HeightReference?.CLAMP_TO_GROUND,
                  extrudedHeightReference: Cesium.HeightReference?.RELATIVE_TO_GROUND,
                  distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3500),
                },
                properties: {
                  kind: "context-building",
                  source: feature.properties?.source ?? "building-footprint",
                },
              });
              contextEntitiesRef.current.push(building);
              buildingCount += 1;
            }
          }
        } finally {
          viewer.entities.resumeEvents?.();
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
        setStatus(
          hasNativeBuildingLayer
            ? "VWorld 3D · VWorld 건물"
            : buildingCount > 0
              ? `VWorld 3D · 주변건물 ${buildingCount.toLocaleString()}동`
              : "VWorld 3D · Cesium",
        );
        viewer.scene?.requestRender?.();
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        setStatus("VWorld 연결 불가 · 경량 지도 전환");
        onUnavailable(reason);
      }
    })();

    return () => {
      cancelled = true;
      clickCleanupRef.current?.();
      clearEntities(cellEntitiesRef.current);
      clearEntities(contextEntitiesRef.current);
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

    for (const cell of cells) {
      const selected = cell.cellId === selectedCellId;
      const score = scoreForLayer(cell, cells, activeLayer);
      const color = scoreColor(Cesium, score, selected ? 0.26 : 0.10);
      const accent = scoreColor(Cesium, score, selected ? 0.92 : 0.52);
      const haloRadius = 95 + clamp(Number(score ?? 0), 0, 100) * 1.25;

      const entity = viewer.entities.add({
        id: `localtwin-cell-${cell.cellId}`,
        name: cell.label,
        position: Cesium.Cartesian3.fromDegrees(cell.center.lon, cell.center.lat),
        polygon: {
          hierarchy: Cesium.Cartesian3.fromDegreesArray(closedDegrees(cell)),
          material: color,
          outline: false,
          heightReference: Cesium.HeightReference?.CLAMP_TO_GROUND,
        },
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(closedDegrees(cell)),
          width: selected ? 2.5 : 1,
          material: accent,
          clampToGround: true,
        },
        ellipse: {
          semiMajorAxis: selected ? haloRadius * 1.18 : haloRadius,
          semiMinorAxis: selected ? haloRadius * 1.18 : haloRadius,
          material: scoreColor(Cesium, score, selected ? 0.16 : 0.055),
          heightReference: Cesium.HeightReference?.CLAMP_TO_GROUND,
        },
        point: {
          pixelSize: selected ? 13 : 8,
          color: accent,
          outlineColor: Cesium.Color.fromCssColorString("#071018"),
          outlineWidth: 2,
          heightReference: Cesium.HeightReference?.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: `${cell.label}\n${score === null ? "데이터 부족" : Math.round(score)}`,
          font: selected ? "bold 15px sans-serif" : "12px sans-serif",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.fromCssColorString("#071018"),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString("#071018").withAlpha(
            selected ? 0.88 : 0.72,
          ),
          backgroundPadding: new Cesium.Cartesian2(7, 5),
          pixelOffset: new Cesium.Cartesian2(0, -24),
          heightReference: Cesium.HeightReference?.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 6500),
        },
      });
      cellEntitiesRef.current.push(entity);
    }

    viewer.scene?.requestRender?.();
  }, [activeLayer, cells, clearEntities, ready, selectedCellId]);

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
          2600,
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
    >
      <div ref={containerRef} id={containerId} className="absolute inset-0 h-full w-full" />
      <div className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/82 px-3 py-1.5 text-[11px] text-slate-100 backdrop-blur">
        <span
          className={
            "h-1.5 w-1.5 rounded-full " +
            (ready ? "bg-emerald-300" : "animate-pulse bg-amber-300")
          }
        />
        {status}
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[85%] rounded-lg border border-white/10 bg-slate-950/78 px-2.5 py-1.5 text-[10px] leading-4 text-slate-300 backdrop-blur">
        실선 = 공식 행정동 경계 · 반투명 영역 = 분석 셀(실제 상권 경계 아님) · 회색 건물 = 주변 건물 footprint · 역 = 공간참조 anchor
      </div>
    </div>
  );
}
