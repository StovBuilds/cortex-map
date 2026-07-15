import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // consume the package source directly — no build step while developing
      "cortex-map": path.resolve(__dirname, "../packages/cortex-map/src/index.ts"),
    },
  },
});
