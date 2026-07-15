import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // consume the package source directly — no build step while developing
      "cortex-map": fileURLToPath(new URL("../packages/cortex-map/src/index.ts", import.meta.url)),
    },
  },
});
