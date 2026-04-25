import type * as vscode from "vscode";

import {
  EXPLORER_SECTION_LABELS,
  EXPLORER_SECTION_ORDER,
  type ExplorerAction,
  type ExplorerNode,
  type ExplorerSectionId,
  type ExplorerSectionSnapshot,
  type ExplorerSnapshotMessage
} from "./shared/explorer/types";

interface ExplorerTreeProvider {
  getChildren(element?: unknown): vscode.ProviderResult<vscode.TreeItem[] | undefined>;
}

type RunningLabTreeDataProvider = ExplorerTreeProvider;
type LocalLabTreeDataProvider = ExplorerTreeProvider;
type HelpFeedbackProvider = ExplorerTreeProvider;

type ExplorerTreeItemLike = vscode.TreeItem & {
  id?: string;
  contextValue?: string;
  endpointId?: string;
  state?: string;
  status?: string;
  link?: string;
};

interface LabShareInfo {
  kind: "sshx" | "gotty";
  url: string;
}

export interface ExplorerSnapshotProviders {
  runningProvider: RunningLabTreeDataProvider;
  localProvider: LocalLabTreeDataProvider;
  helpProvider: HelpFeedbackProvider;
}

export interface ExplorerSnapshotOptions {
  hideNonOwnedLabs: boolean;
  isLocalCaptureAllowed: boolean;
  commandMetadata?: ExplorerCommandMetadata;
  hiddenCommandIds?: readonly string[];
}

export interface ExplorerActionInvocation {
  commandId: string;
  args: unknown[];
}

export interface ExplorerContributedMenuItem {
  commandId: string;
  label?: string;
  iconId?: string;
}

export interface ExplorerCommandMetadata {
  contributedContainerActions?: readonly ExplorerContributedMenuItem[];
  commandLabels?: ReadonlyMap<string, string>;
  commandIcons?: ReadonlyMap<string, string>;
}

export interface ExplorerSnapshotBuildResult {
  snapshot: ExplorerSnapshotMessage;
  actionBindings: Map<string, ExplorerActionInvocation>;
}

