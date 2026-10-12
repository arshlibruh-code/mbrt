import { defineConfig } from "vite";

// MapLibre 6 loads its worker from a sibling file (main.js passes it via setWorkerUrl), so keep it out of
// prebundling; fs.allow lets the app import the shared tool schema and golden set from ../eval
export default defineConfig({
  optimizeDeps: { exclude: ["maplibre-gl"] },
  build: { target: "esnext" },
  server: { fs: { allow: [".."] } },
});
