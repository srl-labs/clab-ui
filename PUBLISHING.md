# Publishing `@srl-labs/clab-ui`

## Publish

1. Update version in `packages/ui/package.json`.
2. Commit and push.
3. Create tag `v<version>` matching `packages/ui/package.json` (for example `v0.0.2`).
4. Push the tag.

The `publish-package.yml` workflow publishes `@srl-labs/clab-ui` to GitHub Packages.

No wrapper packages are published separately; consume browser runtime, core, explorer, and inspect APIs from
`@srl-labs/clab-ui` subpath exports.

## Local publish (manual)

```bash
cd /home/clab/projects/clab/containerlab-gui
npm install
npm run typecheck
npm run publish:ui
```

## Consume from `vscode-containerlab`

```bash
cd /home/clab/projects/clab/vscode-containerlab
npm run deps:source:github
npm install
```

To pin another version:

```bash
node scripts/set-clab-package-source.mjs --source=github --version=<version>
npm install
```

Browser-side runtime integration is owned by `@srl-labs/clab-ui/host`.
