import assert from "node:assert/strict";
import test from "node:test";

import { resolveClabUiHostCapabilities } from "../host/capabilities";

import { createViewerHost } from "./createViewerHost";

test("read-only viewer host explicitly disables unsupported semantic actions", () => {
  const host = createViewerHost({
    yaml: "name: viewer\ntopology:\n  nodes: {}\n"
  });

  const capabilities = resolveClabUiHostCapabilities(host);
  assert.equal(capabilities.lifecycleActions.applyLab, false);
  assert.equal(capabilities.nodeActions.ssh, false);
  assert.equal(capabilities.features.interfaceCapture, false);
  assert.equal(capabilities.features.linkImpairment, false);
  assert.equal(capabilities.features.grafanaExport, false);
  assert.equal(capabilities.features.splitView, false);
});
