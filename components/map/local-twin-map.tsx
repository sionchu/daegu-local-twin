"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";
import { MapLibreOverlay } from "@deck.gl/maplibre";
import { buffer, point } from "@turf/turf";
import * as maplibregl from "maplibre-gl";

import { computeOpportunityScores } from "@/src/model";
import type { LocationEvidence, MapLayer } from "@/src/types";

const DAEGU_CENTER: [number, number] = [128.5967, 35.8714];
const DEFAULT_STYLE =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/bright";
const DEM_TILEJSON_URL = process.env.NEXT_PUBLIC_DEM_TILEJSON_URL;
const DEFAULT_DEM_TILE_URL =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

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
  if (layer === "regeneration") return cell.regenerationScore;
  return null;
}

function mix(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * t);
}

function scoreColor(score: number | null, selected: boolean) {
  if (score === null) return [54, 67, 79, selected ? 235 : 180] as [number, number, number, number];
  const t = clamp(score / 100, 0, 1);
  const low = [45, 63, 79];
  const mid = [70, 203, 188];
  const high = [244, 184, 96];
  const from = t < 0.5 ? low : mid;
  const to = t < 0.5 ? mid : high;
  const local = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  return [
    mix(from[0], to[0], local),
    mix(from[1], to[1], local),
    mix(from[2], to[2], local),
    selected ? 245 : 205,
  ] as [number, number, number, number];
}

function cellsToGeoJson(
  cells: LocationEvidence[],
  activeLayer: MapLayer,
  selectedCellId?: string,
) {
  return {
    type: "FeatureCollection" as const,
    features: cells.map((cell) => {
      const coordinates = cell.boundary.map((item) => [item.lon, item.lat]);
      if (
        coordinates.length &&
        (coordinates[0][0] !== coordinates[coordinates.length - 1][0] ||
          coordinates[0][1] !== coordinates[coordinates.length - 1][1])
      ) {
        coordinates.push([...coordinates[0]]);
      }
      return {
        type: "Feature" as const,
        properties: {
          cellId: cell.cellId,
          label: cell.label,
          score: scoreForLayer(cell, cells, activeLayer),
          selected: cell.cellId === selectedCellId,
        },
        geometry: {
          type: "Polygon" as const,
          coordinates: [coordinates],
        },
      };
    }),
  };
}

