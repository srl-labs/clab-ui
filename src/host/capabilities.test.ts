import assert from "node:assert/strict";
import test from "node:test";

import {
  ALL_CLAB_UI_HOST_CAPABILITIES,
  createClabUiHostCapabilities,
  resolveClabUiHostCapabilities
} from "./capabilities";

test("legacy hosts retain the complete historical capability surface", () => {
  assert.equal(
    resolveClabUiHostCapabilities({ capabilities: undefined }),
    ALL_CLAB_UI_HOST_CAPABILITIES
  );
});

test("new capability sets default unavailable operations closed", () => {
  const capabilities = createClabUiHostCapabilities({
    lifecycleActions: {
      applyLab: true,
      destroyLab: true
    },
    nodeActions: {
      ssh: true
    },
    features: {
      splitView: true
    }
  });

  assert.equal(capabilities.lifecycleActions.applyLab, true);
  assert.equal(capabilities.lifecycleActions.deployLabCleanup, false);
  assert.equal(capabilities.lifecycleActions.destroyLab, true);
  assert.equal(capabilities.nodeActions.ssh, true);
  assert.equal(capabilities.nodeActions.shell, false);
  assert.equal(capabilities.features.interfaceCapture, false);
  assert.equal(capabilities.features.splitView, true);
});
