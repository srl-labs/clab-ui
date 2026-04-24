import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExplorerSnapshot,
  type ExplorerSnapshotProviders
} from "./explorerSnapshotAdapter";

const TREE_ITEM_COLLAPSED = 1;

function provider(roots: unknown[]): { getChildren(element?: unknown): unknown[] } {
  return {
    getChildren(element?: unknown): unknown[] {
      if (
        typeof element === "object" &&
        element !== null &&
        "children" in element &&
        Array.isArray((element as { children?: unknown }).children)
      ) {
        return (element as { children: unknown[] }).children;
      }
      return roots;
    }
  };
}

test("buildExplorerSnapshot hides configured node and toolbar commands", async () => {
  const endpoint = {
    label: "Endpoint",
    contextValue: "containerlabEndpoint",
    state: "connected",
    collapsibleState: TREE_ITEM_COLLAPSED,
    children: [
      {
        label: "demo.clab.yml",
        contextValue: "containerlabLabUndeployed",
        collapsibleState: 0
      }
    ]
  };
  const providers = {
    runningProvider: provider([endpoint]),
    localProvider: provider([]),
    helpProvider: provider([])
  } as ExplorerSnapshotProviders;

  const { snapshot } = await buildExplorerSnapshot(providers, "", {
    hideNonOwnedLabs: false,
    isLocalCaptureAllowed: true,
    hiddenCommandIds: [
      "containerlab.lab.openFolderInNewWindow",
      "containerlab.install.edgeshark",
      "containerlab.inspectAll"
    ]
  });

  const runningSection = snapshot.sections.find((section) => section.id === "runningLabs");
  assert.ok(runningSection);
  assert.equal(
    runningSection.toolbarActions.some((action) => action.commandId === "containerlab.inspectAll"),
    false
  );

  const endpointNode = runningSection.nodes[0];
  assert.equal(
    endpointNode.actions.some((action) => action.commandId === "containerlab.install.edgeshark"),
    false
  );
  assert.equal(
    endpointNode.actions.some((action) => action.commandId === "containerlab.uninstall.edgeshark"),
    true
  );

  const labNode = endpointNode.children[0];
  assert.equal(
    labNode.actions.some(
      (action) => action.commandId === "containerlab.lab.openFolderInNewWindow"
    ),
    false
  );
});