const COMMAND_LABELS: Record<string, string> = {
  "containerlab.lab.openFile": "Edit Topology",
  "containerlab.editor.topoViewerEditor.open": "Edit Topology (TopoViewer)",
  "containerlab.lab.copyPath": "Copy File Path",
  "containerlab.lab.addToWorkspace": "Add To Workspace",
  "containerlab.lab.openFolderInNewWindow": "Open Folder In New Window",
  "containerlab.lab.toggleFavorite": "Toggle Favorite",
  "containerlab.lab.deploy": "Deploy",
  "containerlab.lab.deploy.cleanup": "Deploy (Cleanup)",
  "containerlab.lab.destroy": "Destroy",
  "containerlab.lab.destroy.cleanup": "Destroy (Cleanup)",
  "containerlab.lab.redeploy": "Redeploy",
  "containerlab.lab.redeploy.cleanup": "Redeploy (Cleanup)",
  "containerlab.lab.save": "Save Configs",
  "containerlab.lab.delete": "Delete Lab File",
  "containerlab.lab.sshToAllNodes": "SSH To All Nodes",
  "containerlab.inspectOneLab": "Inspect",
  "containerlab.lab.sshx.attach": "Attach SSHX Session",
  "containerlab.lab.sshx.detach": "Detach SSHX Session",
  "containerlab.lab.sshx.reattach": "Reattach SSHX Session",
  "containerlab.lab.gotty.attach": "Attach GoTTY Session",
  "containerlab.lab.gotty.detach": "Detach GoTTY Session",
  "containerlab.lab.gotty.reattach": "Reattach GoTTY Session",
  "containerlab.lab.sshx.copyLink": "Copy SSHX Link",
  "containerlab.lab.gotty.copyLink": "Copy GoTTY Link",
  "containerlab.lab.graph.topoViewer": "Open TopoViewer",
  "containerlab.lab.graph.drawio.horizontal": "Graph (draw.io, Horizontal)",
  "containerlab.lab.graph.drawio.vertical": "Graph (draw.io, Vertical)",
  "containerlab.lab.graph.drawio.interactive": "Graph (draw.io, Interactive)",
  "containerlab.node.start": "Start Node",
  "containerlab.node.stop": "Stop Node",
  "containerlab.node.pause": "Pause Node",
  "containerlab.node.unpause": "Unpause Node",
  "containerlab.node.save": "Save Node Config",
  "containerlab.node.attachShell": "Attach Shell",
  "containerlab.node.ssh": "SSH",
  "containerlab.node.telnet": "Telnet",
  "containerlab.node.showLogs": "Show Logs",
  "containerlab.node.manageImpairments": "Manage Impairments",
  "containerlab.node.openBrowser": "Open Browser",
  "containerlab.node.copyName": "Copy Node Name",
  "containerlab.node.copyID": "Copy Node ID",
  "containerlab.node.copyIPv4Address": "Copy IPv4 Address",
  "containerlab.node.copyIPv6Address": "Copy IPv6 Address",
  "containerlab.node.copyKind": "Copy Node Kind",
  "containerlab.node.copyImage": "Copy Node Image",
  "containerlab.interface.capture": "Capture",
  "containerlab.interface.captureWithEdgeshark": "Capture With Edgeshark",
  "containerlab.interface.captureWithEdgesharkVNC": "Capture With Edgeshark VNC",
  "containerlab.interface.setDelay": "Set Delay",
  "containerlab.interface.setJitter": "Set Jitter",
  "containerlab.interface.setLoss": "Set Loss",
  "containerlab.interface.setRate": "Set Rate",
  "containerlab.interface.setCorruption": "Set Corruption",
  "containerlab.interface.copyMACAddress": "Copy MAC Address",
  "containerlab.lab.fcli.bgpPeers": "Run fcli bgp-peers",
  "containerlab.lab.fcli.bgpRib": "Run fcli bgp-rib",
  "containerlab.lab.fcli.ipv4Rib": "Run fcli ipv4-rib",
  "containerlab.lab.fcli.lldp": "Run fcli lldp",
  "containerlab.lab.fcli.mac": "Run fcli mac",
  "containerlab.lab.fcli.ni": "Run fcli ni",
  "containerlab.lab.fcli.subif": "Run fcli subif",
  "containerlab.lab.fcli.sysInfo": "Run fcli sys-info",
  "containerlab.lab.fcli.custom": "Run Custom fcli",
  "containerlab.lab.deploy.specificFile": "Deploy Lab File",
  "containerlab.images.manage": "Manage Images",
  "containerlab.inspectAll": "Inspect All Labs",
  "containerlab.treeView.runningLabs.hideNonOwnedLabs": "Hide Non-Owned Labs",
  "containerlab.treeView.runningLabs.showNonOwnedLabs": "Show Non-Owned Labs",
  "containerlab.editor.topoViewerEditor": "New Topology File",
  "containerlab.lab.cloneRepo": "Clone Repository",
  "containerlab.install.edgeshark": "Install EdgeShark",
  "containerlab.uninstall.edgeshark": "Uninstall EdgeShark",
  "containerlab.capture.killAllWiresharkVNC": "Kill All Wireshark VNC Sessions",
  "containerlab.set.sessionHostname": "Configure Session Hostname",
  "containerlab.endpoint.reconnect": "Reconnect Endpoint",
  "containerlab.endpoint.remove": "Remove Endpoint",
  "containerlab.endpoint.copyUrl": "Copy Endpoint URL"
};

const DESTRUCTIVE_COMMANDS = new Set<string>([
  "containerlab.lab.delete",
  "containerlab.lab.destroy",
  "containerlab.lab.destroy.cleanup",
  "containerlab.lab.sshx.detach",
  "containerlab.lab.gotty.detach",
  "containerlab.uninstall.edgeshark",
  "containerlab.capture.killAllWiresharkVNC"
]);
const SECTION_BUILD_TIMEOUT_MS = 4000;
const TREE_ITEM_COLLAPSIBLE_NONE = 0;
const BUILTIN_CONTAINER_ACTION_COMMANDS: readonly string[] = [
  "containerlab.node.showLogs",
  "containerlab.node.attachShell",
  "containerlab.node.ssh",
  "containerlab.node.telnet",
  "containerlab.node.openBrowser",
  "containerlab.node.start",
  "containerlab.node.stop",
  "containerlab.node.pause",
  "containerlab.node.unpause",
  "containerlab.node.save",
  "containerlab.node.manageImpairments",
  "containerlab.node.copyName",
  "containerlab.node.copyID",
  "containerlab.node.copyIPv4Address",
  "containerlab.node.copyIPv6Address",
  "containerlab.node.copyKind",
  "containerlab.node.copyImage"
];

