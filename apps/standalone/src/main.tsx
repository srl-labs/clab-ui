/**
 * Standalone app entry point.
 *
 * Modeled on dev/main.tsx but connects to the real clab-api-server
 * through the Fastify backend instead of using mock data.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { App, useTopoViewerStore } from "@srl-labs/clab-ui";
import "@srl-labs/clab-ui/styles/global.css";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";

import {
  createApiClabUiHost,
  setClabUiHost
} from "@srl-labs/clab-ui/host";
import { applyThemeVars, MuiThemeProvider } from "@srl-labs/clab-ui/theme";
import { parseSchemaData } from "@srl-labs/clab-ui/core/schema";
import {
  EXPORT_COMMANDS,
  MSG_CANCEL_LAB_LIFECYCLE
} from "@srl-labs/clab-ui/core/messages/extension";
import {
  MSG_SVG_EXPORT_RESULT
} from "@srl-labs/clab-ui/core/messages/webview";
import type {
  ExplorerIncomingMessage,
  ExplorerUiState
} from "@srl-labs/clab-ui/explorer/snapshot";

import clabSchema from "../../../schema/clab.schema.json";
import { useLabStore, type LabState } from "./stores/labStore";
import { useAuth } from "./hooks/useAuth";
import { useEventStream } from "./hooks/useEventStream";
import { LoginPage } from "./components/LoginPage";
import { SettingsOverlay } from "./components/SettingsOverlay";
import { createStandaloneExplorerBridge } from "./standaloneExplorer";
import {
  createStandaloneLifecycleManager,
  isStandaloneLifecycleCommand
} from "./standaloneLifecycle";
import {
  labsEqualForExplorer,
  normalizeLabIdentity
} from "./standaloneHostShared";
import { createStandaloneTopologyManager } from "./standaloneTopology";

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

const EXPLORER_REFRESH_DEBOUNCE_MS = 90;
const TOPOLOGY_REFRESH_DEBOUNCE_MS = 120;
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

let scheduleExplorerSnapshot = (_delay?: number) => {};

const topologyManager = createStandaloneTopologyManager({
  debounceMs: TOPOLOGY_REFRESH_DEBOUNCE_MS,
  getLabs: () => useLabStore.getState().labs,
  onTopologyFilesChanged: () => {
    scheduleExplorerSnapshot(0);
  }
});

const lifecycleManager = createStandaloneLifecycleManager({
  getCurrentFilePath: topologyManager.getCurrentFilePath,
  invalidateTopologyFileListCache: topologyManager.invalidateTopologyFileListCache,
  removeLabFromRuntimeStore,
  scheduleExplorerSnapshot: (delay) => scheduleExplorerSnapshot(delay),
  scheduleTopologySnapshotRefresh: (delay) => topologyManager.scheduleSnapshotRefresh(delay),
  syncHostContext: topologyManager.syncHostContext
});

const explorerBridge = createStandaloneExplorerBridge({
  debounceMs: EXPLORER_REFRESH_DEBOUNCE_MS,
  getLabs: () => useLabStore.getState().labs,
  invalidateTopologyFileListCache: topologyManager.invalidateTopologyFileListCache,
  invokeLifecycleApi: lifecycleManager.invokeLifecycleApi,
  listTopologyFiles: topologyManager.listTopologyFiles,
  loadTopologyFile: topologyManager.loadTopologyFile,
  resolveApiTopologyPath: topologyManager.resolveApiTopologyPath,
  resolveDeploymentState: topologyManager.resolveDeploymentState
});

scheduleExplorerSnapshot = explorerBridge.scheduleSnapshot;

// Standalone host bridge - explicit UI host with API-backed topology transport.
function setupStandaloneUiHost(): void {
  type VscodeMessage = {
    command?: string;
    type?: string;
    level?: string;
    message?: string;
    fileLine?: string;
    requestId?: string;
    baseName?: string;
    svgContent?: string;
  };

  const warnedCommands = new Set<string>();

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
      lifecycleManager.cancel();
      return;
    }

    if (isStandaloneLifecycleCommand(msg.command)) {
      const lifecycleCommand = msg.command;
      void lifecycleManager.run(lifecycleCommand).catch((error: unknown) => {
        console.error(`[Standalone] lifecycle command failed:`, error);
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
      explorer: explorerBridge.explorer,
      postMessage,
      targetWindow: window,
      meta: {
        isDevMock: true,
        disableDevMockTraffic: true
      }
    })
  );
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
          scheduleExplorerSnapshot(EXPLORER_REFRESH_DEBOUNCE_MS);
        }
        topologyManager.handleLabStateChange(previousLabs, state.labs);
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
    topologyManager.setAuthenticated(isAuthenticated);
    return () => {
      topologyManager.closeEventStream();
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
    applyThemeVars(currentTheme);
    persistTheme(currentTheme);
  }, []);

  const handleLogout = useCallback(() => {
    topologyManager.closeEventStream();
    void logout();
  }, [logout]);

  if (loading) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", color: "var(--clab-ui-editor-foreground, var(--vscode-editor-foreground, #d4d4d4))"
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
applyThemeVars(currentTheme);
setupStandaloneUiHost();
renderApp();
