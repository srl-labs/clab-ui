import {
  buildExplorerSnapshot,
  EXPLORER_SECTION_LABELS,
  EXPLORER_SECTION_ORDER,
  type ExplorerActionInvocation,
  type ExplorerIncomingMessage,
  type ExplorerOutgoingMessage,
  type ExplorerSnapshotMessage,
  type ExplorerSnapshotOptions,
  type ExplorerSnapshotProviders,
  type ExplorerUiState
} from "../explorer/snapshot";

export interface LifecycleCommandExecution<Action extends string> {
  id: number;
  action: Action;
  signal: AbortSignal;
  isCurrent(): boolean;
  isCancelled(): boolean;
}

export interface LifecycleCommandController<Action extends string> {
  run<Result>(
    action: Action,
    execute: (execution: LifecycleCommandExecution<Action>) => Promise<Result>
  ): Promise<Result | undefined>;
  cancel(reason?: string): boolean;
  getActiveAction(): Action | null;
}

interface LifecycleCommandControllerOptions<Action extends string> {
  isAbortError?: (error: unknown) => boolean;
  onCancel?: (action: Action, reason?: string) => void;
}

interface ActiveLifecycleCommand<Action extends string> {
  id: number;
  action: Action;
  abortController: AbortController;
  cancelled: boolean;
}

export function createLifecycleCommandController<Action extends string>(
  options: LifecycleCommandControllerOptions<Action> = {}
): LifecycleCommandController<Action> {
  let activeCommand: ActiveLifecycleCommand<Action> | null = null;
  let nextCommandId = 0;

  const clearIfCurrent = (commandId: number): void => {
    if (activeCommand?.id === commandId) {
      activeCommand = null;
    }
  };

  return {
    async run<Result>(
      action: Action,
      execute: (execution: LifecycleCommandExecution<Action>) => Promise<Result>
    ): Promise<Result | undefined> {
      if (activeCommand) {
        activeCommand.cancelled = true;
        activeCommand.abortController.abort();
        clearIfCurrent(activeCommand.id);
      }

      const currentCommand: ActiveLifecycleCommand<Action> = {
        id: ++nextCommandId,
        action,
        abortController: new AbortController(),
        cancelled: false
      };
      activeCommand = currentCommand;

      const execution: LifecycleCommandExecution<Action> = {
        id: currentCommand.id,
        action,
        signal: currentCommand.abortController.signal,
        isCurrent: () => activeCommand?.id === currentCommand.id,
        isCancelled: () => currentCommand.cancelled
      };

      try {
        return await execute(execution);
      } catch (error) {
        if (
          currentCommand.cancelled ||
          activeCommand?.id !== currentCommand.id ||
          options.isAbortError?.(error) === true
        ) {
          return undefined;
        }
        throw error;
      } finally {
        clearIfCurrent(currentCommand.id);
      }
    },

    cancel(reason?: string): boolean {
      if (!activeCommand) {
        return false;
      }

      const currentAction = activeCommand.action;
      activeCommand.cancelled = true;
      activeCommand.abortController.abort();
      clearIfCurrent(activeCommand.id);
      options.onCancel?.(currentAction, reason);
      return true;
    },

    getActiveAction(): Action | null {
      return activeCommand?.action ?? null;
    }
  };
}

export interface ExplorerController {
  connect(): void;
  setFilter(filterText: string): Promise<void>;
  clearFilter(): Promise<void>;
  isFilterActive(): boolean;
  persistUiState(state: ExplorerUiState): Promise<void>;
  invokeAction(actionRef: string): Promise<void>;
  handleMessage(message: ExplorerOutgoingMessage): Promise<void>;
  scheduleSnapshot(delay?: number): void;
  dispose(): void;
  getFilterText(): string;
  getUiState(): ExplorerUiState;
}

export interface TopologySyncController {
  schedule(delay?: number, options?: TopologySyncRefreshOptions): void;
  refresh(options?: TopologySyncRefreshOptions): Promise<void>;
  dispose(): void;
}

