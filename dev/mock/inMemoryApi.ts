import { TopologyHostCore } from "@shared/host/TopologyHostCore";
import type { FileSystemAdapter } from "@shared/io/types";
import type {
  TopologyHostCommand,
  TopologyHostResponseMessage,
  TopologySnapshot
} from "@shared/types/messages";
import type { DeploymentState } from "@shared/types/topology";

import datacenterYaml from "../topologies-original/datacenter.clab.yml?raw";
import datacenterAnnotations from "../topologies-original/datacenter.clab.yml.annotations.json?raw";
import emptyYaml from "../topologies-original/empty.clab.yml?raw";
import inheritanceYaml from "../topologies-original/inheritance.clab.yml?raw";
import inheritanceAnnotations from "../topologies-original/inheritance.clab.yml.annotations.json?raw";
import large100Yaml from "../topologies-original/large-100.clab.yml?raw";
import large100Annotations from "../topologies-original/large-100.clab.yml.annotations.json?raw";
import large1000Yaml from "../topologies-original/large-1000.clab.yml?raw";
import large1000Annotations from "../topologies-original/large-1000.clab.yml.annotations.json?raw";
import networkYaml from "../topologies-original/network.clab.yml?raw";
import networkAnnotations from "../topologies-original/network.clab.yml.annotations.json?raw";
import simpleYaml from "../topologies-original/simple.clab.yml?raw";
import simpleAnnotations from "../topologies-original/simple.clab.yml.annotations.json?raw";
import spineLeafYaml from "../topologies-original/spine-leaf.clab.yml?raw";
import spineLeafAnnotations from "../topologies-original/spine-leaf.clab.yml.annotations.json?raw";
import srsimYaml from "../topologies-original/srsim-simple.clab.yml?raw";
import srsimAnnotations from "../topologies-original/srsim-simple.clab.yml.annotations.json?raw";

const LAB_STORAGE_KEY = "containerlab-gui.dev.in-memory-labs.v1";
const ANNOTATIONS_SUFFIX = ".annotations.json";

interface InMemoryLabEntry {
  yaml: string;
  annotations: string | null;
}

interface PersistedLabs {
  version: 1;
  files: Record<string, InMemoryLabEntry>;
}

interface SnapshotRequest {
  path: string;
  mode?: "edit" | "view";
  deploymentState?: DeploymentState;
  externalChange?: boolean;
}

interface CommandRequest {
  path: string;
  mode?: "edit" | "view";
  deploymentState?: DeploymentState;
  baseRevision: number;
  command: TopologyHostCommand;
}

interface InMemoryApiHandlers {
  onFileMutated?: () => void;
}

const seedLabs: Record<string, InMemoryLabEntry> = {
  "datacenter.clab.yml": {
    yaml: datacenterYaml,
    annotations: datacenterAnnotations
  },
  "empty.clab.yml": {
    yaml: emptyYaml,
    annotations: null
  },
  "inheritance.clab.yml": {
    yaml: inheritanceYaml,
    annotations: inheritanceAnnotations
  },
  "large-100.clab.yml": {
    yaml: large100Yaml,
    annotations: large100Annotations
  },
  "large-1000.clab.yml": {
    yaml: large1000Yaml,
    annotations: large1000Annotations
  },
  "network.clab.yml": {
    yaml: networkYaml,
    annotations: networkAnnotations
  },
  "simple.clab.yml": {
    yaml: simpleYaml,
    annotations: simpleAnnotations
  },
  "spine-leaf.clab.yml": {
    yaml: spineLeafYaml,
    annotations: spineLeafAnnotations
  },
  "srsim-simple.clab.yml": {
    yaml: srsimYaml,
    annotations: srsimAnnotations
  }
};

function toPosixPath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/");
}

function normalizeTopologyPath(pathValue: string): string {
  const trimmed = pathValue.trim();
  if (!trimmed) {
    return trimmed;
  }

  let normalized = toPosixPath(trimmed).replace(/^\.\//, "").replace(/^\/+/, "");

  const markerTopologies = "/topologies/";
  const markerOriginal = "/topologies-original/";
  const markerTopologiesIndex = normalized.lastIndexOf(markerTopologies);
  if (markerTopologiesIndex >= 0) {
    normalized = normalized.slice(markerTopologiesIndex + markerTopologies.length);
  }
  const markerOriginalIndex = normalized.lastIndexOf(markerOriginal);
  if (markerOriginalIndex >= 0) {
    normalized = normalized.slice(markerOriginalIndex + markerOriginal.length);
  }

  for (const prefix of ["topologies/", "topologies-original/", "dev/topologies/", "dev/topologies-original/"]) {
    if (normalized.startsWith(prefix)) {
      normalized = normalized.slice(prefix.length);
    }
  }

  return normalized;
}

function isAnnotationsPath(pathValue: string): boolean {
  return normalizeTopologyPath(pathValue).endsWith(ANNOTATIONS_SUFFIX);
}

function yamlPathFromAny(pathValue: string): string {
  const normalized = normalizeTopologyPath(pathValue);
  if (normalized.endsWith(ANNOTATIONS_SUFFIX)) {
    return normalized.slice(0, -ANNOTATIONS_SUFFIX.length);
  }
  return normalized;
}

function basename(pathValue: string): string {
  const normalized = toPosixPath(pathValue);
  const segments = normalized.split("/").filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : normalized;
}

function dirname(pathValue: string): string {
  const normalized = toPosixPath(pathValue);
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash <= 0) {
    return ".";
  }
  return normalized.slice(0, lastSlash);
}

