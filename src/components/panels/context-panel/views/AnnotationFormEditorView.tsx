// Generic annotation editor view shared by the text and shape annotation editors.
import React from "react";
import Box from "@mui/material/Box";

import { useGenericFormState, useEditorHandlersWithFooterRef } from "../../../../hooks/editor";
import { FIELDSET_RESET_STYLE } from "../ContextPanelScrollArea";

import { useAnnotationPreviewCommit } from "./useAnnotationPreviewCommit";

interface AnnotationEditorFooterRef {
  handleApply: () => void;
  handleSave: () => void;
  handleDiscard: () => void;
  hasChanges: boolean;
}

/** External props shared by all annotation form editor views. */
export interface AnnotationEditorViewProps<T extends { id: string }> {
  annotation: T | null;
  onSave: (annotation: T) => void;
  /** Live-preview changes on the canvas (visual only, no persist) */
  onPreview?: (annotation: T) => boolean;
  /** Remove preview-only annotation (used when discarding a new annotation). */
  onPreviewDelete?: (id: string) => void;
  onClose: () => void;
  onDelete?: (id: string) => void;
  /** Disable editing, but keep scrolling available */
  readOnly?: boolean;
  onFooterRef?: (ref: AnnotationEditorFooterRef | null) => void;
}

interface AnnotationFormContentProps<T> {
  formData: T;
  updateField: <K extends keyof T>(field: K, value: T[K]) => void;
}

interface AnnotationFormEditorViewProps<T extends { id: string }>
  extends AnnotationEditorViewProps<T> {
  /** Form body rendered inside the read-only-aware fieldset */
  FormContent: React.ComponentType<AnnotationFormContentProps<T>>;
  /** Snapshot used by preview commit/revert (clone or normalize). Must be referentially stable. */
  snapshot: (annotation: T) => T;
  /** Validation gate for save/apply and footer hasChanges. Must be referentially stable. */
  canSave?: (data: T) => boolean;
  /** Detect a freshly created annotation. Must be referentially stable. */
  getIsNew?: (annotation: T | null) => boolean;
  /** Transform data before populating the form. Must be referentially stable. */
  transformData?: (data: T) => T;
}

export function AnnotationFormEditorView<T extends { id: string }>({
  annotation,
  onSave,
  onPreview,
  onPreviewDelete,
  onClose,
  onDelete,
  readOnly = false,
  onFooterRef,
  FormContent,
  snapshot,
  canSave,
  getIsNew,
  transformData
}: AnnotationFormEditorViewProps<T>): React.ReactElement | null {
  const { formData, updateField, hasChanges, resetInitialData, discardChanges } =
    useGenericFormState(annotation, { getIsNew, transformData });

  const { saveWithCommit, discardWithRevert } = useAnnotationPreviewCommit({
    annotation,
    formData,
    readOnly,
    onPreview,
    onPreviewDelete,
    onSave,
    discardChanges,
    snapshot
  });

  const canSaveNow = formData && canSave ? canSave(formData) : true;
  useEditorHandlersWithFooterRef({
    formData,
    onSave: saveWithCommit,
    onClose,
    onDelete,
    resetInitialData,
    discardChanges: discardWithRevert,
    onFooterRef,
    canSave,
    hasChangesForFooter: hasChanges && canSaveNow
  });

  if (!formData) return null;

  const effectiveUpdateField: typeof updateField = readOnly ? () => {} : updateField;

  return (
    <Box sx={{ flex: 1, overflow: "auto" }}>
      <fieldset disabled={readOnly} style={FIELDSET_RESET_STYLE}>
        <FormContent formData={formData} updateField={effectiveUpdateField} />
      </fieldset>
    </Box>
  );
}
