import type {
  TopologyHostCommand,
  TopologyHostResponseMessage,
  TopologySnapshot
} from "../core/types/messages";
import type { DeploymentState } from "../core/types/topology";
import type {
  ExplorerIncomingMessage,
  ExplorerUiState
} from "../explorer/shared/explorer/types";
import { TOPOLOGY_HOST_PROTOCOL_VERSION } from "../core/types/messages";

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
  path?: string;
  mode?: "edit" | "view";
  deploymentState?: DeploymentState;
  sessionId?: string;
  runtimeContainers?: HostRuntimeContainer[];
}

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

type FetchLike = typeof fetch;
type TopologyHostMessageType =
  | "topology-host:snapshot"
  | "topology-host:ack"
  | "topology-host:reject"
  | "topology-host:error";

interface PendingTopologyRequest {
  resolve: (value: TopologyHostResponseMessage | TopologySnapshot) => void;
  reject: (err: Error) => void;
  expectedType: "snapshot" | "command";
  timeoutId: ReturnType<typeof setTimeout>;
}

interface WindowVsCodeApiLike {
  postMessage(message: unknown): void;
  getState?(): unknown;
  setState?(state: unknown): void;
  __isDevMock__?: boolean;
  __disableDevMockTraffic__?: boolean;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => {
      postMessage(message: unknown): void;
      getState?(): unknown;
      setState?(state: unknown): void;
    };
  }
}

interface WindowHostOptions {
  targetWindow?: Window;
  vscodeApi?: WindowVsCodeApiLike;
  postMessage?: (message: unknown) => void;
  explorer?: ClabUiExplorerHost;
  topoViewer?: ClabUiTopoViewerHost;
  topology?: ClabUiHost["topology"];
}

interface ApiHostOptions extends WindowHostOptions {
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

let currentHost: ClabUiHost | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isExplorerIncomingMessage(value: unknown): value is ExplorerIncomingMessage {
  if (!isRecord(value) || typeof value.command !== "string") {
    return false;
  }

  switch (value.command) {
    case "snapshot":
      return typeof value.filterText === "string" && Array.isArray(value.sections);
    case "filterState":
      return typeof value.filterText === "string";
    case "uiState":
      return isRecord(value.state) || value.state === undefined;
    case "error":
      return typeof value.message === "string";
    default:
      return false;
  }
}

function toTopoViewerEvent(value: unknown): ClabUiTopoViewerEvent | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }

  switch (value.type) {
    case "topo-mode-changed": {
      const data = isRecord(value.data) ? value.data : undefined;
      const mode = data?.mode;
      const deploymentState = data?.deploymentState;
      if (
        (mode === "editor" || mode === "viewer" || mode === "view") &&
        (deploymentState === "deployed" ||
          deploymentState === "undeployed" ||
          deploymentState === "unknown")
      ) {
        return {
          type: "modeChanged",
          mode: mode === "view" ? "viewer" : mode,
          deploymentState
        };
      }
      return null;
    }
    case "panel-action":
      return typeof value.action === "string"
        ? {
            type: "panelAction",
            action: value.action,
            ...(typeof value.nodeId === "string" ? { nodeId: value.nodeId } : {}),
            ...(typeof value.edgeId === "string" ? { edgeId: value.edgeId } : {})
          }
        : null;
    case "custom-nodes-updated":
      return {
        type: "customNodesUpdated",
        customNodes: Array.isArray(value.customNodes) ? value.customNodes : [],
        defaultNode: typeof value.defaultNode === "string" ? value.defaultNode : ""
      };
    case "custom-node-error":
      return typeof value.error === "string"
        ? { type: "customNodeError", error: value.error }
        : null;
    case "icon-list-response":
      return {
        type: "iconList",
        icons: Array.isArray(value.icons) ? value.icons : []
      };
    case "lab-lifecycle-log": {
      const data = isRecord(value.data) ? value.data : undefined;
      return typeof data?.line === "string"
        ? {
            type: "lifecycleLog",
            line: data.line,
            stream: data.stream === "stderr" ? "stderr" : "stdout"
          }
        : null;
    }
    case "lab-lifecycle-status": {
      const data = isRecord(value.data) ? value.data : undefined;
      if (data?.status !== "success" && data?.status !== "error") {
        return null;
      }
      return {
        type: "lifecycleStatus",
        status: data.status,
        ...(typeof data.errorMessage === "string" ? { errorMessage: data.errorMessage } : {})
      };
    }
    case "fit-viewport":
      return { type: "fitViewport" };
    case "svg-export-result":
      return typeof value.requestId === "string" && typeof value.success === "boolean"
        ? {
            type: "svgExportResult",
            requestId: value.requestId,
            success: value.success,
            ...(typeof value.error === "string" ? { error: value.error } : {}),
            ...(Array.isArray(value.files)
              ? { files: value.files.filter((entry): entry is string => typeof entry === "string") }
              : {})
          }
        : null;
    default:
      return null;
  }
}

