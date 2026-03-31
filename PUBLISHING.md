# Publishing `@srl-labs/clab-ui`

## Publish

1. Update version in `packages/ui/package.json`.
2. Commit and push.
3. Create tag `v<version>` matching `packages/ui/package.json` (for example `v0.0.2`).
4. Push the tag.

The `publish-package.yml` workflow publishes `@srl-labs/clab-ui` to GitHub Packages.

No wrapper packages are published separately. Consumers should stay on the explicit public surface:

- `@srl-labs/clab-ui`
- `@srl-labs/clab-ui/host`
- `@srl-labs/clab-ui/session`
- `@srl-labs/clab-ui/theme`
- `@srl-labs/clab-ui/explorer`
- `@srl-labs/clab-ui/inspect`
- `@srl-labs/clab-ui/welcome`
- `@srl-labs/clab-ui/node-impairments`
- `@srl-labs/clab-ui/wireshark-vnc`
- `@srl-labs/clab-ui/styles/global.css`

## Local publish (manual)

```bash
cd /home/flschwar/projects/clab/clab-ui
npm install
npm run typecheck
npm run publish:ui
```

## Consume from `vscode-containerlab`

```bash
cd /home/flschwar/projects/clab/vscode-containerlab
npm install
```

To pin another version:

```bash
node scripts/set-clab-package-source.mjs --source=github --version=<version>
npm install
```

Browser-side runtime integration is owned by `@srl-labs/clab-ui/host`.
