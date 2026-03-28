import type { CustomNodeTemplate } from "@srl-labs/clab-ui-core/types/editors";

const DEV_SESSION_STORAGE_KEY = "containerlab-gui.dev.session.v1";

export interface DevSessionState {
  currentFilePath: string | null;
  mode: "edit" | "view";
  deploymentState: "deployed" | "undeployed" | "unknown";
  customNodes: CustomNodeTemplate[];
  theme: "light" | "dark";
}

interface PersistedDevSession {
  version: 1;
  state: DevSessionState;
}

export function loadDevSession(defaultState: DevSessionState): DevSessionState {
  try {
    const raw = localStorage.getItem(DEV_SESSION_STORAGE_KEY);
    if (!raw) {
      return defaultState;
    }
    const parsed = JSON.parse(raw) as PersistedDevSession;
    if (!parsed || parsed.version !== 1 || !parsed.state) {
      return defaultState;
    }

    return {
      ...defaultState,
      currentFilePath:
        typeof parsed.state.currentFilePath === "string" || parsed.state.currentFilePath === null
          ? parsed.state.currentFilePath
          : defaultState.currentFilePath,
      mode: parsed.state.mode === "view" ? "view" : "edit",
      deploymentState:
        parsed.state.deploymentState === "deployed" || parsed.state.deploymentState === "unknown"
          ? parsed.state.deploymentState
          : "undeployed",
      customNodes: Array.isArray(parsed.state.customNodes)
        ? parsed.state.customNodes
        : defaultState.customNodes,
      theme: parsed.state.theme === "light" ? "light" : "dark"
    };
  } catch {
    return defaultState;
  }
}

export function saveDevSession(state: DevSessionState): void {
  try {
    const payload: PersistedDevSession = {
      version: 1,
      state
    };
    localStorage.setItem(DEV_SESSION_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore localStorage failures in dev mode.
  }
}
