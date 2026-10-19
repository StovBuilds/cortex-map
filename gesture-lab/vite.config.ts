import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// transformers.js loads onnxruntime's WebAssembly from jsDelivr at run time,
// so the copy Vite emits (27 MB, over Cloudflare's 25 MB per-file limit) is
// never fetched: leave it out of the build.
const dropOrtWasm = {
  name: "drop-ort-wasm",
  generateBundle(_: unknown, bundle: Record<string, unknown>) {
    for (const k of Object.keys(bundle)) if (/ort-wasm[^/]*\.wasm$/.test(k)) delete bundle[k];
  },
};

export default defineConfig({
  plugins: [react(), dropOrtWasm],
  resolve: {
    alias: {
      "cortex-map": here("../packages/cortex-map/src/index.ts"),
      "cortex-gesture": here("../packages/gesture/src/index.ts"),
    },
  },
  // the voice worker loads the speech model with dynamic imports
  worker: { format: "es", plugins: () => [dropOrtWasm] },
  build: {
    rollupOptions: {
      input: { index: here("index.html"), dom: here("dom.html"), three: here("three.html"), phone: here("phone.html") },
    },
  },
});
