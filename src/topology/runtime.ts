import type { ClabTopology } from "../core/types/topology";
import type { TopoEdge, TopologyEdgeData } from "../core/types/graph";
import type {
  ContainerDataProvider,
  ContainerInfo,
  InterfaceInfo
} from "../core/parsing/types";
import { mapSrosInterfaceName } from "../core/parsing/DistributedSrosMapper";
import {
  computeEdgeClassFromStates,
  extractEdgeInterfaceStats
} from "../core/parsing/EdgeElementBuilder";
import type { HostRuntimeContainer, HostRuntimeInterface } from "../host";

export interface TopologyRuntimeEdgeUpdate {
  id: string;
  extraData: Record<string, unknown>;
  classes?: string;
}

export interface TopologyRuntimeNodeUpdate {
  containerLongName: string;
  containerShortName: string;
  state: string;
  status?: string;
  mgmtIpv4Address?: string;
  mgmtIpv6Address?: string;
}

export interface TopologyRuntimeUpdateContext {
  currentLabName: string;
  topology: ClabTopology["topology"] | undefined;
}

function normalizeName(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizeLabName(value: string | undefined): string {
  return normalizeName(value);
}

function stripCidr(address: string | undefined): string {
  if (!address) {
    return "";
  }
  const [value] = address.split("/");
  return value ?? "";
}

function extractDistributedBaseFromName(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return undefined;
  }
  const idx = trimmed.lastIndexOf("-");
  if (idx <= 0 || idx >= trimmed.length - 1) {
    return undefined;
  }
  return trimmed.slice(0, idx);
}

function shortContainerName(container: HostRuntimeContainer): string {
  const fullName = (container.name ?? "").trim();
  const labName = (container.labName ?? "").trim();
  const prefix = labName ? `clab-${labName}-` : "";
  if (prefix && fullName.startsWith(prefix)) {
    return fullName.slice(prefix.length);
  }
  if (fullName) {
    return fullName;
  }
  return (container.nodeName ?? "").trim();
}

function hasRuntimeInterfaces(container: HostRuntimeContainer): boolean {
  return (container.interfaces ?? []).length > 0;
}

function sortContainersByInterfacePriority(
  containers: HostRuntimeContainer[]
): HostRuntimeContainer[] {
  return [...containers].sort((left, right) => {
    const leftHasInterfaces = hasRuntimeInterfaces(left) ? 0 : 1;
    const rightHasInterfaces = hasRuntimeInterfaces(right) ? 0 : 1;
    if (leftHasInterfaces !== rightHasInterfaces) {
      return leftHasInterfaces - rightHasInterfaces;
    }
    return left.name.localeCompare(right.name);
  });
}

function interfaceCandidates(ifaceName: string): Set<string> {
  const candidates = new Set<string>();
  const normalized = ifaceName.trim();
  if (normalized) {
    candidates.add(normalized);
  }

  const mapped = mapSrosInterfaceName(normalized);
  if (mapped !== undefined && mapped.length > 0) {
    candidates.add(mapped);
  }

  return candidates;
}

function interfacesMatch(iface: HostRuntimeInterface, ifaceName: string): boolean {
  const candidates = interfaceCandidates(ifaceName);
  if (candidates.size === 0) {
    return false;
  }
  return (
    candidates.has(iface.name) ||
    candidates.has(iface.alias) ||
    candidates.has(iface.label ?? "")
  );
}

function containerMatchesNodeIdentifier(
  container: HostRuntimeContainer,
  nodeName: string
): boolean {
  const normalizedNode = normalizeName(nodeName);
  if (!normalizedNode) {
    return false;
  }

  const shortName = shortContainerName(container);
  const candidates = [
    normalizeName(container.name),
    normalizeName(shortName),
    normalizeName(container.nodeName)
  ];
  if (candidates.some((candidate) => candidate === normalizedNode)) {
    return true;
  }

  if (container.kind !== "nokia_srsim") {
    return false;
  }

  const normalizedBase = normalizeName(extractDistributedBaseFromName(shortName));
  if (normalizedBase && normalizedBase === normalizedNode) {
    return true;
  }

  return normalizeName(shortName).startsWith(`${normalizedNode}-`);
}