export interface TopologySyncRefreshOptions {
  externalChange?: boolean;
  externalChangeKind?: "topology" | "annotations";
}

interface TopologySyncControllerOptions {
  refresh: (options?: TopologySyncRefreshOptions) => Promise<void>;
  debounceMs?: number;
}

interface ExplorerControllerOptions {
  buildProviders: (filterText: string) => Promise<ExplorerSnapshotProviders>;
  executeAction: (binding: ExplorerActionInvocation) => Promise<void>;
  publish: (message: ExplorerIncomingMessage) => void | Promise<void>;
  getSnapshotOptions?: () => ExplorerSnapshotOptions | Promise<ExplorerSnapshotOptions>;
  onFilterTextChanged?: (filterText: string) => void | Promise<void>;
  onUiStateChanged?: (state: ExplorerUiState) => void | Promise<void>;
  initialFilterText?: string;
  initialUiState?: ExplorerUiState;
  debounceMs?: number;
  refreshOnUiStateChanged?: boolean | ((previous: ExplorerUiState, next: ExplorerUiState) => boolean);
}

function buildFallbackExplorerSnapshot(filterText: string): ExplorerSnapshotMessage {
  return {
    command: "snapshot",
    filterText,
    sections: EXPLORER_SECTION_ORDER.map((sectionId) => ({
      id: sectionId,
      label: EXPLORER_SECTION_LABELS[sectionId],
      count: 0,
      nodes: [],
      toolbarActions: []
    }))
  };
}

export function createExplorerController(options: ExplorerControllerOptions): ExplorerController {
  let connected = false;
  let filterText = (options.initialFilterText ?? "").trim();
  let uiState = options.initialUiState ?? {};
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let snapshotInFlight = false;
  let snapshotPending = false;
  let actionBindings = new Map<string, ExplorerActionInvocation>();

  const publish = async (message: ExplorerIncomingMessage): Promise<void> => {
    if (!connected) {
      return;
    }
    await options.publish(message);
  };

  const publishError = async (message: string): Promise<void> => {
    await publish({ command: "error", message });
  };

  const postSnapshot = async (): Promise<void> => {
    if (!connected) {
      return;
    }

    if (snapshotInFlight) {
      snapshotPending = true;
      return;
    }

    snapshotInFlight = true;
    try {
      const providers = await options.buildProviders(filterText);
      const snapshotOptions = (await options.getSnapshotOptions?.()) ?? {
        hideNonOwnedLabs: false,
        isLocalCaptureAllowed: false
      };
      const { snapshot, actionBindings: nextBindings } = await buildExplorerSnapshot(
        providers,
        filterText,
        snapshotOptions
      );
      actionBindings = nextBindings;
      await publish(snapshot);
    } catch (error: unknown) {
      actionBindings = new Map();
      const message = error instanceof Error ? error.message : String(error);
      await publishError(`Explorer refresh failed: ${message}`);
      await publish(buildFallbackExplorerSnapshot(filterText));
    } finally {
      snapshotInFlight = false;
      if (snapshotPending) {
        snapshotPending = false;
        scheduleSnapshot(0);
      }
    }
  };

  const scheduleSnapshot = (delay: number = options.debounceMs ?? 120): void => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      void postSnapshot();
    }, delay);
  };

  return {
    connect(): void {
      connected = true;
      void publish({ command: "filterState", filterText });
      void publish({ command: "uiState", state: uiState });
      scheduleSnapshot(0);
    },

    async setFilter(nextFilterText: string): Promise<void> {
      filterText = nextFilterText.trim();
      await options.onFilterTextChanged?.(filterText);
      await publish({ command: "filterState", filterText });
      scheduleSnapshot(0);
    },

    async clearFilter(): Promise<void> {
      await this.setFilter("");
    },

    isFilterActive(): boolean {
      return filterText.length > 0;
    },

    async persistUiState(state: ExplorerUiState): Promise<void> {
      const previousUiState = uiState;
      uiState = state ?? {};
      await options.onUiStateChanged?.(uiState);
      const refreshOnUiStateChanged = options.refreshOnUiStateChanged;
      const shouldRefresh =
        typeof refreshOnUiStateChanged === "function"
          ? refreshOnUiStateChanged(previousUiState, uiState)
          : refreshOnUiStateChanged === true;
      if (shouldRefresh) {
        scheduleSnapshot(0);
      }
    },

    async invokeAction(actionRef: string): Promise<void> {
      const binding = actionBindings.get(actionRef);
      if (!binding) {
        await publishError("Action is no longer available. Refresh and try again.");
        return;
      }
      if (binding.disabled === true) {
        await publishError("Action is disabled for the current node state.");
        return;
      }

      try {
        await options.executeAction(binding);
        scheduleSnapshot(0);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        await publishError(`Failed to execute action: ${message}`);
      }
    },

    async handleMessage(message: ExplorerOutgoingMessage): Promise<void> {
      switch (message.command) {
        case "ready":
          this.connect();
          break;
        case "setFilter":
          await this.setFilter(message.value);
          break;
        case "invokeAction":
          await this.invokeAction(message.actionRef);
          break;
        case "persistUiState":
          await this.persistUiState(message.state);
          break;
      }
    },

    scheduleSnapshot(delay?: number): void {
      scheduleSnapshot(delay);
    },

    dispose(): void {
      connected = false;
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = undefined;
      }
    },

    getFilterText(): string {
      return filterText;
    },

    getUiState(): ExplorerUiState {
      return uiState;
    }
  };
}

