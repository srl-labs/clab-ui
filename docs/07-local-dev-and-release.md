# 7. Local Dev and Release

This page is the practical workflow for iterating across the sibling repos without guessing which artifact a consumer is actually using.

## Fastest loop when changing `clab-ui`

1. Build `clab-ui`.
2. Start the consumer in its local-ui mode.
3. Rebuild `clab-ui` every time you change the shared package.

### Step 1: build the shared package

```bash
cd /home/flschwar/projects/clab/clab-ui
npm install
npm run build
```

### Step 2A: run `containerlab-app` against the local package

```bash
cd /home/flschwar/projects/clab/containerlab-app
npm install
npm run dev:web:local
```

`dev:local` already enables local-ui mode and fails early if `../clab-ui/dist` is missing.

### Step 2B: build or package `vscode-containerlab` against the local package

```bash
cd /home/flschwar/projects/clab/vscode-containerlab
npm install
npm run build:local-ui
npm run package:local-ui
```

These scripts also set local-ui mode for you.

## When to rebuild `clab-ui`

Rebuild whenever you change anything that affects published output, including:

- React UI components
- host contracts or runtime helpers
- session or message types
- feature entrypoints
- shared styles

If a consumer still shows old behavior after a rebuild, restart that consumer too.

## Published-package flow

Use the published package flow when you want to test the same artifact other repos will consume from GitHub Packages.

For the API-backend and host-capability changes, release in this order. Do not
publish a consumer against a dependency version that is not available from
GitHub Packages yet.

| Order | Repository | Required release action | Consumer gate |
|---|---|---|---|
| 1 | `clab-api-server` | Release a version newer than `v0.5.0` containing `/api/v1/session`, `/api/v1/capabilities`, and the hardened archive/workspace behavior. | Verify the published server before changing either consumer's minimum supported contract. |
| 2 | `clab-ui` | Publish `@srl-labs/clab-ui` `0.3.1` from the matching `v0.3.1` tag. | Confirm `.github/workflows/publish-package.yml` completed and `npm view @srl-labs/clab-ui@0.3.1` succeeds with package credentials. |
| 3 | `containerlab-app` | Change both workspace dependencies and `package-lock.json` from `0.3.0` to `0.3.1`, run the published-package build/tests, then bump the app above the already released `0.2.0`. | Do not publish the container or desktop artifacts while the lock still resolves `clab-ui` `0.3.0`. |
| 4 | `vscode-containerlab` | Change the dependency and lock to `0.3.1`, replace temporary structural capability types with the exported `clab-ui` type, run packaging/tests, then bump the extension above the already released `0.26.0`. | Inspect the VSIX and verify it was built from the published package rather than local-ui mode. |

The `clab-ui` publish sequence itself is:

1. Confirm `package.json` and `package-lock.json` both contain `0.3.1`.
2. Commit and push the validated package changes.
3. Create and push the matching `v0.3.1` tag.
4. Let `.github/workflows/publish-package.yml` publish the package.
5. Only after publication succeeds, open the dependency and version bumps in
   the two consumer repositories.

The consumer dependency bumps are intentionally not part of the unpublished
multi-repository change: their normal CI and release jobs install from GitHub
Packages and must not point at `0.3.1` before it exists.

### Cross-repository contract gate still required

Repository-local CI cannot compile sibling pull-request refs without an
explicit cross-repository checkout or artifact handoff. The `clab-ui` PR job
therefore builds and dry-runs the real npm package, while local integration
validation must build both consumers against `../clab-ui/dist` before the
package is published.

A follow-up release gate should publish a runtime-neutral TypeScript client
from the `clab-api-server` OpenAPI contract and trigger consumer compatibility
jobs after API/client and `clab-ui` publication. Until that gate exists:

- treat the server OpenAPI document as the wire-contract source of truth
- run both consumer local-ui typechecks/builds for shared UI changes
- exercise JSON, fragmented NDJSON, cancellation, and WebSocket fixtures in
  each transport owner
- do not copy API DTOs or transport code into `clab-ui`

## Environment variables you are likely to touch

| Variable | Used in | Purpose |
|---|---|---|
| `CLAB_UI_SOURCE=local` | local consumer builds | switch imports from published package to sibling `../clab-ui/dist` |
| `CLAB_API_URL` | `containerlab-app` server | default API endpoint offered by the browser host |
| `GITHUB_TOKEN` | local npm install flows | GitHub Packages authentication |
| `NODE_AUTH_TOKEN` | publish workflow | package publish authentication |
| `JWT_SECRET` | `clab-api-server` | secure JWT signing |

## Recommended order when debugging integration regressions

1. Confirm `clab-ui/dist` was rebuilt.
2. Confirm the consumer is actually using local-ui mode when you expect it to.
3. Confirm the host-specific bridge still matches the package contract.
4. Only then investigate deeper auth, ownership, or runtime problems.

## Sanity commands per repo

```bash
cd /home/flschwar/projects/clab/clab-ui && npm run build && npm run lint && npm run test:unit
cd /home/flschwar/projects/clab/containerlab-app && npm run build && npm run lint && npm run test:unit
cd /home/flschwar/projects/clab/vscode-containerlab && npm run lint && npm test
cd /home/flschwar/projects/clab/clab-api-server && task && task test
```
