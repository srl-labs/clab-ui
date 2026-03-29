# containerlab-gui

Workspace for shared containerlab UI packages.

## Setup

Run dependency installation from the workspace root:

```bash
cd /home/flschwar/projects/clab/containerlab-gui
npm install
```

## Active development flow

- `npm run dev`: run the standalone browser harness from `dev/`
- `npm run build`: build publishable webview artifacts into `dist/`
- `npm run typecheck`: run TypeScript checks for `src/`, `dev/`, and `packages/`
- `npm run test:e2e`: run Playwright e2e suite
- `npm run test:e2e:ui`: open Playwright UI mode

Before first e2e run, install the browser once:

```bash
npx playwright install chromium
```

The active dev harness is `dev/`.

## Package model

The main published package is:

- `@srl-labs/clab-ui`

Import API surfaces directly from subpaths:

- `@srl-labs/clab-ui/core`
- `@srl-labs/clab-ui/explorer`
- `@srl-labs/clab-ui/inspect`
- `@srl-labs/clab-ui/theme`
- `@srl-labs/clab-ui/services`

Host adapter packages:

- `@srl-labs/clab-adapter-vscode`
- `@srl-labs/clab-adapter-api`
- `@srl-labs/clab-adapter-memory`

## Build outputs

`dist/` contains:

- webview bundles (TopoViewer + explorer + welcome + inspect + node impairments + wireshark VNC)
- `reactTopoViewerStyles.css`
- Monaco worker bundles
- MapLibre CSP worker
- `manifest.json` with logical asset IDs
- `index.js` / `index.d.ts` helper exports (`getWebviewAssetManifest`, `resolveAssetPath`)

## Publishing

`@srl-labs/clab-ui` is published to GitHub Packages. See `PUBLISHING.md`.

## Host integration

The UI package is transport-driven:

- configure transport with `setHostTransport(...)`
- update context with `setHostContext(...)`

Default behavior (no explicit transport) uses VS Code message transport when `window.vscode` is available.

Example (HTTP API transport):

```ts
import { setHostContext, setHostTransport } from "@srl-labs/clab-ui/services";
import { ApiTopologyHostTransport } from "@srl-labs/clab-adapter-api";

setHostTransport(new ApiTopologyHostTransport({ baseUrl: "http://127.0.0.1:8080" }));
setHostContext({
  path: "labs/my-lab.clab.yml",
  mode: "edit",
  deploymentState: "undeployed"
});
```