export default function LocalTwinMap({
  cells,
  selectedCellId,
  activeLayer,
  showTerrain,
  showBuildings,
  showExtrusion,
  onSelect,
}: {
  cells: LocationEvidence[];
  selectedCellId?: string;
  activeLayer: MapLayer;
  showTerrain: boolean;
  showBuildings: boolean;
  showExtrusion: boolean;
  onSelect: (cellId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapLibreOverlay | null>(null);
  const [ready, setReady] = useState(false);
  const [mapMessage, setMapMessage] = useState("3D 지도 로딩 중");

  const selectedCell = useMemo(
    () => cells.find((cell) => cell.cellId === selectedCellId),
    [cells, selectedCellId],
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DEFAULT_STYLE,
      center: DAEGU_CENTER,
      zoom: 14.2,
      pitch: 55,
      bearing: -18,
      maxPitch: 78,
      canvasContextAttributes: { antialias: true },
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

    const overlay = new MapLibreOverlay({
      interleaved: true,
      layers: [],
    });
    map.addControl(overlay);

    mapRef.current = map;
    overlayRef.current = overlay;

    map.on("load", () => {
      try {
        if (!map.getSource("localtwin-dem")) {
          map.addSource(
            "localtwin-dem",
            DEM_TILEJSON_URL
              ? {
                  type: "raster-dem",
                  url: DEM_TILEJSON_URL,
                  tileSize: 256,
                }
              : {
                  type: "raster-dem",
                  tiles: [DEFAULT_DEM_TILE_URL],
                  tileSize: 256,
                  minzoom: 1,
                  maxzoom: 15,
                  encoding: "terrarium",
                  attribution:
                    '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Terrain Tiles · Mapzen/Tilezen</a>',
                },
          );
        }

        const symbolLayer = map
          .getStyle()
          .layers?.find(
            (layer) =>
              layer.type === "symbol" &&
              Boolean((layer.layout as Record<string, unknown> | undefined)?.["text-field"]),
          )?.id;

        if (!map.getLayer("localtwin-hillshade")) {
          map.addLayer(
            {
              id: "localtwin-hillshade",
              type: "hillshade",
              source: "localtwin-dem",
              paint: {
                "hillshade-shadow-color": "#071018",
                "hillshade-highlight-color": "#d8f6ee",
                "hillshade-accent-color": "#567482",
                "hillshade-exaggeration": 0.28,
              },
            },
            symbolLayer,
          );
        }

        if (!map.getSource("localtwin-buildings")) {
          map.addSource("localtwin-buildings", {
            type: "vector",
            url: "https://tiles.openfreemap.org/planet",
          });
        }

        if (!map.getLayer("localtwin-buildings")) {
          map.addLayer(
            {
              id: "localtwin-buildings",
              source: "localtwin-buildings",
              "source-layer": "building",
              type: "fill-extrusion",
              minzoom: 14.5,
              filter: ["!=", ["get", "hide_3d"], true],
              paint: {
                "fill-extrusion-color": "#a9b7bf",
                "fill-extrusion-height": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  14.5,
                  0,
                  15.5,
                  ["coalesce", ["get", "render_height"], 7],
                ],
                "fill-extrusion-base": [
                  "coalesce",
                  ["get", "render_min_height"],
                  0,
                ],
                "fill-extrusion-opacity": 0.48,
              },
            },
            symbolLayer,
          );
        }

        map.setTerrain({ source: "localtwin-dem", exaggeration: 1.08 });
        setReady(true);
        setMapMessage("MapLibre · OpenFreeMap · DEM");
      } catch {
        setMapMessage("기본 지도 모드");
        setReady(true);
      }
    });

    map.on("error", (event) => {
      if (!ready && event.error?.message) {
        setMapMessage("지도 데이터 일부 지연");
      }
    });

    return () => {
      overlayRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || !cells.length) return;

    const geojson = cellsToGeoJson(cells, activeLayer, selectedCellId);
    const selected = cells.find((cell) => cell.cellId === selectedCellId);
    const catchment = selected
      ? buffer(point([selected.center.lon, selected.center.lat]), 0.3, {
          units: "kilometers",
        })
      : undefined;

    const layers = [
      catchment
        ? new GeoJsonLayer({
            id: "localtwin-catchment",
            data: catchment,
            filled: true,
            stroked: true,
            getFillColor: [94, 234, 212, 24],
            getLineColor: [94, 234, 212, 150],
            getLineWidth: 2,
            lineWidthUnits: "pixels",
            pickable: false,
          })
        : null,
      new GeoJsonLayer({
        id: "localtwin-opportunity",
        data: geojson,
        extruded: showExtrusion,
        filled: true,
        stroked: true,
        wireframe: false,
        getElevation: (feature: { properties?: { score?: number | null } }) =>
          showExtrusion ? Math.max(3, Number(feature.properties?.score ?? 0) * 1.75) : 0,
        getFillColor: (feature: {
          properties?: { score?: number | null; selected?: boolean };
        }) =>
          scoreColor(
            feature.properties?.score ?? null,
            Boolean(feature.properties?.selected),
          ),
        getLineColor: (feature: { properties?: { selected?: boolean } }) =>
          feature.properties?.selected ? [255, 255, 255, 245] : [200, 220, 224, 120],
        getLineWidth: (feature: { properties?: { selected?: boolean } }) =>
          feature.properties?.selected ? 2.5 : 1,
        lineWidthUnits: "pixels",
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 35],
        onClick: (info: { object?: { properties?: { cellId?: string } } }) => {
          const cellId = info.object?.properties?.cellId;
          if (cellId) onSelect(cellId);
        },
        updateTriggers: {
          getElevation: [showExtrusion, activeLayer],
          getFillColor: [selectedCellId, activeLayer],
          getLineColor: [selectedCellId],
        },
      }),
      selected
        ? new ScatterplotLayer({
            id: "localtwin-selected-center",
            data: [selected],
            getPosition: (cell: LocationEvidence) => [cell.center.lon, cell.center.lat],
            getRadius: 32,
            radiusUnits: "meters",
            getFillColor: [7, 16, 24, 225],
            getLineColor: [255, 255, 255, 255],
            lineWidthUnits: "pixels",
            getLineWidth: 2,
            stroked: true,
            pickable: false,
          })
        : null,
    ].filter(Boolean);

    overlay.setProps({ layers: layers as never[] });
  }, [cells, activeLayer, selectedCellId, showExtrusion, onSelect]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getSource("localtwin-dem")) return;
    try {
      map.setTerrain(showTerrain ? { source: "localtwin-dem", exaggeration: 1.08 } : null);
      if (map.getLayer("localtwin-hillshade")) {
        map.setLayoutProperty(
          "localtwin-hillshade",
          "visibility",
          showTerrain ? "visible" : "none",
        );
      }
    } catch {
      // Keep the base map usable if a provider does not expose DEM for this view.
    }
  }, [showTerrain, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getLayer("localtwin-buildings")) return;
    map.setLayoutProperty(
      "localtwin-buildings",
      "visibility",
      showBuildings ? "visible" : "none",
    );
  }, [showBuildings, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !selectedCell) return;
    map.easeTo({
      center: [selectedCell.center.lon, selectedCell.center.lat],
      duration: 550,
      zoom: Math.max(map.getZoom(), 14.6),
    });
  }, [selectedCell, ready]);

  return (
    <div className="relative h-full min-h-[520px] overflow-hidden rounded-2xl bg-slate-950">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/80 px-3 py-1.5 text-[11px] text-slate-200 backdrop-blur">
        <span
          className={
            "h-1.5 w-1.5 rounded-full " +
            (ready ? "bg-emerald-300" : "animate-pulse bg-amber-300")
          }
        />
        {mapMessage}
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-lg border border-white/10 bg-slate-950/72 px-2.5 py-1.5 text-[10px] text-slate-300 backdrop-blur">
        300m catchment · 지표 높이 = 선택 레이어 정규화 점수 · 실제 건물 높이와 무관
      </div>
    </div>
  );
}
