import assert from "node:assert/strict";
import test from "node:test";

import type { HostRuntimeContainer } from "../host";
import type { TopoEdge } from "../core/types/graph";

import { buildRuntimeEdgeStatsUpdates, createRuntimeContainerDataProvider } from "./runtime";

const runtimeContainers: HostRuntimeContainer[] = [
  {
    name: "clab-demo-srl1",
    nodeName: "srl1",
    labName: "demo",
    state: "running",
    kind: "nokia_srlinux",
    image: "ghcr.io/nokia/srlinux:latest",
    ipv4Address: "172.20.20.2/24",
    ipv6Address: "",
    interfaces: [
      {
        name: "e1-1",
        alias: "",
        label: "ethernet-1/1",
        mac: "02:42:ac:11:00:01",
        mtu: 1500,
        state: "up",
        type: "veth",
        ifIndex: 42,
        netemState: { delay: "10ms" }
      }
    ]
  },
  {
    name: "clab-demo-srl2",
    nodeName: "srl2",
    labName: "demo",
    state: "running",
    kind: "nokia_srlinux",
    image: "ghcr.io/nokia/srlinux:latest",
    ipv4Address: "172.20.20.3/24",
    ipv6Address: "",
    interfaces: [
      {
        name: "e1-1",
        alias: "ethernet-1/1",
        mac: "02:42:ac:11:00:02",
        mtu: 1500,
        state: "up",
        type: "veth",
        ifIndex: 43
      }
    ]
  }
];

test("runtime provider resolves interfaces by display label", () => {
  const provider = createRuntimeContainerDataProvider(runtimeContainers);
  const iface = provider.findInterface("srl1", "ethernet-1/1", "demo");

  assert.equal(iface?.name, "e1-1");
  assert.equal(iface?.label, "ethernet-1/1");
  assert.equal(iface?.netemState?.delay, "10ms");
});

test("runtime edge updates carry netem state from label-matched interfaces", () => {
  const edge: TopoEdge = {
    id: "srl1:ethernet-1/1--srl2:ethernet-1/1",
    source: "srl1",
    target: "srl2",
    data: {
      id: "srl1:ethernet-1/1--srl2:ethernet-1/1",
      source: "srl1",
      target: "srl2",
      sourceEndpoint: "ethernet-1/1",
      targetEndpoint: "ethernet-1/1",
      extraData: {}
    }
  } as TopoEdge;

  const [update] = buildRuntimeEdgeStatsUpdates([edge], runtimeContainers, {
    currentLabName: "demo",
    topology: undefined
  });

  assert.equal(update?.extraData.clabSourceInterfaceState, "up");
  assert.deepEqual(update?.extraData.clabSourceNetem, { delay: "10ms" });
});