function matchingContainers(
  containers: HostRuntimeContainer[],
  nodeName: string,
  labName: string,
  includeDistributedSiblings: boolean = false
): HostRuntimeContainer[] {
  const targetLab = normalizeLabName(labName);
  const labContainers = containers.filter(
    (container) => normalizeLabName(container.labName) === targetLab
  );
  const matched = labContainers.filter((container) =>
    containerMatchesNodeIdentifier(container, nodeName)
  );
  if (!includeDistributedSiblings || matched.length === 0) {
    return sortContainersByInterfacePriority(matched);
  }

  const siblingRoots = new Set(
    matched
      .filter((container) => container.kind === "nokia_srsim")
      .map((container) => normalizeName(container.nodeName))
      .filter((root) => root.length > 0)
  );
  if (siblingRoots.size === 0) {
    return sortContainersByInterfacePriority(matched);
  }

  const candidates: HostRuntimeContainer[] = [];
  const seen = new Set<string>();
  for (const container of matched) {
    if (!seen.has(container.name)) {
      candidates.push(container);
      seen.add(container.name);
    }
  }
  for (const container of labContainers) {
    if (container.kind !== "nokia_srsim") {
      continue;
    }
    const root = normalizeName(container.nodeName);
    if (!root || !siblingRoots.has(root) || seen.has(container.name)) {
      continue;
    }
    candidates.push(container);
    seen.add(container.name);
  }

  return sortContainersByInterfacePriority(candidates);
}

function toInterfaceInfo(iface: HostRuntimeInterface): InterfaceInfo {
  return {
    name: iface.name ?? "",
    alias: iface.alias ?? "",
    label: iface.label,
    mac: iface.mac ?? "",
    mtu: iface.mtu ?? 0,
    state: iface.state ?? "",
    type: iface.type ?? "",
    ifIndex: iface.ifIndex,
    stats: iface.stats
      ? {
          rxBps: iface.stats.rxBps,
          txBps: iface.stats.txBps,
          rxPps: iface.stats.rxPps,
          txPps: iface.stats.txPps,
          rxBytes: iface.stats.rxBytes,
          txBytes: iface.stats.txBytes,
          rxPackets: iface.stats.rxPackets,
          txPackets: iface.stats.txPackets,
          statsIntervalSeconds: iface.stats.statsIntervalSeconds
        }
      : undefined,
    netemState: iface.netemState
  };
}

function toContainerInfo(container: HostRuntimeContainer): ContainerInfo {
  return {
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
  };
}

function findInterfaceInfo(
  containers: HostRuntimeContainer[],
  nodeName: string,
  ifaceName: string,
  labName: string
): InterfaceInfo | undefined {
  const candidates = matchingContainers(containers, nodeName, labName, true);
  for (const container of candidates) {
    const match = (container.interfaces ?? []).find((iface) => interfacesMatch(iface, ifaceName));
    if (match) {
      return toInterfaceInfo(match);
    }
  }
  return undefined;
}

function normalizeInterfaceName(value: unknown, fallback: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (typeof fallback === "string" && fallback.trim().length > 0) {
    return fallback;
  }
  return "";
}

function normalizeNodeIdentifier(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return "";
}

function buildInterfaceExtraData(
  sourceIface: InterfaceInfo | undefined,
  targetIface: InterfaceInfo | undefined
): Record<string, unknown> {
  const updatedExtraData: Record<string, unknown> = {};

  if (sourceIface) {
    applyInterfaceToExtraData(updatedExtraData, "Source", sourceIface);
  }
  if (targetIface) {
    applyInterfaceToExtraData(updatedExtraData, "Target", targetIface);
  }

  return updatedExtraData;
}

function applyInterfaceToExtraData(
  extraData: Record<string, unknown>,
  prefix: "Source" | "Target",
  iface: InterfaceInfo
): void {
  extraData[`clab${prefix}InterfaceState`] = iface.state || "";
  extraData[`clab${prefix}MacAddress`] = iface.mac;
  extraData[`clab${prefix}Mtu`] = iface.mtu;
  extraData[`clab${prefix}Type`] = iface.type;
  if ("netemState" in iface) {
    extraData[`clab${prefix}Netem`] = iface.netemState ?? undefined;
  }
  const stats = extractEdgeInterfaceStats(iface);
  if (stats) {
    extraData[`clab${prefix}Stats`] = stats;
  }
}

function computeEdgeClassForUpdate(
  topology: ClabTopology["topology"] | undefined,
  extraData: Record<string, unknown>,
  edge: TopoEdge,
  sourceState?: string,
  targetState?: string
): string | undefined {
  if (!topology) {
    return undefined;
  }
  const sourceNodeId = normalizeNodeIdentifier(extraData.yamlSourceNodeId, edge.source);
  const targetNodeId = normalizeNodeIdentifier(extraData.yamlTargetNodeId, edge.target);
  return computeEdgeClassFromStates(topology, sourceNodeId, targetNodeId, sourceState, targetState);
}

