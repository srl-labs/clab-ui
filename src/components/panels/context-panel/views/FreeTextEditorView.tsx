// Text annotation editor for the ContextPanel.
import React from "react";

import type { FreeTextAnnotation } from "../../../../core/types/topology";
import { FreeTextFormContent } from "../../free-text-editor/FreeTextFormContent";

import { AnnotationFormEditorView, type AnnotationEditorViewProps } from "./AnnotationFormEditorView";

export type FreeTextEditorViewProps = AnnotationEditorViewProps<FreeTextAnnotation>;

function canSave(data: FreeTextAnnotation): boolean {
  return data.text.trim().length > 0;
}

function getIsNew(annotation: FreeTextAnnotation | null): boolean {
  return annotation?.text === "";
}

function cloneAnnotation(annotation: FreeTextAnnotation): FreeTextAnnotation {
  return { ...annotation };
}

export const FreeTextEditorView: React.FC<FreeTextEditorViewProps> = (props) => (
  <AnnotationFormEditorView
    {...props}
    FormContent={FreeTextFormContent}
    snapshot={cloneAnnotation}
    canSave={canSave}
    getIsNew={getIsNew}
  />
);
