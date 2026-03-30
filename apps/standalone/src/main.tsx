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

import { createApiClabUiHost, setClabUiHost } from "@webview/host";
import {
  setHostContext
} from "@webview/services/topologyHostClient";
import { refreshTopologySnapshot } from "@webview/services/topologyHostCommands";
import { applyDevVars } from "@webview/theme/devTheme";
import { MuiThemeProvider } from "@webview/theme";
import { parseSchemaData } from "@srl-labs/clab-ui/core/schema";
import {
  EXPORT_COMMANDS,
  MSG_CANCEL_LAB_LIFECYCLE,
  type LifecycleCommand as ExtensionLifecycleCommand
} from "@srl-labs/clab-ui/core/messages/extension";
import {
  MSG_LAB_LIFECYCLE_LOG,
  MSG_LAB_LIFECYCLE_STATUS,
  MSG_SVG_EXPORT_RESULT
} from "@srl-labs/clab-ui/core/messages/webview";

import {
  buildExplorerSnapshot,
  type ExplorerActionInvocation,
  type ExplorerSnapshotOptions,
  type ExplorerSnapshotProviders
} from "@srl-labs/clab-ui/explorer/snapshot";
import type {
  ExplorerIncomingMessage,
  ExplorerUiState
} from "@srl-labs/clab-ui/explorer/snapshot";
import { useTopoViewerStore } from "@webview/stores/topoViewerStore";

import clabSchema from "../../../schema/clab.schema.json";
import { useLabStore, type LabState } from "./stores/labStore";
import { useAuth } from "./hooks/useAuth";
import { useEventStream } from "./hooks/useEventStream";
import { LoginPage } from "./components/LoginPage";
import { SettingsOverlay } from "./components/SettingsOverlay";
import { getRuntimeContainersForLab, runtimeContainersEqual } from "./runtimeData";

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

