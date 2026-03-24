import { resolve } from "node:path";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { version } from "./package.json";

import { cloudflare } from "@cloudflare/vite-plugin";

const host = process.env.TAURI_DEV_HOST;
const shouldGenerateSentrySourcemaps =
  process.env.VITE_SENTRY_SOURCEMAPS_ENABLED === "true";

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [vue(), tailwindcss(), cloudflare()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  build: {
    sourcemap: shouldGenerateSentrySourcemaps,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        "main-window": resolve(__dirname, "main-window.html"),
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
});