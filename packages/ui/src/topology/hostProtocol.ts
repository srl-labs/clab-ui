import type {
  TopologyHostCommand,
  TopologyHostResponseMessage,
  TopologyHostSnapshotMessage,
  TopologySnapshot
} from "../core/types/messages";
import { TOPOLOGY_HOST_PROTOCOL_VERSION } from "../core/types/messages";
import type { TopologyHost } from "../core/types/topologyHost";

const TOPOLOGY_HOST_GET_SNAPSHOT = "topology-host:get-snapshot";
const TOPOLOGY_HOST_COMMAND = "topology-host:command";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTopologyHostCommand(value: unknown): value is TopologyHostCommand {
  if (!isRecord(value)) return false;
  if (typeof value.command !== "string") return false;
  if (value.command === "undo" || value.command === "redo") return true;
  return "payload" in value;
}

function getProtocolVersion(message: Record<string, unknown>): number | undefined {
  const protocolVersion = message.protocolVersion;
  return typeof protocolVersion === "number" ? protocolVersion : undefined;
}

function parseCommandRequest(
  message: Record<string, unknown>
): { command: TopologyHostCommand; baseRevision: number } | null {
  const baseRevisionRaw = message.baseRevision;
  const commandPayload = message.command;
  const baseRevision =
    typeof baseRevisionRaw === "number" && Number.isFinite(baseRevisionRaw)
      ? baseRevisionRaw
      : NaN;
  if (!isTopologyHostCommand(commandPayload) || !Number.isFinite(baseRevision)) {
    return null;
  }
  return { command: commandPayload, baseRevision };
}

export function buildTopologySnapshotMessage(
  snapshot: TopologySnapshot,
  reason?: "init" | "external-change" | "resync"
): TopologyHostSnapshotMessage {
  return {
    type: "topology-host:snapshot",
    protocolVersion: TOPOLOGY_HOST_PROTOCOL_VERSION,
    snapshot,
    ...(reason ? { reason } : {})
  };
}

export interface HandleTopologyHostProtocolMessageOptions {
  host?: TopologyHost;
  message: unknown;
  onSnapshot?: (snapshot: TopologySnapshot) => void;
  onSnapshotLoadError?: (errorMessage: string) => void;
  postMessage: (message: TopologyHostResponseMessage) => void;
}

function withRequestId(
  response: TopologyHostResponseMessage,
  requestId: string
): TopologyHostResponseMessage {
  return {
    ...response,
    requestId: requestId || response.requestId || ""
  };
}

export async function handleTopologyHostProtocolMessage(
  options: HandleTopologyHostProtocolMessageOptions
): Promise<boolean> {
  const { host, message, onSnapshot, onSnapshotLoadError, postMessage } = options;
  if (!isRecord(message)) {
    return false;
  }

  const msgType = typeof message.type === "string" ? message.type : "";
  if (msgType !== TOPOLOGY_HOST_GET_SNAPSHOT && msgType !== TOPOLOGY_HOST_COMMAND) {
    return false;
  }

  const requestId = typeof message.requestId === "string" ? message.requestId : "";
  const protocolVersion = getProtocolVersion(message);
  if (protocolVersion !== TOPOLOGY_HOST_PROTOCOL_VERSION) {
    postMessage({
      type: "topology-host:error",
      protocolVersion: TOPOLOGY_HOST_PROTOCOL_VERSION,
      requestId,
      error: `Unsupported topology host protocol version: ${protocolVersion ?? "unknown"}`
    });
    return true;
  }

  if (!host) {
    postMessage({
      type: "topology-host:error",
      protocolVersion: TOPOLOGY_HOST_PROTOCOL_VERSION,
      requestId,
      error: "Topology host unavailable"
    });
    return true;
  }

  if (msgType === TOPOLOGY_HOST_GET_SNAPSHOT) {
    try {
      const snapshot = await host.getSnapshot();
      onSnapshot?.(snapshot);
      postMessage({
        ...buildTopologySnapshotMessage(snapshot, "init"),
        requestId
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      onSnapshotLoadError?.(errorMessage);
      postMessage({
        type: "topology-host:error",
        protocolVersion: TOPOLOGY_HOST_PROTOCOL_VERSION,
        requestId,
        error: errorMessage
      });
    }
    return true;
  }

  const commandData = parseCommandRequest(message);
  if (!commandData) {
    postMessage({
      type: "topology-host:error",
      protocolVersion: TOPOLOGY_HOST_PROTOCOL_VERSION,
      requestId,
      error: "Invalid topology host command payload"
    });
    return true;
  }

  const response = await host.applyCommand(commandData.command, commandData.baseRevision);
  const responseWithId = withRequestId(response, requestId);
  if (responseWithId.type === "topology-host:ack" || responseWithId.type === "topology-host:reject") {
    const snapshot = (responseWithId as { snapshot?: TopologySnapshot }).snapshot;
    if (snapshot) {
      onSnapshot?.(snapshot);
    }
  }
  postMessage(responseWithId);
  return true;
}
