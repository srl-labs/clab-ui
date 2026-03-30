/**
 * Standalone app entry point.
 *
 * Modeled on dev/main.tsx but connects to the real clab-api-server
 * through the Fastify backend instead of using mock data.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { App } from "@webview/App";
import "@webview/styles/global.css";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";

import {
  setHostContext,
  type HostRuntimeContainer,
  type HostRuntimeInterface,
  type HostRuntimeInterfaceStats
} from "@webview/services/topologyHostClient";
import { refreshTopologySnapshot } from "@webview/services/topologyHostCommands";
import { applyDevVars } from "@webview/theme/devTheme";
import { MuiThemeProvider } from "@webview/theme";
import { parseSchemaData } from "@srl-labs/clab-ui/core/schema";
import { EXPORT_COMMANDS } from "@srl-labs/clab-ui/core/messages/extension";
import { MSG_SVG_EXPORT_RESULT } from "@srl-labs/clab-ui/core/messages/webview";

import {
  buildExplorerSnapshot,
  type ExplorerActionInvocation,
  type ExplorerSnapshotOptions,
  type ExplorerSnapshotProviders
} from "@srl-labs/clab-ui/explorer";
import type {
  ExplorerIncomingMessage,
  ExplorerOutgoingMessage,
  ExplorerUiState
} from "@srl-labs/clab-ui/explorer";
import { useTopoViewerStore } from "@webview/stores/topoViewerStore";

import clabSchema from "../../../schema/clab.schema.json";
import { useLabStore, type ContainerState, type InterfaceState, type LabState } from "./stores/labStore";
import { useAuth } from "./hooks/useAuth";
import { useEventStream } from "./hooks/useEventStream";
import { LoginPage } from "./components/LoginPage";
import { SettingsOverlay } from "./components/SettingsOverlay";

// Monaco workers setup
const monacoGlobal = self as typeof self & {
  MonacoEnvironment?: {
    getWorker: (workerId: string, label: string) => Worker;
  };
};

if (!monacoGlobal.MonacoEnvironment) {
  monacoGlobal.MonacoEnvironment = {
    getWorker: (_workerId: string, label: string) => {
      if (label === "json") {
        return new JsonWorker();
      }
      return new EditorWorker();
    }
  };
}

// Schema data
const schemaData = parseSchemaData(clabSchema as Record<string, unknown>);

// Initial data for the App
const initialData = {
  schemaData,
  dockerImages: [] as string[],
  customNodes: [],
  defaultNode: "",
  customIcons: []
};

// Theme management
let currentTheme: "light" | "dark" = "dark";

function loadPersistedTheme(): "light" | "dark" {
  try {
    const raw = localStorage.getItem("clab-standalone-theme");
    if (raw === "light") return "light";
  } catch { /* ignore */ }
  return "dark";
}

function persistTheme(theme: "light" | "dark"): void {
  try {
    localStorage.setItem("clab-standalone-theme", theme);
  } catch { /* ignore */ }
}

currentTheme = loadPersistedTheme();

// Explorer bridge constants
const EXPLORER_REFRESH_DEBOUNCE_MS = 90;
const TOPOLOGY_REFRESH_DEBOUNCE_MS = 120;
const TREE_ITEM_NONE = 0;
const TREE_ITEM_COLLAPSED = 1;

interface ExplorerTreeItem {
  id?: string;
  label: string;
  description?: string;
  tooltip?: string;
  contextValue?: string;
  command?: { command: string; title: string; arguments?: unknown[] };
  collapsibleState?: number;
  state?: string;
  status?: string;
  link?: string;
  labPath?: { absolute: string; relative: string };
  labName?: string;
  name?: string;
  cID?: string;
  kind?: string;
  image?: string;
  mac?: string;
  v4Address?: string;
  v6Address?: string;
  children?: ExplorerTreeItem[];
}

interface TopologyFileEntry {
  filename: string;
  path: string;
  hasAnnotations: boolean;
  labName?: string;
  deploymentState?: string;
}

class SimpleExplorerProvider {
  constructor(private readonly roots: ExplorerTreeItem[]) {}
  getChildren(element?: ExplorerTreeItem): ExplorerTreeItem[] {
    if (!element) return this.roots;
    return Array.isArray(element.children) ? element.children : [];
  }
}

// State
let currentFilePath: string | null = null;
let explorerFilterText = "";
let explorerUiState: ExplorerUiState = {};
let explorerRefreshTimer: number | null = null;
let explorerActionBindings = new Map<string, ExplorerActionInvocation>();
const unhandledCommands = new Set<string>();
const FILE_LIST_CACHE_TTL_MS = 1500;
let fileListCache: { fetchedAt: number; entries: TopologyFileEntry[] } | null = null;
let fileListInFlight: Promise<TopologyFileEntry[]> | null = null;
let topologyRefreshTimer: number | null = null;
let topologyRefreshInFlight = false;
let topologyRefreshQueued = false;

function sendExplorerMessage(message: ExplorerIncomingMessage): void {
  window.dispatchEvent(new MessageEvent<ExplorerIncomingMessage>("message", { data: message }));
}

