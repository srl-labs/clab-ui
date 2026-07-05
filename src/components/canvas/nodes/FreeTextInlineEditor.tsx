/* eslint-disable import-x/max-dependencies */
/**
 * FreeTextInlineEditor - In-place editor for text annotations on the canvas.
 *
 * Renders a textarea styled like the annotation plus a floating formatting
 * toolbar. Commits on blur / Escape / Ctrl+Enter; an empty commit deletes the
 * annotation. Style changes apply live through the annotation handlers.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { NodeToolbar, Position } from "@xyflow/react";
import FormatAlignCenterIcon from "@mui/icons-material/FormatAlignCenter";
import FormatAlignLeftIcon from "@mui/icons-material/FormatAlignLeft";
import FormatAlignRightIcon from "@mui/icons-material/FormatAlignRight";
import FormatBoldIcon from "@mui/icons-material/FormatBold";
import FormatItalicIcon from "@mui/icons-material/FormatItalic";
import FormatUnderlinedIcon from "@mui/icons-material/FormatUnderlined";
import TuneIcon from "@mui/icons-material/Tune";
import Divider from "@mui/material/Divider";
import MuiIconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";

import type { FreeTextAnnotation } from "../../../core/types/topology";
import type { FreeTextNodeData } from "../types";

interface FreeTextInlineEditorProps {
  nodeId: string;
  data: FreeTextNodeData;
  /** Style of the rendered annotation text, reused for WYSIWYG editing */
  textStyle: React.CSSProperties;
  onCommit: (text: string) => void;
  onStyleChange?: (style: Partial<FreeTextAnnotation>) => void;
  onOpenStyleEditor?: (text: string) => void;
}

const ToolbarButton: React.FC<{
  active?: boolean;
  title: string;
  testId?: string;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active = false, title, testId, onClick, children }) => (
  <Tooltip title={title}>
    <MuiIconButton
      size="small"
      data-testid={testId}
      onClick={onClick}
      // Keep focus in the textarea so toolbar clicks don't commit the edit.
      onMouseDown={(e) => e.preventDefault()}
      sx={{
        borderRadius: 0.5,
        color: active ? "primary.contrastText" : "text.primary",
        bgcolor: active ? "primary.main" : "transparent",
        "&:hover": { bgcolor: active ? "primary.dark" : "action.hover" }
      }}
    >
      {children}
    </MuiIconButton>
  </Tooltip>
);

function buildTextareaStyle(
  textStyle: React.CSSProperties,
  data: FreeTextNodeData
): React.CSSProperties {
  const hasFixedWidth = typeof data.width === "number" && Number.isFinite(data.width);
  const hasFixedHeight = typeof data.height === "number" && Number.isFinite(data.height);
  return {
    ...textStyle,
    display: "block",
    boxSizing: "border-box",
    border: "none",
    outline: "none",
    margin: 0,
    resize: "none",
    overflow: "hidden",
    backgroundColor:
      typeof textStyle.backgroundColor === "string" && textStyle.backgroundColor.length > 0
        ? textStyle.backgroundColor
        : "transparent",
    caretColor: typeof textStyle.color === "string" ? textStyle.color : undefined,
    width: hasFixedWidth ? "100%" : "auto",
    height: hasFixedHeight ? "100%" : "auto",
    minWidth: hasFixedWidth ? undefined : 160,
    minHeight: hasFixedHeight ? undefined : 24,
    // Auto-grow with content where supported (Chromium); the resize effect
    // below covers the height for other engines.
    fieldSizing: "content"
  } as React.CSSProperties;
}

