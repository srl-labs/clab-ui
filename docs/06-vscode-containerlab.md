# 6. vscode-containerlab

`vscode-containerlab` embeds `clab-ui` inside VS Code webviews and turns UI actions into extension-host operations.

## Core rule

The extension host owns the runtime contract. The webview does not.

That means:

- the webview renders shared UI from `clab-ui`
- the extension host owns commands, file access, and runtime access
- the bridge between them is explicit and message-driven

## Bridge layers

| Layer | Responsibility |
|---|---|
| `src/extension.ts` | backend registry initialization, command registration, and activation |
| `ReactTopoViewerProvider` | open or reuse topology viewers by lab path |
| `TopologyHostCore` | authoritative topology document state for the panel |
| `MessageRouter` | handles topology-host protocol messages and semantic UI commands |
| feature services | lifecycle, node actions, capture, icons, custom nodes, split view |
| watchers | push file and docker-image changes back to the webview |

## Topology viewer flow

1. VS Code registers `containerlab.lab.graph.topoViewer`.
2. `ReactTopoViewerProvider.openViewer(...)` reuses an existing viewer for the same `labPath` or creates a new one.
3. The provider creates a panel and initializes `TopologyHostCore`.
4. The webview sends either topology-host protocol messages or semantic UI commands.
5. `MessageRouter` routes those messages to the correct service.
6. The extension posts responses, snapshots, and push events back to the webview.

## Other webview flows

| Feature | Main entry points |
|---|---|
| Explorer | `src/webviews/explorer/*` |
| Inspect | `src/commands/inspect.ts`, `src/webviews/inspect/*` |
| Welcome | `src/welcomePage.ts`, `src/webviews/welcome/*` |
| Node impairments | `src/commands/nodeImpairments.ts`, `src/webviews/nodeImpairments/*` |
| Capture and Wireshark VNC | `src/commands/capture.ts`, `src/webviews/wiresharkVnc/*` |
| API endpoint profiles | `src/apiEndpoints/*`, `src/webviews/apiEndpoints/*` |

## Local `clab-ui` mode

The build config supports a strict sibling-repo override:

- if `CLAB_UI_SOURCE=local` and `../clab-ui/dist/index.js` exists, imports such as `@srl-labs/clab-ui/*` are rewritten to the local `dist/` tree
- otherwise the published package is used

In day-to-day usage you normally call the scripts that already set this flag for you:

```bash
npm run build:local-ui
npm run package:local-ui
```

## Local and API backends

The extension host can execute through its local containerlab/runtime adapter
and multiple direct clab-api-server adapters in parallel. The workspace router
aggregates read snapshots but sends every mutation to the backend id carried by
the selected resource. In every case the webview keeps the same
`window.postMessage` host contract. API URLs, TLS policy, login prompts,
and JWT storage stay in the extension host and are never sent to the webview.
For the API server's default self-signed certificate, the host performs a
credential-free probe, presents the SHA-256 fingerprint for explicit approval,
and pins that exact leaf certificate to the endpoint. This does not modify the
operating-system trust store, and a later certificate change must be approved
before a password or stored JWT is sent.

!!! info "Do not mentally model this as the web app inside VS Code"
    API mode does not embed `containerlab-app` or reuse its browser sessions.
    The VS Code extension owns its endpoint and secret-storage lifecycle, then
    maps backend results into the same transport-neutral `clab-ui` messages.

The endpoint manager therefore shares the `clab-ui` VS Code theme but remains a
VS Code host feature. Both hosts support concurrent endpoints, but the web app
uses BFF sessions while the extension owns direct SecretStorage sessions and
combines them with local runtime state.

## Operational prerequisites

Local integration expects an environment that can reach the runtime. Each API
integration independently requires a reachable, compatible clab-api-server and
a valid authenticated session. Failure of one does not disable the others.

Typical blockers are:

- the user is not in the required local groups such as `clab_admins` and `docker`
- the Docker socket is unavailable
- the API endpoint certificate is not trusted or the API token expired
- the extension command router and webview messages drift out of sync