function postExplorerFilterState(): void {
  sendExplorerMessage({ command: "filterState", filterText: explorerFilterText });
}

function postExplorerUiState(): void {
  sendExplorerMessage({ command: "uiState", state: explorerUiState });
}

function postExplorerError(message: string): void {
  sendExplorerMessage({ command: "error", message });
}

function stripTopologySuffix(name: string): string {
  return name.replace(/\.clab\.(ya?ml)$/i, "");
}

function safeFilename(pathValue: string): string {
  const segments = pathValue.split("/").filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : pathValue;
}

function normalizePathValue(pathValue: string): string {
  return pathValue.trim().replace(/\\/g, "/");
}

function isAbsolutePath(pathValue: string): boolean {
  const normalized = normalizePathValue(pathValue);
  return normalized.startsWith("/") || normalized.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(normalized);
}

function topologyEntryLabName(entry: TopologyFileEntry): string {
  if (entry.labName && entry.labName.length > 0) {
    return entry.labName;
  }
  return stripTopologySuffix(entry.filename || safeFilename(entry.path));
}

function normalizeLabIdentity(value: string): string {
  return stripTopologySuffix(safeFilename(normalizePathValue(value))).trim().toLowerCase();
}

function isLabRunning(
  labName: string | undefined,
  labs: Map<string, { containers: Map<string, unknown> }> = useLabStore.getState().labs
): boolean {
  if (!labName || labName.trim().length === 0) {
    return false;
  }

  const target = normalizeLabIdentity(labName);
  for (const key of labs.keys()) {
    if (normalizeLabIdentity(key) === target) {
      return true;
    }
  }
  return false;
}

function findLabState(
  labName: string | undefined,
  labs: Map<string, LabState> = useLabStore.getState().labs
): LabState | undefined {
  if (!labName || labName.trim().length === 0) {
    return undefined;
  }

  const target = normalizeLabIdentity(labName);
  for (const [key, lab] of labs.entries()) {
    if (normalizeLabIdentity(key) === target) {
      return lab;
    }
  }
  return undefined;
}

function toFiniteNumber(value: string | number | undefined): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toRuntimeInterfaceStats(iface: InterfaceState): HostRuntimeInterfaceStats | undefined {
  const stats: HostRuntimeInterfaceStats = {};
  const assign = (key: keyof HostRuntimeInterfaceStats, value: string | number | undefined): void => {
    const parsed = toFiniteNumber(value);
    if (parsed !== undefined) {
      stats[key] = parsed;
    }
  };

  assign("rxBps", iface.rxBps);
  assign("txBps", iface.txBps);
  assign("rxPps", iface.rxPps);
  assign("txPps", iface.txPps);
  assign("rxBytes", iface.rxBytes);
  assign("txBytes", iface.txBytes);
  assign("rxPackets", iface.rxPackets);
  assign("txPackets", iface.txPackets);
  assign("statsIntervalSeconds", iface.statsIntervalSeconds);

  return Object.keys(stats).length > 0 ? stats : undefined;
}

function toRuntimeInterface(iface: InterfaceState): HostRuntimeInterface {
  return {
    name: iface.name,
    alias: iface.alias,
    mac: iface.mac,
    mtu: toFiniteNumber(iface.mtu) ?? 0,
    state: iface.state,
    type: iface.type,
    ifIndex: toFiniteNumber(iface.ifIndex),
    stats: toRuntimeInterfaceStats(iface)
  };
}

function toRuntimeContainer(container: ContainerState): HostRuntimeContainer {
  const interfaces = [...container.interfaces.values()]
    .map((iface) => toRuntimeInterface(iface))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    name: container.name,
    nodeName: container.nodeName,
    labName: container.labName,
    state: container.state,
    kind: container.kind,
    image: container.image,
    ipv4Address: container.ipv4Address,
    ipv6Address: container.ipv6Address,
    interfaces
  };
}

function getRuntimeContainersForLab(
  labName: string | undefined,
  labs: Map<string, LabState> = useLabStore.getState().labs
): HostRuntimeContainer[] {
  const lab = findLabState(labName, labs);
  if (!lab) {
    return [];
  }

  return [...lab.containers.values()].map((container) => toRuntimeContainer(container));
}

