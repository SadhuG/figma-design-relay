import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { devManifestPlugin, readDevSlot } from "./dev-slot";
import manifest from "./manifest.json";

// Emits the dev manifest too, so a watch rebuild of either pass restores it.
const slot = readDevSlot(fileURLToPath(new URL("..", import.meta.url)));

export default defineConfig({
  plugins: [devManifestPlugin(manifest, slot)],
  build: {
    target: "es2015",
    lib: {
      entry: "src/main/code.ts",
      formats: ["iife"],
      name: "code",
      fileName: () => "code.js",
    },
    outDir: "dist",
    emptyOutDir: false,
    minify: false,
  },
});
