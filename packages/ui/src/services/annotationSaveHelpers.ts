/**
 * Annotation Save Helpers (Host-authoritative)
 */

import type { Node } from "@xyflow/react";

import type {
  FreeTextAnnotation,
  FreeShapeAnnotation,
  GroupStyleAnnotation,
  EdgeAnnotation,
  TopologyAnnotations
} from "../core/types/topology";
import type { TopologySessionClient } from "../session";

import { buildAnnotationNodesPayload } from "./annotationPayloads";
import { executeTopologyCommand } from "./topologyHostCommands";

const WARN_COMMAND_FAILED = "[Host] Annotation command failed";

export async function saveFreeTextAnnotations(
  client: TopologySessionClient,
  annotations: FreeTextAnnotation[]
): Promise<void> {
  try {
    await executeTopologyCommand({
      command: "setAnnotations",
      payload: { freeTextAnnotations: annotations }
    }, {}, client);
  } catch (err) {
    console.error(`${WARN_COMMAND_FAILED}: setAnnotations(freeTextAnnotations)`, err);
  }
}

export interface SaveAnnotationNodesOptions {
  /** Skip re-applying snapshot to avoid position snapback during continuous updates */
  applySnapshot?: boolean;
}

export async function saveAnnotationNodesFromGraph(
  client: TopologySessionClient,
  nodes?: Node[],
  options: SaveAnnotationNodesOptions = {}
): Promise<void> {
  try {
    await executeTopologyCommand(
      {
        command: "setAnnotations",
        payload: buildAnnotationNodesPayload(nodes)
      },
      { applySnapshot: options.applySnapshot ?? true },
      client
    );
  } catch (err) {
    console.error(`${WARN_COMMAND_FAILED}: setAnnotations(annotationNodes)`, err);
  }
}

export async function saveAnnotationNodesWithMemberships(
  client: TopologySessionClient,
  memberships: Array<{ id: string; groupId?: string }>,
  nodes?: Node[]
): Promise<void> {
  try {
    await executeTopologyCommand({
      command: "setAnnotationsWithMemberships",
      payload: {
        annotations: buildAnnotationNodesPayload(nodes),
        memberships: memberships.map((m) => ({ nodeId: m.id, groupId: m.groupId ?? null }))
      }
    }, {}, client);
  } catch (err) {
    console.error(`${WARN_COMMAND_FAILED}: setAnnotationsWithMemberships`, err);
  }
}

export async function saveFreeShapeAnnotations(
  client: TopologySessionClient,
  annotations: FreeShapeAnnotation[]
): Promise<void> {
  try {
    await executeTopologyCommand({
      command: "setAnnotations",
      payload: { freeShapeAnnotations: annotations }
    }, {}, client);
  } catch (err) {
    console.error(`${WARN_COMMAND_FAILED}: setAnnotations(freeShapeAnnotations)`, err);
  }
}

export async function saveGroupStyleAnnotations(
  client: TopologySessionClient,
  annotations: GroupStyleAnnotation[]
): Promise<void> {
  try {
    await executeTopologyCommand({
      command: "setAnnotations",
      payload: { groupStyleAnnotations: annotations }
    }, {}, client);
  } catch (err) {
    console.error(`${WARN_COMMAND_FAILED}: setAnnotations(groupStyleAnnotations)`, err);
  }
}

export async function saveEdgeAnnotations(
  client: TopologySessionClient,
  annotations: EdgeAnnotation[]
): Promise<void> {
  try {
    await executeTopologyCommand({ command: "setEdgeAnnotations", payload: annotations }, {}, client);
  } catch (err) {
    console.error(`${WARN_COMMAND_FAILED}: setEdgeAnnotations`, err);
  }
}

export async function saveViewerSettings(
  client: TopologySessionClient,
  settings: NonNullable<TopologyAnnotations["viewerSettings"]>
): Promise<void> {
  try {
    await executeTopologyCommand({ command: "setViewerSettings", payload: settings }, {}, client);
  } catch (err) {
    console.error(`${WARN_COMMAND_FAILED}: setViewerSettings`, err);
  }
}

export async function saveNodeGroupMembership(
  client: TopologySessionClient,
  nodeId: string,
  groupId: string | null
): Promise<void> {
  try {
    // Avoid snapshot re-apply here to prevent position snapback when membership changes
    // are sent separately from position saves during drag/drop.
    await executeTopologyCommand(
      { command: "setNodeGroupMembership", payload: { nodeId, groupId } },
      { applySnapshot: false },
      client
    );
  } catch (err) {
    console.error(`${WARN_COMMAND_FAILED}: setNodeGroupMembership`, err);
  }
}

export async function saveAllNodeGroupMemberships(
  client: TopologySessionClient,
  memberships: Array<{ id: string; groupId?: string }>
): Promise<void> {
  try {
    // Avoid snapshot re-apply here for the same reason as saveNodeGroupMembership.
    await executeTopologyCommand(
      {
        command: "setNodeGroupMemberships",
        payload: memberships.map((m) => ({ nodeId: m.id, groupId: m.groupId ?? null }))
      },
      { applySnapshot: false },
      client
    );
  } catch (err) {
    console.error(`${WARN_COMMAND_FAILED}: setNodeGroupMemberships`, err);
  }
}
