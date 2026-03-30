/**
 * TopoViewer host action helpers.
 * UI code talks in semantic intents; the configured host translates them to
 * VS Code commands, standalone backend calls, or no-ops as appropriate.
 */
import type { SaveCustomNodeData } from "../core/utilities/customNodeConversions";
import { getClabUiHost } from "../host";

export function sendLifecycleCommand(
  action:
    | "deployLab"
    | "deployLabCleanup"
    | "destroyLab"
    | "destroyLabCleanup"
    | "redeployLab"
    | "redeployLabCleanup"
): void {
  getClabUiHost().topoViewer.runLifecycle(action);
}

export function sendToggleSplitView(): void {
  getClabUiHost().topoViewer.toggleSplitView();
}

export function sendNodeAction(action: "ssh" | "shell" | "logs", nodeName: string): void {
  getClabUiHost().topoViewer.runNodeAction(action, nodeName);
}

export function sendInterfaceCapture(nodeName: string, interfaceName: string): void {
  getClabUiHost().topoViewer.captureInterface(nodeName, interfaceName);
}

export function sendLinkImpairment(
  nodeName: string,
  interfaceName: string,
  data: unknown
): void {
  getClabUiHost().topoViewer.setLinkImpairment(nodeName, interfaceName, data);
}

export function sendRequestIconList(): void {
  getClabUiHost().topoViewer.requestIconList();
}

export function sendUploadIcon(): void {
  getClabUiHost().topoViewer.uploadIcon();
}

export function sendDeleteIcon(iconName: string): void {
  getClabUiHost().topoViewer.deleteIcon(iconName);
}

export function sendGrafanaBundleExport(payload: {
  requestId: string;
  baseName: string;
  svgContent: string;
  dashboardJson: string;
  panelYaml: string;
}): void {
  getClabUiHost().topoViewer.exportGrafanaBundle(payload);
}

export function sendDumpCssVars(vars: Record<string, string>): void {
  getClabUiHost().topoViewer.dumpCssVars(vars);
}

// ============================================================================
// CUSTOM NODE TEMPLATE COMMANDS
// ============================================================================
// These commands manage custom node templates stored in VS Code workspace settings.
// They use messaging because they interact with VS Code's configuration API.
// DO NOT confuse with node CRUD operations (create-node, save-node-editor, etc.)
// which use services for YAML/annotation persistence.

/**
 * Delete a custom node template from VS Code settings.
 *
 * This removes a user-defined node template stored in workspace configuration.
 * Handled by: extension `MessageRouter`
 */
export function sendDeleteCustomNode(nodeName: string): void {
  getClabUiHost().topoViewer.deleteCustomNode(nodeName);
}

/**
 * Set a custom node template as the default for new nodes.
 *
 * This updates VS Code settings to mark a template as the default.
 * Handled by: extension `MessageRouter`
 */
export function sendSetDefaultCustomNode(nodeName: string): void {
  getClabUiHost().topoViewer.setDefaultCustomNode(nodeName);
}

/**
 * Save a custom node template to VS Code settings.
 *
 * This creates or updates a user-defined node template in workspace configuration.
 * Templates define reusable node configurations (kind, image, icon, etc.)
 * and are stored in VS Code workspace settings, NOT in topology files.
 *
 * Handled by: extension `MessageRouter`
 */
export function sendSaveCustomNode(data: SaveCustomNodeData): void {
  getClabUiHost().topoViewer.saveCustomNode(data as Record<string, unknown>);
}

// ============================================================================
// ICON RECONCILIATION
// ============================================================================

/**
 * Trigger icon reconciliation on the extension side.
 * This copies used custom icons from global to workspace, and removes unused ones.
 *
 * @param usedIcons - Array of custom icon names currently used by nodes
 */
export function sendIconReconcile(usedIcons: string[]): void {
  getClabUiHost().topoViewer.reconcileIcons(usedIcons);
}

/**
 * Request cancellation of the currently running lab lifecycle command.
 */
export function sendCancelLabLifecycle(): void {
  getClabUiHost().topoViewer.cancelLifecycle();
}
