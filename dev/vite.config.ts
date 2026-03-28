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
      "@webview": path.resolve(__dirname, "../packages/ui/src"),
      "@webviews": path.resolve(__dirname, "../src/webviews"),
      "@shared": path.resolve(__dirname, "../packages/core/src"),
      "@srl-labs/clab-ui-core": path.resolve(__dirname, "../packages/core/src"),
      "@srl-labs/clab-ui": path.resolve(__dirname, "../packages/ui/src"),
      "@srl-labs/clab-ui-explorer": path.resolve(__dirname, "../packages/explorer/src"),
      "@srl-labs/clab-ui-inspect": path.resolve(__dirname, "../packages/inspect/src"),
      "@srl-labs/clab-host-contract": path.resolve(__dirname, "../packages/host-contract/src"),
      "@srl-labs/clab-adapter-memory": path.resolve(__dirname, "../packages/adapter-memory/src"),
      "@srl-labs/clab-adapter-vscode": path.resolve(__dirname, "../packages/adapter-vscode/src")
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