interface TopologyDocEventMessage {
  type: "topology-doc";
  labName: string;
  path: string;
  documentKind: "yaml" | "annotations";
  action: "create" | "change" | "delete" | "rename";
  revision: string;
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
const explorerSubscribers = new Set<(message: ExplorerIncomingMessage) => void>();
const unhandledCommands = new Set<string>();
const FILE_LIST_CACHE_TTL_MS = 1500;
let fileListCache: { fetchedAt: number; entries: TopologyFileEntry[] } | null = null;
let fileListInFlight: Promise<TopologyFileEntry[]> | null = null;
let topologyRefreshTimer: number | null = null;
let topologyRefreshInFlight = false;
let topologyRefreshQueued = false;
let topologyEventSource: EventSource | null = null;
let topologyEventStreamPath: string | null = null;
let standaloneAuthenticated = false;
const LIFECYCLE_STATE_WAIT_TIMEOUT_MS = 120_000;
const LIFECYCLE_STATE_WAIT_POLL_MS = 750;
const LIFECYCLE_RESPONSE_LOG_LIMIT = 500;
const LIFECYCLE_TIMESTAMP_LEVEL_PATTERN =
  /^(?:\d{2}:\d{2}:\d{2}|\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (INFO|WARN|ERRO|ERROR|FATAL|PANIC)\b/;
type LifecycleCommandType = "deploy" | "destroy" | "redeploy";
type LifecycleCommandStream = "stdout" | "stderr";
type LifecycleCommandEndpoint = "deploy" | "destroy" | "redeploy";
interface LifecycleApiCallResult {
  logs: string[];
  message?: string;
}

interface LifecycleStreamEvent {
  type?: unknown;
  line?: unknown;
  stream?: unknown;
  message?: unknown;
  error?: unknown;
}

interface LifecycleCommandConfig {
  commandType: LifecycleCommandType;
  endpoint: LifecycleCommandEndpoint;
  cleanup: boolean;
  label: string;
}

const LIFECYCLE_COMMAND_CONFIG: Record<ExtensionLifecycleCommand, LifecycleCommandConfig> = {
  deployLab: {
    commandType: "deploy",
    endpoint: "deploy",
    cleanup: false,
    label: "deploy"
  },
  deployLabCleanup: {
    commandType: "deploy",
    endpoint: "deploy",
    cleanup: true,
    label: "deploy (cleanup)"
  },
  destroyLab: {
    commandType: "destroy",
    endpoint: "destroy",
    cleanup: false,
    label: "destroy"
  },
  destroyLabCleanup: {
    commandType: "destroy",
    endpoint: "destroy",
    cleanup: true,
    label: "destroy (cleanup)"
  },
  redeployLab: {
    commandType: "redeploy",
    endpoint: "redeploy",
    cleanup: false,
    label: "redeploy"
  },
  redeployLabCleanup: {
    commandType: "redeploy",
    endpoint: "redeploy",
    cleanup: true,
    label: "redeploy (cleanup)"
  }
};

interface ActiveLifecycleRequest {
  id: number;
  command: ExtensionLifecycleCommand;
  commandType: LifecycleCommandType;
  labName: string;
  abortController: AbortController;
  cancelled: boolean;
}

let activeLifecycleRequest: ActiveLifecycleRequest | null = null;
let nextLifecycleRequestId = 0;

function sendExplorerMessage(message: ExplorerIncomingMessage): void {
  for (const subscriber of explorerSubscribers) {
    subscriber(message);
  }
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

function isStandaloneLifecycleCommand(command: string): command is ExtensionLifecycleCommand {
  return Object.prototype.hasOwnProperty.call(LIFECYCLE_COMMAND_CONFIG, command);
}

function postWebviewMessage(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent("message", { data }));
}

function postLifecycleLogMessage(
  commandType: LifecycleCommandType,
  line: string,
  stream: LifecycleCommandStream
): void {
  postWebviewMessage({
    type: MSG_LAB_LIFECYCLE_LOG,
    data: { commandType, line, stream }
  });
}

function postLifecycleStatusMessage(
  commandType: LifecycleCommandType,
  status: "success" | "error",
  errorMessage?: string
): void {
  postWebviewMessage({
    type: MSG_LAB_LIFECYCLE_STATUS,
    data: { commandType, status, errorMessage }
  });
}

function getActiveLabName(): string | undefined {
  const fromStore = useTopoViewerStore.getState().labName?.trim();
  if (fromStore && fromStore.length > 0) {
    return fromStore;
  }

  if (currentFilePath) {
    const fromPath = stripTopologySuffix(safeFilename(currentFilePath)).trim();
    if (fromPath.length > 0) {
      return fromPath;
    }
  }
  return undefined;
}

function getActiveTopologyRelativePath(): string | undefined {
  if (!currentFilePath) {
    return undefined;
  }

  const normalized = normalizePathValue(currentFilePath);
  if (!normalized) {
    return undefined;
  }

  const filename = safeFilename(normalized);
  if (!filename || filename.startsWith(".")) {
    return undefined;
  }
  return filename;
}

async function readLifecycleError(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  if (body.trim().length === 0) {
    return `${response.status} ${response.statusText}`.trim();
  }
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim().length > 0) {
      return parsed.error;
    }
    if (typeof parsed.message === "string" && parsed.message.trim().length > 0) {
      return parsed.message;
    }
  } catch {
    // Fall back to raw body text for non-JSON responses.
  }
  return body;
}

