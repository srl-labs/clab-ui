/**
 * Webview Services (Host-authoritative)
 */

export { executeTopologyCommand, executeTopologyCommands } from "./topologyHostCommands";
export { refreshTopologySnapshot } from "./topologyHostCommands";
export {
  setHostContext,
  getHostContext,
  getHostRevision,
  setHostRevision
} from "./topologyHostClient";
export { toLinkSaveData } from "./linkSaveData";

export {
  saveEdgeAnnotations,
  saveViewerSettings,
  saveNodeGroupMembership,
  saveAllNodeGroupMemberships,
  saveAnnotationNodesFromGraph,
  saveAnnotationNodesWithMemberships
} from "./annotationSaveHelpers";

export {
  createNode,
  deleteNode,
  createLink,
  deleteLink,
  buildNetworkNodeAnnotations,
  saveNetworkNodesFromGraph,
  saveNodePositions,
  saveNodePositionsWithAnnotations,
  saveNodePositionsWithMemberships
} from "./topologyCrud";

export type { NodeSaveData, LinkSaveData, NetworkNodeData } from "./topologyCrud";

export { getCustomIconMap, buildCustomIconMap } from "../utils/iconUtils";
