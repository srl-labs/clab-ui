import {
  TOPOLOGY_HOST_PROTOCOL_VERSION,
  type TopologyHostResponseMessage
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

type FetchLike = typeof fetch;

export interface ApiTopologyHostTransportOptions {
  /**
   * Base URL for API endpoints, e.g. `http://127.0.0.1:8080`.
   * Defaults to an empty string (relative paths).
   */
  baseUrl?: string;
  /**
   * Inject custom fetch implementation for testing.
   * Defaults to `globalThis.fetch`.
   */
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

interface SnapshotPayload {
  snapshot: TopologySnapshotState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTopologyHostResponse(value: unknown): value is TopologyHostResponse {
  if (!isRecord(value)) return false;
  return (
    value.type === "topology-host:ack" ||
    value.type === "topology-host:reject" ||
    value.type === "topology-host:error" ||
    value.type === "topology-host:snapshot"
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

export class ApiTopologyHostTransport implements TopologyHostTransport {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly subscribers = new Set<(event: TopologyHostEvent) => void>();
  private context: TopologyHostContext = {};
  private disposed = false;

  constructor(options: ApiTopologyHostTransportOptions = {}) {
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }

  setContext(context: Partial<TopologyHostContext>): void {
    this.context = { ...this.context, ...context };
  }

  subscribe(handler: (event: TopologyHostEvent) => void): Unsubscribe {
    this.subscribers.add(handler);
    return () => {
      this.subscribers.delete(handler);
    };
  }

  async requestSnapshot(options: SnapshotRequestOptions = {}): Promise<TopologySnapshotState> {
    this.assertNotDisposed();
    const path = this.requirePath();
    const payload = await this.postJson<SnapshotPayload>(
      appendSessionId("/api/topology/snapshot", this.context.sessionId),
      {
        path,
        mode: this.context.mode,
        deploymentState: this.context.deploymentState,
        externalChange: options.externalChange ?? false
      }
    );

    if (!isRecord(payload) || !isRecord(payload.snapshot)) {
      throw new Error("Invalid snapshot payload received from API transport");
    }

    const snapshot = payload.snapshot as TopologySnapshotState;
    this.publish({
      type: "topology-host:snapshot",
      protocolVersion: TOPOLOGY_HOST_PROTOCOL_VERSION,
      snapshot,
      reason: options.externalChange ? "external-change" : "resync"
    });
    return snapshot;
  }

  async dispatch(command: TopologyCommand, revision: number): Promise<TopologyHostResponse> {
    this.assertNotDisposed();
    const path = this.requirePath();
    const response = await this.postJson<TopologyHostResponseMessage>(
      appendSessionId("/api/topology/command", this.context.sessionId),
      {
        path,
        mode: this.context.mode,
        deploymentState: this.context.deploymentState,
        baseRevision: revision,
        command
      },
      true
    );

    if (!isTopologyHostResponse(response)) {
      throw new Error("Invalid command response received from API transport");
    }
    this.publish(response);
    return response;
  }

  dispose(): void {
    this.disposed = true;
    this.subscribers.clear();
  }

  private publish(event: TopologyHostEvent): void {
    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
  }

  private requirePath(): string {
    const path = this.context.path?.trim();
    if (!path) {
      throw new Error("API transport requires context.path before requesting topology data");
    }
    return path;
  }

  private buildUrl(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("Transport is disposed");
    }
  }

  private async postJson<T>(
    path: string,
    payload: unknown,
    allowErrorResponseBody = false
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.buildUrl(path), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const parsedBody: unknown = await response.json().catch(() => undefined);

      if (!response.ok) {
        if (allowErrorResponseBody && isRecord(parsedBody) && typeof parsedBody.type === "string") {
          return parsedBody as T;
        }

        const message =
          isRecord(parsedBody) && typeof parsedBody.error === "string"
            ? parsedBody.error
            : `API transport request failed: ${response.status} ${response.statusText}`;
        throw new Error(message);
      }

      return parsedBody as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export type { TopologyHostContext } from "@srl-labs/clab-host-contract";