async function invokeLifecycleApi(
  endpoint: LifecycleCommandEndpoint,
  labName: string,
  cleanup: boolean,
  options: { path?: string; signal?: AbortSignal } = {}
): Promise<LifecycleApiCallResult> {
  const payload: { labName: string; cleanup?: boolean; path?: string } = { labName };
  if (cleanup) {
    payload.cleanup = true;
  }
  if (options.path) {
    payload.path = options.path;
  }

  const response = await fetch(`/api/lab/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
    signal: options.signal
  });

  if (!response.ok) {
    throw new Error(await readLifecycleError(response));
  }

  const body = (await response.json().catch(() => undefined)) as
    | { logs?: unknown; message?: unknown }
    | undefined;
  const logs = Array.isArray(body?.logs)
    ? body.logs.filter((line): line is string => typeof line === "string")
    : [];
  const message = typeof body?.message === "string" ? body.message : undefined;

  return { logs, message };
}

async function invokeLifecycleApiStream(
  endpoint: LifecycleCommandEndpoint,
  labName: string,
  cleanup: boolean,
  options: {
    path?: string;
    signal?: AbortSignal;
    onLog: (line: string, stream: LifecycleCommandStream) => void;
  }
): Promise<{ message?: string }> {
  const payload: { labName: string; cleanup?: boolean; path?: string } = { labName };
  if (cleanup) {
    payload.cleanup = true;
  }
  if (options.path) {
    payload.path = options.path;
  }

  const response = await fetch(`/api/lab/${endpoint}/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
    signal: options.signal
  });

  if (!response.ok) {
    throw new Error(await readLifecycleError(response));
  }
  if (!response.body) {
    throw new Error("Lifecycle stream response has no body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completionMessage: string | undefined;

  const processLine = (raw: string): void => {
    const trimmed = raw.trim();
    if (!trimmed) {
      return;
    }

    let event: LifecycleStreamEvent;
    try {
      event = JSON.parse(trimmed) as LifecycleStreamEvent;
    } catch {
      return;
    }

    if (event.type === "log" && typeof event.line === "string") {
      if (!shouldDisplayLifecycleLogLine(event.line)) {
        return;
      }
      const stream = event.stream === "stderr" ? "stderr" : inferLifecycleLogStream(event.line);
      options.onLog(event.line, stream);
      return;
    }

    if (event.type === "done") {
      if (typeof event.message === "string" && event.message.trim().length > 0) {
        completionMessage = event.message;
      }
      return;
    }

    if (event.type === "error") {
      const errorMessage =
        typeof event.error === "string" && event.error.trim().length > 0
          ? event.error
          : typeof event.message === "string" && event.message.trim().length > 0
            ? event.message
            : "Lifecycle command failed.";
      throw new Error(errorMessage);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        processLine(line);
      }
    }
    const remainder = decoder.decode();
    if (remainder) {
      buffer += remainder;
    }
    if (buffer.trim().length > 0) {
      processLine(buffer);
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  return { message: completionMessage };
}

function inferLifecycleLogStream(line: string): LifecycleCommandStream {
  const upper = line.toUpperCase();
  if (upper.includes(" ERROR ") || upper.includes(" FATAL ") || upper.includes("PANIC")) {
    return "stderr";
  }
  return "stdout";
}

function shouldDisplayLifecycleLogLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }
  if (LIFECYCLE_TIMESTAMP_LEVEL_PATTERN.test(trimmed)) {
    if (trimmed.includes(" username=")) {
      return false;
    }
    return true;
  }
  return (
    trimmed.startsWith("notice=") ||
    trimmed.startsWith("│") ||
    trimmed.startsWith("╭") ||
    trimmed.startsWith("├") ||
    trimmed.startsWith("╰") ||
    trimmed.startsWith("🎉=") ||
    trimmed.startsWith("deprecated type=")
  );
}

function normalizeLifecycleResponseLogs(lines: string[]): string[] {
  const normalized: string[] = [];
  let previous = "";
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!shouldDisplayLifecycleLogLine(line)) {
      continue;
    }
    if (line === previous) {
      continue;
    }
    normalized.push(line);
    previous = line;
    if (normalized.length >= LIFECYCLE_RESPONSE_LOG_LIMIT) {
      break;
    }
  }
  return normalized;
}

async function queryLabRunningState(labName: string): Promise<boolean> {
  const response = await fetch(`/api/lab/status?labName=${encodeURIComponent(labName)}`, {
    credentials: "include"
  });
  if (!response.ok) {
    throw new Error(await readLifecycleError(response));
  }
  const payload = (await response.json()) as { running?: unknown };
  return payload.running === true;
}

async function waitForExpectedLabRunningState(
  request: ActiveLifecycleRequest,
  expectedRunning: boolean
): Promise<boolean> {
  const deadline = Date.now() + LIFECYCLE_STATE_WAIT_TIMEOUT_MS;
  let previousRunningState: boolean | undefined;

  while (Date.now() < deadline) {
    if (activeLifecycleRequest?.id !== request.id || request.cancelled) {
      return false;
    }

    let running: boolean;
    try {
      running = await queryLabRunningState(request.labName);
    } catch (error) {
      if (activeLifecycleRequest?.id !== request.id || request.cancelled) {
        return false;
      }
      const message = error instanceof Error ? error.message : String(error);
      postLifecycleLogMessage(request.commandType, `Status check failed: ${message}`, "stderr");
      await new Promise((resolve) => {
        window.setTimeout(resolve, LIFECYCLE_STATE_WAIT_POLL_MS);
      });
      continue;
    }

    if (running !== previousRunningState) {
      previousRunningState = running;
      postLifecycleLogMessage(
        request.commandType,
        `Runtime state observed: ${running ? "deployed" : "undeployed"}`,
        "stdout"
      );
    }

    if (running === expectedRunning) {
      return true;
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, LIFECYCLE_STATE_WAIT_POLL_MS);
    });
  }

  return false;
}

