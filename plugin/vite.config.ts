import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { fileURLToPath } from "node:url";
import { devManifestPlugin, readDevSlot } from "./dev-slot";
import manifest from "./manifest.json";

// In a feature worktree with a dev slot, the UI dials the slot's relay and the
// build emits the dev manifest into dist/ (see dev-slot.ts).
const slot = readDevSlot(fileURLToPath(new URL("..", import.meta.url)));
const slotWs = slot && `ws://localhost:${slot.port}/ws`;
const explicitWs = process.env.VITE_FIGMA_DESIGN_RELAY_WS;
if (slotWs && explicitWs && explicitWs !== slotWs) {
  throw new Error(
    `VITE_FIGMA_DESIGN_RELAY_WS=${explicitWs} contradicts this worktree's dev slot (${slotWs}). Unset it.`
  );
}

export default defineConfig({
  plugins: [react(), viteSingleFile(), devManifestPlugin(manifest, slot)],
  define: slotWs ? { "import.meta.env.VITE_FIGMA_DESIGN_RELAY_WS": JSON.stringify(slotWs) } : {},
  root: "./src/ui",
  build: {
    target: "es2015",
    cssCodeSplit: false,
    outDir: "../../dist",
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
    emptyOutDir: true,
  },
});
