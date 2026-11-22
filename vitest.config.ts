import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { localCtrlUi, localCtrlUiRepo } from "./scripts/local-ctrl-ui";

const APP_SRC = resolve(import.meta.dirname, "./src");
const ctrlUiRepo = localCtrlUiRepo();

export default defineConfig({
  plugins: [
    ctrlUiRepo
      ? localCtrlUi(ctrlUiRepo, resolve(APP_SRC, "index.css"))
      : undefined,
    react(),
  ],
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
  resolve: {
    alias: {
      "@": APP_SRC,
    },
  },
});
