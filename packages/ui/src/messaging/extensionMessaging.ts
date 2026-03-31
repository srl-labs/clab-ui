/**
 * TopoViewer host action helpers.
 * UI code talks in semantic intents; the configured host translates them to
 * VS Code commands, standalone backend calls, or no-ops as appropriate.
 */
import React from "react";

import type { SaveCustomNodeData } from "../core/utilities/customNodeConversions";
import { type ClabUiHost, useClabUiHost } from "../host";

export interface ClabUiExtensionMessaging {
  sendCancelLabLifecycle(): void;
  sendDeleteCustomNode(nodeName: string): void;
  sendDeleteIcon(iconName: string): void;
  sendDumpCssVars(vars: Record<string, string>): void;
  sendGrafanaBundleExport(payload: {
    requestId: string;
    baseName: string;
    svgContent: string;
    dashboardJson: string;
    panelYaml: string;
  }): void;
  sendIconReconcile(usedIcons: string[]): void;
  sendInterfaceCapture(nodeName: string, interfaceName: string): void;
  sendLifecycleCommand(
    action:
      | "deployLab"
      | "deployLabCleanup"
      | "destroyLab"
      | "destroyLabCleanup"
      | "redeployLab"
      | "redeployLabCleanup"
  ): void;
  sendLinkImpairment(nodeName: string, interfaceName: string, data: unknown): void;
  sendNodeAction(action: "ssh" | "shell" | "logs", nodeName: string): void;
  sendRequestIconList(): void;
  sendSaveCustomNode(data: SaveCustomNodeData): void;
  sendSetDefaultCustomNode(nodeName: string): void;
  sendToggleSplitView(): void;
  sendUploadIcon(): void;
}

export function createExtensionMessaging(host: ClabUiHost): ClabUiExtensionMessaging {
  return {
    sendLifecycleCommand(action) {
      host.topoViewer.runLifecycle(action);
    },
    sendToggleSplitView() {
      host.topoViewer.toggleSplitView();
    },
    sendNodeAction(action, nodeName) {
      host.topoViewer.runNodeAction(action, nodeName);
    },
    sendInterfaceCapture(nodeName, interfaceName) {
      host.topoViewer.captureInterface(nodeName, interfaceName);
    },
    sendLinkImpairment(nodeName, interfaceName, data) {
      host.topoViewer.setLinkImpairment(nodeName, interfaceName, data);
    },
    sendRequestIconList() {
      host.topoViewer.requestIconList();
    },
    sendUploadIcon() {
      host.topoViewer.uploadIcon();
    },
    sendDeleteIcon(iconName) {
      host.topoViewer.deleteIcon(iconName);
    },
    sendGrafanaBundleExport(payload) {
      host.topoViewer.exportGrafanaBundle(payload);
    },
    sendDumpCssVars(vars) {
      host.topoViewer.dumpCssVars(vars);
    },
    sendDeleteCustomNode(nodeName) {
      host.topoViewer.deleteCustomNode(nodeName);
    },
    sendSetDefaultCustomNode(nodeName) {
      host.topoViewer.setDefaultCustomNode(nodeName);
    },
    sendSaveCustomNode(data) {
      host.topoViewer.saveCustomNode(data as Record<string, unknown>);
    },
    sendIconReconcile(usedIcons) {
      host.topoViewer.reconcileIcons(usedIcons);
    },
    sendCancelLabLifecycle() {
      host.topoViewer.cancelLifecycle();
    }
  };
}

export function useExtensionMessaging(): ClabUiExtensionMessaging {
  const host = useClabUiHost();
  return React.useMemo(() => createExtensionMessaging(host), [host]);
}
