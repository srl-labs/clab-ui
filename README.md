# containerlab-gui

Standalone frontend package for containerlab webviews.

## Commands

- `npm run dev`: run pure frontend Vite dev app
- `npm run build`: build publishable webview artifacts into `dist/`
- `npm run typecheck`: run TypeScript checks

## Package outputs

`dist/` contains:

- Webview bundles (TopoViewer + explorer + welcome + inspect + node impairments + wireshark VNC)
- `reactTopoViewerStyles.css`
- Monaco worker bundles
- MapLibre CSP worker
- `manifest.json` with logical asset IDs
- `index.js` / `index.d.ts` helper exports (`getWebviewAssetManifest`, `resolveAssetPath`)

## Dev mode

The dev app runs fully in-browser with an in-memory topology host and `localStorage` persistence.
No filesystem middleware or backend server is required.