function isTopologyHostMessageType(value: unknown): value is TopologyHostMessageType {
  return (
    value === "topology-host:snapshot" ||
    value === "topology-host:ack" ||
    value === "topology-host:reject" ||
    value === "topology-host:error"
  );
}

function isTopologyHostResponseMessage(value: unknown): value is TopologyHostResponseMessage {
  return (
    isRecord(value) &&
    isTopologyHostMessageType(value.type) &&
    typeof value.requestId === "string" &&
    typeof value.protocolVersion === "number"
  );
}

function isTopologySnapshot(value: unknown): value is TopologySnapshot {
  return (
    isRecord(value) &&
    typeof value.revision === "number" &&
    Array.isArray(value.nodes) &&
    Array.isArray(value.edges) &&
    isRecord(value.annotations)
  );
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function appendSessionId(path: string, sessionId?: string): string {
  if (!sessionId) return path;
  const delimiter = path.includes("?") ? "&" : "?";
  return `${path}${delimiter}sessionId=${encodeURIComponent(sessionId)}`;
}

function resolveVsCodeApi(targetWindow: Window): WindowVsCodeApiLike | undefined {
  const windowWithVsCode = targetWindow as Window & { vscode?: WindowVsCodeApiLike };

  if (windowWithVsCode.vscode) {
    return windowWithVsCode.vscode;
  }

  if (typeof targetWindow.acquireVsCodeApi === "function") {
    const api = targetWindow.acquireVsCodeApi();
    windowWithVsCode.vscode = api;
    return api;
  }

  return undefined;
}

function createMessageSubscription(targetWindow: Window) {
  return (handler: (event: MessageEvent<unknown>) => void): (() => void) => {
    const listener = (event: Event) => {
      handler(event as MessageEvent<unknown>);
    };
    targetWindow.addEventListener("message", listener);
    return () => {
      targetWindow.removeEventListener("message", listener);
    };
  };
}

export function createWindowClabUiHost(options: WindowHostOptions = {}): ClabUiHost {
  const targetWindow = options.targetWindow ?? window;
  const resolvedVsCodeApi = options.vscodeApi ?? resolveVsCodeApi(targetWindow);
  const postMessage =
    options.postMessage ?? ((message: unknown) => resolvedVsCodeApi?.postMessage(message));
  const subscribe = createMessageSubscription(targetWindow);

  const explorer =
    options.explorer ??
    {
      connect(): void {
        postMessage({ command: "ready" });
      },
      setFilter(filterText: string): void {
        postMessage({ command: "setFilter", value: filterText });
      },
      invokeAction(actionRef: string): void {
        postMessage({ command: "invokeAction", actionRef });
      },
      persistUiState(state: ExplorerUiState): void {
        postMessage({ command: "persistUiState", state });
      },
      subscribe(handler: (message: ExplorerIncomingMessage) => void): () => void {
        return subscribe((event) => {
          if (isExplorerIncomingMessage(event.data)) {
            handler(event.data);
          }
        });
      }
    };

  const topoViewer =
    options.topoViewer ??
    {
      runLifecycle(action: TopoViewerLifecycleAction): void {
        postMessage({ command: action });
      },
      cancelLifecycle(): void {
        postMessage({ command: "cancelLabLifecycle" });
      },
      toggleSplitView(): void {
        postMessage({ command: "topo-toggle-split-view" });
      },
      runNodeAction(action: TopoViewerNodeAction, nodeName: string): void {
        const command =
          action === "ssh"
            ? "clab-node-connect-ssh"
            : action === "shell"
              ? "clab-node-attach-shell"
              : "clab-node-view-logs";
        postMessage({ command, nodeName });
      },
      captureInterface(nodeName: string, interfaceName: string): void {
        postMessage({ command: "clab-interface-capture", nodeName, interfaceName });
      },
      setLinkImpairment(nodeName: string, interfaceName: string, data: unknown): void {
        postMessage({ command: "clab-link-impairment", nodeName, interfaceName, data });
      },
      saveCustomNode(data: Record<string, unknown>): void {
        postMessage({ command: "save-custom-node", ...data });
      },
      deleteCustomNode(nodeName: string): void {
        postMessage({ command: "delete-custom-node", name: nodeName });
      },
      setDefaultCustomNode(nodeName: string): void {
        postMessage({ command: "set-default-custom-node", name: nodeName });
      },
      requestIconList(): void {
        postMessage({ command: "icon-list" });
      },
      uploadIcon(): void {
        postMessage({ command: "icon-upload" });
      },
      deleteIcon(iconName: string): void {
        postMessage({ command: "icon-delete", iconName });
      },
      reconcileIcons(usedIcons: string[]): void {
        postMessage({ command: "icon-reconcile", usedIcons });
      },
      exportGrafanaBundle(payload: TopoViewerSvgExportPayload): void {
        postMessage({ command: "export-svg-grafana-bundle", ...payload });
      },
      dumpCssVars(vars: Record<string, string>): void {
        postMessage({ command: "dump-css-vars", vars });
      },
      subscribe(handler: (event: ClabUiTopoViewerEvent) => void): () => void {
        return subscribe((event) => {
          const topoViewerEvent = toTopoViewerEvent(event.data);
          if (topoViewerEvent) {
            handler(topoViewerEvent);
          }
        });
      }
    };

  const topology =
    options.topology ??
    (() => {
      const pending = new Map<string, PendingTopologyRequest>();
      let listenerStarted = false;

      const ensureListener = (): void => {
        if (listenerStarted) return;
        subscribe((event) => {
          if (!isRecord(event.data) || !isTopologyHostMessageType(event.data.type)) {
            return;
          }

          const requestId = event.data.requestId;
          if (typeof requestId !== "string" || requestId.length === 0) {
            return;
          }

          const request = pending.get(requestId);
          if (!request) {
            return;
          }

          if (event.data.type === "topology-host:snapshot") {
            if (request.expectedType !== "snapshot" || !isTopologySnapshot(event.data.snapshot)) {
              clearTimeout(request.timeoutId);
              request.reject(new Error("Unexpected snapshot response"));
              pending.delete(requestId);
              return;
            }

            clearTimeout(request.timeoutId);
            request.resolve(event.data.snapshot);
            pending.delete(requestId);
            return;
          }

          if (request.expectedType !== "command" || !isTopologyHostResponseMessage(event.data)) {
            clearTimeout(request.timeoutId);
            request.reject(new Error("Unexpected command response"));
            pending.delete(requestId);
            return;
          }

          clearTimeout(request.timeoutId);
          request.resolve(event.data);
          pending.delete(requestId);
        });
        listenerStarted = true;
      };

      const sendRequest = (
        message: Record<string, unknown>,
        expectedType: "snapshot" | "command",
        timeoutMs = 30_000
      ): Promise<TopologyHostResponseMessage | TopologySnapshot> => {
        ensureListener();
        const requestId = globalThis.crypto.randomUUID();
        return new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            if (!pending.has(requestId)) {
              return;
            }
            pending.delete(requestId);
            reject(
              new Error(
                `${expectedType === "snapshot" ? "Snapshot" : "Command"} request timed out`
              )
            );
          }, timeoutMs);
          pending.set(requestId, { resolve, reject, expectedType, timeoutId });
          postMessage({ ...message, requestId });
        });
      };

      return {
        async requestSnapshot(
          _context: TopologyUiContext,
          options: TopologyUiRequestOptions = {}
        ): Promise<TopologySnapshot> {
          return (await sendRequest(
            {
              type: "topology-host:get-snapshot",
              protocolVersion: TOPOLOGY_HOST_PROTOCOL_VERSION,
              externalChange: options.externalChange ?? false
            },
            "snapshot"
          )) as TopologySnapshot;
        },

        async dispatchCommand(
          _context: TopologyUiContext,
          revision: number,
          command: TopologyHostCommand
        ): Promise<TopologyHostResponseMessage> {
          return (await sendRequest(
            {
              type: "topology-host:command",
              protocolVersion: TOPOLOGY_HOST_PROTOCOL_VERSION,
              baseRevision: revision,
              command
            },
            "command"
          )) as TopologyHostResponseMessage;
        }
      };
    })();

  return {
    postMessage,
    subscribe,
    meta: {
      isDevMock: resolvedVsCodeApi?.__isDevMock__ === true,
      disableDevMockTraffic: resolvedVsCodeApi?.__disableDevMockTraffic__ === true
    },
    explorer,
    topoViewer,
    topology
  };
}

