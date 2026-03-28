import { createEmptyAnnotations } from "@srl-labs/clab-ui-core/annotations/types";
import { TopologyHostCore } from "@srl-labs/clab-ui-core/host/TopologyHostCore";
import type { FileSystemAdapter, IOLogger } from "@srl-labs/clab-ui-core/io/types";
import {
  TOPOLOGY_HOST_PROTOCOL_VERSION,
  type TopologyHostSnapshotMessage
} from "@srl-labs/clab-ui-core/types/messages";
import type { DeploymentState } from "@srl-labs/clab-ui-core/types/topology";
import type {
  TopologyCommand,
  TopologyHostEvent,
  TopologyHostResponse,
  TopologyHostTransport,
  TopologySnapshotState,
  Unsubscribe
} from "@srl-labs/clab-host-contract";

const DEFAULT_YAML_FILE_PATH = "topology.clab.yml";
const DEFAULT_YAML_CONTENT = `name: in-memory-lab\n\ntopology:\n  nodes: {}\n  links: []\n`;

function toPosixPath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/");
}

function normalizePath(pathValue: string): string {
  return toPosixPath(pathValue).replace(/\/+/g, "/").replace(/^\.\//, "");
}

function dirname(pathValue: string): string {
  const normalized = normalizePath(pathValue);
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash <= 0) {
    return ".";
  }
  return normalized.slice(0, lastSlash);
}

function basename(pathValue: string): string {
  const normalized = normalizePath(pathValue);
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash < 0) {
    return normalized;
  }
  return normalized.slice(lastSlash + 1);
}

function join(...segments: string[]): string {
  return normalizePath(segments.filter((segment) => segment.length > 0).join("/"));
}

function createDefaultAnnotationsJson(): string {
  return JSON.stringify(createEmptyAnnotations(), null, 2);
}

class InMemoryFileSystemAdapter implements FileSystemAdapter {
  private readonly files = new Map<string, string>();

  constructor(initialFiles: Iterable<[string, string]>) {
    for (const [filePath, content] of initialFiles) {
      this.files.set(normalizePath(filePath), content);
    }
  }

  async readFile(filePath: string): Promise<string> {
    const normalized = normalizePath(filePath);
    const content = this.files.get(normalized);
    if (content === undefined) {
      throw new Error(`ENOENT: no such file ${filePath}`);
    }
    return content;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    this.files.set(normalizePath(filePath), content);
  }

  async unlink(filePath: string): Promise<void> {
    this.files.delete(normalizePath(filePath));
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const normalizedOld = normalizePath(oldPath);
    const content = this.files.get(normalizedOld);
    if (content === undefined) {
      throw new Error(`ENOENT: no such file ${oldPath}`);
    }
    this.files.delete(normalizedOld);
    this.files.set(normalizePath(newPath), content);
  }

  async exists(filePath: string): Promise<boolean> {
    return this.files.has(normalizePath(filePath));
  }

  dirname(filePath: string): string {
    return dirname(filePath);
  }

  basename(filePath: string): string {
    return basename(filePath);
  }

  join(...segments: string[]): string {
    return join(...segments);
  }

  public dumpFiles(): Record<string, string> {
    const output: Record<string, string> = {};
    for (const [filePath, content] of this.files.entries()) {
      output[filePath] = content;
    }
    return output;
  }
}

export interface MemoryTopologyHostTransportOptions {
  fs?: FileSystemAdapter;
  yamlFilePath?: string;
  initialYamlContent?: string;
  initialAnnotationsContent?: string | null;
  mode?: "edit" | "view";
  deploymentState?: DeploymentState;
  logger?: IOLogger;
  maxHistory?: number;
}

/**
 * Host-contract adapter backed by TopologyHostCore + in-memory file system.
 *
 * This is used by the standalone dev app and test harnesses.
 */
export class MemoryTopologyHostTransport implements TopologyHostTransport {
  private readonly internalFs?: InMemoryFileSystemAdapter;
  private readonly host: TopologyHostCore;
  private readonly subscribers = new Set<(event: TopologyHostEvent) => void>();
  private disposed = false;

  constructor(options: MemoryTopologyHostTransportOptions = {}) {
    const yamlFilePath = normalizePath(options.yamlFilePath ?? DEFAULT_YAML_FILE_PATH);
    let fs: FileSystemAdapter;

    if (options.fs) {
      fs = options.fs;
    } else {
      const annotationsFilePath = `${yamlFilePath}.annotations.json`;
      const initialFiles: Array<[string, string]> = [
        [yamlFilePath, options.initialYamlContent ?? DEFAULT_YAML_CONTENT]
      ];

      if (typeof options.initialAnnotationsContent === "string") {
        initialFiles.push([annotationsFilePath, options.initialAnnotationsContent]);
      } else if (options.initialAnnotationsContent === undefined) {
        initialFiles.push([annotationsFilePath, createDefaultAnnotationsJson()]);
      }

      const internalFs = new InMemoryFileSystemAdapter(initialFiles);
      this.internalFs = internalFs;
      fs = internalFs;
    }

    this.host = new TopologyHostCore({
      fs,
      yamlFilePath,
      mode: options.mode ?? "edit",
      deploymentState: options.deploymentState ?? "undeployed",
      logger: options.logger,
      maxHistory: options.maxHistory
    });
  }

  async requestSnapshot(): Promise<TopologySnapshotState> {
    this.assertNotDisposed();

    const snapshot = await this.host.getSnapshot();
    this.publish({
      type: "topology-host:snapshot",
      protocolVersion: TOPOLOGY_HOST_PROTOCOL_VERSION,
      snapshot,
      reason: "resync"
    });

    return snapshot;
  }

  async onExternalChange(): Promise<TopologySnapshotState> {
    this.assertNotDisposed();

    const snapshot = await this.host.onExternalChange();
    this.publish({
      type: "topology-host:snapshot",
      protocolVersion: TOPOLOGY_HOST_PROTOCOL_VERSION,
      snapshot,
      reason: "external-change"
    });

    return snapshot;
  }

  async dispatch(command: TopologyCommand, revision: number): Promise<TopologyHostResponse> {
    this.assertNotDisposed();

    const response = await this.host.applyCommand(command, revision);
    this.publish(response);

    return response;
  }

  subscribe(handler: (event: TopologyHostEvent) => void): Unsubscribe {
    this.subscribers.add(handler);
    return () => {
      this.subscribers.delete(handler);
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.subscribers.clear();
    this.host.dispose();
  }

  public updateContext(context: {
    mode?: "edit" | "view";
    deploymentState?: DeploymentState;
  }): void {
    this.assertNotDisposed();
    this.host.updateContext(context);
  }

  public dumpFiles(): Record<string, string> {
    return this.internalFs?.dumpFiles() ?? {};
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("Transport is disposed");
    }
  }

  private publish(event: TopologyHostEvent): void {
    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
  }
}

export function createSnapshotEvent(snapshot: TopologySnapshotState): TopologyHostSnapshotMessage {
  return {
    type: "topology-host:snapshot",
    protocolVersion: TOPOLOGY_HOST_PROTOCOL_VERSION,
    snapshot,
    reason: "resync"
  };
}