export const FreeTextInlineEditor: React.FC<FreeTextInlineEditorProps> = ({
  nodeId,
  data,
  textStyle,
  onCommit,
  onStyleChange,
  onOpenStyleEditor
}) => {
  const [text, setText] = useState(data.text);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const committedRef = useRef(false);
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  // Height auto-grow fallback for engines without field-sizing support.
  const hasFixedHeight = typeof data.height === "number" && Number.isFinite(data.height);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el || hasFixedHeight) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text, hasFixedHeight]);

  const commit = useCallback(() => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit(textRef.current);
  }, [onCommit]);

  const isInsideEditor = useCallback((target: EventTarget | null): boolean => {
    if (!(target instanceof Node)) return false;
    return (
      textareaRef.current?.contains(target) === true ||
      toolbarRef.current?.contains(target) === true
    );
  }, []);

  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
      if (isInsideEditor(e.relatedTarget)) return;
      commit();
    },
    [isInsideEditor, commit]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Keep app/canvas shortcuts (delete node, deselect, ...) out of typing.
      e.stopPropagation();
      if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        commit();
      }
    },
    [commit]
  );

  const stopMouseEvent = useCallback((e: React.MouseEvent) => {
    // A click inside the editor must not bubble into React Flow's node click
    // handlers (selection changes, opening the panel editor, ...).
    e.stopPropagation();
  }, []);

  const isBold = data.fontWeight === "bold";
  const isItalic = data.fontStyle === "italic";
  const isUnderline = data.textDecoration === "underline";
  const align = data.textAlign ?? "left";
  const fontSize = data.fontSize ?? 14;

  const changeFontSize = useCallback(
    (delta: number) => {
      const current = typeof data.fontSize === "number" ? data.fontSize : 14;
      const next = Math.min(72, Math.max(1, current + delta));
      if (next !== current) onStyleChange?.({ fontSize: next });
    },
    [data.fontSize, onStyleChange]
  );

  return (
    <>
      <NodeToolbar
        nodeId={nodeId}
        isVisible
        position={Position.Top}
        offset={10}
        className="nodrag nopan"
      >
        <Paper
          ref={toolbarRef}
          elevation={4}
          data-testid="free-text-inline-toolbar"
          onKeyDown={handleKeyDown}
          sx={{ display: "flex", alignItems: "center", gap: 0.25, p: 0.25 }}
        >
          <ToolbarButton
            title="Bold"
            testId="inline-text-bold"
            active={isBold}
            onClick={() => onStyleChange?.({ fontWeight: isBold ? "normal" : "bold" })}
          >
            <FormatBoldIcon fontSize="small" />
          </ToolbarButton>
          <ToolbarButton
            title="Italic"
            testId="inline-text-italic"
            active={isItalic}
            onClick={() => onStyleChange?.({ fontStyle: isItalic ? "normal" : "italic" })}
          >
            <FormatItalicIcon fontSize="small" />
          </ToolbarButton>
          <ToolbarButton
            title="Underline"
            active={isUnderline}
            onClick={() =>
              onStyleChange?.({ textDecoration: isUnderline ? "none" : "underline" })
            }
          >
            <FormatUnderlinedIcon fontSize="small" />
          </ToolbarButton>
          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
          <ToolbarButton
            title="Align Left"
            active={align === "left"}
            onClick={() => onStyleChange?.({ textAlign: "left" })}
          >
            <FormatAlignLeftIcon fontSize="small" />
          </ToolbarButton>
          <ToolbarButton
            title="Align Center"
            active={align === "center"}
            onClick={() => onStyleChange?.({ textAlign: "center" })}
          >
            <FormatAlignCenterIcon fontSize="small" />
          </ToolbarButton>
          <ToolbarButton
            title="Align Right"
            active={align === "right"}
            onClick={() => onStyleChange?.({ textAlign: "right" })}
          >
            <FormatAlignRightIcon fontSize="small" />
          </ToolbarButton>
          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
          <ToolbarButton title="Smaller text" onClick={() => changeFontSize(-1)}>
            <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1 }}>A−</span>
          </ToolbarButton>
          <ToolbarButton title="Larger text" onClick={() => changeFontSize(1)}>
            <span style={{ fontSize: 15, fontWeight: 600, lineHeight: 1 }}>A+</span>
          </ToolbarButton>
          <span
            style={{ fontSize: 11, opacity: 0.7, minWidth: 26, textAlign: "center" }}
            data-testid="inline-text-font-size"
          >
            {fontSize}
          </span>
          {onOpenStyleEditor && (
            <>
              <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
              <ToolbarButton
                title="More styling options…"
                testId="inline-text-more"
                onClick={() => {
                  // The style editor takes over; suppress the blur commit.
                  committedRef.current = true;
                  onOpenStyleEditor(textRef.current);
                }}
              >
                <TuneIcon fontSize="small" />
              </ToolbarButton>
            </>
          )}
        </Paper>
      </NodeToolbar>
      <textarea
        ref={textareaRef}
        className="nodrag nowheel nopan free-text-inline-textarea"
        data-testid="free-text-inline-input"
        value={text}
        placeholder="Type text… (Markdown supported)"
        style={buildTextareaStyle(textStyle, data)}
        onChange={(e) => setText(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onClick={stopMouseEvent}
        onDoubleClick={stopMouseEvent}
        onContextMenu={stopMouseEvent}
      />
    </>
  );
};
