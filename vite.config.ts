import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const fromHere = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// The interface: the React renderer, entered through src/tauri so the bridge to Rust is installed
// before it mounts. The port is fixed because src-tauri/tauri.conf.json points devUrl at it; the
// content security policy lives in that file too, where Tauri can add its own IPC address to it.
export default defineConfig({
  root: fromHere("./src/tauri"),
  base: "./",
  resolve: { alias: { "@": fromHere("./src") } },
  plugins: [react()],
  clearScreen: false,
  server: { port: 5183, strictPort: true },
  build: { outDir: fromHere("./dist"), emptyOutDir: true },
});
