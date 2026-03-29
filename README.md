# containerlab-gui

Shared UI workspace for containerlab webviews and topology editing.

Primary consumer today: [`vscode-containerlab`](https://github.com/srl-labs/vscode-containerlab).

![containerlab-gui screenshot](resources/screenshot.png)

---

## What This Repo Contains

- React UI and topology editing logic used by containerlab webviews
- Shared parsing/core utilities used by the extension host
- A local browser dev harness (`npm run dev`) for fast UI iteration
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
| Main UI package | `@srl-labs/clab-ui` | Published | Published to GitHub Packages |
| Host contract | `@srl-labs/clab-host-contract` | Workspace-only | `private: true` |
| API adapter | `@srl-labs/clab-adapter-api` | Workspace-only | `private: true` |
| VS Code adapter | `@srl-labs/clab-adapter-vscode` | Workspace-only | `private: true` |
| Memory adapter | `@srl-labs/clab-adapter-memory` | Workspace-only | Used by local dev harness |
| Standalone app | N/A | Planned | Dev harness exists; production standalone distribution is not complete yet |

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

Start the dev harness:

```bash
npm run dev
```

Then open `http://localhost:5173`.

Dev harness runtime model:

- Pure frontend runtime (no Node middleware backend in this repo)
- In-memory topology host using shared `TopologyHostCore`
- File/session persistence in browser `localStorage`
- Reset action restores seeded topologies from `dev/topologies-original/`

---

## Common Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Run Vite dev harness from `dev/` |
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

- The workspace also ships host adapter packages, but they are not published externally yet.
- Current UI host context APIs are imported from service subpaths (for example `@srl-labs/clab-ui/services/topologyHostClient`).

---

## Host Integration (Current)

The UI currently uses host messaging via `services/topologyHostClient`:

```ts
import { App } from "@srl-labs/clab-ui";
import { setHostContext } from "@srl-labs/clab-ui/services/topologyHostClient";
import { refreshTopologySnapshot } from "@srl-labs/clab-ui/services/topologyHostCommands";

setHostContext({
  path: "labs/my-lab.clab.yml",
  mode: "edit",
  deploymentState: "undeployed"
});

await refreshTopologySnapshot();
```

The adapter packages in `packages/adapter-*` are part of the transport direction but are currently workspace-only.

---

## Troubleshooting

- `npm install` fails with engine mismatch: ensure Node `>= 24` (`node -v`).
- Playwright tests fail before opening a browser: run `npx playwright install chromium`.
- Dev harness state feels stale: clear browser localStorage keys `containerlab-gui.dev.in-memory-labs.v1` and `containerlab-gui.dev.session.v1`.

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

## Standalone Roadmap Note

The standalone browser experience exists today as a dev harness (`npm run dev`) and is useful for UI iteration and testing.

A fully supported standalone distribution is planned but not complete yet. Until that lands, the production integration target remains `vscode-containerlab`.
