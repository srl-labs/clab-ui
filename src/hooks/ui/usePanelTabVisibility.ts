/**
 * usePanelTabVisibility - Centralizes mode-based tab visibility rules.
 *
 * Rules:
 * - Info tab: visible when node/link selection resolves to an info view
 *   (deployed labs and read-only view mode).
 * - Edit tab: visible when an editor is active in any mode.
 * - Extra behavior: for unlocked selected nodes, also show Edit tab so
 *   icon/label/direction can be adjusted while running.
 */
import { useTopoViewerState } from "../../stores";
import { useAnnotationUIStore } from "../../stores/annotationUIStore";

import { useContextPanelContent } from "./useContextPanelContent";

export interface PanelTabVisibility {
  showInfoTab: boolean;
  showEditTab: boolean;
  infoTabTitle?: string;
  editTabTitle?: string;
}

export function usePanelTabVisibility(): PanelTabVisibility {
  const state = useTopoViewerState();
  const panelView = useContextPanelContent();
  const annotationUI = useAnnotationUIStore();

  // Info tab: when node or link selection resolves to an info view
  // (useContextPanelContent gates that on deployment/read-only state).
  const showInfoTab = panelView.kind === "nodeInfo" || panelView.kind === "linkInfo";
  let infoTabTitle: string | undefined;
  if (panelView.kind === "nodeInfo") {
    infoTabTitle = "Node Properties";
  } else if (panelView.kind === "linkInfo") {
    infoTabTitle = "Link Properties";
  }

  // Edit tab: visible whenever an editor is active (any mode).
  // Some editors are view-mode features (Link Impairments, annotation editing).
  const hasEditor = [
    state.editingNode,
    state.editingEdge,
    state.editingNetwork,
    state.editingImpairment,
    annotationUI.editingTextAnnotation,
    annotationUI.editingShapeAnnotation,
    annotationUI.editingTrafficRateAnnotation,
    annotationUI.editingGroup
  ].some((value) => value !== null);

  // When unlocked, selected topology nodes can open a visual-only editor tab.
  const canEditSelectedNode =
    state.isLocked === false && panelView.kind === "nodeInfo" && state.selectedNode !== null;
  const showEditTab = hasEditor || canEditSelectedNode;

  let editTabTitle: string | undefined;
  if (hasEditor) {
    editTabTitle = panelView.title;
  } else if (canEditSelectedNode) {
    editTabTitle = "Node Editor";
  }

  return { showInfoTab, showEditTab, infoTabTitle, editTabTitle };
}
