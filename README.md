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

## Publishing

This package is published to GitHub Packages as `@srl-labs/containerlab-gui`.

Release flow:

1. Update `package.json` version.
2. Create and push a matching git tag (`v<version>`, for example `v0.0.1`).
3. The `Publish Package` workflow publishes the package.

Notes:

- `prepack` runs `npm run build`, so `dist/` is generated automatically for the published tarball.
- Tag and package versions must match or the publish workflow fails.

## Installing from GitHub Packages

Add this to `.npmrc` in consuming repos:

```ini
@srl-labs:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```
