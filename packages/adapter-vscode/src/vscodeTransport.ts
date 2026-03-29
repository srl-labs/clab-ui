import {
  TOPOLOGY_HOST_PROTOCOL_VERSION,
  type ModeChangedMessage,
  type TopologyHostAckMessage,
  type TopologyHostErrorMessage,
  type TopologyHostRejectMessage,
  type TopologyHostSnapshotMessage
} from "@srl-labs/clab-ui/core";
import type {
  SnapshotRequestOptions,
  TopologyCommand,
  TopologyHostContext,
  TopologyHostEvent,
  TopologyHostResponse,
  TopologyHostTransport,
  TopologySnapshotState,
  Unsubscribe
} from "@srl-labs/clab-host-contract";

declare global {
  interface Window {
    vscode?: { postMessage(data: unknown): void; __isDevMock__?: boolean };
  }
}

type RequestKind = "snapshot" | "command";

type HostResponse = TopologyHostAckMessage | TopologyHostRejectMessage | TopologyHostErrorMessage;

interface PendingRequest {
  kind: RequestKind;
  resolve: (value: TopologySnapshotState | TopologyHostResponse) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface VsCodeTopologyHostTransportOptions {
  vscodeApi?: { postMessage(data: unknown): void; __isDevMock__?: boolean };
  timeoutMs?: number;
  targetWindow?: Window;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function createRequestId(): string {
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSnapshotMessage(data: unknown): data is TopologyHostSnapshotMessage {
  return isObject(data) && data.type === "topology-host:snapshot" && isObject(data.snapshot);
}

function isHostResponse(data: unknown): data is HostResponse {
  return (
    isObject(data) &&
    (data.type === "topology-host:ack" || data.type === "topology-host:reject" || data.type === "topology-host:error")
  );
}

function isModeChangedMessage(data: unknown): data is ModeChangedMessage {
  return isObject(data) && data.type === "topo-mode-changed";
}

export class VsCodeTopologyHostTransport implements TopologyHostTransport {
  private readonly timeoutMs: number;
  private readonly subscribers = new Set<(event: TopologyHostEvent) => void>();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly windowTarget: Window;
  private readonly vscodeApi?: { postMessage(data: unknown): void; __isDevMock__?: boolean };
  private disposed = false;

  constructor(options: VsCodeTopologyHostTransportOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.windowTarget = options.targetWindow ?? window;
    this.vscodeApi = options.vscodeApi ?? window.vscode;
    this.windowTarget.addEventListener("message", this.handleMessage as EventListener);
  }

  async requestSnapshot(_options?: SnapshotRequestOptions): Promise<TopologySnapshotState> {
    return this.sendRequest<TopologySnapshotState>(
      {
        type: "topology-host:get-snapshot",
        protocolVersion: TOPOLOGY_HOST_PROTOCOL_VERSION
      },
      "snapshot"
    );
  }

  async dispatch(command: TopologyCommand, revision: number): Promise<TopologyHostResponse> {
    return this.sendRequest<TopologyHostResponse>(
      {
        type: "topology-host:command",
        protocolVersion: TOPOLOGY_HOST_PROTOCOL_VERSION,
        baseRevision: revision,
        command
      },
      "command"
    );
  }

  subscribe(handler: (event: TopologyHostEvent) => void): Unsubscribe {
    this.subscribers.add(handler);
    return () => {
      this.subscribers.delete(handler);
    };
  }

  setContext(_context: Partial<TopologyHostContext>): void {
    // VS Code transport does not require client-side context injection.
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.windowTarget.removeEventListener("message", this.handleMessage as EventListener);

    for (const [requestId, request] of this.pending.entries()) {
      clearTimeout(request.timeoutId);
      request.reject(new Error(`Transport disposed while request ${requestId} was pending`));
    }

    this.pending.clear();
    this.subscribers.clear();
  }

  private sendRequest<T>(payload: Record<string, unknown>, kind: RequestKind): Promise<T> {
    if (this.disposed) {
      return Promise.reject(new Error("Transport is disposed"));
    }
    if (!this.vscodeApi || this.vscodeApi.__isDevMock__) {
      return Promise.reject(new Error("VS Code API is unavailable for topology transport"));
    }

    const requestId = createRequestId();

    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`${kind} request timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.pending.set(requestId, {
        kind,
        resolve: resolve as PendingRequest["resolve"],
        reject,
        timeoutId
      });

      this.vscodeApi?.postMessage({ ...payload, requestId });
    });
  }

  private readonly handleMessage = (event: MessageEvent<unknown>): void => {
    const data = event.data;

    if (isModeChangedMessage(data)) {
      this.publish(data);
      return;
    }

    if (isSnapshotMessage(data)) {
      const requestId = typeof data.requestId === "string" ? data.requestId : undefined;
      if (!requestId) {
        this.publish(data);
        return;
      }

      const pending = this.pending.get(requestId);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timeoutId);
      this.pending.delete(requestId);

      if (pending.kind !== "snapshot") {
        pending.reject(new Error("Received snapshot for non-snapshot request"));
        return;
      }

      pending.resolve(data.snapshot);
      return;
    }

    if (!isHostResponse(data)) {
      return;
    }

    const requestId = typeof data.requestId === "string" ? data.requestId : undefined;

    if (!requestId) {
      if (data.type === "topology-host:error") {
        this.publish(data);
      }
      return;
    }

    const pending = this.pending.get(requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeoutId);
    this.pending.delete(requestId);

    if (pending.kind === "snapshot") {
      pending.reject(new Error("Expected snapshot response"));
      return;
    }

    pending.resolve(data);
    this.publish(data);
  };

  private publish(event: TopologyHostEvent): void {
    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
  }
}
