import { useTopoViewerStore } from "@srl-labs/clab-ui";
import { createTopologySyncController } from "@srl-labs/clab-ui/host";
import { refreshTopologySnapshot, setHostContext } from "@srl-labs/clab-ui/services";

import type { LabState } from "./stores/labStore";
import { getRuntimeContainersForLab, runtimeContainersEqual } from "./runtimeData";
import {
  type DeploymentState,
  type TopologyDocEventMessage,
  type TopologyFileEntry,
  firstArgAsTreeItem,
  isAbsolutePath,
  isLabRunning,
  normalizePathValue,
  resolveLabName,
  resolveLabPath,
  safeFilename,
  stripTopologySuffix,
  topologyEntryLabName
} from "./standaloneHostShared";

interface StandaloneTopologyManagerOptions {
  debounceMs: number;
  getLabs: () => Map<string, LabState>;
  onTopologyFilesChanged: () => void;
}

interface HostContextOptions {
  mode?: "edit" | "view";
  deploymentState?: DeploymentState;
}

export interface StandaloneTopologyManager {
  closeEventStream(): void;
  getCurrentFilePath(): string | null;
  handleLabStateChange(previousLabs: Map<string, LabState>, nextLabs: Map<string, LabState>): void;
  invalidateTopologyFileListCache(): void;
  listTopologyFiles(): Promise<TopologyFileEntry[]>;
  loadTopologyFile(filePath: string, options?: { deploymentState?: DeploymentState }): Promise<void>;
  resolveApiTopologyPath(args: unknown[]): Promise<string | undefined>;
  resolveDeploymentState(apiLabPath: string, labName: string | undefined): Promise<DeploymentState | undefined>;
  scheduleSnapshotRefresh(delay?: number): void;
  setAuthenticated(isAuthenticated: boolean): void;
  syncHostContext(options?: HostContextOptions): void;
}

const FILE_LIST_CACHE_TTL_MS = 1500;

export function createStandaloneTopologyManager(
  options: StandaloneTopologyManagerOptions
): StandaloneTopologyManager {
  let currentFilePath: string | null = null;
  let standaloneAuthenticated = false;
  let fileListCache: { fetchedAt: number; entries: TopologyFileEntry[] } | null = null;
  let fileListInFlight: Promise<TopologyFileEntry[]> | null = null;
  let topologyEventSource: EventSource | null = null;
  let topologyEventStreamPath: string | null = null;

  const topologySyncController = createTopologySyncController({
    debounceMs: options.debounceMs,
    async refresh(refreshOptions = {}) {
      try {
        await refreshTopologySnapshot(refreshOptions);
      } catch {
        // Ignore transient refresh errors; event stream updates will retry.
      }
    }
  });

  function invalidateTopologyFileListCache(): void {
    fileListCache = null;
  }

  function closeTopologyEventStream(): void {
    topologyEventSource?.close();
    topologyEventSource = null;
    topologyEventStreamPath = null;
  }

  function normalizeDeploymentState(value: string | undefined): DeploymentState | undefined {
    if (value === "deployed" || value === "undeployed" || value === "unknown") {
      return value;
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

  function handleTopologyDocumentEvent(event: TopologyDocEventMessage): void {
    invalidateTopologyFileListCache();
    options.onTopologyFilesChanged();

    const currentRevision = useTopoViewerStore.getState().documentRevision;
    if (event.revision && event.revision === currentRevision) {
      return;
    }
    topologySyncController.schedule(0, { externalChange: true });
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

  function syncHostContext(hostOptions: HostContextOptions = {}): void {
    const labs = options.getLabs();
    const labName = currentFilePath ? stripTopologySuffix(safeFilename(currentFilePath)) : "";
    const isDeployed = isLabRunning(labName, labs);
    const deploymentState = hostOptions.deploymentState ?? (isDeployed ? "deployed" : "undeployed");
    const mode = hostOptions.mode ?? (deploymentState === "deployed" ? "view" : "edit");
    const runtimeContainers = getRuntimeContainersForLab(labName, labs);

    setHostContext({
      path: currentFilePath ?? "",
      mode,
      deploymentState,
      runtimeContainers
    });
  }

  async function resolveDeploymentState(
    apiLabPath: string,
    labName: string | undefined
  ): Promise<DeploymentState | undefined> {
    const resolvedLabName = labName ?? stripTopologySuffix(safeFilename(apiLabPath));
    const files = await listTopologyFiles();
    const exact = findEntryByPath(files, apiLabPath);
    const byLab = resolvedLabName
      ? files.find((entry) => topologyEntryLabName(entry) === resolvedLabName)
      : undefined;
    const fileState =
      normalizeDeploymentState(exact?.deploymentState) ??
      normalizeDeploymentState(byLab?.deploymentState);
    if (resolvedLabName && isLabRunning(resolvedLabName, options.getLabs())) {
      return "deployed";
    }
    if (fileState) {
      return fileState;
    }
    return undefined;
  }

  async function loadTopologyFile(
    filePath: string,
    loadOptions: { deploymentState?: DeploymentState } = {}
  ): Promise<void> {
    currentFilePath = filePath;
    ensureTopologyEventStream();
    syncHostContext(loadOptions);
    const snapshot = await refreshTopologySnapshot();

    const activeLabName = stripTopologySuffix(safeFilename(filePath));
    const stateFromApi = await resolveDeploymentState(filePath, activeLabName);
    const stateFromRunningLabs = isLabRunning(activeLabName, options.getLabs()) ? "deployed" : undefined;
    const resolvedState =
      loadOptions.deploymentState ??
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

  function handleLabStateChange(previousLabs: Map<string, LabState>, nextLabs: Map<string, LabState>): void {
    if (!currentFilePath) {
      return;
    }

    const activeLabName = stripTopologySuffix(safeFilename(currentFilePath));
    const wasDeployed = isLabRunning(activeLabName, previousLabs);
    const isDeployed = isLabRunning(activeLabName, nextLabs);
    const previousRuntimeContainers = getRuntimeContainersForLab(activeLabName, previousLabs);
    const nextRuntimeContainers = getRuntimeContainersForLab(activeLabName, nextLabs);
    const runtimeChanged = !runtimeContainersEqual(previousRuntimeContainers, nextRuntimeContainers);

    if (wasDeployed !== isDeployed || (isDeployed && runtimeChanged)) {
      syncHostContext({ deploymentState: isDeployed ? "deployed" : "undeployed" });
      topologySyncController.schedule();
    }
  }

  return {
    closeEventStream: closeTopologyEventStream,
    getCurrentFilePath: () => currentFilePath,
    handleLabStateChange,
    invalidateTopologyFileListCache,
    listTopologyFiles,
    loadTopologyFile,
    resolveApiTopologyPath,
    resolveDeploymentState,
    scheduleSnapshotRefresh(delay = options.debounceMs) {
      topologySyncController.schedule(delay);
    },
    setAuthenticated(isAuthenticated) {
      standaloneAuthenticated = isAuthenticated;
      if (!isAuthenticated) {
        currentFilePath = null;
      }
      ensureTopologyEventStream();
    },
    syncHostContext
  };
}
