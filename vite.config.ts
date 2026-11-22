import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { localCtrlUi, localCtrlUiRepo } from "./scripts/local-ctrl-ui";

const DEV_PORT = 1420;
const DEV_APP_MODE = "dev-app";
const APP_SRC = resolve(import.meta.dirname, "./src");

export default defineConfig(({ command, mode }) => {
  const ctrlUiRepo =
    command === "serve" || mode === DEV_APP_MODE
      ? localCtrlUiRepo()
      : undefined;
  return {
    plugins: [
      ctrlUiRepo
        ? localCtrlUi(ctrlUiRepo, resolve(APP_SRC, "index.css"))
        : undefined,
      react(),
      tailwindcss(),
    ],
    clearScreen: false,
    server: {
      port: DEV_PORT,
      strictPort: true,
      watch: {
        ignored: ["**/src-tauri/**"],
      },
    },
    envPrefix: ["VITE_", "TAURI_ENV_"],
    build: {
      target: "safari15",
      sourcemap: process.env.TAURI_ENV_DEBUG === "true",
      minify: process.env.TAURI_ENV_DEBUG === "true" ? false : "esbuild",
    },
    resolve: {
      alias: {
        "@": APP_SRC,
      },
    },
  };
});