function lookupEdgeInterfaces(
  containers: HostRuntimeContainer[],
  edge: TopoEdge,
  edgeData: TopologyEdgeData | undefined,
  extraData: Record<string, unknown>,
  currentLabName: string
): {
  sourceIface: InterfaceInfo | undefined;
  targetIface: InterfaceInfo | undefined;
} {
  const sourceIfaceName = normalizeInterfaceName(
    extraData.clabSourcePort,
    edgeData?.sourceEndpoint
  );
  const targetIfaceName = normalizeInterfaceName(
    extraData.clabTargetPort,
    edgeData?.targetEndpoint
  );

  const sourceNodeIdentifier = normalizeNodeIdentifier(
    extraData.yamlSourceNodeId,
    extraData.clabSourceLongName,
    edge.source
  );
  const targetNodeIdentifier = normalizeNodeIdentifier(
    extraData.yamlTargetNodeId,
    extraData.clabTargetLongName,
    edge.target
  );

  return {
    sourceIface: findInterfaceInfo(
      containers,
      sourceNodeIdentifier,
      sourceIfaceName,
      currentLabName
    ),
    targetIface: findInterfaceInfo(
      containers,
      targetNodeIdentifier,
      targetIfaceName,
      currentLabName
    )
  };
}

export function createRuntimeContainerDataProvider(
  containers: HostRuntimeContainer[]
): ContainerDataProvider {
  return {
    findContainer(containerName: string, labName: string): ContainerInfo | undefined {
      const container = matchingContainers(containers, containerName, labName, false)[0];
      return container ? toContainerInfo(container) : undefined;
    },
    findInterface(
      containerName: string,
      ifaceName: string,
      labName: string
    ): InterfaceInfo | undefined {
      return findInterfaceInfo(containers, containerName, ifaceName, labName);
    },
    findDistributedSrosInterface(params) {
      const candidates = matchingContainers(containers, params.baseNodeName, params.labName, true);
      for (const container of candidates) {
        if (container.kind !== "nokia_srsim") {
          continue;
        }
        const iface = (container.interfaces ?? []).find((entry) =>
          interfacesMatch(entry, params.ifaceName)
        );
        if (iface) {
          return {
            containerName: container.name,
            ifaceData: toInterfaceInfo(iface)
          };
        }
      }
      return undefined;
    },
    findDistributedSrosContainer(params) {
      const container = matchingContainers(containers, params.baseNodeName, params.labName, true).find(
        (candidate) => candidate.kind === "nokia_srsim"
      );
      return container ? toContainerInfo(container) : undefined;
    }
  };
}

export function buildRuntimeEdgeStatsUpdates(
  edges: TopoEdge[],
  containers: HostRuntimeContainer[],
  context: TopologyRuntimeUpdateContext
): TopologyRuntimeEdgeUpdate[] {
  if (edges.length === 0 || containers.length === 0) {
    return [];
  }

  const updates: TopologyRuntimeEdgeUpdate[] = [];
  for (const edge of edges) {
    const edgeData = edge.data;
    const extraData = edgeData?.extraData ?? {};
    const { sourceIface, targetIface } = lookupEdgeInterfaces(
      containers,
      edge,
      edgeData,
      extraData,
      context.currentLabName
    );
    const updatedExtraData = buildInterfaceExtraData(sourceIface, targetIface);
    const edgeClass = computeEdgeClassForUpdate(
      context.topology,
      extraData,
      edge,
      sourceIface?.state,
      targetIface?.state
    );
    if (Object.keys(updatedExtraData).length === 0) {
      continue;
    }
    updates.push({ id: edge.id, extraData: updatedExtraData, classes: edgeClass });
  }

  return updates;
}

export function buildRuntimeNodeUpdates(
  containers: HostRuntimeContainer[],
  currentLabName: string
): TopologyRuntimeNodeUpdate[] {
  const targetLab = normalizeLabName(currentLabName);
  if (!targetLab) {
    return [];
  }

  return containers
    .filter((container) => normalizeLabName(container.labName) === targetLab)
    .map((container) => ({
      containerLongName: container.name,
      containerShortName: shortContainerName(container),
      state: container.state,
      mgmtIpv4Address: stripCidr(container.ipv4Address),
      mgmtIpv6Address: stripCidr(container.ipv6Address)
    }));
}
