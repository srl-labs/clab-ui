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
import { useTopoViewerStore } from "../../stores/topoViewerStore";
import { useAnnotationUIStore } from "../../stores/annotationUIStore";

import { useContextPanelContent } from "./useContextPanelContent";

export interface PanelTabVisibility {
  showInfoTab: boolean;
  showEditTab: boolean;
  infoTabTitle?: string;
  editTabTitle?: string;
}

export function usePanelTabVisibility(): PanelTabVisibility {
  const panelView = useContextPanelContent();

  // Subscribe to derived booleans so unrelated store updates don't re-render consumers.
  const hasTopoEditor = useTopoViewerStore(
    (state) =>
      state.editingNode !== null ||
      state.editingEdge !== null ||
      state.editingNetwork !== null ||
      state.editingImpairment !== null
  );
  const hasAnnotationEditor = useAnnotationUIStore(
    (state) =>
      state.editingTextAnnotation !== null ||
      state.editingShapeAnnotation !== null ||
      state.editingTrafficRateAnnotation !== null ||
      state.editingGroup !== null
  );
  const isLocked = useTopoViewerStore((state) => state.isLocked);
  const hasSelectedNode = useTopoViewerStore((state) => state.selectedNode !== null);

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
  const hasEditor = hasTopoEditor || hasAnnotationEditor;

  // When unlocked, selected topology nodes can open a visual-only editor tab.
  const canEditSelectedNode = isLocked === false && panelView.kind === "nodeInfo" && hasSelectedNode;
  const showEditTab = hasEditor || canEditSelectedNode;

  let editTabTitle: string | undefined;
  if (hasEditor) {
    editTabTitle = panelView.title;
  } else if (canEditSelectedNode) {
    editTabTitle = "Node Editor";
  }

  return { showInfoTab, showEditTab, infoTabTitle, editTabTitle };
}