export function createTopologySyncController(
  options: TopologySyncControllerOptions
): TopologySyncController {
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshInFlight = false;
  let refreshQueued = false;
  let pendingExternalChange = false;
  let pendingExternalChangeKind: TopologySyncRefreshOptions["externalChangeKind"] | undefined;

  const flushRefresh = async (): Promise<void> => {
    if (refreshInFlight) {
      refreshQueued = true;
      return;
    }

    refreshInFlight = true;
    const externalChange = pendingExternalChange;
    const externalChangeKind = pendingExternalChangeKind;
    pendingExternalChange = false;
    pendingExternalChangeKind = undefined;
    try {
      await options.refresh({ externalChange, externalChangeKind });
    } finally {
      refreshInFlight = false;
      if (refreshQueued) {
        refreshQueued = false;
        await flushRefresh();
      }
    }
  };

  const schedule = (delay: number = options.debounceMs ?? 120): void => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      void flushRefresh();
    }, delay);
  };

  return {
    schedule(delay = options.debounceMs ?? 120, refreshOptions = {}): void {
      pendingExternalChange = pendingExternalChange || refreshOptions.externalChange === true;
      pendingExternalChangeKind = mergeExternalChangeKind(
        pendingExternalChangeKind,
        refreshOptions.externalChangeKind
      );
      schedule(delay);
    },

    async refresh(refreshOptions = {}): Promise<void> {
      pendingExternalChange = pendingExternalChange || refreshOptions.externalChange === true;
      pendingExternalChangeKind = mergeExternalChangeKind(
        pendingExternalChangeKind,
        refreshOptions.externalChangeKind
      );
      await flushRefresh();
    },

    dispose(): void {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = undefined;
      }
      refreshQueued = false;
      pendingExternalChange = false;
      pendingExternalChangeKind = undefined;
    }
  };
}

function mergeExternalChangeKind(
  current: TopologySyncRefreshOptions["externalChangeKind"] | undefined,
  next: TopologySyncRefreshOptions["externalChangeKind"] | undefined
): TopologySyncRefreshOptions["externalChangeKind"] | undefined {
  if (current === "topology" || next === "topology") return "topology";
  return current ?? next;
}
