import type { GeoPoint, Site } from "./types";

export type AddressSearchResult = {
  id: string;
  title: string;
  address: string;
  point: GeoPoint;
};

function buildUrl(base: string, params: Record<string, string | number | boolean | undefined>) {
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  });
  return url;
}

function requestJsonp(url: URL) {
  return new Promise<any>((resolve, reject) => {
    const callbackName = `__spacelab_vworld_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const cleanup = () => {
      script.remove();
      delete (window as any)[callbackName];
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("VWorld request timed out"));
    }, 12_000);
    (window as any)[callbackName] = (payload: unknown) => {
      window.clearTimeout(timeout);
      cleanup();
      resolve(payload);
    };
    url.searchParams.set("callback", callbackName);
    script.src = url.toString();
    script.onerror = () => {
      window.clearTimeout(timeout);
      cleanup();
      reject(new Error("VWorld request failed"));
    };
    document.head.appendChild(script);
  });
}

async function requestVWorld(url: URL) {
  try {
    const response = await fetch(url.toString(), { mode: "cors" });
    if (response.ok) return await response.json();
  } catch {
    // Older VWorld examples use JSONP. Keep it as a browser fallback.
  }
  return requestJsonp(url);
}

function responseStatus(payload: any) {
  return payload?.response?.status ?? payload?.status;
}

export async function searchVWorldAddress(
  apiKey: string,
  query: string,
  domain?: string,
): Promise<AddressSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const categories = ["ROAD", "PARCEL"] as const;
  const all: AddressSearchResult[] = [];
  for (const category of categories) {
    const url = buildUrl("https://api.vworld.kr/req/search", {
      service: "search",
      request: "search",
      version: "2.0",
      crs: "EPSG:4326",
      size: 8,
      page: 1,
      query: trimmed,
      type: "ADDRESS",
      category,
      format: "json",
      key: apiKey,
      domain,
    });
    const payload = await requestVWorld(url);
    if (responseStatus(payload) !== "OK") continue;
    const items = payload?.response?.result?.items ?? [];
    for (const item of items) {
      const lon = Number(item?.point?.x);
      const lat = Number(item?.point?.y);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      const address = String(item?.address?.road || item?.address?.parcel || item?.title || trimmed);
      const title = String(item?.title || address);
      all.push({
        id: `${category}-${lon}-${lat}-${all.length}`,
        title,
        address,
        point: { lon, lat },
      });
    }
  }

  const seen = new Set<string>();
  return all.filter((item) => {
    const key = `${item.point.lon.toFixed(7)},${item.point.lat.toFixed(7)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}

function firstBoundary(geometry: any): GeoPoint[] {
  if (!geometry) return [];
  const coords = geometry.coordinates;
  const ring = geometry.type === "MultiPolygon" ? coords?.[0]?.[0] : coords?.[0];
  if (!Array.isArray(ring)) return [];
  return ring
    .map((coordinate: unknown) => Array.isArray(coordinate)
      ? { lon: Number(coordinate[0]), lat: Number(coordinate[1]) }
      : undefined)
    .filter((point: GeoPoint | undefined): point is GeoPoint => Boolean(point && Number.isFinite(point.lon) && Number.isFinite(point.lat)));
}

function centroid(boundary: GeoPoint[], fallback: GeoPoint) {
  if (!boundary.length) return fallback;
  const points = boundary.length > 2
    && boundary[0].lon === boundary[boundary.length - 1].lon
    && boundary[0].lat === boundary[boundary.length - 1].lat
    ? boundary.slice(0, -1)
    : boundary;
  if (!points.length) return fallback;
  return {
    lon: points.reduce((sum, point) => sum + point.lon, 0) / points.length,
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
  };
}

export async function getVWorldParcelAtPoint(
  apiKey: string,
  point: GeoPoint,
  domain?: string,
  label?: string,
): Promise<Site> {
  const url = buildUrl("https://api.vworld.kr/req/data", {
    service: "data",
    request: "GetFeature",
    version: "2.0",
    data: "LP_PA_CBND_BUBUN",
    geometry: true,
    attribute: true,
    crs: "EPSG:4326",
    geomFilter: `POINT(${point.lon} ${point.lat})`,
    size: 1,
    page: 1,
    format: "json",
    key: apiKey,
    domain,
  });
  const payload = await requestVWorld(url);
  const feature = payload?.response?.result?.featureCollection?.features?.[0];
  const boundary = firstBoundary(feature?.geometry);
  const properties = feature?.properties ?? {};
  const pnu = String(properties?.pnu || properties?.PNU || "").trim() || undefined;

  if (boundary.length >= 3) {
    const center = centroid(boundary, point);
    return {
      id: pnu ? `parcel-${pnu}` : `parcel-${center.lon.toFixed(7)}-${center.lat.toFixed(7)}`,
      name: label || properties?.full_nm || properties?.jibun || "Selected parcel",
      address: label,
      center,
      boundary,
      pnu,
      source: "vworld-cadastral",
    };
  }

  const deltaLon = 18 / (111_320 * Math.cos((point.lat * Math.PI) / 180));
  const deltaLat = 18 / 111_320;
  return {
    id: `point-${point.lon.toFixed(7)}-${point.lat.toFixed(7)}`,
    name: label || "Selected map point",
    address: label,
    center: point,
    boundary: [
      { lon: point.lon - deltaLon, lat: point.lat - deltaLat },
      { lon: point.lon + deltaLon, lat: point.lat - deltaLat },
      { lon: point.lon + deltaLon, lat: point.lat + deltaLat },
      { lon: point.lon - deltaLon, lat: point.lat + deltaLat },
    ],
    source: "manual-point",
  };
}
