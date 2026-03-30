# containerlab-gui

Shared UI workspace for containerlab webviews and topology editing.

Primary consumer today: [`vscode-containerlab`](https://github.com/srl-labs/vscode-containerlab).

![containerlab-gui screenshot](resources/screenshot.png)

---

## What This Repo Contains

- React UI and topology editing logic used by containerlab webviews
- Shared parsing/core utilities used by the extension host
- A standalone-backed local development flow (`npm run dev`) that exercises the real browser/runtime integration
- Build tooling that produces webview-ready assets in `dist/`

---

## Key Features

- **TopoViewer editing:** create/delete nodes and links, drag/drop layout, undo/redo, copy/paste, and box selection
- **Rich annotations:** groups, free text, free shapes, endpoint label offsets, traffic-rate overlays, and geolocation layout helpers
- **Context-driven editors:** node, link, network, group, and lab settings editors with schema-aware forms
- **Operational helpers:** find node, grid controls, dummy link display, and quick context menu actions
- **Export paths:** SVG export and Grafana-oriented export helpers
- **Extra webviews:** explorer, inspect, welcome page, node impairments, and Wireshark VNC

---

## Current Status

| Component | Package | Status | Notes |
| --- | --- | --- | --- |
| Main UI package | `@srl-labs/clab-ui` | Published | Owns the shared browser-side host contract and constructors |
| Standalone app | `@srl-labs/clab-standalone` | Workspace app | Local dev/runtime host backed by the API proxy server |

---

## Requirements

- Node.js `>= 24`
- npm
- For E2E tests: Playwright Chromium browser

Install dependencies:

```bash
npm install
```

Install Playwright browser once (only needed for E2E):

```bash
npx playwright install chromium
```

---

## Getting Started

Start the standalone-backed dev flow:

```bash
npm run dev
```

Then open `http://localhost:5173`.

Local dev runtime model:

- Browser frontend served by the standalone Vite app
- Fastify backend proxy for auth, topology snapshot/command, files, and lifecycle actions
- Shared `ClabUiHost` runtime used by both standalone and VS Code webviews

---

## Common Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Run the standalone-backed local development flow |
| `npm run build` | Build production webview assets into `dist/` |
| `npm run build:watch` | Build in dev mode (inline sourcemaps, no minify) |
| `npm run build:dev` | Build in dev mode (same output profile as `build:watch`) |
| `npm run typecheck` | Run TypeScript checks |
| `npm run lint` | Typecheck + `oxlint` |
| `npm run lint:ts` | Run `oxlint` only |
| `npm run lint:ts:fix` | Run `oxlint` with fixes |
| `npm run test:e2e` | Run Playwright E2E suite |
| `npm run test:e2e:ui` | Run Playwright in UI mode |
| `npm run test:e2e:debug` | Run Playwright in debug mode |
| `npm run pack:preview` | Preview package contents for `@srl-labs/clab-ui` |
| `npm run publish:ui` | Publish `@srl-labs/clab-ui` manually (requires registry auth) |

Run a single E2E file:

```bash
npm run test:e2e -- test/e2e/specs/node-creation.spec.ts
```

---

## Build Outputs

`npm run build` writes `dist/` with:

- `reactTopoViewerWebview.js`
- `containerlabExplorerView.js`
- `welcomePageWebview.js`
- `inspectWebview.js`
- `nodeImpairmentsWebview.js`
- `wiresharkVncWebview.js`
- `reactTopoViewerStyles.css`
- `monaco-editor-worker.js`
- `monaco-json-worker.js`
- `maplibre-gl-csp-worker.js`
- `manifest.json` (logical asset IDs -> output files)
- `index.js` / `index.d.ts` helpers (`getWebviewAssetManifest()`, `resolveAssetPath(assetId)`)

---

## Package Surfaces

Published package: `@srl-labs/clab-ui`

Frequently used exports:

- `@srl-labs/clab-ui`
- `@srl-labs/clab-ui/core`
- `@srl-labs/clab-ui/theme`
- `@srl-labs/clab-ui/explorer`
- `@srl-labs/clab-ui/inspect`
- `@srl-labs/clab-ui/core/parsing`
- `@srl-labs/clab-ui/core/schema`
- `@srl-labs/clab-ui/core/types`
- `@srl-labs/clab-ui/core/utilities`

Notes:

- Browser runtime integration is exposed from `@srl-labs/clab-ui/host`.
- Current UI host context APIs are still imported from service subpaths (for example `@srl-labs/clab-ui/services/topologyHostClient`).

---

## Host Integration (Current)

The UI currently uses host messaging via `services/topologyHostClient`:

```ts
import { createWindowClabUiHost, setClabUiHost } from "@srl-labs/clab-ui/host";

setClabUiHost(createWindowClabUiHost());
```

---

## Troubleshooting

- `npm install` fails with engine mismatch: ensure Node `>= 24` (`node -v`).
- Playwright tests fail before opening a browser: run `npx playwright install chromium`.
- Local dev flow cannot reach the backend: ensure the standalone dev server on `http://localhost:3000` is starting successfully.

---

## Publishing

`@srl-labs/clab-ui` is published to GitHub Packages through `.github/workflows/publish-package.yml`.

Release flow:

1. Bump `packages/ui/package.json` version.
2. Commit and push.
3. Create a tag `v<version>` matching the package version.
4. Push the tag to trigger publish.

Detailed steps: [`PUBLISHING.md`](PUBLISHING.md)

---

## Standalone Runtime

The standalone browser experience is the supported local development runtime for `containerlab-gui`.

It uses the same browser-side host contract as VS Code, with only platform-specific differences in backend transport and shell behavior.
