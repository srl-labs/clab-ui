import type { ReactFlowInstance } from "@xyflow/react";
import type { StyleSpecification } from "maplibre-gl";

import type { GroupStyleAnnotation } from "../core/types/topology";
import type { NetworkType } from "../core/types/editors";
import type { TopoNode } from "../core/types/graph";
import type { CustomIconInfo } from "../core/types/icons";
import type { CustomNodeTemplate, SchemaData } from "../core/schema";

type LayoutOption = "preset" | "force" | "geo";

export interface DevModeInterface {
  isLocked?: () => boolean;
  mode?: () => "edit" | "view";
  setLocked?: (locked: boolean) => void;
  setModeState?: (mode: "edit" | "view") => void;
  undoRedo?: {
    canUndo: boolean;
    canRedo: boolean;
  };
  handleEdgeCreated?: (
    sourceId: string,
    targetId: string,
    edgeData: {
      id: string;
      source: string;
      target: string;
      sourceEndpoint: string;
      targetEndpoint: string;
    }
  ) => void;
  handleNodeCreatedCallback?: (
    nodeId: string,
    nodeElement: TopoNode,
    position: { x: number; y: number }
  ) => void;
  createGroupFromSelected?: () => void;
  createNetworkAtPosition?: (
    position: { x: number; y: number },
    networkType: NetworkType
  ) => string | null;
  openNetworkEditor?: (nodeId: string | null) => void;
  openNodeEditor?: (nodeId: string | null) => void;
  getReactGroups?: () => GroupStyleAnnotation[];
  groupsCount?: number;
  getElements?: () => unknown[];
  setLayout?: (layout: LayoutOption) => void;
  isGeoLayout?: () => boolean;
  rfInstance?: ReactFlowInstance;
  selectedNode?: () => string | null;
  selectedEdge?: () => string | null;
  selectNode?: (nodeId: string | null) => void;
  selectEdge?: (edgeId: string | null) => void;
  selectNodesForClipboard?: (nodeIds: string[]) => void;
  clearNodeSelection?: () => void;
  toggleDummyLinks?: () => void;
}

export interface WebviewInitialData {
  schemaData?: SchemaData;
  dockerImages?: string[];
  customNodes?: CustomNodeTemplate[];
  defaultNode?: string;
  customIcons?: CustomIconInfo[];
  [key: string]: unknown;
}

declare global {
  interface Window {
    __DEV__?: DevModeInterface;
    __INITIAL_DATA__?: unknown;
    __DOCKER_IMAGES__?: string[];
    maplibreStyle?: StyleSpecification;
    maplibreWorkerUrl?: string;
    maplibreWorkerSourceBase64?: string;
  }
}
