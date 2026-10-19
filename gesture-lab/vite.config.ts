import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "cortex-map": here("../packages/cortex-map/src/index.ts"),
      "cortex-gesture": here("../packages/gesture/src/index.ts"),
    },
  },
  build: {
    rollupOptions: {
      input: { index: here("index.html"), dom: here("dom.html"), three: here("three.html"), phone: here("phone.html") },
    },
  },
});
