import os from "node:os";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const projectEnv = loadEnv(mode, process.cwd(), "");
  const codexEnv = loadEnv(mode, path.join(os.homedir(), ".codex"), "");
  const vworldApiKey = process.env.VITE_VWORLD_API_KEY
    || projectEnv.VITE_VWORLD_API_KEY
    || codexEnv.VITE_VWORLD_API_KEY
    || codexEnv.VWORLD_API_KEY
    || "";
  const vworldDomain = process.env.VITE_VWORLD_DOMAIN
    || projectEnv.VITE_VWORLD_DOMAIN
    || codexEnv.VITE_VWORLD_DOMAIN
    || codexEnv.VWORLD_DOMAIN
    || "";

  return {
    plugins: [react()],
    define: {
      "import.meta.env.VITE_VWORLD_API_KEY": JSON.stringify(vworldApiKey),
      "import.meta.env.VITE_VWORLD_DOMAIN": JSON.stringify(vworldDomain),
    },
    build: { sourcemap: true },
  };
});