function runtimeContainersEqual(
  previous: HostRuntimeContainer[],
  next: HostRuntimeContainer[]
): boolean {
  if (previous.length !== next.length) {
    return false;
  }

  const byName = new Map(next.map((container) => [container.name, container]));
  for (const container of previous) {
    const candidate = byName.get(container.name);
    if (!candidate) {
      return false;
    }
    if (
      candidate.nodeName !== container.nodeName ||
      candidate.labName !== container.labName ||
      candidate.state !== container.state ||
      candidate.kind !== container.kind ||
      candidate.image !== container.image ||
      candidate.ipv4Address !== container.ipv4Address ||
      candidate.ipv6Address !== container.ipv6Address
    ) {
      return false;
    }

    const prevInterfaces = [...(container.interfaces ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    const nextInterfaces = [...(candidate.interfaces ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    if (prevInterfaces.length !== nextInterfaces.length) {
      return false;
    }

    for (let i = 0; i < prevInterfaces.length; i += 1) {
      const prevIface = prevInterfaces[i];
      const nextIface = nextInterfaces[i];
      if (
        prevIface.name !== nextIface.name ||
        prevIface.alias !== nextIface.alias ||
        prevIface.state !== nextIface.state ||
        prevIface.type !== nextIface.type ||
        prevIface.mac !== nextIface.mac ||
        prevIface.mtu !== nextIface.mtu ||
        prevIface.ifIndex !== nextIface.ifIndex
      ) {
        return false;
      }

      const prevStats = prevIface.stats;
      const nextStats = nextIface.stats;
      const keys: Array<keyof HostRuntimeInterfaceStats> = [
        "rxBps",
        "txBps",
        "rxPps",
        "txPps",
        "rxBytes",
        "txBytes",
        "rxPackets",
        "txPackets",
        "statsIntervalSeconds"
      ];
      for (const key of keys) {
        if (prevStats?.[key] !== nextStats?.[key]) {
          return false;
        }
      }
    }
  }

  return true;
}

function filterTreeItems(items: ExplorerTreeItem[], filterText: string): ExplorerTreeItem[] {
  const query = filterText.trim().toLowerCase();
  if (query.length === 0) return items;

  const visit = (item: ExplorerTreeItem): ExplorerTreeItem | null => {
    const filteredChildren = (item.children ?? [])
      .map((child) => visit(child))
      .filter((child): child is ExplorerTreeItem => child !== null);
    const haystack = [item.label, item.description, item.tooltip]
      .filter((v): v is string => typeof v === "string")
      .join(" ")
      .toLowerCase();
    if (haystack.includes(query) || filteredChildren.length > 0) {
      return { ...item, children: filteredChildren };
    }
    return null;
  };

  return items
    .map((item) => visit(item))
    .filter((item): item is ExplorerTreeItem => item !== null);
}

function buildContainerTooltip(input: {
  name: string; state: string; status: string; kind: string; image: string; id: string;
  ipv4?: string; ipv6?: string;
}): string {
  const lines = [
    `Name: ${input.name}`, `State: ${input.state}`, `Status: ${input.status}`,
    `Kind: ${input.kind}`, `Image: ${input.image}`, `ID: ${input.id}`
  ];
  if (input.ipv4 && input.ipv4 !== "N/A") lines.push(`IPv4: ${input.ipv4}`);
  if (input.ipv6 && input.ipv6 !== "N/A") lines.push(`IPv6: ${input.ipv6}`);
  return lines.join("\n");
}

function buildInterfaceTooltip(input: {
  name: string;
  alias: string;
  state: string;
  type: string;
  mac: string;
  mtu: string;
  rxBps?: string;
  txBps?: string;
}): string {
  const lines = [
    `Name: ${input.name}`,
    `Alias: ${input.alias || "N/A"}`,
    `State: ${input.state || "unknown"}`,
    `Type: ${input.type || "N/A"}`,
    `MAC: ${input.mac || "N/A"}`,
    `MTU: ${input.mtu || "N/A"}`
  ];
  if (input.rxBps) lines.push(`RX: ${input.rxBps} bps`);
  if (input.txBps) lines.push(`TX: ${input.txBps} bps`);
  return lines.join("\n");
}

function getInterfaceContextValue(state: string): string {
  return state.toLowerCase() === "up" ? "containerlabInterfaceUp" : "containerlabInterfaceDown";
}

/**
 * Build running lab tree items from the live lab store (populated by events stream).
 */
function buildRunningLabItems(filterText: string, files: TopologyFileEntry[]): ExplorerTreeItem[] {
  const labs = useLabStore.getState().labs;
  const items: ExplorerTreeItem[] = [];
  const topologyByLab = new Map<string, TopologyFileEntry>(
    files.map((entry) => [topologyEntryLabName(entry), entry])
  );

  for (const [labName, lab] of labs.entries()) {
    const containers: ExplorerTreeItem[] = [];

    for (const [, container] of lab.containers) {
      const interfaces = [...container.interfaces.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .filter((iface) => {
          const state = iface.state.toLowerCase();
          return iface.name !== "lo" && state !== "unknown";
        })
        .map((iface) => {
          const state = iface.state.toLowerCase();
          const hasAlias = Boolean(iface.alias);
          const label = hasAlias ? iface.alias : iface.name;
          const stateText = state ? state.toUpperCase() : "";
          const description = hasAlias
            ? `${stateText || "UNKNOWN"} (${iface.name})`
            : (stateText || iface.type || undefined);

          return {
            id: `running-interface:${container.name}:${iface.name}`,
            label,
            description,
            tooltip: buildInterfaceTooltip({
              name: iface.name,
              alias: iface.alias,
              state: iface.state,
              type: iface.type,
              mac: iface.mac,
              mtu: iface.mtu,
              rxBps: iface.rxBps,
              txBps: iface.txBps
            }),
            contextValue: getInterfaceContextValue(state),
            collapsibleState: TREE_ITEM_NONE,
            cID: container.containerId,
            name: iface.name,
            mac: iface.mac,
            children: []
          };
        });

      containers.push({
        id: `running-container:${container.name}`,
        label: container.nodeName || container.name,
        description: container.status || container.state,
        tooltip: buildContainerTooltip({
          name: container.name,
          state: container.state,
          status: container.status,
          kind: container.kind,
          image: container.image,
          id: container.containerId,
          ipv4: container.ipv4Address,
          ipv6: container.ipv6Address
        }),
        contextValue: "containerlabContainer",
        state: container.state,
        status: container.status,
        name: container.name,
        cID: container.containerId,
        kind: container.kind,
        image: container.image,
        v4Address: container.ipv4Address,
        v6Address: container.ipv6Address,
        collapsibleState: interfaces.length > 0 ? TREE_ITEM_COLLAPSED : TREE_ITEM_NONE,
        children: interfaces
      });
    }

    const topologyEntry = topologyByLab.get(labName);
    const labPath = topologyEntry?.path;
    const fallbackPathHint = lab.containers.values().next().value?.labPath as string | undefined;
    const pathHint = labPath ?? fallbackPathHint;
    const fallbackOwner = lab.containers.values().next().value?.owner as string | undefined;
    const owner = (lab.owner || fallbackOwner || "").trim();
    const labLabel = owner ? `${labName} (${owner})` : labName;
    const labItem: ExplorerTreeItem = {
      id: `running-lab:${labName}`,
      label: labLabel,
      description: pathHint || "No API topology file",
      tooltip: pathHint || `No API topology file available for running lab "${labName}"`,
      contextValue: "containerlabLabDeployed",
      collapsibleState: containers.length > 0 ? TREE_ITEM_COLLAPSED : TREE_ITEM_NONE,
      labName,
      children: containers
    };

    if (labPath) {
      labItem.labPath = { absolute: labPath, relative: labPath };
      labItem.command = {
        command: "containerlab.lab.graph.topoViewer",
        title: "Open TopoViewer",
        arguments: [{ labName, labPath: { absolute: labPath, relative: labPath } }]
      };
    }

    items.push(labItem);
  }

  return filterTreeItems(items, filterText);
}

/**
 * Build local (undeployed) lab items from the /files endpoint.
 */
async function buildLocalLabItems(
  filterText: string,
  files: TopologyFileEntry[]
): Promise<ExplorerTreeItem[]> {
  // Exclude files that correspond to running labs
  const runningLabs = useLabStore.getState().labs;
  const items = files
    .filter((f) => {
      const name = topologyEntryLabName(f);
      return !isLabRunning(name, runningLabs);
    })
    .map((file) => {
      const labName = topologyEntryLabName(file);
      const item: ExplorerTreeItem = {
        id: `local-lab:${file.path}`,
        label: file.filename || safeFilename(file.path),
        description: file.path,
        tooltip: file.path,
        contextValue: "containerlabLabUndeployed",
        collapsibleState: TREE_ITEM_NONE,
        labName,
        labPath: { absolute: file.path, relative: file.path },
        children: []
      };
      item.command = {
        command: "containerlab.lab.graph.topoViewer",
        title: "Open TopoViewer",
        arguments: [item]
      };
      return item;
    });

  return filterTreeItems(items, filterText);
}

const HELP_LINKS = [
  { label: "Containerlab Documentation", url: "https://containerlab.dev/" },
  { label: "VS Code Extension Documentation", url: "https://containerlab.dev/manual/vsc-extension/" },
  { label: "Browse Labs on GitHub (srl-labs)", url: "https://github.com/srl-labs/" },
  { label: "Join our Discord server", url: "https://discord.gg/vAyddtaEV9" }
] as const;

function buildHelpItems(): ExplorerTreeItem[] {
  return HELP_LINKS.map((link) => ({
    id: `help:${link.url}`,
    label: link.label,
    tooltip: link.url,
    collapsibleState: TREE_ITEM_NONE,
    command: {
      command: "containerlab.openLink",
      title: "Open Link",
      arguments: [link.url]
    },
    children: []
  }));
}

async function buildExplorerProviders(): Promise<ExplorerSnapshotProviders> {
  const files = await listTopologyFiles();
  const runningItems = buildRunningLabItems(explorerFilterText, files);
  const localItems = await buildLocalLabItems(explorerFilterText, files);
  const helpItems = buildHelpItems();

  return {
    runningProvider: new SimpleExplorerProvider(runningItems) as unknown as ExplorerSnapshotProviders["runningProvider"],
    localProvider: new SimpleExplorerProvider(localItems) as unknown as ExplorerSnapshotProviders["localProvider"],
    helpProvider: new SimpleExplorerProvider(helpItems) as unknown as ExplorerSnapshotProviders["helpProvider"]
  };
}

async function postExplorerSnapshot(): Promise<void> {
  try {
    const providers = await buildExplorerProviders();
    const options: ExplorerSnapshotOptions = {
      hideNonOwnedLabs: false,
      isLocalCaptureAllowed: false
    };
    const { snapshot, actionBindings } = await buildExplorerSnapshot(
      providers,
      explorerFilterText,
      options
    );
    explorerActionBindings = actionBindings;
    sendExplorerMessage(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postExplorerError(`Explorer refresh failed: ${message}`);
  }
}

function scheduleExplorerSnapshot(delay = EXPLORER_REFRESH_DEBOUNCE_MS): void {
  if (explorerRefreshTimer !== null) {
    window.clearTimeout(explorerRefreshTimer);
  }
  explorerRefreshTimer = window.setTimeout(() => {
    explorerRefreshTimer = null;
    void postExplorerSnapshot();
  }, delay);
}

async function flushTopologySnapshotRefresh(): Promise<void> {
  if (topologyRefreshInFlight) {
    topologyRefreshQueued = true;
    return;
  }

  topologyRefreshInFlight = true;
  try {
    await refreshTopologySnapshot();
  } catch {
    // Ignore transient refresh errors; event stream updates will retry.
  } finally {
    topologyRefreshInFlight = false;
    if (topologyRefreshQueued) {
      topologyRefreshQueued = false;
      scheduleTopologySnapshotRefresh(0);
    }
  }
}

function scheduleTopologySnapshotRefresh(delay = TOPOLOGY_REFRESH_DEBOUNCE_MS): void {
  if (topologyRefreshTimer !== null) {
    window.clearTimeout(topologyRefreshTimer);
  }
  topologyRefreshTimer = window.setTimeout(() => {
    topologyRefreshTimer = null;
    void flushTopologySnapshotRefresh();
  }, delay);
}

// Topology loading

function syncHostContext(options: {
  mode?: "edit" | "view";
  deploymentState?: "deployed" | "undeployed" | "unknown";
} = {}): void {
  const labs = useLabStore.getState().labs;
  const labName = currentFilePath ? stripTopologySuffix(safeFilename(currentFilePath)) : "";
  const isDeployed = isLabRunning(labName, labs);
  const deploymentState = options.deploymentState ?? (isDeployed ? "deployed" : "undeployed");
  const mode = options.mode ?? (deploymentState === "deployed" ? "view" : "edit");
  const runtimeContainers = getRuntimeContainersForLab(labName, labs);

  setHostContext({
    path: currentFilePath ?? "",
    mode,
    deploymentState,
    runtimeContainers
  });
}

async function loadTopologyFile(
  filePath: string,
  options: { deploymentState?: "deployed" | "undeployed" | "unknown" } = {}
): Promise<void> {
  console.log(`[Standalone] Loading topology: ${filePath}`);
  currentFilePath = filePath;
  syncHostContext(options);
  const snapshot = await refreshTopologySnapshot();

  const activeLabName = stripTopologySuffix(safeFilename(filePath));
  const stateFromApi = await resolveDeploymentState(filePath, activeLabName);
  const stateFromRunningLabs = isLabRunning(activeLabName) ? "deployed" : undefined;
  const resolvedState =
    options.deploymentState ??
    stateFromApi ??
    stateFromRunningLabs ??
    snapshot.deploymentState;
  const resolvedMode = resolvedState === "deployed" ? "view" : "edit";

  if (snapshot.deploymentState !== resolvedState || snapshot.mode !== resolvedMode) {
    useTopoViewerStore.getState().setInitialData({
      deploymentState: resolvedState,
      mode: resolvedMode
    });
    syncHostContext({ deploymentState: resolvedState, mode: resolvedMode });
  }
}

async function listTopologyFiles(): Promise<TopologyFileEntry[]> {
  const now = Date.now();
  if (fileListCache && now - fileListCache.fetchedAt < FILE_LIST_CACHE_TTL_MS) {
    return fileListCache.entries;
  }

  if (fileListInFlight) {
    return fileListInFlight;
  }

  fileListInFlight = (async () => {
    try {
      const response = await fetch("/files", { credentials: "include" });
      if (!response.ok) return [];
      const entries = (await response.json()) as TopologyFileEntry[];
      fileListCache = { fetchedAt: Date.now(), entries };
      return entries;
    } catch {
      return [];
    } finally {
      fileListInFlight = null;
    }
  })();

  return fileListInFlight;
}

function invalidateTopologyFileListCache(): void {
  fileListCache = null;
}

function firstArgAsTreeItem(args: unknown[]): ExplorerTreeItem | undefined {
  const first = args[0];
  if (!first || typeof first !== "object") return undefined;
  return first as ExplorerTreeItem;
}

function resolveLabPath(args: unknown[]): string | undefined {
  const first = args[0];
  if (typeof first === "string" && first.length > 0) {
    return normalizePathValue(first);
  }
  const item = firstArgAsTreeItem(args);
  if (item?.labPath?.absolute) {
    return normalizePathValue(item.labPath.absolute);
  }
  return undefined;
}

function resolveLabName(args: unknown[], labPath?: string): string | undefined {
  if (labPath) {
    return stripTopologySuffix(safeFilename(labPath));
  }

  const first = args[0];
  if (first && typeof first === "object") {
    const item = first as ExplorerTreeItem;
    if (item.labName && item.labName.length > 0) {
      return item.labName;
    }
    if (typeof item.id === "string" && item.id.startsWith("running-lab:")) {
      return item.id.slice("running-lab:".length);
    }
    if (typeof item.label === "string" && item.label.length > 0) {
      return item.label;
    }
  }

  return undefined;
}

function findEntryByPath(files: TopologyFileEntry[], pathValue: string): TopologyFileEntry | undefined {
  const normalized = normalizePathValue(pathValue);
  return files.find((entry) => {
    const entryPath = normalizePathValue(entry.path);
    const entryFilename = normalizePathValue(entry.filename);
    return entryPath === normalized || entryFilename === normalized;
  });
}

async function resolveApiTopologyPath(args: unknown[]): Promise<string | undefined> {
  const requestedPath = resolveLabPath(args);
  const requestedLabName = resolveLabName(args, requestedPath);
  const files = await listTopologyFiles();

  if (requestedPath) {
    const exactMatch = findEntryByPath(files, requestedPath);
    if (exactMatch) {
      return exactMatch.path;
    }

    const filenameMatch = findEntryByPath(files, safeFilename(requestedPath));
    if (filenameMatch) {
      return filenameMatch.path;
    }
  }

  if (requestedLabName) {
    const labMatch = files.find((entry) => topologyEntryLabName(entry) === requestedLabName);
    if (labMatch) {
      return labMatch.path;
    }

    const item = firstArgAsTreeItem(args);
    if (item?.contextValue === "containerlabLabDeployed") {
      return `${requestedLabName}.clab.yml`;
    }
  }

  if (requestedPath && !isAbsolutePath(requestedPath)) {
    const derivedLabName = stripTopologySuffix(safeFilename(requestedPath));
    const labMatch = files.find((entry) => topologyEntryLabName(entry) === derivedLabName);
    if (labMatch) {
      return labMatch.path;
    }
  }

  return undefined;
}

function normalizeDeploymentState(value: string | undefined): "deployed" | "undeployed" | "unknown" | undefined {
  if (value === "deployed" || value === "undeployed" || value === "unknown") {
    return value;
  }
  return undefined;
}

async function resolveDeploymentState(
  apiLabPath: string,
  labName: string | undefined
): Promise<"deployed" | "undeployed" | "unknown" | undefined> {
  const resolvedLabName = labName ?? stripTopologySuffix(safeFilename(apiLabPath));
  const files = await listTopologyFiles();
  const exact = findEntryByPath(files, apiLabPath);
  const byLab = resolvedLabName
    ? files.find((entry) => topologyEntryLabName(entry) === resolvedLabName)
    : undefined;
  const fileState = normalizeDeploymentState(exact?.deploymentState) ?? normalizeDeploymentState(byLab?.deploymentState);
  if (resolvedLabName && isLabRunning(resolvedLabName)) {
    return "deployed";
  }
  if (fileState) {
    return fileState;
  }
  return undefined;
}

async function executeExplorerCommand(commandId: string, args: unknown[]): Promise<void> {
  const commandLabPath = resolveLabPath(args);
  const labName = resolveLabName(args, commandLabPath);
  const item = firstArgAsTreeItem(args);

  switch (commandId) {
    case "containerlab.openLink": {
      const link = typeof args[0] === "string" ? args[0] : undefined;
      if (link) window.open(link, "_blank", "noopener,noreferrer");
      return;
    }
    case "containerlab.lab.graph.topoViewer":
    case "containerlab.lab.openFile":
    case "containerlab.editor.topoViewerEditor.open": {
      const apiLabPath = await resolveApiTopologyPath(args);
      if (!apiLabPath) {
        postExplorerError(
          labName
            ? `No API-backed topology file found for running lab "${labName}".`
            : "No API-backed topology file found for this item. Standalone mode only opens topologies exposed by /api/v1/labs/topology/files."
        );
        return;
      }
      const itemState = item?.contextValue === "containerlabLabDeployed"
        ? "deployed"
        : item?.contextValue === "containerlabLabUndeployed"
          ? "undeployed"
          : undefined;
      const resolvedState = await resolveDeploymentState(apiLabPath, labName);
      const deploymentState = resolvedState ?? itemState;
      await loadTopologyFile(apiLabPath, { deploymentState });
      return;
    }
    case "containerlab.lab.deploy":
    case "containerlab.lab.deploy.specificFile": {
      if (labName) {
        try {
          await fetch("/api/lab/deploy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ labName })
          });
          invalidateTopologyFileListCache();
        } catch (error) {
          console.error("[Standalone] Deploy failed:", error);
        }
      }
      return;
    }
    case "containerlab.lab.destroy":
    case "containerlab.lab.destroy.cleanup": {
      if (labName) {
        try {
          await fetch("/api/lab/destroy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ labName })
          });
          invalidateTopologyFileListCache();
        } catch (error) {
          console.error("[Standalone] Destroy failed:", error);
        }
      }
      return;
    }
    case "containerlab.lab.redeploy":
    case "containerlab.lab.redeploy.cleanup": {
      if (labName) {
        try {
          await fetch("/api/lab/redeploy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ labName })
          });
          invalidateTopologyFileListCache();
        } catch (error) {
          console.error("[Standalone] Redeploy failed:", error);
        }
      }
      return;
    }
    case "containerlab.node.copyName": {
      const item = args[0] as ExplorerTreeItem | undefined;
      if (item) await navigator.clipboard.writeText(item.name || item.label || "").catch(() => {});
      return;
    }
    case "containerlab.node.copyID": {
      const item = args[0] as ExplorerTreeItem | undefined;
      if (item?.cID) await navigator.clipboard.writeText(item.cID).catch(() => {});
      return;
    }
    case "containerlab.node.copyKind": {
      const item = args[0] as ExplorerTreeItem | undefined;
      if (item?.kind) await navigator.clipboard.writeText(item.kind).catch(() => {});
      return;
    }
    case "containerlab.node.copyImage": {
      const item = args[0] as ExplorerTreeItem | undefined;
      if (item?.image) await navigator.clipboard.writeText(item.image).catch(() => {});
      return;
    }
    case "containerlab.node.copyIPv4Address": {
      const item = args[0] as ExplorerTreeItem | undefined;
      if (item?.v4Address) await navigator.clipboard.writeText(item.v4Address).catch(() => {});
      return;
    }
    case "containerlab.node.copyIPv6Address": {
      const item = args[0] as ExplorerTreeItem | undefined;
      if (item?.v6Address) await navigator.clipboard.writeText(item.v6Address).catch(() => {});
      return;
    }
    case "containerlab.interface.copyMACAddress": {
      const item = args[0] as ExplorerTreeItem | undefined;
      if (item?.mac) await navigator.clipboard.writeText(item.mac).catch(() => {});
      return;
    }
    case "containerlab.lab.copyPath": {
      const apiLabPath = await resolveApiTopologyPath(args);
      if (apiLabPath) await navigator.clipboard.writeText(apiLabPath).catch(() => {});
      return;
    }
    default: {
      if (!unhandledCommands.has(commandId)) {
        unhandledCommands.add(commandId);
        console.info(`[Standalone] Command not implemented: ${commandId}`);
      }
    }
  }
}

// Mock VS Code API - forces HTTP path in topologyHostClient.ts
function setupMockVscodeApi(): void {
  type VscodeMessage = {
    command?: string;
    type?: string;
    level?: string;
    message?: string;
    fileLine?: string;
    actionRef?: string;
    value?: string;
    state?: ExplorerUiState;
    requestId?: string;
    baseName?: string;
    svgContent?: string;
  };

  const warnedCommands = new Set<string>();

  const isExplorerOutgoing = (msg: VscodeMessage): msg is ExplorerOutgoingMessage => {
    return (
      msg.command === "ready" ||
      msg.command === "setFilter" ||
      msg.command === "invokeAction" ||
      msg.command === "persistUiState"
    );
  };

  const handleExplorerMessage = (message: ExplorerOutgoingMessage): void => {
    if (message.command === "ready") {
      postExplorerFilterState();
      postExplorerUiState();
      scheduleExplorerSnapshot(0);
      return;
    }
    if (message.command === "setFilter") {
      explorerFilterText = message.value.trim();
      postExplorerFilterState();
      scheduleExplorerSnapshot(0);
      return;
    }
    if (message.command === "persistUiState") {
      explorerUiState = message.state || {};
      return;
    }
    if (message.command === "invokeAction") {
      const binding = explorerActionBindings.get(message.actionRef);
      if (!binding) {
        postExplorerError("Action is no longer available. Refresh and try again.");
        return;
      }
      Promise.resolve(executeExplorerCommand(binding.commandId, binding.args ?? []))
        .then(() => scheduleExplorerSnapshot(0))
        .catch((error: unknown) => {
          const msg = error instanceof Error ? error.message : String(error);
          postExplorerError(`Failed to execute action: ${msg}`);
        });
    }
  };

  const triggerDownload = (filename: string, content: string, mimeType: string): void => {
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const mockVscodeApi = {
    __isDevMock__: true,
    __disableDevMockTraffic__: true,
    postMessage: (message: unknown) => {
      const msg = message as VscodeMessage | undefined;

      // Ignore topology-host messages - these use HTTP in standalone mode
      if (msg?.type?.startsWith("topology-host:")) return;

      if (!msg?.command) return;

      if (isExplorerOutgoing(msg)) {
        handleExplorerMessage(msg);
        return;
      }

      if (msg.command === "reactTopoViewerLog" || msg.command === "topoViewerLog") {
        return;
      }

      if (msg.command === EXPORT_COMMANDS.EXPORT_SVG_GRAFANA_BUNDLE) {
        const baseName = typeof msg.baseName === "string" ? msg.baseName.trim() || "topology" : "topology";
        const svgContent = typeof msg.svgContent === "string" ? msg.svgContent : "";
        if (svgContent) {
          triggerDownload(`${baseName}.svg`, svgContent, "image/svg+xml");
        }
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: MSG_SVG_EXPORT_RESULT,
              requestId: msg.requestId ?? "",
              success: true,
              files: [`${baseName}.svg`]
            }
          })
        );
        return;
      }

      if (!warnedCommands.has(msg.command)) {
        warnedCommands.add(msg.command);
        console.warn(`[Standalone] Unhandled VS Code command: ${msg.command}`);
      }
    }
  };

  (window as unknown as { vscode: typeof mockVscodeApi }).vscode = mockVscodeApi;
}

