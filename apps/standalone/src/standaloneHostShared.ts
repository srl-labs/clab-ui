import type { LabState } from "./stores/labStore";

export const TREE_ITEM_NONE = 0;
export const TREE_ITEM_COLLAPSED = 1;

export type DeploymentState = "deployed" | "undeployed" | "unknown";
export type LifecycleCommandType = "deploy" | "destroy" | "redeploy";
export type LifecycleCommandStream = "stdout" | "stderr";
export type LifecycleCommandEndpoint = "deploy" | "destroy" | "redeploy";

export interface ExplorerTreeItem {
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

export interface TopologyFileEntry {
  filename: string;
  path: string;
  hasAnnotations: boolean;
  labName?: string;
  deploymentState?: string;
}

export interface TopologyDocEventMessage {
  type: "topology-doc";
  labName: string;
  path: string;
  documentKind: "yaml" | "annotations";
  action: "create" | "change" | "delete" | "rename";
  revision: string;
}

export class SimpleExplorerProvider {
  constructor(private readonly roots: ExplorerTreeItem[]) {}

  public getChildren(element?: ExplorerTreeItem): ExplorerTreeItem[] {
    if (!element) return this.roots;
    return Array.isArray(element.children) ? element.children : [];
  }
}

export function stripTopologySuffix(name: string): string {
  return name.replace(/\.clab\.(ya?ml)$/i, "");
}

export function safeFilename(pathValue: string): string {
  const segments = pathValue.split("/").filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : pathValue;
}

export function normalizePathValue(pathValue: string): string {
  return pathValue.trim().replace(/\\/g, "/");
}

export function isAbsolutePath(pathValue: string): boolean {
  const normalized = normalizePathValue(pathValue);
  return normalized.startsWith("/") || normalized.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(normalized);
}

export function topologyEntryLabName(entry: TopologyFileEntry): string {
  if (entry.labName && entry.labName.length > 0) {
    return entry.labName;
  }
  return stripTopologySuffix(entry.filename || safeFilename(entry.path));
}

export function normalizeLabIdentity(value: string): string {
  return stripTopologySuffix(safeFilename(normalizePathValue(value))).trim().toLowerCase();
}

export function firstArgAsTreeItem(args: unknown[]): ExplorerTreeItem | undefined {
  const first = args[0];
  if (!first || typeof first !== "object") return undefined;
  return first as ExplorerTreeItem;
}

export function resolveLabPath(args: unknown[]): string | undefined {
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

export function resolveLabName(args: unknown[], labPath?: string): string | undefined {
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

export function isLabRunning(
  labName: string | undefined,
  labs: Map<string, LabState>
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

export function labsEqualForExplorer(
  previousLabs: Map<string, LabState>,
  nextLabs: Map<string, LabState>
): boolean {
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
