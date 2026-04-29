import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import type { Edge } from "@xyflow/react";

import type { TopoEdge } from "../core/types/graph";
import type { HostRuntimeContainer, HostRuntimeInterfaceStats } from "../host";
import { useGraphStore } from "../stores/graphStore";

import { applyRuntimeEdgeStatsToGraph, clearTopologyGraph } from "./runtimeGraphUpdates";

function createStats(rxBps: number, txBps: number): HostRuntimeInterfaceStats {
  return {
    rxBps,
    txBps,
    rxPps: rxBps / 1000,
    txPps: txBps / 1000,
    rxBytes: rxBps * 2,
    txBytes: txBps * 2,
    rxPackets: rxBps / 100,
    txPackets: txBps / 100,
    statsIntervalSeconds: 1
  };
}

function createRuntimeContainer(
  nodeName: string,
  stats: HostRuntimeInterfaceStats
): HostRuntimeContainer {
  return {
    name: `clab-demo-${nodeName}`,
    nodeName,
    labName: "demo",
    state: "running",
    kind: "nokia_srlinux",
    image: "ghcr.io/nokia/srlinux:latest",
    ipv4Address: "",
    ipv6Address: "",
    interfaces: [
      {
        name: "e1-1",
        alias: "ethernet-1/1",
        label: "ethernet-1/1",
        mac: `02:42:ac:11:00:${nodeName === "srl1" ? "01" : "02"}`,
        mtu: 1500,
        state: "up",
        type: "veth",
        stats
      }
    ]
  };
}

function createRuntimeContainers(
  sourceStats: HostRuntimeInterfaceStats,
  targetStats: HostRuntimeInterfaceStats
): HostRuntimeContainer[] {
  return [
    createRuntimeContainer("srl1", sourceStats),
    createRuntimeContainer("srl2", targetStats)
  ];
}

function createEdge(id: string = "srl1:e1-1--srl2:e1-1"): TopoEdge {
  return {
    id,
    source: "srl1",
    target: "srl2",
    data: {
      sourceEndpoint: "ethernet-1/1",
      targetEndpoint: "ethernet-1/1",
      extraData: {
        existing: "preserved"
      }
    }
  };
}

function createUnmatchedEdge(): TopoEdge {
  return {
    id: "srl3:e1-1--srl4:e1-1",
    source: "srl3",
    target: "srl4",
    data: {
      sourceEndpoint: "ethernet-1/1",
      targetEndpoint: "ethernet-1/1",
      extraData: {}
    }
  };
}

function currentEdges(): Edge[] {
  return useGraphStore.getState().edges;
}

afterEach(() => {
  useGraphStore.getState().setGraph([], []);
});

test("applies live runtime interface stats to existing graph edges", () => {
  const edge = createEdge();
  const sourceStats = createStats(1000, 2000);
  const targetStats = createStats(3000, 4000);
  useGraphStore.getState().setGraph([], [edge]);

  const changed = applyRuntimeEdgeStatsToGraph(createRuntimeContainers(sourceStats, targetStats), {
    currentLabName: "demo"
  });

  const [updatedEdge] = currentEdges() as TopoEdge[];
  assert.equal(changed, true);
  assert.notEqual(updatedEdge, edge);
  assert.deepEqual(updatedEdge?.data?.extraData?.clabSourceStats, sourceStats);
  assert.deepEqual(updatedEdge?.data?.extraData?.clabTargetStats, targetStats);
  assert.equal(updatedEdge?.data?.extraData?.existing, "preserved");
});

test("skips graph writes when live runtime stats are unchanged", () => {
  const edge = createEdge();
  const sourceStats = createStats(1000, 2000);
  const targetStats = createStats(3000, 4000);
  const containers = createRuntimeContainers(sourceStats, targetStats);
  useGraphStore.getState().setGraph([], [edge]);

  assert.equal(applyRuntimeEdgeStatsToGraph(containers, { currentLabName: "demo" }), true);
  const [edgeAfterFirstUpdate] = currentEdges();
  assert.equal(applyRuntimeEdgeStatsToGraph(containers, { currentLabName: "demo" }), false);

  assert.equal(currentEdges()[0], edgeAfterFirstUpdate);
});

test("preserves unrelated edge references while applying runtime stats", () => {
  const matchingEdge = createEdge();
  const unmatchedEdge = createUnmatchedEdge();
  useGraphStore.getState().setGraph([], [matchingEdge, unmatchedEdge]);

  const changed = applyRuntimeEdgeStatsToGraph(
    createRuntimeContainers(createStats(1000, 2000), createStats(3000, 4000)),
    { currentLabName: "demo" }
  );

  const [updatedMatchingEdge, updatedUnmatchedEdge] = currentEdges();
  assert.equal(changed, true);
  assert.notEqual(updatedMatchingEdge, matchingEdge);
  assert.equal(updatedUnmatchedEdge, unmatchedEdge);
});

test("clears graph state when the active topology closes", () => {
  useGraphStore.getState().setGraph([], [createEdge()]);

  clearTopologyGraph();

  assert.deepEqual(currentEdges(), []);
});
