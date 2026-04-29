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

test("buildExplorerSnapshot disables running-only actions for stopped containers", async () => {
  const endpoint = {
    label: "Endpoint",
    contextValue: "containerlabEndpoint",
    state: "connected",
    collapsibleState: TREE_ITEM_COLLAPSED,
    children: [
      {
        label: "demo.clab.yml",
        contextValue: "containerlabLabDeployed",
        collapsibleState: TREE_ITEM_COLLAPSED,
        children: [
          {
            label: "leaf1",
            contextValue: "containerlabContainer",
            state: "exited",
            status: "Exited (0)",
            collapsibleState: 0
          }
        ]
      }
    ]
  };
  const providers = {
    runningProvider: provider([endpoint]),
    localProvider: provider([]),
    helpProvider: provider([])
  } as ExplorerSnapshotProviders;

  const { snapshot, actionBindings } = await buildExplorerSnapshot(providers, "", {
    hideNonOwnedLabs: false,
    isLocalCaptureAllowed: true
  });

  const runningSection = snapshot.sections.find((section) => section.id === "runningLabs");
  assert.ok(runningSection);
  const containerNode = runningSection.nodes[0].children[0].children[0];
  const actionByCommand = (commandId: string) =>
    containerNode.actions.find((action) => action.commandId === commandId);

  assert.equal(actionByCommand("containerlab.node.start")?.disabled, false);
  assert.equal(actionByCommand("containerlab.node.copyName")?.disabled, false);
  assert.equal(actionByCommand("containerlab.node.showLogs")?.disabled, true);
  assert.equal(actionByCommand("containerlab.node.attachShell")?.disabled, true);
  assert.equal(actionByCommand("containerlab.node.ssh")?.disabled, true);
  assert.equal(actionByCommand("containerlab.node.telnet")?.disabled, true);
  assert.equal(actionByCommand("containerlab.node.openBrowser")?.disabled, true);
  assert.equal(actionByCommand("containerlab.node.stop")?.disabled, true);
  assert.equal(actionByCommand("containerlab.node.restart")?.disabled, true);
  assert.equal(actionByCommand("containerlab.node.pause")?.disabled, true);
  assert.equal(actionByCommand("containerlab.node.unpause")?.disabled, true);
  assert.equal(actionByCommand("containerlab.node.save")?.disabled, true);
  assert.equal(actionByCommand("containerlab.node.manageImpairments")?.disabled, true);

  const logsAction = actionByCommand("containerlab.node.showLogs");
  assert.ok(logsAction);
  assert.equal(actionBindings.get(logsAction.actionRef)?.disabled, true);
});