function join(...segments: string[]): string {
  return segments
    .filter((segment) => segment.length > 0)
    .join("/")
    .replace(/\/{2,}/g, "/");
}

function cloneSeedLabs(): Map<string, InMemoryLabEntry> {
  return new Map(
    Object.entries(seedLabs).map(([path, entry]) => [
      path,
      {
        yaml: entry.yaml,
        annotations: entry.annotations
      }
    ])
  );
}

class InMemoryLabStore {
  private labs: Map<string, InMemoryLabEntry>;

  constructor() {
    this.labs = cloneSeedLabs();
    this.hydrate();
  }

  private hydrate(): void {
    try {
      const raw = localStorage.getItem(LAB_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedLabs;
      if (!parsed || parsed.version !== 1 || typeof parsed.files !== "object") return;
      const next = new Map<string, InMemoryLabEntry>();
      for (const [key, value] of Object.entries(parsed.files)) {
        if (!value || typeof value.yaml !== "string") continue;
        next.set(key, {
          yaml: value.yaml,
          annotations: typeof value.annotations === "string" ? value.annotations : null
        });
      }
      if (next.size > 0) {
        this.labs = next;
      }
    } catch {
      // Ignore malformed localStorage data and fall back to seed labs.
    }
  }

  private persist(): void {
    try {
      const files: Record<string, InMemoryLabEntry> = {};
      for (const [key, value] of this.labs.entries()) {
        files[key] = {
          yaml: value.yaml,
          annotations: value.annotations
        };
      }
      const payload: PersistedLabs = {
        version: 1,
        files
      };
      localStorage.setItem(LAB_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage quota/serialization failures in dev mode.
    }
  }

  public listTopologyFiles(): Array<{ filename: string; path: string; hasAnnotations: boolean }> {
    return [...this.labs.entries()]
      .map(([path, entry]) => ({
        filename: basename(path),
        path,
        hasAnnotations: entry.annotations !== null
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  public readFile(filePath: string): string {
    const yamlPath = yamlPathFromAny(filePath);
    const entry = this.labs.get(yamlPath);
    if (!entry) {
      throw new Error(`ENOENT: no such file ${filePath}`);
    }
    if (isAnnotationsPath(filePath)) {
      if (entry.annotations === null) {
        throw new Error(`ENOENT: no such file ${filePath}`);
      }
      return entry.annotations;
    }
    return entry.yaml;
  }

  public writeFile(filePath: string, content: string): void {
    const yamlPath = yamlPathFromAny(filePath);
    const current = this.labs.get(yamlPath) ?? { yaml: "", annotations: null };
    if (isAnnotationsPath(filePath)) {
      this.labs.set(yamlPath, {
        yaml: current.yaml,
        annotations: content
      });
    } else {
      this.labs.set(yamlPath, {
        yaml: content,
        annotations: current.annotations
      });
    }
    this.persist();
  }

  public unlink(filePath: string): void {
    const yamlPath = yamlPathFromAny(filePath);
    if (isAnnotationsPath(filePath)) {
      const current = this.labs.get(yamlPath);
      if (current) {
        this.labs.set(yamlPath, {
          yaml: current.yaml,
          annotations: null
        });
      }
    } else {
      this.labs.delete(yamlPath);
    }
    this.persist();
  }

  public rename(oldPath: string, newPath: string): void {
    const oldIsAnnotation = isAnnotationsPath(oldPath);
    const newIsAnnotation = isAnnotationsPath(newPath);
    if (oldIsAnnotation !== newIsAnnotation) {
      throw new Error(`Cannot rename between different file types: ${oldPath} -> ${newPath}`);
    }

    const oldYamlPath = yamlPathFromAny(oldPath);
    const newYamlPath = yamlPathFromAny(newPath);

    if (oldIsAnnotation) {
      const oldEntry = this.labs.get(oldYamlPath);
      if (!oldEntry || oldEntry.annotations === null) {
        throw new Error(`ENOENT: no such file ${oldPath}`);
      }
      const nextEntry = this.labs.get(newYamlPath) ?? { yaml: "", annotations: null };
      this.labs.set(newYamlPath, {
        yaml: nextEntry.yaml,
        annotations: oldEntry.annotations
      });
      this.labs.set(oldYamlPath, {
        yaml: oldEntry.yaml,
        annotations: null
      });
      this.persist();
      return;
    }

    const oldEntry = this.labs.get(oldYamlPath);
    if (!oldEntry) {
      throw new Error(`ENOENT: no such file ${oldPath}`);
    }

    this.labs.delete(oldYamlPath);
    this.labs.set(newYamlPath, {
      yaml: oldEntry.yaml,
      annotations: oldEntry.annotations
    });
    this.persist();
  }

  public exists(filePath: string): boolean {
    const yamlPath = yamlPathFromAny(filePath);
    const entry = this.labs.get(yamlPath);
    if (!entry) {
      return false;
    }
    if (isAnnotationsPath(filePath)) {
      return entry.annotations !== null;
    }
    return true;
  }

  public reset(): void {
    this.labs = cloneSeedLabs();
    this.persist();
  }
}

class InMemoryFsAdapter implements FileSystemAdapter {
  constructor(private readonly store: InMemoryLabStore) {}

  async readFile(filePath: string): Promise<string> {
    return this.store.readFile(filePath);
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    this.store.writeFile(filePath, content);
  }

  async unlink(filePath: string): Promise<void> {
    this.store.unlink(filePath);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    this.store.rename(oldPath, newPath);
  }

  async exists(filePath: string): Promise<boolean> {
    return this.store.exists(filePath);
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
}

class InMemoryTopologyHostService {
  private readonly store = new InMemoryLabStore();
  private readonly fsAdapter = new InMemoryFsAdapter(this.store);
  private readonly hosts = new Map<string, TopologyHostCore>();

  public listTopologyFiles(): Array<{ filename: string; path: string; hasAnnotations: boolean }> {
    return this.store.listTopologyFiles();
  }

  public reset(): void {
    this.store.reset();
    for (const host of this.hosts.values()) {
      host.dispose();
    }
    this.hosts.clear();
  }

  public dispose(): void {
    for (const host of this.hosts.values()) {
      host.dispose();
    }
    this.hosts.clear();
  }

  private getHost(
    filePath: string,
    mode: "edit" | "view",
    deploymentState: DeploymentState
  ): TopologyHostCore {
    const normalizedPath = yamlPathFromAny(filePath);
    let host = this.hosts.get(normalizedPath);

    if (!host) {
      host = new TopologyHostCore({
        fs: this.fsAdapter,
        yamlFilePath: normalizedPath,
        mode,
        deploymentState,
        logger: {
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {}
        }
      });
      this.hosts.set(normalizedPath, host);
      return host;
    }

    host.updateContext({ mode, deploymentState });
    return host;
  }

  public async snapshot(request: SnapshotRequest): Promise<TopologySnapshot> {
    const mode = request.mode ?? "edit";
    const deploymentState = request.deploymentState ?? "undeployed";
    const host = this.getHost(request.path, mode, deploymentState);

    if (request.externalChange) {
      return host.onExternalChange();
    }

    return host.getSnapshot();
  }

  public async command(request: CommandRequest): Promise<TopologyHostResponseMessage> {
    const mode = request.mode ?? "edit";
    const deploymentState = request.deploymentState ?? "undeployed";
    const host = this.getHost(request.path, mode, deploymentState);
    return host.applyCommand(request.command, request.baseRevision);
  }
}

function parseBody(init?: RequestInit): unknown {
  if (!init || init.body === undefined || init.body === null) {
    return {};
  }
  if (typeof init.body === "string") {
    return JSON.parse(init.body) as unknown;
  }
  return {};
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

export function installInMemoryApi(handlers: InMemoryApiHandlers = {}): () => void {
  const hostService = new InMemoryTopologyHostService();
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = new URL(url, window.location.origin);
    const method = (init?.method || "GET").toUpperCase();

    if (parsed.pathname === "/files" && method === "GET") {
      return jsonResponse(hostService.listTopologyFiles());
    }

    if (parsed.pathname === "/api/reset" && method === "POST") {
      hostService.reset();
      handlers.onFileMutated?.();
      return jsonResponse({ success: true });
    }

    if (parsed.pathname === "/api/topology/snapshot" && method === "POST") {
      try {
        const body = parseBody(init) as SnapshotRequest;
        const snapshot = await hostService.snapshot(body);
        return jsonResponse({ snapshot });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonResponse({ error: message }, 500);
      }
    }

    if (parsed.pathname === "/api/topology/command" && method === "POST") {
      try {
        const body = parseBody(init) as CommandRequest;
        const response = await hostService.command(body);
        return jsonResponse(response);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonResponse({ type: "topology-host:error", error: message }, 500);
      }
    }

    return nativeFetch(input, init);
  };

  return () => {
    window.fetch = nativeFetch;
    hostService.dispose();
  };
}
