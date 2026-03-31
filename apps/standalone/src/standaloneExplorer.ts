import { createExplorerController } from "@srl-labs/clab-ui/host";
import type {
  ExplorerIncomingMessage,
  ExplorerSnapshotProviders,
  ExplorerUiState
} from "@srl-labs/clab-ui/explorer/snapshot";

import type { LabState } from "./stores/labStore";
import type { LifecycleApiCallResult } from "./standaloneLifecycle";
import type {
  DeploymentState,
  ExplorerTreeItem,
  LifecycleCommandEndpoint,
  TopologyFileEntry
} from "./standaloneHostShared";
import {
  TREE_ITEM_COLLAPSED,
  TREE_ITEM_NONE,
  SimpleExplorerProvider,
  firstArgAsTreeItem,
  isLabRunning,
  resolveLabName,
  resolveLabPath,
  safeFilename,
  topologyEntryLabName
} from "./standaloneHostShared";

interface StandaloneExplorerBridgeOptions {
  debounceMs: number;
  getLabs: () => Map<string, LabState>;
  invalidateTopologyFileListCache: () => void;
  invokeLifecycleApi: (
    endpoint: LifecycleCommandEndpoint,
    labName: string,
    cleanup: boolean,
    options?: { path?: string; signal?: AbortSignal }
  ) => Promise<LifecycleApiCallResult>;
  listTopologyFiles: () => Promise<TopologyFileEntry[]>;
  loadTopologyFile: (
    filePath: string,
    options?: { deploymentState?: DeploymentState }
  ) => Promise<void>;
  resolveApiTopologyPath: (args: unknown[]) => Promise<string | undefined>;
  resolveDeploymentState: (
    apiLabPath: string,
    labName: string | undefined
  ) => Promise<DeploymentState | undefined>;
}

export interface StandaloneExplorerBridge {
  explorer: {
    connect: () => void;
    invokeAction: (actionRef: string) => Promise<void>;
    persistUiState: (state: ExplorerUiState) => void;
    setFilter: (filterText: string) => void;
    subscribe: (handler: (message: ExplorerIncomingMessage) => void) => () => void;
  };
  scheduleSnapshot: (delay?: number) => void;
}

function filterTreeItems(items: ExplorerTreeItem[], filterText: string): ExplorerTreeItem[] {
  const query = filterText.trim().toLowerCase();
  if (query.length === 0) return items;

  const visit = (item: ExplorerTreeItem): ExplorerTreeItem | null => {
    const filteredChildren = (item.children ?? [])
      .map((child) => visit(child))
      .filter((child): child is ExplorerTreeItem => child !== null);
    const haystack = [item.label, item.description, item.tooltip]
      .filter((value): value is string => typeof value === "string")
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
  id: string;
  image: string;
  ipv4?: string;
  ipv6?: string;
  kind: string;
  name: string;
  state: string;
  status: string;
}): string {
  const lines = [
    `Name: ${input.name}`,
    `State: ${input.state}`,
    `Status: ${input.status}`,
    `Kind: ${input.kind}`,
    `Image: ${input.image}`,
    `ID: ${input.id}`
  ];
  if (input.ipv4 && input.ipv4 !== "N/A") lines.push(`IPv4: ${input.ipv4}`);
  if (input.ipv6 && input.ipv6 !== "N/A") lines.push(`IPv6: ${input.ipv6}`);
  return lines.join("\n");
}

