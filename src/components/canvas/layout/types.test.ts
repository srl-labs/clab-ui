import assert from "node:assert/strict";
import test from "node:test";

import type { Node } from "@xyflow/react";

import { hasPresetPositions, isLayoutParticipant, normalizeLayoutableNodePositions } from "./types";

function node(id: string, type: string, x: number, y: number): Node {
  return {
    id,
    type,
    position: { x, y },
    data: {}
  };
}

test("normalizes and extracts only layoutable node positions", () => {
  const topologyNode = node("leaf1", "topology-node", 10.2, 20.8);
  const networkNode = node("mgmt", "network-node", 30.4, 40.4);
  const annotationNode = node("traffic-rate-1", "traffic-rate-node", 50.2, 60.8);
  const nodes = [topologyNode, networkNode, annotationNode];

  const result = normalizeLayoutableNodePositions(nodes, (position) => ({
    x: Math.round(position.x),
    y: Math.round(position.y)
  }));

  assert.deepEqual(result.positions, [
    { id: "leaf1", position: { x: 10, y: 21 } },
    { id: "mgmt", position: { x: 30, y: 40 } }
  ]);
  assert.deepEqual(result.nodes[0]?.position, { x: 10, y: 21 });
  assert.deepEqual(result.nodes[1]?.position, { x: 30, y: 40 });
  assert.equal(result.nodes[2], annotationNode);
});

test("normalizes hidden layoutable nodes so their stored positions survive", () => {
  const hiddenNode = { ...node("dummy0", "network-node", 30.4, 40.4), hidden: true };
  const nodes = [node("leaf1", "topology-node", 10.2, 20.8), hiddenNode];

  const result = normalizeLayoutableNodePositions(nodes, (position) => ({
    x: Math.round(position.x),
    y: Math.round(position.y)
  }));

  assert.deepEqual(result.positions, [
    { id: "leaf1", position: { x: 10, y: 21 } },
    { id: "dummy0", position: { x: 30, y: 40 } }
  ]);
});

test("isLayoutParticipant excludes hidden nodes and non-layoutable types", () => {
  assert.equal(isLayoutParticipant(node("leaf1", "topology-node", 0, 0)), true);
  assert.equal(isLayoutParticipant(node("mgmt", "network-node", 0, 0)), true);
  assert.equal(isLayoutParticipant(node("text-1", "free-text-node", 0, 0)), false);
  assert.equal(
    isLayoutParticipant({ ...node("dummy0", "network-node", 0, 0), hidden: true }),
    false
  );
});

test("hasPresetPositions ignores positions of hidden nodes", () => {
  const visibleAtOrigin = node("leaf1", "topology-node", 0, 0);
  const hiddenWithPosition = { ...node("dummy0", "network-node", 400, 300), hidden: true };

  assert.equal(hasPresetPositions([visibleAtOrigin, hiddenWithPosition]), false);
  assert.equal(
    hasPresetPositions([node("leaf1", "topology-node", 400, 300), hiddenWithPosition]),
    true
  );
});