// Render

type StandaloneWindowState = Window & {
  __clabStandaloneReactRoot?: ReactRoot;
};

const standaloneWindowState = window as StandaloneWindowState;
let reactRoot: ReactRoot | null = standaloneWindowState.__clabStandaloneReactRoot ?? null;

function renderApp(): void {
  (window as unknown as Record<string, unknown>).__INITIAL_DATA__ = initialData;
  (window as unknown as Record<string, unknown>).__SCHEMA_DATA__ = initialData.schemaData;
  (window as unknown as Record<string, unknown>).__DOCKER_IMAGES__ = initialData.dockerImages;

  const container = document.getElementById("root");
  if (!container) throw new Error("Root element not found");

  if (!reactRoot) {
    reactRoot = createRoot(container);
    standaloneWindowState.__clabStandaloneReactRoot = reactRoot;
  }

  reactRoot.render(<StandaloneApp />);
}

/**
 * Root component that handles auth and renders the app.
 */
function StandaloneApp() {
  const { isAuthenticated, loading, logout, login, error } = useAuth();
  const connected = useLabStore((s) => s.connected);
  const [apiUrl, setApiUrl] = useState("");

  // Start event stream when authenticated
  useEventStream(isAuthenticated);

  // Refresh explorer when lab state changes
  const labsRef = useRef(useLabStore.getState().labs);
  useEffect(() => {
    const unsub = useLabStore.subscribe((state) => {
      if (state.labs !== labsRef.current) {
        const previousLabs = labsRef.current;
        labsRef.current = state.labs;
        scheduleExplorerSnapshot();

        if (currentFilePath) {
          const activeLabName = stripTopologySuffix(safeFilename(currentFilePath));
          const wasDeployed = isLabRunning(activeLabName, previousLabs);
          const isDeployed = isLabRunning(activeLabName, state.labs);
          const previousRuntimeContainers = getRuntimeContainersForLab(activeLabName, previousLabs);
          const nextRuntimeContainers = getRuntimeContainersForLab(activeLabName, state.labs);
          const runtimeChanged = !runtimeContainersEqual(previousRuntimeContainers, nextRuntimeContainers);

          if (wasDeployed !== isDeployed || (isDeployed && runtimeChanged)) {
            syncHostContext({ deploymentState: isDeployed ? "deployed" : "undeployed" });
            scheduleTopologySnapshotRefresh();
          }
        }
      }
    });
    return unsub;
  }, []);

  const refreshApiConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/config", { credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as { clabApiUrl?: string; defaultClabApiUrl?: string };
      if (typeof data.clabApiUrl === "string" && data.clabApiUrl.length > 0) {
        setApiUrl(data.clabApiUrl);
        return;
      }
      if (typeof data.defaultClabApiUrl === "string" && data.defaultClabApiUrl.length > 0) {
        setApiUrl(data.defaultClabApiUrl);
      }
    } catch {
      // Keep current value if config endpoint is temporarily unavailable
    }
  }, []);

  useEffect(() => {
    void refreshApiConfig();
  }, [isAuthenticated, refreshApiConfig]);

  const handleLogin = useCallback(
    async (username: string, password: string, selectedApiUrl: string) => {
      await login(username, password, selectedApiUrl);
      await refreshApiConfig();
    },
    [login, refreshApiConfig]
  );

  const handleToggleTheme = useCallback(() => {
    document.documentElement.classList.toggle("light");
    currentTheme = document.documentElement.classList.contains("light") ? "light" : "dark";
    applyDevVars(currentTheme);
    persistTheme(currentTheme);
  }, []);

  const handleLogout = useCallback(() => {
    void logout();
  }, [logout]);

  if (loading) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", color: "var(--vscode-editor-foreground, #d4d4d4)"
      }}>
        Loading...
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <MuiThemeProvider>
        <LoginPage
          error={error}
          apiUrl={apiUrl}
          onApiUrlChange={setApiUrl}
          onLogin={handleLogin}
        />
      </MuiThemeProvider>
    );
  }

  return (
    <>
      <App initialData={initialData} />
      <SettingsOverlayMounted
        currentTheme={currentTheme}
        onToggleTheme={handleToggleTheme}
        onLogout={handleLogout}
        connected={connected}
        apiUrl={apiUrl || "unknown"}
      />
    </>
  );
}

/**
 * Settings overlay mounted in its own root div.
 */
function SettingsOverlayMounted(props: {
  currentTheme: "light" | "dark";
  onToggleTheme: () => void;
  onLogout: () => void;
  connected: boolean;
  apiUrl: string;
}) {
  const overlayContainer = document.getElementById("settings-overlay");
  if (!overlayContainer) return null;

  return createPortal(
    <MuiThemeProvider>
      <SettingsOverlay
        currentTheme={props.currentTheme}
        onToggleTheme={props.onToggleTheme}
        onLogout={props.onLogout}
        apiUrl={props.apiUrl}
        connected={props.connected}
      />
    </MuiThemeProvider>,
    overlayContainer
  );
}

// Bootstrap

if (currentTheme === "light") {
  document.documentElement.classList.add("light");
} else {
  document.documentElement.classList.remove("light");
}
applyDevVars(currentTheme);
setupMockVscodeApi();
renderApp();
