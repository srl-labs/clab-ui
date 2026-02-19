import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeModules = path.resolve(__dirname, "../node_modules");

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  publicDir: path.resolve(__dirname, "../resources"),
  resolve: {
    alias: {
      react: path.resolve(nodeModules, "react"),
      "react-dom": path.resolve(nodeModules, "react-dom"),
      "@webview": path.resolve(__dirname, "../src/reactTopoViewer/webview"),
      "@shared": path.resolve(__dirname, "../src/reactTopoViewer/shared"),
      "@webviews": path.resolve(__dirname, "../src/webviews")
    },
    dedupe: ["react", "react-dom"]
  },
  optimizeDeps: {
    include: ["react", "react-dom"]
  },
  css: {
    postcss: path.resolve(__dirname, "../postcss.config.js")
  },
  server: {
    port: 5173,
    open: !process.env.CI
  },
  build: {
    outDir: path.resolve(__dirname, "../dist-dev")
  }
});
