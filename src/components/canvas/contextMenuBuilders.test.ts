import assert from "node:assert/strict";
import test from "node:test";

import type { TopoViewerNodeAction } from "../../host";

import { buildEdgeContextMenu, buildNodeContextMenu } from "./contextMenuBuilders";
import type { ContextMenuItem } from "../context-menu/ContextMenu";
import { FREE_TEXT_NODE_TYPE } from "../../annotations/annotationNodeConverters";

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

test("edge capture menu displays topology names but invokes runtime container names", () => {
  const captures: Array<{ nodeName: string; interfaceName: string }> = [];
  const items = buildEdgeContextMenu({
    targetId: "edge-1",
    sourceNode: '${LAB_PREFIX:-""}-srl-mirroring-lab-leaf1',
    targetNode: '${LAB_PREFIX:-""}-srl-mirroring-lab-leaf2',
    sourceEndpoint: "e1-1",
    targetEndpoint: "e1-50",
    extraData: {
      yamlSourceNodeId: "leaf1",
      yamlTargetNodeId: "leaf2",
      clabSourceLongName: '${LAB_PREFIX:-""}-srl-mirroring-lab-leaf1',
      clabTargetLongName: '${LAB_PREFIX:-""}-srl-mirroring-lab-leaf2'
    },
    isEditMode: false,
    isLocked: false,
    onInterfaceCapture: (nodeName, interfaceName) => captures.push({ nodeName, interfaceName }),
    closeContextMenu: () => {},
    editEdge: () => {},
    handleDeleteEdge: () => {}
  });

  const sourceCapture = itemById(items, "capture-source");
  const targetCapture = itemById(items, "capture-target");

  assert.equal(sourceCapture.label, "leaf1 - e1-1");
  assert.equal(targetCapture.label, "leaf2 - e1-50");

  targetCapture.onClick?.();
  assert.deepEqual(captures, [
    {
      nodeName: '${LAB_PREFIX:-""}-srl-mirroring-lab-leaf2',
      interfaceName: "e1-50"
    }
  ]);
});

test("free text context menu offers Duplicate Text that duplicates the target and closes", () => {
  const duplicated: string[] = [];
  let closes = 0;
  const items = buildNodeContextMenu({
    targetId: "freeText_1",
    targetNodeType: FREE_TEXT_NODE_TYPE,
    isEditMode: true,
    isLocked: false,
    onNodeAction: () => {},
    closeContextMenu: () => {
      closes += 1;
    },
    editNode: () => {},
    editNetwork: () => {},
    handleDeleteNode: () => {},
    editFreeText: () => {},
    deleteFreeText: () => {},
    duplicateFreeText: (id) => duplicated.push(id)
  });

  const duplicateItem = itemById(items, "duplicate-text");
  assert.equal(duplicateItem.label, "Duplicate Text");

  duplicateItem.onClick?.();
  assert.deepEqual(duplicated, ["freeText_1"]);
  assert.equal(closes, 1);
});

test("free text context menu hides Duplicate Text when locked", () => {
  const items = buildNodeContextMenu({
    targetId: "freeText_1",
    targetNodeType: FREE_TEXT_NODE_TYPE,
    isEditMode: true,
    isLocked: true,
    onNodeAction: () => {},
    closeContextMenu: () => {},
    editNode: () => {},
    editNetwork: () => {},
    handleDeleteNode: () => {},
    editFreeText: () => {},
    deleteFreeText: () => {},
    duplicateFreeText: () => {}
  });

  assert.equal(
    items.find((item) => item.id === "duplicate-text"),
    undefined
  );
});