function labelToText(label: string | vscode.TreeItemLabel | undefined): string {
  if (!label) {
    return "";
  }
  return typeof label === "string" ? label : label.label;
}

function descriptionToText(description: string | boolean | undefined): string | undefined {
  if (typeof description === "string" && description.trim().length > 0) {
    return description;
  }
  return undefined;
}

function tooltipToText(tooltip: vscode.MarkdownString | string | undefined): string | undefined {
  if (typeof tooltip === "string") {
    return tooltip;
  }
  if (
    tooltip &&
    typeof tooltip === "object" &&
    "value" in tooltip &&
    typeof (tooltip as { value?: unknown }).value === "string"
  ) {
    return (tooltip as { value: string }).value;
  }
  return undefined;
}

function commandLabel(commandId: string, fallback?: string): string {
  return fallback || COMMAND_LABELS[commandId] || commandId;
}

function isLabContext(contextValue: string | undefined): boolean {
  return typeof contextValue === "string" && contextValue.includes("containerlabLab");
}

function isDeployedLab(contextValue: string | undefined): boolean {
  return typeof contextValue === "string" && contextValue.includes("containerlabLabDeployed");
}

function isUndeployedLab(contextValue: string | undefined): boolean {
  return typeof contextValue === "string" && contextValue.includes("containerlabLabUndeployed");
}

function isFavoriteLab(contextValue: string | undefined): boolean {
  return typeof contextValue === "string" && contextValue.includes("Favorite");
}

function shouldHideNodeDescription(contextValue: string | undefined): boolean {
  return isLabContext(contextValue);
}

function collectContainerIndicators(children: ExplorerNode[]): ExplorerNode["statusIndicator"][] {
  const indicators: ExplorerNode["statusIndicator"][] = [];
  for (const child of children) {
    if (child.contextValue === "containerlabContainer") {
      indicators.push(child.statusIndicator);
    } else if (child.contextValue === "containerlabContainerGroup") {
      // Recurse into group children to get actual container indicators
      indicators.push(...collectContainerIndicators(child.children));
    }
  }
  return indicators;
}

function aggregateStatusFromIndicators(indicators: ExplorerNode["statusIndicator"][]): ExplorerNode["statusIndicator"] {
  if (indicators.length === 0) {
    return undefined;
  }

  let healthyRunning = 0;
  let notRunning = 0;
  let unhealthyRunning = 0;

  for (const indicator of indicators) {
    if (indicator === "green") {
      healthyRunning += 1;
      continue;
    }
    if (indicator === "yellow") {
      unhealthyRunning += 1;
      continue;
    }
    notRunning += 1;
  }

  if (healthyRunning === indicators.length) {
    return "green";
  }
  if (healthyRunning > 0 && notRunning > 0 && unhealthyRunning === 0) {
    return "yellow";
  }
  return "red";
}

function getStatusIndicator(item: ExplorerTreeItemLike): ExplorerNode["statusIndicator"] {
  const context = item.contextValue;
  if (context === "containerlabEndpoint") {
    const state = String(item.state ?? "").toLowerCase();
    if (state === "connected") {
      return "green";
    }
    if (state === "session_expired") {
      return "yellow";
    }
    if (state === "offline") {
      return "red";
    }
    return "gray";
  }
  if (context === "containerlabInterfaceUp") {
    return "green";
  }
  if (context === "containerlabInterfaceDown") {
    return "red";
  }
  if (context === "containerlabContainer") {
    const state = String(item.state ?? "").toLowerCase();
    const status = String(item.status ?? "").toLowerCase();
    if (state === "running" && (status.includes("unhealthy") || status.includes("health: starting"))) {
      return "yellow";
    }
    if (state === "running") {
      return "green";
    }
    return "red";
  }
  return undefined;
}

class ExplorerActionRegistry {
  private counter = 0;
  private readonly bindings = new Map<string, ExplorerActionInvocation>();

  public createAction(
    commandId: string,
    label: string,
    args: unknown[] = [],
    destructive = false,
    iconId?: string
  ): ExplorerAction {
    const actionRef = `action:${this.counter++}`;
    this.bindings.set(actionRef, { commandId, args });
    return {
      id: `${commandId}:${label}:${actionRef}`,
      actionRef,
      label,
      commandId,
      iconId,
      destructive
    };
  }