export function createApiClabUiHost(options: ApiHostOptions = {}): ClabUiHost {
  const baseHost = createWindowClabUiHost(options);
  const baseUrl = trimTrailingSlash(options.baseUrl ?? "");
  const fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);

  const buildUrl = (path: string): string => `${baseUrl}${path}`;

  const postJson = async <T>(path: string, payload: unknown): Promise<T> => {
    const response = await fetchImpl(buildUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const parsedBody: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message =
        isRecord(parsedBody) && typeof parsedBody.error === "string"
          ? parsedBody.error
          : `API host request failed: ${response.status} ${response.statusText}`;
      throw new Error(message);
    }

    return parsedBody as T;
  };

  return {
    ...baseHost,
    topology: options.topology ?? {
      async requestSnapshot(
        context: TopologyUiContext,
        options: TopologyUiRequestOptions = {}
      ): Promise<TopologySnapshot> {
        const payload = await postJson<{ snapshot?: TopologySnapshot }>(
          appendSessionId("/api/topology/snapshot", context.sessionId),
          {
            path: context.path,
            mode: context.mode,
            deploymentState: context.deploymentState,
            runtimeContainers: context.runtimeContainers,
            externalChange: options.externalChange ?? false
          }
        );

        if (!isRecord(payload) || !isRecord(payload.snapshot)) {
          throw new Error("Snapshot response payload is invalid");
        }

        return payload.snapshot as TopologySnapshot;
      },

      async dispatchCommand(
        context: TopologyUiContext,
        revision: number,
        command: TopologyHostCommand
      ): Promise<TopologyHostResponseMessage> {
        const payload = await postJson<TopologyHostResponseMessage>(
          appendSessionId("/api/topology/command", context.sessionId),
          {
            path: context.path,
            baseRevision: revision,
            command,
            mode: context.mode,
            deploymentState: context.deploymentState,
            runtimeContainers: context.runtimeContainers
          }
        );

        if (!isRecord(payload) || typeof payload.type !== "string") {
          throw new Error("Command response payload is invalid");
        }

        return payload;
      }
    }
  };
}

export function setClabUiHost(host: ClabUiHost | null): void {
  currentHost = host;
}

export function getClabUiHost(): ClabUiHost {
  if (!currentHost) {
    throw new Error(
      "clab-ui host is not configured. The product entrypoint must call setClabUiHost() before rendering."
    );
  }
  return currentHost;
}

export function getConfiguredClabUiHost(): ClabUiHost | null {
  return currentHost;
}

export function assertClabUiHostConfigured(): ClabUiHost {
  return getClabUiHost();
}