function buildInterfaceTooltip(input: {
  alias: string;
  mac: string;
  mtu: string;
  name: string;
  rxBps?: string;
  state: string;
  txBps?: string;
  type: string;
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

const HELP_LINKS = [
  { label: "Containerlab Documentation", url: "https://containerlab.dev/" },
  { label: "VS Code Extension Documentation", url: "https://containerlab.dev/manual/vsc-extension/" },
  { label: "Browse Labs on GitHub (srl-labs)", url: "https://github.com/srl-labs/" },
  { label: "Join our Discord server", url: "https://discord.gg/vAyddtaEV9" }
] as const;

export function createStandaloneExplorerBridge(
  options: StandaloneExplorerBridgeOptions
): StandaloneExplorerBridge {
  let explorerFilterText = "";
  let explorerUiState: ExplorerUiState = {};
  const explorerSubscribers = new Set<(message: ExplorerIncomingMessage) => void>();
  const unhandledCommands = new Set<string>();

  function sendExplorerMessage(message: ExplorerIncomingMessage): void {
    for (const subscriber of explorerSubscribers) {
      subscriber(message);
    }
  }

  function postExplorerError(message: string): void {
    sendExplorerMessage({ command: "error", message });
  }

  function buildRunningLabItems(filterText: string, files: TopologyFileEntry[]): ExplorerTreeItem[] {
    const labs = options.getLabs();
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
            } satisfies ExplorerTreeItem;
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

  async function buildLocalLabItems(
    filterText: string,
    files: TopologyFileEntry[]
  ): Promise<ExplorerTreeItem[]> {
    const runningLabs = options.getLabs();
    const items = files
      .filter((file) => {
        const name = topologyEntryLabName(file);
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

  async function buildExplorerProviders(
    filterText: string = explorerFilterText
  ): Promise<ExplorerSnapshotProviders> {
    const files = await options.listTopologyFiles();
    const runningItems = buildRunningLabItems(filterText, files);
    const localItems = await buildLocalLabItems(filterText, files);
    const helpItems = buildHelpItems();

    return {
      runningProvider: new SimpleExplorerProvider(runningItems) as ExplorerSnapshotProviders["runningProvider"],
      localProvider: new SimpleExplorerProvider(localItems) as ExplorerSnapshotProviders["localProvider"],
      helpProvider: new SimpleExplorerProvider(helpItems) as ExplorerSnapshotProviders["helpProvider"]
    };
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
        const apiLabPath = await options.resolveApiTopologyPath(args);
        if (!apiLabPath) {
          postExplorerError(
            labName
              ? `No API-backed topology file found for running lab "${labName}".`
              : "No API-backed topology file found for this item. Standalone mode only opens topologies exposed by /api/v1/labs/topology/files."
          );
          return;
        }
        const itemState =
          item?.contextValue === "containerlabLabDeployed"
            ? "deployed"
            : item?.contextValue === "containerlabLabUndeployed"
              ? "undeployed"
              : undefined;
        const resolvedState = await options.resolveDeploymentState(apiLabPath, labName);
        const deploymentState = resolvedState ?? itemState;
        await options.loadTopologyFile(apiLabPath, { deploymentState });
        return;
      }
      case "containerlab.lab.deploy":
      case "containerlab.lab.deploy.specificFile": {
        if (labName) {
          try {
            const apiLabPath = await options.resolveApiTopologyPath(args);
            await options.invokeLifecycleApi("deploy", labName, false, { path: apiLabPath });
            options.invalidateTopologyFileListCache();
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
            await options.invokeLifecycleApi("destroy", labName, cleanup);
            options.invalidateTopologyFileListCache();
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
            await options.invokeLifecycleApi("redeploy", labName, cleanup);
            options.invalidateTopologyFileListCache();
          } catch (error) {
            console.error("[Standalone] Redeploy failed:", error);
          }
        }
        return;
      }
      case "containerlab.node.copyName": {
        const node = args[0] as ExplorerTreeItem | undefined;
        if (node) await navigator.clipboard.writeText(node.name || node.label || "").catch(() => {});
        return;
      }
      case "containerlab.node.copyID": {
        const node = args[0] as ExplorerTreeItem | undefined;
        if (node?.cID) await navigator.clipboard.writeText(node.cID).catch(() => {});
        return;
      }
      case "containerlab.node.copyKind": {
        const node = args[0] as ExplorerTreeItem | undefined;
        if (node?.kind) await navigator.clipboard.writeText(node.kind).catch(() => {});
        return;
      }
      case "containerlab.node.copyImage": {
        const node = args[0] as ExplorerTreeItem | undefined;
        if (node?.image) await navigator.clipboard.writeText(node.image).catch(() => {});
        return;
      }
      case "containerlab.node.copyIPv4Address": {
        const node = args[0] as ExplorerTreeItem | undefined;
        if (node?.v4Address) await navigator.clipboard.writeText(node.v4Address).catch(() => {});
        return;
      }
      case "containerlab.node.copyIPv6Address": {
        const node = args[0] as ExplorerTreeItem | undefined;
        if (node?.v6Address) await navigator.clipboard.writeText(node.v6Address).catch(() => {});
        return;
      }
      case "containerlab.interface.copyMACAddress": {
        const node = args[0] as ExplorerTreeItem | undefined;
        if (node?.mac) await navigator.clipboard.writeText(node.mac).catch(() => {});
        return;
      }
      case "containerlab.lab.copyPath": {
        const apiLabPath = await options.resolveApiTopologyPath(args);
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

  const controller = createExplorerController({
    initialFilterText: explorerFilterText,
    initialUiState: explorerUiState,
    debounceMs: options.debounceMs,
    buildProviders: buildExplorerProviders,
    executeAction: async (binding) => {
      await executeExplorerCommand(binding.commandId, binding.args ?? []);
    },
    publish: sendExplorerMessage,
    onFilterTextChanged(filterText) {
      explorerFilterText = filterText;
    },
    onUiStateChanged(state) {
      explorerUiState = state ?? {};
    }
  });

  return {
    explorer: {
      connect() {
        controller.connect();
      },
      invokeAction(actionRef) {
        return controller.invokeAction(actionRef);
      },
      persistUiState(state) {
        void controller.persistUiState(state);
      },
      setFilter(filterText) {
        void controller.setFilter(filterText);
      },
      subscribe(handler) {
        explorerSubscribers.add(handler);
        return () => {
          explorerSubscribers.delete(handler);
        };
      }
    },
    scheduleSnapshot(delay = options.debounceMs) {
      controller.scheduleSnapshot(delay);
    }
  };
}
