import { rotatedFootprintPoints } from "./model";
import type { Scenario } from "./types";

declare global {
  interface Window {
    vw?: any;
    Cesium?: any;
    viewer?: any;
  }
}

let scriptPromise: Promise<void> | null = null;
let viewerPromise: Promise<any> | null = null;
const entities = new Map<string, any>();

export function loadVWorld(apiKey: string) {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (window.vw && window.Cesium) return resolve();
    const script = document.createElement("script");
    script.src = `https://map.vworld.kr/js/webglMapInit.js.do?version=3.0&apiKey=${encodeURIComponent(apiKey)}`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load VWorld WebGL SDK"));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

function resolveViewer(map: any) {
  return map?.getViewer?.() ?? map?.getCesiumViewer?.() ?? map?.viewer ?? window.viewer ?? (map?.entities ? map : undefined);
}

export async function startVWorld(containerId: string, apiKey: string, lon: number, lat: number) {
  if (window.viewer?.entities) return window.viewer;
  if (viewerPromise) return viewerPromise;

  viewerPromise = (async () => {
    await loadVWorld(apiKey);
    const vw = window.vw;
    if (!vw) throw new Error("VWorld SDK unavailable");
    return new Promise<any>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("VWorld 3D initialization timed out")), 15000);
      let map: any;
      const finish = () => {
        window.clearTimeout(timeout);
        const viewer = resolveViewer(map);
        if (!viewer?.entities) {
          reject(new Error("VWorld initialized without a Cesium viewer"));
          return;
        }
        window.viewer = viewer;
        resolve(viewer);
      };
      vw.ws3dInitCallBack = finish;
      map = new vw.Map();
      const camera = new vw.CameraPosition(new vw.CoordZ(lon, lat, 1100), new vw.Direction(0, -72, 0));
      map.setOption({ mapId: containerId, initPosition: camera, logo: false, navigation: true });
      map.setMapId(containerId);
      map.setInitPosition(camera);
      map.setLogoVisible(false);
      map.setNavigationZoomVisible(false);
      map.start();
      if (resolveViewer(map)?.entities) finish();
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

export function renderScenario(scenario: Scenario, active: boolean) {
  const viewer = window.viewer;
  const Cesium = window.Cesium;
  if (!viewer?.entities || !Cesium) return;
  const old = entities.get(scenario.id);
  if (old) viewer.entities.remove(old);
  const entity = viewer.entities.add({
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
  entities.set(scenario.id, entity);
}

export function setShadowTime(localDateTime: string) {
  const viewer = window.viewer;
  const Cesium = window.Cesium;
  if (!viewer || !Cesium || !localDateTime) return;
  const date = new Date(`${localDateTime}:00+09:00`);
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