  public getBindings(): Map<string, ExplorerActionInvocation> {
    return this.bindings;
  }
}

function pushAction(
  actions: ExplorerAction[],
  seen: Set<string>,
  registry: ExplorerActionRegistry,
  commandId: string,
  args: unknown[] = [],
  label?: string,
  destructive?: boolean,
  iconId?: string
): void {
  const resolvedLabel = commandLabel(commandId, label);
  const key = `${commandId}:${resolvedLabel}`;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  actions.push(
    registry.createAction(
      commandId,
      resolvedLabel,
      args,
      destructive ?? DESTRUCTIVE_COMMANDS.has(commandId),
      iconId
    )
  );
}

function applyCommandIcons(
  actions: ExplorerAction[],
  commandIcons: ReadonlyMap<string, string>
): ExplorerAction[] {
  for (const action of actions) {
    if (action.iconId !== undefined) {
      continue;
    }
    const iconId = commandIcons.get(action.commandId);
    if (iconId !== undefined && iconId.length > 0) {
      action.iconId = iconId;
    }
  }
  return actions;
}

function filterHiddenActions(
  actions: ExplorerAction[],
  options: ExplorerSnapshotOptions
): ExplorerAction[] {
  const hiddenCommandIds = options.hiddenCommandIds ?? [];
  if (hiddenCommandIds.length === 0) {
    return actions;
  }

  const hidden = new Set(hiddenCommandIds);
  return actions.filter((action) => !hidden.has(action.commandId));
}

function getLinkArgument(item: ExplorerTreeItemLike): string | undefined {
  const link = item.link;
  if (typeof link === "string" && link.length > 0) {
    return link;
  }
  return undefined;
}

function isShareLinkNode(contextValue: string | undefined): boolean {
  return contextValue === "containerlabSSHXLink" || contextValue === "containerlabGottyLink";
}

function getLabShareInfo(childrenItems: ExplorerTreeItemLike[]): LabShareInfo | undefined {
  let sshxUrl: string | undefined;
  let gottyUrl: string | undefined;

  for (const child of childrenItems) {
    const contextValue = child.contextValue;
    if (contextValue === "containerlabSSHXLink") {
      sshxUrl = getLinkArgument(child);
      continue;
    }
    if (contextValue === "containerlabGottyLink") {
      gottyUrl = getLinkArgument(child);
    }
  }

  if (sshxUrl) {
    return { kind: "sshx", url: sshxUrl };
  }
  if (gottyUrl) {
    return { kind: "gotty", url: gottyUrl };
  }
  return undefined;
}

