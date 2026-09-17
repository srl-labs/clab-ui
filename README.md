# clab-ui

> [!IMPORTANT]
> Development has moved to [srl-labs/containerlab-app](https://github.com/srl-labs/containerlab-app).
> This repository is retained for historical reference.

The shared Containerlab UI is now maintained in
[`packages/clab-ui`](https://github.com/srl-labs/containerlab-app/tree/main/packages/clab-ui),
alongside the web app, desktop app, and VS Code extension that use it.

Please open issues and submit pull requests in **containerlab-app**.

- [Source code and current README](https://github.com/srl-labs/containerlab-app/tree/main/packages/clab-ui)
- [Issue tracker](https://github.com/srl-labs/containerlab-app/issues)
- [Integration guide](https://github.com/srl-labs/containerlab-app/blob/main/packages/clab-ui/INTEGRATORS.md)
- [Development guide](https://github.com/srl-labs/containerlab-app/blob/main/README.md)
- [Release guide](https://github.com/srl-labs/containerlab-app/blob/main/RELEASING.md)
- [Releases](https://github.com/srl-labs/containerlab-app/releases) (UI tags: `clab-ui-v<version>`)

## Package migration

The package is now named `@containerlab/clab-ui`. Consumers migrating from
`@srl-labs/clab-ui` should update the dependency name and import paths. See the
[current package README](https://github.com/srl-labs/containerlab-app/blob/main/packages/clab-ui/README.md)
for installation instructions and supported exports.
