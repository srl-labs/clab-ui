import { useTopoViewerStore } from "@srl-labs/clab-ui";
import { createLifecycleCommandController } from "@srl-labs/clab-ui/host";
import {
  MSG_CANCEL_LAB_LIFECYCLE,
  type LifecycleCommand as ExtensionLifecycleCommand
} from "@srl-labs/clab-ui/core/messages/extension";
import {
  MSG_LAB_LIFECYCLE_LOG,
  MSG_LAB_LIFECYCLE_STATUS
} from "@srl-labs/clab-ui/core/messages/webview";

import type { DeploymentState, LifecycleCommandEndpoint, LifecycleCommandStream, LifecycleCommandType } from "./standaloneHostShared";
import { normalizeLabIdentity, safeFilename, stripTopologySuffix } from "./standaloneHostShared";

const LIFECYCLE_STATE_WAIT_TIMEOUT_MS = 120_000;
const LIFECYCLE_STATE_WAIT_POLL_MS = 750;
const LIFECYCLE_RESPONSE_LOG_LIMIT = 500;
const LIFECYCLE_TIMESTAMP_LEVEL_PATTERN =
  /^(?:\d{2}:\d{2}:\d{2}|\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (INFO|WARN|ERRO|ERROR|FATAL|PANIC)\b/;

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

interface ActiveLifecycleRequest {
  commandType: LifecycleCommandType;
  labName: string;
  signal: AbortSignal;
  isCurrent(): boolean;
  isCancelled(): boolean;
}

interface StandaloneLifecycleManagerOptions {
  getCurrentFilePath: () => string | null;
  invalidateTopologyFileListCache: () => void;
  removeLabFromRuntimeStore: (labName: string) => void;
  scheduleExplorerSnapshot: (delay?: number) => void;
  scheduleTopologySnapshotRefresh: (delay?: number) => void;
  syncHostContext: (options?: {
    mode?: "edit" | "view";
    deploymentState?: DeploymentState;
  }) => void;
}

export interface StandaloneLifecycleManager {
  cancel(): boolean;
  invokeLifecycleApi(
    endpoint: LifecycleCommandEndpoint,
    labName: string,
    cleanup: boolean,
    options?: { path?: string; signal?: AbortSignal }
  ): Promise<LifecycleApiCallResult>;
  run(command: ExtensionLifecycleCommand): Promise<void>;
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

export function isStandaloneLifecycleCommand(command: string): command is ExtensionLifecycleCommand {
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

function getActiveLabName(currentFilePath: string | null): string | undefined {
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

function getActiveTopologyRelativePath(currentFilePath: string | null): string | undefined {
  if (!currentFilePath) {
    return undefined;
  }

  const filename = safeFilename(currentFilePath);
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
    if (!request.isCurrent() || request.isCancelled()) {
      return false;
    }

    let running: boolean;
    try {
      running = await queryLabRunningState(request.labName);
    } catch (error) {
      if (!request.isCurrent() || request.isCancelled()) {
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

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  return error instanceof Error && error.name === "AbortError";
}

function getLifecycleTypeFromProcessingMode(): LifecycleCommandType {
  return useTopoViewerStore.getState().processingMode === "destroy" ? "destroy" : "deploy";
}

export function createStandaloneLifecycleManager(
  options: StandaloneLifecycleManagerOptions
): StandaloneLifecycleManager {
  const lifecycleController = createLifecycleCommandController<ExtensionLifecycleCommand>({
    isAbortError,
    onCancel(action) {
      const config = LIFECYCLE_COMMAND_CONFIG[action];
      postLifecycleLogMessage(config.commandType, "Lifecycle command cancelled by user.", "stderr");
      postLifecycleStatusMessage(
        config.commandType,
        "error",
        "Lifecycle command cancelled by user."
      );
    }
  });

  async function invokeLifecycleApi(
    endpoint: LifecycleCommandEndpoint,
    labName: string,
    cleanup: boolean,
    invokeOptions: { path?: string; signal?: AbortSignal } = {}
  ): Promise<LifecycleApiCallResult> {
    const payload: { labName: string; cleanup?: boolean; path?: string } = { labName };
    if (cleanup) {
      payload.cleanup = true;
    }
    if (invokeOptions.path) {
      payload.path = invokeOptions.path;
    }

    const response = await fetch(`/api/lab/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
      signal: invokeOptions.signal
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
    invokeOptions: {
      path?: string;
      signal?: AbortSignal;
      onLog: (line: string, stream: LifecycleCommandStream) => void;
    }
  ): Promise<{ message?: string }> {
    const payload: { labName: string; cleanup?: boolean; path?: string } = { labName };
    if (cleanup) {
      payload.cleanup = true;
    }
    if (invokeOptions.path) {
      payload.path = invokeOptions.path;
    }

    const response = await fetch(`/api/lab/${endpoint}/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
      signal: invokeOptions.signal
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
        invokeOptions.onLog(event.line, stream);
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

  function syncActiveTopologyAfterLifecycle(commandType: LifecycleCommandType, labName: string): void {
    const currentFilePath = options.getCurrentFilePath();
    if (!currentFilePath) {
      return;
    }
    const activeLabName = stripTopologySuffix(safeFilename(currentFilePath));
    if (normalizeLabIdentity(activeLabName) !== normalizeLabIdentity(labName)) {
      return;
    }

    options.syncHostContext({
      deploymentState: commandType === "destroy" ? "undeployed" : "deployed"
    });
    options.scheduleTopologySnapshotRefresh(0);
  }

  async function executeStandaloneLifecycleCommand(
    command: ExtensionLifecycleCommand,
    execution: {
      signal: AbortSignal;
      isCurrent(): boolean;
      isCancelled(): boolean;
    }
  ): Promise<void> {
    const config = LIFECYCLE_COMMAND_CONFIG[command];
    const currentFilePath = options.getCurrentFilePath();
    const labName = getActiveLabName(currentFilePath);
    if (!labName) {
      postLifecycleStatusMessage(
        getLifecycleTypeFromProcessingMode(),
        "error",
        "No active lab selected for lifecycle command."
      );
      return;
    }

    const request: ActiveLifecycleRequest = {
      commandType: config.commandType,
      labName,
      signal: execution.signal,
      isCurrent: execution.isCurrent,
      isCancelled: execution.isCancelled
    };

    postLifecycleLogMessage(config.commandType, `Starting ${config.label} for "${labName}"...`, "stdout");
    if (config.endpoint === "deploy" && config.cleanup) {
      postLifecycleLogMessage(
        config.commandType,
        "Cleanup is not supported by deploy API; running a standard deploy.",
        "stdout"
      );
    }

    try {
      const deployPath =
        config.endpoint === "deploy" ? getActiveTopologyRelativePath(currentFilePath) : undefined;
      postLifecycleLogMessage(config.commandType, `Sending ${config.label} request to API...`, "stdout");
      const lifecycleResponse = await invokeLifecycleApiStream(config.endpoint, labName, config.cleanup, {
        path: deployPath,
        signal: request.signal,
        onLog: (line, stream) => {
          postLifecycleLogMessage(config.commandType, line, stream);
        }
      });
      if (!request.isCurrent() || request.isCancelled()) {
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
      if (!request.isCurrent() || request.isCancelled()) {
        return;
      }
      if (!reachedExpectedState) {
        if (config.commandType === "destroy") {
          options.removeLabFromRuntimeStore(labName);
          options.invalidateTopologyFileListCache();
          options.scheduleExplorerSnapshot(0);
        }
        postLifecycleStatusMessage(
          config.commandType,
          "error",
          `Timed out waiting for lab "${labName}" to become ${expectedRunning ? "deployed" : "undeployed"}.`
        );
        return;
      }

      if (config.commandType === "destroy") {
        options.removeLabFromRuntimeStore(labName);
      }

      options.invalidateTopologyFileListCache();
      options.scheduleExplorerSnapshot(0);
      syncActiveTopologyAfterLifecycle(config.commandType, labName);
      postLifecycleLogMessage(config.commandType, `${config.label} completed.`, "stdout");
      postLifecycleStatusMessage(config.commandType, "success");
    } catch (error) {
      if (!request.isCurrent() || request.isCancelled() || isAbortError(error)) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      postLifecycleStatusMessage(config.commandType, "error", message);
    }
  }

  return {
    cancel() {
      if (!lifecycleController.cancel("Lifecycle command cancelled by user.")) {
        postLifecycleStatusMessage(
          getLifecycleTypeFromProcessingMode(),
          "error",
          "No active lifecycle command to cancel."
        );
        return false;
      }
      return true;
    },
    invokeLifecycleApi,
    async run(command) {
      await lifecycleController.run(command, (execution) =>
        executeStandaloneLifecycleCommand(command, execution)
      );
    }
  };
}

export { MSG_CANCEL_LAB_LIFECYCLE };
