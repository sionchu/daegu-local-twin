"use client";

declare global {
  interface Window {
    vw?: any;
    ws3d?: { viewer?: any };
    Cesium?: any;
    viewer?: any;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadExternalScript(src: string) {
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  if (existing?.dataset.loaded === "true") return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const script = existing ?? document.createElement("script");
    script.src = src;
    script.async = false;
    const onLoad = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error(`VWorld dependency load failed: ${new URL(src, window.location.href).pathname}`)),
      { once: true },
    );
    if (!existing) document.head.appendChild(script);
  });
}

export function loadVWorld(apiKey: string) {
  if (window.vw && window.Cesium) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const childScripts: string[] = [];
    const originalWrite = document.write.bind(document);
    const originalWriteln = document.writeln.bind(document);
    const restoreDocumentWrite = () => {
      document.write = originalWrite;
      document.writeln = originalWriteln;
    };
    const captureMarkup = (markup: string) => {
      const template = document.createElement("template");
      template.innerHTML = markup;
      template.content.querySelectorAll("script[src]").forEach((child) => {
        const src = child.getAttribute("src");
        if (src) childScripts.push(new URL(src, "https://map.vworld.kr/").href);
      });
    };

    document.write = captureMarkup;
    document.writeln = captureMarkup;

    const bootstrap = document.createElement("script");
    const params = new URLSearchParams({ version: "3.0", apiKey });
    bootstrap.src = `https://map.vworld.kr/js/webglMapInit.js.do?${params.toString()}`;
    bootstrap.async = false;
    bootstrap.onload = () => {
      void (async () => {
        for (const childScript of [...new Set(childScripts)]) {
          await loadExternalScript(childScript);
        }
        restoreDocumentWrite();

        const deadline = Date.now() + 15_000;
        while (!(window.vw && window.Cesium)) {
          if (Date.now() >= deadline) throw new Error("VWorld SDK globals unavailable");
          await new Promise((next) => window.setTimeout(next, 100));
        }
        resolve();
      })().catch((error) => {
        restoreDocumentWrite();
        reject(error);
      });
    };
    bootstrap.onerror = () => {
      restoreDocumentWrite();
      reject(new Error("VWorld WebGL SDK bootstrap failed"));
    };
    document.head.appendChild(bootstrap);
  }).catch((error) => {
    scriptPromise = null;
    throw error;
  });

  return scriptPromise;
}

function resolveViewer(map: any) {
  return (
    window.ws3d?.viewer ??
    map?.getViewer?.() ??
    map?.getCesiumViewer?.() ??
    map?.viewer ??
    window.viewer ??
    (map?.entities ? map : undefined)
  );
}

export async function startVWorld(
  containerId: string,
  apiKey: string,
  lon: number,
  lat: number,
) {
  await loadVWorld(apiKey);
  const vw = window.vw;
  if (!vw) throw new Error("VWorld SDK unavailable");

  return new Promise<{ viewer: any; map: any }>((resolve, reject) => {
    let settled = false;
    let map: any;
    const finish = () => {
      const viewer = resolveViewer(map);
      if (!viewer?.entities || settled) return false;
      settled = true;
      window.viewer = viewer;
      resolve({ viewer, map });
      return true;
    };
    const timeout = window.setTimeout(() => {
      if (!settled) reject(new Error("VWorld 3D initialization timed out"));
    }, 15_000);

    const originalCallback = vw.ws3dInitCallBack;
    vw.ws3dInitCallBack = () => {
      window.clearTimeout(timeout);
      finish();
      if (typeof originalCallback === "function") originalCallback();
    };

    map = new vw.Map();
    const camera = new vw.CameraPosition(
      new vw.CoordZ(lon, lat, 2600),
      new vw.Direction(0, -52, 0),
    );
    map.setOption({
      mapId: containerId,
      initPosition: camera,
      logo: false,
      navigation: true,
    });
    map.setMapId(containerId);
    map.setInitPosition(camera);
    map.setLogoVisible?.(false);
    map.setNavigationZoomVisible?.(false);
    map.start();
    if (finish()) window.clearTimeout(timeout);
  });
}

export function disposeVWorld(viewer: any) {
  if (!viewer) return;
  try {
    viewer.entities?.removeAll?.();
    viewer.dataSources?.removeAll?.(true);
    if (typeof viewer.isDestroyed === "function" && !viewer.isDestroyed()) {
      viewer.destroy?.();
    }
  } catch {
    // VWorld owns parts of the Cesium lifecycle; cleanup is best-effort.
  }
  if (window.viewer === viewer) window.viewer = undefined;
}
