/**
 * Topology host protocol endpoints.
 *
 * Exposes /api/topology/snapshot and /api/topology/command — the same
 * endpoints the dev harness uses, so the UI's topologyHostClient.ts
 * works without changes.
 *
 * Each lab gets a TopologyHostCore backed by ClabApiFileSystemAdapter.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { ClabApiClient } from "./clabApiClient.js";
import { ClabApiFileSystemAdapter } from "./clabApiFileSystem.js";
import { getTokenFromRequest } from "./middleware.js";
import { TopologyHostCore } from "@srl-labs/clab-ui/core/host/TopologyHostCore";
import type {
  ContainerDataProvider,
  ContainerInfo,
  InterfaceInfo
} from "@srl-labs/clab-ui/core/parsing/types";
import type {
  TopologyHostCommand,
  TopologyHostResponseMessage,
  TopologySnapshot
} from "@srl-labs/clab-ui/core/types/messages";

interface RuntimeContainerPayload {
  name: string;
  nodeName: string;
  labName: string;
  state: string;
  kind: string;
  image: string;
  ipv4Address: string;
  ipv6Address: string;
  interfaces?: RuntimeInterfacePayload[];
}

interface RuntimeInterfaceStatsPayload {
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

interface RuntimeInterfacePayload {
  name: string;
  alias: string;
  mac: string;
  mtu: number;
  state: string;
  type: string;
  ifIndex?: number;
  stats?: RuntimeInterfaceStatsPayload;
}

interface SnapshotRequest {
  path: string;
  mode?: "edit" | "view";
  deploymentState?: DeploymentState;
  runtimeContainers?: RuntimeContainerPayload[];
  externalChange?: boolean;
}

interface CommandRequest {
  path: string;
  mode?: "edit" | "view";
  deploymentState?: DeploymentState;
  runtimeContainers?: RuntimeContainerPayload[];
  baseRevision: number;
  command: TopologyHostCommand;
}

// Cache TopologyHostCore instances per token+lab combination
type DeploymentState = "deployed" | "undeployed" | "unknown";

const hostCache = new Map<string, {
  host: TopologyHostCore;
  lastAccess: number;
  path: string;
}>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function isMissingTopologyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("ENOENT") || message.includes("(404)");
}

function normalizeCachePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function cleanupCache(): void {
  const now = Date.now();
  for (const [key, entry] of hostCache.entries()) {
    if (now - entry.lastAccess > CACHE_TTL_MS) {
      entry.host.dispose();
      hostCache.delete(key);
    }
  }
}

// Run cleanup every minute
setInterval(cleanupCache, 60_000);

function extractLabName(filePath: string): string {
  // The path comes as "labName.clab.yml" or similar
  // The clab-api-server expects just the lab name (without .clab.yml)
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const basename = normalized.includes("/")
    ? normalized.slice(normalized.lastIndexOf("/") + 1)
    : normalized;
  // Strip .clab.yml/.clab.yaml suffix to get lab name
  return basename.replace(/\.clab\.ya?ml$/i, "");
}

function normalizeLabName(labName: string): string {
  return labName.trim().toLowerCase();
}

function shortContainerName(container: RuntimeContainerPayload): string {
  if (container.nodeName && container.nodeName.length > 0) {
    return container.nodeName;
  }
  const fullName = container.name ?? "";
  const prefix = container.labName ? `clab-${container.labName}-` : "";
  if (prefix && fullName.startsWith(prefix)) {
    return fullName.slice(prefix.length);
  }
  return fullName;
}

function stripCidr(address: string | undefined): string {
  if (!address) {
    return "";
  }
  const [value] = address.split("/");
  return value ?? "";
}

function toFiniteNumber(value: number | string | undefined): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toInterfaceInfo(iface: RuntimeInterfacePayload): InterfaceInfo {
  return {
    name: iface.name ?? "",
    alias: iface.alias ?? "",
    mac: iface.mac ?? "",
    mtu: toFiniteNumber(iface.mtu) ?? 0,
    state: iface.state ?? "",
    type: iface.type ?? "",
    ifIndex: toFiniteNumber(iface.ifIndex),
    stats: iface.stats
      ? {
          rxBps: toFiniteNumber(iface.stats.rxBps),
          txBps: toFiniteNumber(iface.stats.txBps),
          rxPps: toFiniteNumber(iface.stats.rxPps),
          txPps: toFiniteNumber(iface.stats.txPps),
          rxBytes: toFiniteNumber(iface.stats.rxBytes),
          txBytes: toFiniteNumber(iface.stats.txBytes),
          rxPackets: toFiniteNumber(iface.stats.rxPackets),
          txPackets: toFiniteNumber(iface.stats.txPackets),
          statsIntervalSeconds: toFiniteNumber(iface.stats.statsIntervalSeconds)
        }
      : undefined
  };
}

function createContainerDataProvider(containers: RuntimeContainerPayload[]): ContainerDataProvider {
  const containersByLab = new Map<string, RuntimeContainerPayload[]>();
  for (const container of containers) {
    const labName = normalizeLabName(container.labName ?? "");
    const existing = containersByLab.get(labName);
    if (existing) {
      existing.push(container);
    } else {
      containersByLab.set(labName, [container]);
    }
  }

  const findContainerEntry = (
    containerName: string,
    labName: string
  ): RuntimeContainerPayload | undefined => {
    const labContainers = containersByLab.get(normalizeLabName(labName)) ?? [];
    return labContainers.find((container) => {
      if (container.name === containerName) return true;
      if (container.nodeName === containerName) return true;
      return shortContainerName(container) === containerName;
    });
  };

  const toContainerInfo = (container: RuntimeContainerPayload): ContainerInfo => ({
    name: container.name ?? "",
    name_short: shortContainerName(container),
    rootNodeName: container.nodeName ?? "",
    state: container.state ?? "",
    kind: container.kind ?? "",
    image: container.image ?? "",
    IPv4Address: stripCidr(container.ipv4Address),
    IPv6Address: stripCidr(container.ipv6Address),
    interfaces: (container.interfaces ?? []).map((iface) => toInterfaceInfo(iface)),
    label: container.nodeName || container.name
  });

  return {
    findContainer(containerName: string, labName: string): ContainerInfo | undefined {
      const container = findContainerEntry(containerName, labName);
      return container ? toContainerInfo(container) : undefined;
    },
    findInterface(containerName: string, ifaceName: string, labName: string): InterfaceInfo | undefined {
      const container = findContainerEntry(containerName, labName);
      if (!container) {
        return undefined;
      }
      const needle = ifaceName.trim().toLowerCase();
      if (!needle) {
        return undefined;
      }

      const iface = (container.interfaces ?? []).find((entry) => {
        const byName = entry.name?.trim().toLowerCase();
        const byAlias = entry.alias?.trim().toLowerCase();
        return byName === needle || byAlias === needle;
      });
      return iface ? toInterfaceInfo(iface) : undefined;
    }
  };
}

async function getOrCreateHost(
  client: ClabApiClient,
  token: string,
  filePath: string,
  mode: "edit" | "view",
  deploymentState: DeploymentState,
  containerDataProvider: ContainerDataProvider
): Promise<TopologyHostCore> {
  const labName = extractLabName(filePath);
  const normalizedPath = normalizeCachePath(filePath);
  const cacheKey = `${client.getBaseUrl()}:${token}:${labName}`;

  const cached = hostCache.get(cacheKey);
  if (cached) {
    if (cached.path !== normalizedPath) {
      cached.host.dispose();
      hostCache.delete(cacheKey);
    } else {
      cached.lastAccess = Date.now();
      cached.host.updateContext({ mode, deploymentState, containerDataProvider });
      return cached.host;
    }
  }

  const fs = new ClabApiFileSystemAdapter({
    client,
    token,
    labName
  });

  const host = new TopologyHostCore({
    fs,
    yamlFilePath: filePath,
    mode,
    deploymentState,
    containerDataProvider,
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: console.error
    }
  });

  hostCache.set(cacheKey, { host, lastAccess: Date.now(), path: normalizedPath });
  return host;
}

async function attachDocumentRevision(
  client: ClabApiClient,
  token: string,
  filePath: string,
  snapshot: TopologySnapshot
): Promise<TopologySnapshot> {
  const labName = extractLabName(filePath);
  const documentRevision = await client.getTopologyDocumentRevision(token, labName, filePath);
  return documentRevision ? { ...snapshot, documentRevision } : snapshot;
}

type ClientResolver = (request: FastifyRequest) => ClabApiClient;

export function registerTopologyProxy(app: FastifyInstance, getClient: ClientResolver): void {
  app.post<{ Body: SnapshotRequest }>(
    "/api/topology/snapshot",
    async (request: FastifyRequest<{ Body: SnapshotRequest }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) {
        return reply.status(401).send({ error: "Not authenticated" });
      }
      const client = getClient(request);

      const body = request.body;
      if (!body.path) {
        return reply.status(400).send({ error: "Missing path" });
      }

      try {
        const deploymentState = body.deploymentState ?? "undeployed";
        const mode = body.mode ?? (deploymentState === "deployed" ? "view" : "edit");
        const containerDataProvider = createContainerDataProvider(body.runtimeContainers ?? []);
        const host = await getOrCreateHost(
          client,
          token,
          body.path,
          mode,
          deploymentState,
          containerDataProvider
        );

        let snapshot: TopologySnapshot;
        if (body.externalChange) {
          snapshot = await host.onExternalChange();
        } else {
          snapshot = await host.getSnapshot();
        }
        snapshot = await attachDocumentRevision(client, token, body.path, snapshot);

        return reply.send({ snapshot });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const statusCode = isMissingTopologyError(error) ? 404 : 500;
        return reply.status(statusCode).send({ error: message });
      }
    }
  );

  app.post<{ Body: CommandRequest }>(
    "/api/topology/command",
    async (request: FastifyRequest<{ Body: CommandRequest }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) {
        return reply.status(401).send({ error: "Not authenticated" });
      }
      const client = getClient(request);

      const body = request.body;
      if (!body.path || !body.command) {
        return reply.status(400).send({ error: "Missing path or command" });
      }

      try {
        const deploymentState = body.deploymentState ?? "undeployed";
        const mode = body.mode ?? (deploymentState === "deployed" ? "view" : "edit");
        const containerDataProvider = createContainerDataProvider(body.runtimeContainers ?? []);
        const host = await getOrCreateHost(
          client,
          token,
          body.path,
          mode,
          deploymentState,
          containerDataProvider
        );

        const response: TopologyHostResponseMessage = await host.applyCommand(
          body.command,
          body.baseRevision
        );
        if (
          (response.type === "topology-host:ack" || response.type === "topology-host:reject") &&
          response.snapshot
        ) {
          response.snapshot = await attachDocumentRevision(client, token, body.path, response.snapshot);
        }
        return reply.send(response);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const statusCode = isMissingTopologyError(error) ? 404 : 500;
        return reply.status(statusCode).send({
          type: "topology-host:error",
          error: message
        });
      }
    }
  );
}
