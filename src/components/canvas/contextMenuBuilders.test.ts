import assert from "node:assert/strict";
import test from "node:test";

import type { TopoViewerNodeAction } from "../../host";

import { buildNodeContextMenu } from "./contextMenuBuilders";
import type { ContextMenuItem } from "../context-menu/ContextMenu";

function buildViewNodeMenu(runtimeState?: "running" | "stopped" | "paused" | "undeployed") {
  const actions: Array<{ action: TopoViewerNodeAction; nodeName: string }> = [];
  const items = buildNodeContextMenu({
    targetId: "srl1",
    targetNodeType: "topology-node",
    targetRuntimeState: runtimeState,
    isEditMode: false,
    isLocked: false,
    onNodeAction: (action, nodeName) => actions.push({ action, nodeName }),
    closeContextMenu: () => {},
    editNode: () => {},
    editNetwork: () => {},
    handleDeleteNode: () => {},
    showNodeInfo: () => {}
  });
  return { actions, items };
}

function itemById(items: ContextMenuItem[], id: string): ContextMenuItem {
  const item = items.find((candidate) => candidate.id === id);
  assert.ok(item, `missing context menu item ${id}`);
  return item;
}

test("view node context menu disables running-only actions for stopped nodes", () => {
  const { items } = buildViewNodeMenu("stopped");

  assert.equal(itemById(items, "start-node").disabled, undefined);
  assert.equal(itemById(items, "info-node").disabled, undefined);
  assert.equal(itemById(items, "stop-node").disabled, true);
  assert.equal(itemById(items, "restart-node").disabled, true);
  assert.equal(itemById(items, "ssh-node").disabled, true);
  assert.equal(itemById(items, "shell-node").disabled, true);
  assert.equal(itemById(items, "logs-node").disabled, true);
});

test("view node context menu keeps runtime actions enabled for running nodes", () => {
  const { items } = buildViewNodeMenu("running");

  assert.equal(itemById(items, "stop-node").disabled, false);
  assert.equal(itemById(items, "restart-node").disabled, false);
  assert.equal(itemById(items, "ssh-node").disabled, false);
  assert.equal(itemById(items, "shell-node").disabled, false);
  assert.equal(itemById(items, "logs-node").disabled, false);
});
