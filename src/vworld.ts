let probePromise: Promise<boolean> | null = null;

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("VWorld SDK unavailable"));
    document.head.appendChild(script);
  });
}

/** Optional browser-side provider probe. The fallback map stays usable when it fails. */
export async function probeVWorld(apiKey?: string, domain?: string) {
  if (!apiKey) return false;
  if (probePromise) return probePromise;
  probePromise = (async () => {
    const params = new URLSearchParams({ version: "3.0", apiKey });
    if (domain) params.set("domain", domain);
    try {
      await loadScript(`https://map.vworld.kr/js/webglMapInit.js.do?${params.toString()}`);
      return Boolean((window as Window & { vw?: unknown }).vw);
    } catch {
      probePromise = null;
      return false;
    }
  })();
  return probePromise;
}