function appendLabActions(
  actions: ExplorerAction[],
  seen: Set<string>,
  registry: ExplorerActionRegistry,
  sectionId: ExplorerSectionId,
  item: ExplorerTreeItemLike
): void {
  const contextValue = item.contextValue;
  const isDeployed = isDeployedLab(contextValue);
  const isUndeployed = isUndeployedLab(contextValue);
  const isFavorite = isFavoriteLab(contextValue);

  pushAction(actions, seen, registry, "containerlab.lab.openFile", [item]);
  pushAction(actions, seen, registry, "containerlab.lab.copyPath", [item]);
  pushAction(actions, seen, registry, "containerlab.lab.openFolderInNewWindow", [item]);

  if (isUndeployed) {
    pushAction(
      actions,
      seen,
      registry,
      "containerlab.editor.topoViewerEditor.open",
      [item],
      "Edit Topology (TopoViewer)"
    );
  }

  if (contextValue === "containerlabLabDeployed") {
    pushAction(actions, seen, registry, "containerlab.lab.addToWorkspace", [item]);
  }

  pushAction(
    actions,
    seen,
    registry,
    "containerlab.lab.toggleFavorite",
    [item],
    isFavorite ? "Remove From Favorites" : "Add To Favorites"
  );

  if (isUndeployed) {
    pushAction(actions, seen, registry, "containerlab.lab.deploy", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.deploy.cleanup", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.delete", [item], undefined, true);
  }

  if (isDeployed) {
    pushAction(actions, seen, registry, "containerlab.lab.destroy", [item], undefined, true);
    pushAction(actions, seen, registry, "containerlab.lab.destroy.cleanup", [item], undefined, true);
    pushAction(actions, seen, registry, "containerlab.lab.redeploy", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.redeploy.cleanup", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.save", [item]);
    pushAction(actions, seen, registry, "containerlab.inspectOneLab", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.sshToAllNodes", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.sshx.attach", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.sshx.detach", [item], undefined, true);
    pushAction(actions, seen, registry, "containerlab.lab.sshx.reattach", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.gotty.attach", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.gotty.detach", [item], undefined, true);
    pushAction(actions, seen, registry, "containerlab.lab.gotty.reattach", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.fcli.bgpPeers", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.fcli.bgpRib", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.fcli.ipv4Rib", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.fcli.lldp", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.fcli.mac", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.fcli.ni", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.fcli.subif", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.fcli.sysInfo", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.fcli.custom", [item]);
  }

  pushAction(actions, seen, registry, "containerlab.lab.graph.drawio.horizontal", [item]);
  pushAction(actions, seen, registry, "containerlab.lab.graph.drawio.vertical", [item]);
  pushAction(actions, seen, registry, "containerlab.lab.graph.drawio.interactive", [item]);
  pushAction(actions, seen, registry, "containerlab.lab.graph.topoViewer", [item]);

  if (sectionId === "localLabs" && !isDeployed && !isUndeployed) {
    // Keep local section behavior consistent for edge nodes without known lab context.
    pushAction(actions, seen, registry, "containerlab.lab.openFile", [item]);
  }
}

function appendContainerActions(
  actions: ExplorerAction[],
  seen: Set<string>,
  registry: ExplorerActionRegistry,
  item: ExplorerTreeItemLike,
  contributedActions: readonly ExplorerContributedMenuItem[],
  commandLabels: ReadonlyMap<string, string>,
  commandIcons: ReadonlyMap<string, string>
): void {
  for (const commandId of BUILTIN_CONTAINER_ACTION_COMMANDS) {
    pushAction(actions, seen, registry, commandId, [item]);
  }

  const existingCommands = new Set(actions.map((action) => action.commandId));
  for (const contributedAction of contributedActions) {
    if (existingCommands.has(contributedAction.commandId)) {
      continue;
    }

    pushAction(
      actions,
      seen,
      registry,
      contributedAction.commandId,
      [item],
      commandLabels.get(contributedAction.commandId) ?? contributedAction.label,
      undefined,
      commandIcons.get(contributedAction.commandId) ?? contributedAction.iconId
    );
    existingCommands.add(contributedAction.commandId);
  }
}

function appendInterfaceActions(
  actions: ExplorerAction[],
  seen: Set<string>,
  registry: ExplorerActionRegistry,
  item: ExplorerTreeItemLike,
  isLocalCaptureAllowed: boolean
): void {
  if (isLocalCaptureAllowed) {
    pushAction(actions, seen, registry, "containerlab.interface.capture", [item]);
  }
  pushAction(actions, seen, registry, "containerlab.interface.captureWithEdgeshark", [item]);
  pushAction(actions, seen, registry, "containerlab.interface.captureWithEdgesharkVNC", [item]);
  pushAction(actions, seen, registry, "containerlab.interface.setDelay", [item]);
  pushAction(actions, seen, registry, "containerlab.interface.setJitter", [item]);
  pushAction(actions, seen, registry, "containerlab.interface.setLoss", [item]);
  pushAction(actions, seen, registry, "containerlab.interface.setRate", [item]);
  pushAction(actions, seen, registry, "containerlab.interface.setCorruption", [item]);
  pushAction(actions, seen, registry, "containerlab.interface.copyMACAddress", [item]);
}

function appendLinkActions(
  actions: ExplorerAction[],
  seen: Set<string>,
  registry: ExplorerActionRegistry,
  item: ExplorerTreeItemLike
): void {
  const linkArg = getLinkArgument(item);
  if (item.contextValue === "containerlabSSHXLink" && linkArg) {
    pushAction(actions, seen, registry, "containerlab.lab.sshx.copyLink", [linkArg]);
  } else if (item.contextValue === "containerlabGottyLink" && linkArg) {
    pushAction(actions, seen, registry, "containerlab.lab.gotty.copyLink", [linkArg]);
  }
}

function appendHelpFeedbackActions(
  actions: ExplorerAction[],
  seen: Set<string>,
  registry: ExplorerActionRegistry,
  item: ExplorerTreeItemLike
): void {
  const linkArg = getLinkArgument(item);
  if (!linkArg) {
    return;
  }
  pushAction(actions, seen, registry, "containerlab.openLink", [linkArg], "Open Link");
}

function appendEndpointActions(
  actions: ExplorerAction[],
  seen: Set<string>,
  registry: ExplorerActionRegistry,
  item: ExplorerTreeItemLike
): void {
  const normalizedState = String(item.state ?? "").toLowerCase();
  if (normalizedState === "connected") {
    pushAction(actions, seen, registry, "containerlab.editor.topoViewerEditor", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.cloneRepo", [item]);
    pushAction(actions, seen, registry, "containerlab.install.edgeshark", [item]);
    pushAction(actions, seen, registry, "containerlab.uninstall.edgeshark", [item], undefined, true);
    pushAction(actions, seen, registry, "containerlab.capture.killAllWiresharkVNC", [item], undefined, true);
    pushAction(actions, seen, registry, "containerlab.set.sessionHostname", [item]);
  }
  pushAction(actions, seen, registry, "containerlab.endpoint.reconnect", [item]);
  pushAction(actions, seen, registry, "containerlab.endpoint.remove", [item], undefined, true);
  pushAction(actions, seen, registry, "containerlab.endpoint.copyUrl", [item]);
}

function appendNodeActionsForContext(
  actions: ExplorerAction[],
  seen: Set<string>,
  sectionId: ExplorerSectionId,
  item: ExplorerTreeItemLike,
  registry: ExplorerActionRegistry,
  options: ExplorerSnapshotOptions,
  contributedActions: readonly ExplorerContributedMenuItem[],
  commandLabels: ReadonlyMap<string, string>,
  commandIcons: ReadonlyMap<string, string>
): void {
  const contextValue = item.contextValue;
  if (contextValue === "containerlabEndpoint") {
    appendEndpointActions(actions, seen, registry, item);
    return;
  }
  if (isLabContext(contextValue)) {
    appendLabActions(actions, seen, registry, sectionId, item);
    return;
  }
  if (contextValue === "containerlabContainer" || contextValue === "containerlabContainerGroup") {
    appendContainerActions(
      actions,
      seen,
      registry,
      item,
      contributedActions,
      commandLabels,
      commandIcons
    );
    return;
  }
  if (contextValue === "containerlabInterfaceUp") {
    appendInterfaceActions(actions, seen, registry, item, options.isLocalCaptureAllowed);
    return;
  }
  if (contextValue === "containerlabSSHXLink" || contextValue === "containerlabGottyLink") {
    appendLinkActions(actions, seen, registry, item);
  }
}

function getNodeActions(
  sectionId: ExplorerSectionId,
  item: ExplorerTreeItemLike,
  registry: ExplorerActionRegistry,
  options: ExplorerSnapshotOptions
): ExplorerAction[] {
  const actions: ExplorerAction[] = [];
  const seen = new Set<string>();
  const commandMetadata = options.commandMetadata;
  const contributedActions = commandMetadata?.contributedContainerActions ?? [];
  const commandLabels = commandMetadata?.commandLabels ?? new Map<string, string>();
  const commandIcons = commandMetadata?.commandIcons ?? new Map<string, string>();

  if (sectionId === "helpFeedback") {
    appendHelpFeedbackActions(actions, seen, registry, item);
    return filterHiddenActions(applyCommandIcons(actions, commandIcons), options);
  }

  appendNodeActionsForContext(
    actions,
    seen,
    sectionId,
    item,
    registry,
    options,
    contributedActions,
    commandLabels,
    commandIcons
  );

  return filterHiddenActions(applyCommandIcons(actions, commandIcons), options);
}

function resolvePrimaryAction(
  contextValue: string | undefined,
  nodeActions: ExplorerAction[],
  nodeState?: string
): ExplorerAction | undefined {
  if (contextValue === "containerlabEndpoint") {
    const normalizedState = String(nodeState ?? "").toLowerCase();
    if (normalizedState !== "connected") {
      return nodeActions.find((action) => action.commandId === "containerlab.endpoint.reconnect");
    }
    return undefined;
  }

  if (isLabContext(contextValue)) {
    return nodeActions.find((action) => action.commandId === "containerlab.lab.graph.topoViewer");
  }

  if (
    contextValue === "containerlabContainer" ||
    contextValue === "containerlabContainerGroup" ||
    contextValue === "containerlabInterfaceUp" ||
    contextValue === "containerlabInterfaceDown" ||
    isShareLinkNode(contextValue)
  ) {
    return undefined;
  }

  return nodeActions.length > 0 ? nodeActions[0] : undefined;
}

async function getProviderChildren(
  provider: ExplorerTreeProvider,
  element?: ExplorerTreeItemLike
): Promise<ExplorerTreeItemLike[]> {
  const result = await Promise.resolve(provider.getChildren(element));
  if (!Array.isArray(result)) {
    return [];
  }
  return result as ExplorerTreeItemLike[];
}

function shouldResolveChildren(item: ExplorerTreeItemLike): boolean {
  return item.collapsibleState !== TREE_ITEM_COLLAPSIBLE_NONE;
}

function resolveNodeStatusIndicator(
  contextValue: string | undefined,
  item: ExplorerTreeItemLike,
  children: ExplorerNode[]
): ExplorerNode["statusIndicator"] {
  if (contextValue === "containerlabEndpoint") {
    return getStatusIndicator(item);
  }
  if (isDeployedLab(contextValue) || contextValue === "containerlabContainerGroup") {
    return aggregateStatusFromIndicators(collectContainerIndicators(children));
  }
  return getStatusIndicator(item);
}

async function buildNode(
  provider: ExplorerTreeProvider,
  item: ExplorerTreeItemLike,
  sectionId: ExplorerSectionId,
  options: ExplorerSnapshotOptions,
  registry: ExplorerActionRegistry,
  pathId: string
): Promise<ExplorerNode> {
  const contextValue = item.contextValue;
  const rawLabel = labelToText(item.label);
  const label = isLabContext(contextValue) ? rawLabel.replace(/^🔗\s*/u, "") : rawLabel;
  const description = shouldHideNodeDescription(contextValue)
    ? undefined
    : descriptionToText(item.description);
  const tooltip = tooltipToText(item.tooltip);
  const rawChildrenItems = shouldResolveChildren(item)
    ? await getProviderChildren(provider, item)
    : [];
  const shareInfo = isLabContext(contextValue) ? getLabShareInfo(rawChildrenItems) : undefined;
  const childrenItems = isLabContext(contextValue)
    ? rawChildrenItems.filter((child) => !isShareLinkNode(child.contextValue))
    : rawChildrenItems;
  const children = await Promise.all(
    childrenItems.map((child, index) =>
      buildNode(provider, child, sectionId, options, registry, `${pathId}/${index}`)
    )
  );
  const nodeActions = getNodeActions(sectionId, item, registry, options);
  if (shareInfo) {
    const copyCommandId =
      shareInfo.kind === "sshx" ? "containerlab.lab.sshx.copyLink" : "containerlab.lab.gotty.copyLink";
    const hasCopyAction = nodeActions.some((action) => action.commandId === copyCommandId);
    if (!hasCopyAction) {
      nodeActions.push(
        registry.createAction(
          copyCommandId,
          commandLabel(copyCommandId),
          [shareInfo.url],
          DESTRUCTIVE_COMMANDS.has(copyCommandId)
        )
      );
    }
  }
  let shareAction: ExplorerAction | undefined;
  if (shareInfo) {
    const label = shareInfo.kind === "sshx" ? "Open Shared Terminal" : "Open Web Terminal";
    shareAction = registry.createAction("containerlab.openLink", label, [shareInfo.url]);
  } else {
    shareAction = undefined;
  }
  const primaryAction = resolvePrimaryAction(contextValue, nodeActions, item.state);
  const statusIndicator = resolveNodeStatusIndicator(contextValue, item, children);

  return {
    id: item.id || pathId,
    label,
    description,
    tooltip,
    contextValue,
    endpointId: item.endpointId,
    state: item.state,
    statusIndicator,
    statusDescription: description,
    primaryAction,
    shareAction,
    actions: nodeActions,
    children
  };
}

async function buildSectionNodes(
  provider: ExplorerTreeProvider,
  sectionId: ExplorerSectionId,
  options: ExplorerSnapshotOptions,
  registry: ExplorerActionRegistry
): Promise<ExplorerNode[]> {
  const roots = await getProviderChildren(provider);
  return Promise.all(
    roots.map((item, index) => buildNode(provider, item, sectionId, options, registry, `${sectionId}/${index}`))
  );
}

function countNodes(nodes: ExplorerNode[], predicate: (node: ExplorerNode) => boolean): number {
  let total = 0;
  for (const node of nodes) {
    if (predicate(node)) {
      total += 1;
    }
    total += countNodes(node.children, predicate);
  }
  return total;
}

function countForSection(sectionId: ExplorerSectionId, nodes: ExplorerNode[]): number {
  if (sectionId === "runningLabs") {
    return countNodes(nodes, (node) => isDeployedLab(node.contextValue));
  }
  if (sectionId === "localLabs") {
    return countNodes(nodes, (node) => isUndeployedLab(node.contextValue));
  }
  return nodes.length;
}

function toolbarActionsForSection(
  sectionId: ExplorerSectionId,
  registry: ExplorerActionRegistry,
  options: ExplorerSnapshotOptions
): ExplorerAction[] {
  const actions: ExplorerAction[] = [];
  const seen = new Set<string>();
  const commandIcons = options.commandMetadata?.commandIcons ?? new Map<string, string>();

  if (sectionId === "runningLabs") {
    pushAction(actions, seen, registry, "containerlab.lab.deploy.specificFile");
    pushAction(actions, seen, registry, "containerlab.images.manage");
    pushAction(actions, seen, registry, "containerlab.inspectAll");
    if (options.hideNonOwnedLabs) {
      pushAction(actions, seen, registry, "containerlab.treeView.runningLabs.showNonOwnedLabs");
    } else {
      pushAction(actions, seen, registry, "containerlab.treeView.runningLabs.hideNonOwnedLabs");
    }
    return filterHiddenActions(applyCommandIcons(actions, commandIcons), options);
  }

  if (sectionId === "localLabs") {
    pushAction(actions, seen, registry, "containerlab.editor.topoViewerEditor");
    pushAction(actions, seen, registry, "containerlab.lab.cloneRepo");
    pushAction(actions, seen, registry, "containerlab.images.manage");
  }

  return filterHiddenActions(applyCommandIcons(actions, commandIcons), options);
}

async function buildSectionSnapshot(
  sectionId: ExplorerSectionId,
  provider: ExplorerTreeProvider,
  options: ExplorerSnapshotOptions,
  registry: ExplorerActionRegistry
): Promise<ExplorerSectionSnapshot> {
  const nodes = await buildSectionNodes(provider, sectionId, options, registry);
  return {
    id: sectionId,
    label: EXPLORER_SECTION_LABELS[sectionId],
    count: countForSection(sectionId, nodes),
    nodes,
    toolbarActions: toolbarActionsForSection(sectionId, registry, options)
  };
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    promise.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function buildSectionSnapshotSafe(
  sectionId: ExplorerSectionId,
  provider: ExplorerTreeProvider,
  options: ExplorerSnapshotOptions,
  registry: ExplorerActionRegistry
): Promise<ExplorerSectionSnapshot> {
  try {
    return await withTimeout(
      buildSectionSnapshot(sectionId, provider, options, registry),
      SECTION_BUILD_TIMEOUT_MS,
      `Timed out while building section '${sectionId}'`
    );
  } catch (error: unknown) {
    console.error(`[containerlab explorer] failed to build section '${sectionId}'`, error);
    return {
      id: sectionId,
      label: EXPLORER_SECTION_LABELS[sectionId],
      count: 0,
      nodes: [],
      toolbarActions: toolbarActionsForSection(sectionId, registry, options)
    };
  }
}

export async function buildExplorerSnapshot(
  providers: ExplorerSnapshotProviders,
  filterText: string,
  options: ExplorerSnapshotOptions
): Promise<ExplorerSnapshotBuildResult> {
  const registry = new ExplorerActionRegistry();
  const providersBySection: Record<ExplorerSectionId, ExplorerTreeProvider> = {
    runningLabs: providers.runningProvider,
    localLabs: providers.localProvider,
    helpFeedback: providers.helpProvider
  };

  const sections = await Promise.all(
    EXPLORER_SECTION_ORDER.map((sectionId) =>
      buildSectionSnapshotSafe(sectionId, providersBySection[sectionId], options, registry)
    )
  );

  return {
    snapshot: {
      command: "snapshot",
      filterText,
      sections
    },
    actionBindings: registry.getBindings()
  };
}
