import { computeShadowPolygon, rotatedFootprintPoints, siteTimeZoneOffsetMinutes } from "./model";
import type { Scenario } from "./types";

declare global {
  interface Window {
    vw?: any;
    ws3d?: { viewer?: any };
    Cesium?: any;
    viewer?: any;
  }
}

let scriptPromise: Promise<void> | null = null;
let viewerPromise: Promise<any> | null = null;
const entities = new Map<string, any>();

export function loadVWorld(apiKey: string) {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    if (window.vw && window.Cesium) return resolve();
    const waitDeadline = Date.now() + 15000;
    const waitForGlobals = () => {
      if (window.vw && window.Cesium) {
        resolve();
        return;
      }
      if (Date.now() >= waitDeadline) {
        reject(new Error("VWorld SDK unavailable"));
        return;
      }
      window.setTimeout(waitForGlobals, 100);
    };
    const script = document.createElement("script");
    const params = new URLSearchParams({ version: "3.0", apiKey });
    const domain = import.meta.env.VITE_VWORLD_DOMAIN as string | undefined;
    if (domain) params.set("domain", domain);
    script.src = `https://map.vworld.kr/js/webglMapInit.js.do?${params.toString()}`;
    script.async = true;
    script.onload = waitForGlobals;
    script.onerror = () => reject(new Error("Failed to load VWorld WebGL SDK"));
    document.head.appendChild(script);
  }).catch((error) => {
    scriptPromise = null;
    throw error;
  });
  return scriptPromise;
}

function resolveViewer(map: any) {
  return window.ws3d?.viewer
    ?? map?.getViewer?.()
    ?? map?.getCesiumViewer?.()
    ?? map?.viewer
    ?? window.viewer
    ?? (map?.entities ? map : undefined);
}

export async function startVWorld(containerId: string, apiKey: string, lon: number, lat: number) {
  if (window.viewer?.entities) return window.viewer;
  if (viewerPromise) return viewerPromise;

  viewerPromise = (async () => {
    await loadVWorld(apiKey);
    const vw = window.vw;
    if (!vw) throw new Error("VWorld SDK unavailable");
    return new Promise<any>((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (!settled) reject(new Error("VWorld 3D initialization timed out"));
      }, 15000);
      let map: any;
      const finish = () => {
        const viewer = resolveViewer(map);
        if (!viewer?.entities) return false;
        settled = true;
        window.clearTimeout(timeout);
        window.viewer = viewer;
        resolve(viewer);
        return true;
      };
      vw.ws3dInitCallBack = () => { finish(); };
      map = new vw.Map();
      const camera = new vw.CameraPosition(new vw.CoordZ(lon, lat, 1100), new vw.Direction(0, -72, 0));
      map.setOption({ mapId: containerId, initPosition: camera, logo: false, navigation: true });
      map.setMapId(containerId);
      map.setInitPosition(camera);
      map.setLogoVisible(false);
      map.setNavigationZoomVisible(false);
      map.start();
      finish();
    });
  })().catch((error) => {
    viewerPromise = null;
    throw error;
  });
  return viewerPromise;
}

function offsetDegrees(lat: number, eastM: number, northM: number) {
  const dLat = northM / 111_320;
  const dLon = eastM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { dLon, dLat };
}

function footprintCorners(scenario: Scenario) {
  const { center, position } = scenario.mass;
  const origin = offsetDegrees(center.lat, position.eastM, position.northM);
  const cx = center.lon + origin.dLon;
  const cy = center.lat + origin.dLat;
  return rotatedFootprintPoints(scenario.mass).flatMap(({ xM, yM }) => {
    const offset = offsetDegrees(cy, xM, yM);
    return [cx + offset.dLon, cy + offset.dLat];
  });
}

function localPointsToDegrees(center: { lon: number; lat: number }, points: { xM: number; yM: number }[]) {
  return points.flatMap(({ xM, yM }) => {
    const offset = offsetDegrees(center.lat, xM, yM);
    return [center.lon + offset.dLon, center.lat + offset.dLat];
  });
}

export function renderScenario(scenario: Scenario, active: boolean, timeZoneOffsetMinutes = siteTimeZoneOffsetMinutes) {
  const viewer = window.viewer;
  const Cesium = window.Cesium;
  if (!viewer?.entities || !Cesium) return;
  const old = entities.get(scenario.id);
  if (old?.building) viewer.entities.remove(old.building);
  if (old?.shadow) viewer.entities.remove(old.shadow);
  const building = viewer.entities.add({
    name: scenario.name,
    polygon: {
      hierarchy: Cesium.Cartesian3.fromDegreesArray(footprintCorners(scenario)),
      extrudedHeight: scenario.mass.heightM,
      height: 0,
      material: Cesium.Color.fromCssColorString(active ? "#68f3c2" : "#7aa7ff").withAlpha(active ? 0.72 : 0.38),
      outline: true,
      outlineColor: Cesium.Color.WHITE.withAlpha(active ? 0.9 : 0.45),
    },
  });
  const shadow = computeShadowPolygon(scenario.mass, scenario.analysisTime, timeZoneOffsetMinutes);
  const shadowEntity = shadow.points.length >= 3 ? viewer.entities.add({
    name: `${scenario.name} solar shadow`,
    polygon: {
      hierarchy: Cesium.Cartesian3.fromDegreesArray(localPointsToDegrees(scenario.mass.center, shadow.points)),
      height: 0,
      extrudedHeight: 0.25,
      material: Cesium.Color.fromCssColorString(active ? "#68f3c2" : "#7aa7ff").withAlpha(active ? 0.22 : 0.14),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString(active ? "#68f3c2" : "#7aa7ff").withAlpha(active ? 0.55 : 0.38),
    },
  }) : undefined;
  entities.set(scenario.id, { building, shadow: shadowEntity });
}

export function setShadowTime(localDateTime: string, timeZoneOffsetMinutes = siteTimeZoneOffsetMinutes) {
  const viewer = window.viewer;
  const Cesium = window.Cesium;
  if (!viewer || !Cesium || !localDateTime) return;
  const sign = timeZoneOffsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(timeZoneOffsetMinutes);
  const offsetHours = String(Math.floor(absoluteOffset / 60)).padStart(2, "0");
  const offsetMinutes = String(absoluteOffset % 60).padStart(2, "0");
  const date = new Date(`${localDateTime}:00${sign}${offsetHours}:${offsetMinutes}`);
  if (!Number.isNaN(date.getTime())) viewer.clock.currentTime = Cesium.JulianDate.fromDate(date);
}

export function setShadowMode(enabled: boolean) {
  const viewer = window.viewer;
  if (!viewer) return;
  viewer.shadows = enabled;
  if (viewer.scene?.globe) {
    const Cesium = window.Cesium;
    if (Cesium) viewer.scene.globe.shadows = enabled ? Cesium.ShadowMode.ENABLED : Cesium.ShadowMode.DISABLED;
  }
}
