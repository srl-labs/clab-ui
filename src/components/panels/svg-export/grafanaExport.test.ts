import assert from "node:assert/strict";
import test from "node:test";
import type { Edge, Node } from "@xyflow/react";

import { TRAFFIC_RATE_NODE_TYPE } from "../../../annotations/annotationNodeConverters";

import {
  buildGrafanaPanelYaml,
  collectGrafanaEdgeCellMappings,
  collectGrafanaTrafficRateLabelPlacements
} from "./grafanaExport";

const annotationNodeTypes = new Set<string>([TRAFFIC_RATE_NODE_TYPE]);

test("traffic-rate annotations provide Grafana label placement and metric refs", () => {
  const nodes: Node[] = [
    { id: "srl1", type: "topology-node", position: { x: 0, y: 0 }, data: {} },
    { id: "srl2", type: "topology-node", position: { x: 200, y: 0 }, data: {} },
    {
      id: "rate-source",
      type: TRAFFIC_RATE_NODE_TYPE,
      position: { x: 10, y: 20 },
      width: 100,
      height: 30,
      data: { nodeId: "srl1", interfaceName: "e1-1", textMetric: "rx" }
    },
    {
      id: "rate-target",
      type: TRAFFIC_RATE_NODE_TYPE,
      position: { x: 200, y: 20 },
      width: 100,
      height: 30,
      data: { nodeId: "srl2", interfaceName: "e1-2", textMetric: "combined" }
    }
  ];
  const edges: Edge[] = [
    {
      id: "edge-1",
      source: "srl1",
      target: "srl2",
      data: {
        sourceEndpoint: "e1-1",
        targetEndpoint: "e1-2"
      }
    }
  ];

  const mappings = collectGrafanaEdgeCellMappings(edges, nodes, annotationNodeTypes);
  const placements = collectGrafanaTrafficRateLabelPlacements(nodes, mappings);

  assert.equal(mappings.length, 1);
  assert.deepEqual(placements, [
    {
      labelCellId: "link_id:srl1:e1-1:srl2:e1-2:label",
      x: 60,
      y: 35,
      dataRef: "srl1:e1-1:in"
    },
    {
      labelCellId: "link_id:srl2:e1-2:srl1:e1-1:label",
      x: 250,
      y: 35,
      dataRef: "srl2:e1-2:out"
    }
  ]);

  const yaml = buildGrafanaPanelYaml(mappings, { trafficRateLabelPlacements: placements });
  assert.ok(
    yaml.includes('"link_id:srl1:e1-1:srl2:e1-2:label":\n    dataRef: "srl1:e1-1:in"')
  );
  assert.ok(
    yaml.includes('"link_id:srl2:e1-2:srl1:e1-1:label":\n    dataRef: "srl2:e1-2:out"')
  );
});