function syncActiveTopologyAfterLifecycle(commandType: LifecycleCommandType, labName: string): void {
  if (!currentFilePath) {
    return;
  }
  const activeLabName = stripTopologySuffix(safeFilename(currentFilePath));
  if (normalizeLabIdentity(activeLabName) !== normalizeLabIdentity(labName)) {
    return;
  }

  syncHostContext({
    deploymentState: commandType === "destroy" ? "undeployed" : "deployed"
  });
  scheduleTopologySnapshotRefresh(0);
}

function removeLabFromRuntimeStore(labName: string): void {
  useLabStore.setState((state) => {
    let changed = false;
    const nextLabs = new Map(state.labs);
    for (const key of nextLabs.keys()) {
      if (normalizeLabIdentity(key) === normalizeLabIdentity(labName)) {
        nextLabs.delete(key);
        changed = true;
      }
    }
    return changed ? { labs: nextLabs } : state;
  });
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  return error instanceof Error && error.name === "AbortError";
}

function getLifecycleTypeFromProcessingMode(): LifecycleCommandType {
  return useTopoViewerStore.getState().processingMode === "destroy" ? "destroy" : "deploy";
}

async function runStandaloneLifecycleCommand(command: ExtensionLifecycleCommand): Promise<void> {
  const config = LIFECYCLE_COMMAND_CONFIG[command];
  const labName = getActiveLabName();
  if (!labName) {
    postLifecycleStatusMessage(
      getLifecycleTypeFromProcessingMode(),
      "error",
      "No active lab selected for lifecycle command."
    );
    return;
  }

  if (activeLifecycleRequest) {
    activeLifecycleRequest.cancelled = true;
    activeLifecycleRequest.abortController.abort();
    activeLifecycleRequest = null;
  }

  const request: ActiveLifecycleRequest = {
    id: ++nextLifecycleRequestId,
    command,
    commandType: config.commandType,
    labName,
    abortController: new AbortController(),
    cancelled: false
  };
  activeLifecycleRequest = request;

  postLifecycleLogMessage(config.commandType, `Starting ${config.label} for "${labName}"...`, "stdout");
  if (config.endpoint === "deploy" && config.cleanup) {
    postLifecycleLogMessage(
      config.commandType,
      "Cleanup is not supported by deploy API; running a standard deploy.",
      "stdout"
    );
  }

  try {
    const deployPath = config.endpoint === "deploy" ? getActiveTopologyRelativePath() : undefined;
    postLifecycleLogMessage(config.commandType, `Sending ${config.label} request to API...`, "stdout");
    const lifecycleResponse = await invokeLifecycleApiStream(config.endpoint, labName, config.cleanup, {
      path: deployPath,
      signal: request.abortController.signal,
      onLog: (line, stream) => {
        postLifecycleLogMessage(config.commandType, line, stream);
      }
    });
    if (activeLifecycleRequest?.id !== request.id || request.cancelled) {
      return;
    }
    if (lifecycleResponse.message) {
      postLifecycleLogMessage(
        config.commandType,
        lifecycleResponse.message,
        inferLifecycleLogStream(lifecycleResponse.message)
      );
    }

    const expectedRunning = config.commandType !== "destroy";
    postLifecycleLogMessage(
      config.commandType,
      `Request accepted. Waiting for runtime to become ${expectedRunning ? "deployed" : "undeployed"}...`,
      "stdout"
    );
    const reachedExpectedState = await waitForExpectedLabRunningState(request, expectedRunning);
    if (activeLifecycleRequest?.id !== request.id || request.cancelled) {
      return;
    }
    if (!reachedExpectedState) {
      if (config.commandType === "destroy") {
        removeLabFromRuntimeStore(labName);
        invalidateTopologyFileListCache();
        scheduleExplorerSnapshot(0);
      }
      postLifecycleStatusMessage(
        config.commandType,
        "error",
        `Timed out waiting for lab "${labName}" to become ${expectedRunning ? "deployed" : "undeployed"}.`
      );
      return;
    }

    if (config.commandType === "destroy") {
      removeLabFromRuntimeStore(labName);
    }

    invalidateTopologyFileListCache();
    scheduleExplorerSnapshot(0);
    syncActiveTopologyAfterLifecycle(config.commandType, labName);
    postLifecycleLogMessage(config.commandType, `${config.label} completed.`, "stdout");
    postLifecycleStatusMessage(config.commandType, "success");
  } catch (error) {
    if (activeLifecycleRequest?.id !== request.id || request.cancelled || isAbortError(error)) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    postLifecycleStatusMessage(config.commandType, "error", message);
  } finally {
    if (activeLifecycleRequest?.id === request.id) {
      activeLifecycleRequest = null;
    }
  }
}

