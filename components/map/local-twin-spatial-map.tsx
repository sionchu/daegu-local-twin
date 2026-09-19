"use client";

import { lazy, Suspense, useCallback, useState } from "react";

import type { LocationEvidence, MapLayer } from "@/src/types";
import VWorldLocalTwinMap from "@/components/map/vworld-local-twin-map";

const MapLibreFallback = lazy(() => import("@/components/map/local-twin-map"));
const FALLBACK_LIGHT_TIME = new Date("2026-09-19T18:00:00+09:00");

type Props = {
  cells: LocationEvidence[];
  selectedCellId?: string;
  activeLayer: MapLayer;
  onSelect: (cellId: string) => void;
};

export default function LocalTwinSpatialMap(props: Props) {
  const [fallbackReason, setFallbackReason] = useState<string>();

  const handleUnavailable = useCallback((reason: string) => {
    setFallbackReason(reason || "VWorld unavailable");
  }, []);

  if (fallbackReason) {
    return (
      <div className="relative h-full min-h-[520px]" data-testid="spatial-map" data-map-engine="maplibre">
        <Suspense
          fallback={
            <div className="grid h-full min-h-[520px] place-items-center rounded-2xl bg-slate-950 text-sm text-slate-400">
              경량 지도를 준비하고 있습니다.
            </div>
          }
        >
          <MapLibreFallback
            cells={props.cells}
            selectedCellId={props.selectedCellId}
            activeLayer={props.activeLayer}
            selectedTime={FALLBACK_LIGHT_TIME}
            showTerrain
            showBuildings
            showExtrusion
            onSelect={props.onSelect}
          />
        </Suspense>
        <div className="pointer-events-none absolute right-3 top-3 z-20 rounded-full border border-amber-300/15 bg-slate-950/80 px-2.5 py-1 text-[9px] text-amber-100/80 backdrop-blur">
          VWorld fallback
        </div>
      </div>
    );
  }

  return <VWorldLocalTwinMap {...props} onUnavailable={handleUnavailable} />;
}
