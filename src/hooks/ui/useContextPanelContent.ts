/**
 * useContextPanelContent - Determines what the ContextPanel should display
 * based on selection/editing state from stores.
 *
 * Priority: editing states > selection states > palette (default)
 */
import { shallow } from "zustand/shallow";

import { useTopoViewerStore } from "../../stores/topoViewerStore";
import type { TopoViewerState } from "../../stores/topoViewerStore";
import { useAnnotationUIStore } from "../../stores/annotationUIStore";
import type { AnnotationUIState } from "../../stores/annotationUIStore";

type PanelViewKind =
  | "palette"
  | "nodeInfo"
  | "linkInfo"
  | "nodeEditor"
  | "linkEditor"
  | "networkEditor"
  | "linkImpairment"
  | "freeTextEditor"
  | "freeShapeEditor"
  | "trafficRateEditor"
  | "groupEditor";

export interface PanelView {
  kind: PanelViewKind;
  title: string;
  /** Whether the view has editor footer (Apply button) */
  hasFooter: boolean;
}

const PALETTE_VIEW: PanelView = { kind: "palette", title: "Palette", hasFooter: false };

function hasId(value: string | null): value is string {
  return value !== null && value.length > 0;
}

function resolveEditingView(
  state: Pick<
    TopoViewerState,
    "editingNode" | "editingEdge" | "editingNetwork" | "editingImpairment"
  >
): PanelView | null {
  if (hasId(state.editingNode))
    return { kind: "nodeEditor", title: "Node Editor", hasFooter: true };
  if (hasId(state.editingEdge))
    return { kind: "linkEditor", title: "Link Editor", hasFooter: true };
  if (hasId(state.editingNetwork))
    return { kind: "networkEditor", title: "Network Editor", hasFooter: true };
  if (hasId(state.editingImpairment))
    return { kind: "linkImpairment", title: "Link Impairments", hasFooter: true };
  return null;
}

type AnnotationEditingSlice = Pick<
  AnnotationUIState,
  | "editingTextAnnotation"
  | "editingShapeAnnotation"
  | "editingTrafficRateAnnotation"
  | "editingGroup"
>;

function resolveAnnotationView(annotationUI: AnnotationEditingSlice): PanelView | null {
  if (annotationUI.editingTextAnnotation) {
    const isNew = annotationUI.editingTextAnnotation.text === "";
    return { kind: "freeTextEditor", title: isNew ? "Add Text" : "Edit Text", hasFooter: true };
  }
  if (annotationUI.editingShapeAnnotation) {
    const shapeType = annotationUI.editingShapeAnnotation.shapeType;
    const prefix = shapeType.charAt(0).toUpperCase() + shapeType.slice(1);
    return { kind: "freeShapeEditor", title: `Edit ${prefix}`, hasFooter: true };
  }
  if (annotationUI.editingTrafficRateAnnotation) {
    return { kind: "trafficRateEditor", title: "Edit Traffic Rate", hasFooter: true };
  }
  if (annotationUI.editingGroup)
    return { kind: "groupEditor", title: "Edit Group", hasFooter: true };
  return null;
}

function resolveSelectionView(
  state: Pick<TopoViewerState, "selectedNode" | "selectedEdge" | "mode" | "deploymentState">
): PanelView | null {
  // Info panels show runtime properties, so they follow the deployment state
  // (read-only view mode keeps them too, even when the state is unknown).
  const showInfoOnSelect = state.deploymentState === "deployed" || state.mode === "view";
  if (hasId(state.selectedNode) && showInfoOnSelect)
    return { kind: "nodeInfo", title: "Node Properties", hasFooter: false };
  if (hasId(state.selectedEdge) && showInfoOnSelect)
    return { kind: "linkInfo", title: "Link Properties", hasFooter: false };
  return null;
}

type ContextPanelStateSlice = Pick<
  TopoViewerState,
  | "editingNode"
  | "editingEdge"
  | "editingNetwork"
  | "editingImpairment"
  | "selectedNode"
  | "selectedEdge"
  | "mode"
  | "deploymentState"
>;

// Subscribe only to the fields the panel view depends on so unrelated store
// updates (selection sets, telemetry, lifecycle logs, ...) don't re-render consumers.
function selectContextPanelState(state: TopoViewerState): ContextPanelStateSlice {
  return {
    editingNode: state.editingNode,
    editingEdge: state.editingEdge,
    editingNetwork: state.editingNetwork,
    editingImpairment: state.editingImpairment,
    selectedNode: state.selectedNode,
    selectedEdge: state.selectedEdge,
    mode: state.mode,
    deploymentState: state.deploymentState
  };
}

function selectAnnotationEditingState(state: AnnotationUIState): AnnotationEditingSlice {
  return {
    editingTextAnnotation: state.editingTextAnnotation,
    editingShapeAnnotation: state.editingShapeAnnotation,
    editingTrafficRateAnnotation: state.editingTrafficRateAnnotation,
    editingGroup: state.editingGroup
  };
}

export function useContextPanelContent(): PanelView {
  const state = useTopoViewerStore(selectContextPanelState, shallow);
  const annotationUI = useAnnotationUIStore(selectAnnotationEditingState, shallow);

  return (
    resolveEditingView(state) ??
    resolveAnnotationView(annotationUI) ??
    resolveSelectionView(state) ??
    PALETTE_VIEW
  );
}