function handleStandaloneLifecycleCancellation(): void {
  const request = activeLifecycleRequest;
  if (!request) {
    postLifecycleStatusMessage(
      getLifecycleTypeFromProcessingMode(),
      "error",
      "No active lifecycle command to cancel."
    );
    return;
  }

  request.cancelled = true;
  request.abortController.abort();
  if (activeLifecycleRequest?.id === request.id) {
    activeLifecycleRequest = null;
  }

  postLifecycleLogMessage(request.commandType, "Lifecycle command cancelled by user.", "stderr");
  postLifecycleStatusMessage(request.commandType, "error", "Lifecycle command cancelled by user.");
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


function labsEqualForExplorer(previousLabs: Map<string, LabState>, nextLabs: Map<string, LabState>): boolean {
  if (previousLabs.size !== nextLabs.size) {
    return false;
  }

  for (const [labName, previousLab] of previousLabs.entries()) {
    const nextLab = nextLabs.get(labName);
    if (!nextLab) {
      return false;
    }
    if (previousLab.owner !== nextLab.owner || previousLab.containers.size !== nextLab.containers.size) {
      return false;
    }

    for (const [containerName, previousContainer] of previousLab.containers.entries()) {
      const nextContainer = nextLab.containers.get(containerName);
      if (!nextContainer) {
        return false;
      }
      if (
        previousContainer.nodeName !== nextContainer.nodeName ||
        previousContainer.kind !== nextContainer.kind ||
        previousContainer.image !== nextContainer.image ||
        previousContainer.state !== nextContainer.state ||
        previousContainer.status !== nextContainer.status ||
        previousContainer.ipv4Address !== nextContainer.ipv4Address ||
        previousContainer.ipv6Address !== nextContainer.ipv6Address ||
        previousContainer.labPath !== nextContainer.labPath ||
        previousContainer.interfaces.size !== nextContainer.interfaces.size
      ) {
        return false;
      }

      for (const [ifaceName, previousIface] of previousContainer.interfaces.entries()) {
        const nextIface = nextContainer.interfaces.get(ifaceName);
        if (!nextIface) {
          return false;
        }
        if (
          previousIface.alias !== nextIface.alias ||
          previousIface.state !== nextIface.state ||
          previousIface.type !== nextIface.type ||
          previousIface.mac !== nextIface.mac ||
          previousIface.mtu !== nextIface.mtu ||
          previousIface.ifIndex !== nextIface.ifIndex ||
          previousIface.netemDelay !== nextIface.netemDelay ||
          previousIface.netemJitter !== nextIface.netemJitter ||
          previousIface.netemLoss !== nextIface.netemLoss ||
          previousIface.netemRate !== nextIface.netemRate ||
          previousIface.netemCorruption !== nextIface.netemCorruption
        ) {
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

function closeTopologyEventStream(): void {
  topologyEventSource?.close();
  topologyEventSource = null;
  topologyEventStreamPath = null;
}

function handleTopologyDocumentEvent(event: TopologyDocEventMessage): void {
  invalidateTopologyFileListCache();
  scheduleExplorerSnapshot(0);

  const currentRevision = useTopoViewerStore.getState().documentRevision;
  if (event.revision && event.revision === currentRevision) {
    return;
  }
  scheduleTopologySnapshotRefresh(0);
}

function ensureTopologyEventStream(): void {
  const filePath = currentFilePath?.trim() ?? "";
  if (!standaloneAuthenticated || filePath.length === 0) {
    closeTopologyEventStream();
    return;
  }

  if (topologyEventSource && topologyEventStreamPath === filePath) {
    return;
  }

  closeTopologyEventStream();
  const es = new EventSource(`/api/topology/events?path=${encodeURIComponent(filePath)}`);
  topologyEventSource = es;
  topologyEventStreamPath = filePath;

  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as TopologyDocEventMessage;
      if (data.type !== "topology-doc") {
        return;
      }
      handleTopologyDocumentEvent(data);
    } catch {
      // Ignore malformed topology events
    }
  };

  es.onerror = () => {
    // EventSource reconnects automatically.
  };
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
  ensureTopologyEventStream();
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
          const apiLabPath = await resolveApiTopologyPath(args);
          await invokeLifecycleApi("deploy", labName, false, { path: apiLabPath });
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
          const cleanup = commandId === "containerlab.lab.destroy.cleanup";
          await invokeLifecycleApi("destroy", labName, cleanup);
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
          const cleanup = commandId === "containerlab.lab.redeploy.cleanup";
          await invokeLifecycleApi("redeploy", labName, cleanup);
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

// Standalone host bridge - explicit UI host with API-backed topology transport.
function setupStandaloneUiHost(): void {
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

  const explorer = {
    connect(): void {
      postExplorerFilterState();
      postExplorerUiState();
      scheduleExplorerSnapshot(0);
    },
    setFilter(filterText: string): void {
      explorerFilterText = filterText.trim();
      postExplorerFilterState();
      scheduleExplorerSnapshot(0);
    },
    persistUiState(state: ExplorerUiState): void {
      explorerUiState = state || {};
    },
    invokeAction(actionRef: string): Promise<void> {
      const binding = explorerActionBindings.get(actionRef);
      if (!binding) {
        postExplorerError("Action is no longer available. Refresh and try again.");
        return Promise.resolve();
      }
      return Promise.resolve(executeExplorerCommand(binding.commandId, binding.args ?? []))
        .then(() => scheduleExplorerSnapshot(0))
        .catch((error: unknown) => {
          const msg = error instanceof Error ? error.message : String(error);
          postExplorerError(`Failed to execute action: ${msg}`);
        });
    },
    subscribe(handler: (message: ExplorerIncomingMessage) => void): () => void {
      explorerSubscribers.add(handler);
      return () => {
        explorerSubscribers.delete(handler);
      };
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

  const postMessage = (message: unknown) => {
    const msg = message as VscodeMessage | undefined;

    if (!msg?.command) return;

    if (msg.command === "reactTopoViewerLog" || msg.command === "topoViewerLog") {
      return;
    }

    if (msg.command === MSG_CANCEL_LAB_LIFECYCLE) {
      handleStandaloneLifecycleCancellation();
      return;
    }

    if (isStandaloneLifecycleCommand(msg.command)) {
      const lifecycleCommand = msg.command;
      void runStandaloneLifecycleCommand(lifecycleCommand).catch((error: unknown) => {
        const config = LIFECYCLE_COMMAND_CONFIG[lifecycleCommand];
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[Standalone] ${config.label} failed:`, error);
        postLifecycleStatusMessage(config.commandType, "error", message);
      });
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
  };

  setClabUiHost(
    createApiClabUiHost({
      explorer,
      postMessage,
      targetWindow: window
    })
  );

  const mockVscodeApi = {
    __isDevMock__: true,
    __disableDevMockTraffic__: true,
    postMessage
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
        if (!labsEqualForExplorer(previousLabs, state.labs)) {
          scheduleExplorerSnapshot();
        }

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

  useEffect(() => {
    standaloneAuthenticated = isAuthenticated;
    ensureTopologyEventStream();
    if (!isAuthenticated) {
      currentFilePath = null;
    }
    return () => {
      standaloneAuthenticated = false;
      closeTopologyEventStream();
    };
  }, [isAuthenticated]);

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
    closeTopologyEventStream();
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
setupStandaloneUiHost();
renderApp();
