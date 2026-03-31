import type {
  TopologyHostCommand,
  TopologyHostResponseMessage,
  TopologySnapshot
} from "../core/types/messages";
import type { TopologyRef } from "../contract/topologyRef";
import type { DeploymentState } from "../core/types/topology";
import type {
  ExplorerIncomingMessage,
  ExplorerUiState
} from "../explorer/shared/explorer/types";

export type TopoViewerLifecycleAction =
  | "deployLab"
  | "deployLabCleanup"
  | "destroyLab"
  | "destroyLabCleanup"
  | "redeployLab"
  | "redeployLabCleanup";

export type TopoViewerNodeAction = "ssh" | "shell" | "logs";

export interface TopoViewerSvgExportPayload {
  requestId: string;
  baseName: string;
  svgContent: string;
  dashboardJson: string;
  panelYaml: string;
}

export type ClabUiTopoViewerEvent =
  | {
      type: "modeChanged";
      mode: "editor" | "viewer";
      deploymentState: DeploymentState;
    }
  | {
      type: "panelAction";
      action: string;
      nodeId?: string;
      edgeId?: string;
    }
  | {
      type: "customNodesUpdated";
      customNodes: unknown[];
      defaultNode: string;
    }
  | {
      type: "customNodeError";
      error: string;
    }
  | {
      type: "iconList";
      icons: unknown[];
    }
  | {
      type: "lifecycleLog";
      line: string;
      stream: "stdout" | "stderr";
    }
  | {
      type: "lifecycleStatus";
      status: "success" | "error";
      errorMessage?: string;
    }
  | {
      type: "fitViewport";
    }
  | {
      type: "svgExportResult";
      requestId: string;
      success: boolean;
      error?: string;
      files?: string[];
    };

export interface HostRuntimeInterfaceStats {
  rxBps?: number;
  txBps?: number;
  rxPps?: number;
  txPps?: number;
  rxBytes?: number;
  txBytes?: number;
  rxPackets?: number;
  txPackets?: number;
  statsIntervalSeconds?: number;
}

export interface HostRuntimeInterface {
  name: string;
  alias: string;
  mac: string;
  mtu: number;
  state: string;
  type: string;
  ifIndex?: number;
  stats?: HostRuntimeInterfaceStats;
}

export interface HostRuntimeContainer {
  name: string;
  nodeName: string;
  labName: string;
  state: string;
  kind: string;
  image: string;
  ipv4Address: string;
  ipv6Address: string;
  interfaces?: HostRuntimeInterface[];
}

export interface TopologyUiContext {
  topologyRef?: TopologyRef;
  path?: string;
  mode?: "edit" | "view";
  deploymentState?: DeploymentState;
  sessionId?: string;
  runtimeContainers?: HostRuntimeContainer[];
}

export type TopologySessionContext = TopologyUiContext;

export interface TopologyUiRequestOptions {
  externalChange?: boolean;
}

export interface ClabUiExplorerHost {
  connect(): void;
  setFilter(filterText: string): void | Promise<void>;
  invokeAction(actionRef: string): void | Promise<void>;
  persistUiState(state: ExplorerUiState): void | Promise<void>;
  subscribe(handler: (message: ExplorerIncomingMessage) => void): () => void;
}

export interface ClabUiTopoViewerHost {
  runLifecycle(action: TopoViewerLifecycleAction): void;
  cancelLifecycle(): void;
  toggleSplitView(): void;
  runNodeAction(action: TopoViewerNodeAction, nodeName: string): void;
  captureInterface(nodeName: string, interfaceName: string): void;
  setLinkImpairment(nodeName: string, interfaceName: string, data: unknown): void;
  saveCustomNode(data: Record<string, unknown>): void;
  deleteCustomNode(nodeName: string): void;
  setDefaultCustomNode(nodeName: string): void;
  requestIconList(): void;
  uploadIcon(): void;
  deleteIcon(iconName: string): void;
  reconcileIcons(usedIcons: string[]): void;
  exportGrafanaBundle(payload: TopoViewerSvgExportPayload): void;
  dumpCssVars(vars: Record<string, string>): void;
  subscribe(handler: (event: ClabUiTopoViewerEvent) => void): () => void;
}

export interface ClabUiHost {
  postMessage(message: unknown): void;
  subscribe(handler: (event: MessageEvent<unknown>) => void): () => void;
  meta?: {
    isDevMock?: boolean;
    disableDevMockTraffic?: boolean;
  };
  explorer: ClabUiExplorerHost;
  topoViewer: ClabUiTopoViewerHost;
  topology: {
    requestSnapshot(
      context: TopologyUiContext,
      options?: TopologyUiRequestOptions
    ): Promise<TopologySnapshot>;
    dispatchCommand(
      context: TopologyUiContext,
      revision: number,
      command: TopologyHostCommand
    ): Promise<TopologyHostResponseMessage>;
  };
}
