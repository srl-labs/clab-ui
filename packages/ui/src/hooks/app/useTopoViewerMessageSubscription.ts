/**
 * useTopoViewerMessageSubscription - TopoViewer host event subscription hook
 */
import { useEffect } from "react";

import type { CustomNodeTemplate } from "../../core/types/editors";
import type { CustomIconInfo } from "../../core/types/icons";
import { type ClabUiTopoViewerEvent, useClabUiHost } from "../../host";
import { useCanvasStore } from "../../stores/canvasStore";
import { useTopoViewerStore, type DeploymentState } from "../../stores/topoViewerStore";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isDeploymentState(value: unknown): value is DeploymentState {
  return value === "deployed" || value === "undeployed" || value === "unknown";
}

function isCustomNodeTemplate(value: unknown): value is CustomNodeTemplate {
  return isRecord(value) && isNonEmptyString(value.name) && isNonEmptyString(value.kind);
}

function isCustomIconInfo(value: unknown): value is CustomIconInfo {
  return (
    isRecord(value) &&
    isNonEmptyString(value.name) &&
    (value.source === "workspace" || value.source === "global") &&
    isNonEmptyString(value.dataUri) &&
    (value.format === "svg" || value.format === "png")
  );
}

function handleTopoModeChanged(
  event: Extract<ClabUiTopoViewerEvent, { type: "modeChanged" }>
): void {
  const { setMode, setDeploymentState } = useTopoViewerStore.getState();
  setMode(event.mode === "viewer" ? "view" : "edit");
  if (isDeploymentState(event.deploymentState)) {
    setDeploymentState(event.deploymentState);
  }
}

function handlePanelAction(
  event: Extract<ClabUiTopoViewerEvent, { type: "panelAction" }>
): void {
  const { selectNode, selectEdge, editNode, editEdge, isProcessing } =
    useTopoViewerStore.getState();
  if (isProcessing) return;

  const action = isNonEmptyString(event.action) ? event.action : undefined;
  const nodeId = isNonEmptyString(event.nodeId) ? event.nodeId : undefined;
  const edgeId = isNonEmptyString(event.edgeId) ? event.edgeId : undefined;
  if (action === undefined) return;

  switch (action) {
    case "edit-node":
      if (nodeId !== undefined) editNode(nodeId);
      return;
    case "edit-link":
      if (edgeId !== undefined) editEdge(edgeId);
      return;
    case "node-info":
      if (nodeId !== undefined) selectNode(nodeId);
      return;
    case "link-info":
      if (edgeId !== undefined) selectEdge(edgeId);
      return;
  }
}

function handleCustomNodesUpdated(
  event: Extract<ClabUiTopoViewerEvent, { type: "customNodesUpdated" }>
): void {
  const { setCustomNodes } = useTopoViewerStore.getState();
  setCustomNodes(event.customNodes.filter(isCustomNodeTemplate), event.defaultNode);
}

function handleCustomNodeError(
  event: Extract<ClabUiTopoViewerEvent, { type: "customNodeError" }>
): void {
  const { setCustomNodeError } = useTopoViewerStore.getState();
  if (isNonEmptyString(event.error)) {
    setCustomNodeError(event.error);
  }
}

function handleIconList(
  event: Extract<ClabUiTopoViewerEvent, { type: "iconList" }>
): void {
  const { setCustomIcons } = useTopoViewerStore.getState();
  setCustomIcons(event.icons.filter(isCustomIconInfo));
}

function handleLifecycleLog(
  event: Extract<ClabUiTopoViewerEvent, { type: "lifecycleLog" }>
): void {
  const { appendLifecycleLog, isProcessing } = useTopoViewerStore.getState();
  if (!isProcessing || !isNonEmptyString(event.line)) {
    return;
  }
  appendLifecycleLog(event.line, event.stream === "stderr" ? "stderr" : "stdout");
}

function handleLifecycleStatus(
  event: Extract<ClabUiTopoViewerEvent, { type: "lifecycleStatus" }>
): void {
  const { appendLifecycleLog, setLifecycleStatus, setProcessing } = useTopoViewerStore.getState();
  if (event.status === "error" && isNonEmptyString(event.errorMessage)) {
    appendLifecycleLog(`[error] ${event.errorMessage}`, "stderr");
    setLifecycleStatus("error", event.errorMessage);
  } else if (event.status === "error") {
    setLifecycleStatus("error", "Lifecycle command failed.");
  }
  if (event.status === "success") {
    appendLifecycleLog("Command completed successfully.", "stdout");
    setLifecycleStatus("success");
  }
  setProcessing(false);
}

function handleFitViewport(): void {
  const { requestFitView } = useCanvasStore.getState();
  requestFitView();
}

export function useTopoViewerMessageSubscription(): void {
  const host = useClabUiHost();

  useEffect(() => {
    return host.topoViewer.subscribe((event) => {
      switch (event.type) {
        case "modeChanged":
          handleTopoModeChanged(event);
          return;
        case "panelAction":
          handlePanelAction(event);
          return;
        case "customNodesUpdated":
          handleCustomNodesUpdated(event);
          return;
        case "customNodeError":
          handleCustomNodeError(event);
          return;
        case "iconList":
          handleIconList(event);
          return;
        case "lifecycleLog":
          handleLifecycleLog(event);
          return;
        case "lifecycleStatus":
          handleLifecycleStatus(event);
          return;
        case "fitViewport":
          handleFitViewport();
          return;
        case "svgExportResult":
          return;
      }
    });
  }, [host]);
}
