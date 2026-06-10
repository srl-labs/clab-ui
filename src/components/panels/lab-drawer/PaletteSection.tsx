// Node and annotation palette for the context panel.
import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import AddIcon from "@mui/icons-material/Add";
import CableIcon from "@mui/icons-material/Cable";
import CircleOutlinedIcon from "@mui/icons-material/CircleOutlined";
import ClearIcon from "@mui/icons-material/Clear";
import CropSquareIcon from "@mui/icons-material/CropSquare";
import DeleteIcon from "@mui/icons-material/Delete";
import DeviceHubIcon from "@mui/icons-material/DeviceHub";
import DnsIcon from "@mui/icons-material/Dns";
import EditIcon from "@mui/icons-material/Edit";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import FileUploadIcon from "@mui/icons-material/FileUpload";
import HubIcon from "@mui/icons-material/Hub";
import LanIcon from "@mui/icons-material/Lan";
import PowerIcon from "@mui/icons-material/Power";
import RemoveIcon from "@mui/icons-material/Remove";
import SaveIcon from "@mui/icons-material/Save";
import SearchIcon from "@mui/icons-material/Search";
import SelectAllIcon from "@mui/icons-material/SelectAll";
import SpeedIcon from "@mui/icons-material/Speed";
import StarIcon from "@mui/icons-material/Star";
import StarOutlineIcon from "@mui/icons-material/StarOutline";
import TextFieldsIcon from "@mui/icons-material/TextFields";
import {
  Box,
  Button,
  Card,
  Divider,
  IconButton,
  InputAdornment,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";

import type { CustomNodeTemplate } from "../../../core/types/editors";
import {
  NODE_TEMPLATES_EXPORT_FILENAME,
  serializeCustomNodeTemplates
} from "../../../core/utilities/customNodeImportExport";
import { ROLE_SVG_MAP, DEFAULT_ICON_COLOR } from "../../../core/types/graph";
import { generateEncodedSVG, type NodeType } from "../../../icons/SvgGenerator";
import {
  useCustomIcons,
  useCustomNodes,
  useTopoViewerStore
} from "../../../stores/topoViewerStore";
import { useTopologySessionClient } from "../../../host";
import { useExtensionMessaging } from "../../../messaging/extensionMessaging";
import { buildCustomIconMap } from "../../../utils/iconUtils";
import type { TabDefinition } from "../../ui/editor";
import { TabNavigation } from "../../ui/editor/TabNavigation";
import { IconPreview } from "../../ui/form";
import { executeTopologyCommand } from "../../../services/topologyHostCommands";
import clabSchema from "../../../../schema/clab.schema.json";
import { preloadMonacoCodeEditor } from "../../monaco/preloadMonacoCodeEditor";

interface PaletteSectionProps {
  mode?: "edit" | "view";
  isLocked?: boolean;
  requestedTab?: { tabId: string };
  onEditCustomNode?: (nodeName: string) => void;
  onDeleteCustomNode?: (nodeName: string) => void;
  onSetDefaultCustomNode?: (nodeName: string) => void;
  editTabContent?: React.ReactNode;
  showEditTab?: boolean;
  editTabTitle?: string;
  onEditDelete?: () => void;
  onEditTabLeave?: () => void;
  infoTabContent?: React.ReactNode;
  showInfoTab?: boolean;
  infoTabTitle?: string;
}

interface NetworkTypeDefinition {
  readonly type: string;
  readonly label: string;
  readonly icon: React.ReactNode;
}

const NETWORK_TYPE_DEFINITIONS: readonly NetworkTypeDefinition[] = [
  { type: "host", label: "Host", icon: <DnsIcon fontSize="small" /> },
  { type: "mgmt-net", label: "Mgmt Net", icon: <LanIcon fontSize="small" /> },
  { type: "macvlan", label: "Macvlan", icon: <CableIcon fontSize="small" /> },
  { type: "vxlan", label: "VXLAN", icon: <DeviceHubIcon fontSize="small" /> },
  { type: "vxlan-stitch", label: "VXLAN Stitch", icon: <CableIcon fontSize="small" /> },
  { type: "dummy", label: "Dummy", icon: <PowerIcon fontSize="small" /> },
  { type: "bridge", label: "Bridge", icon: <AccountTreeIcon fontSize="small" /> },
  { type: "ovs-bridge", label: "OVS Bridge", icon: <HubIcon fontSize="small" /> }
];

const VALID_NODE_TYPES: Record<NodeType, true> = {
  pe: true,
  dcgw: true,
  leaf: true,
  switch: true,
  spine: true,
  "super-spine": true,
  server: true,
  pon: true,
  controller: true,
  rgw: true,
  ue: true,
  cloud: true,
  client: true,
  bridge: true
};

function isNodeType(value: string): value is NodeType {
  return Object.prototype.hasOwnProperty.call(VALID_NODE_TYPES, value);
}

function getRoleSvgType(role: string): NodeType {
  if (Object.prototype.hasOwnProperty.call(ROLE_SVG_MAP, role)) {
    const mapped = ROLE_SVG_MAP[role];
    if (isNodeType(mapped)) return mapped;
  }
  return "pe";
}

function getTemplateIconUrl(
  template: CustomNodeTemplate,
  customIconMap: Map<string, string>
): string {
  const role = template.icon ?? "pe";
  const customDataUri = customIconMap.get(role);
  if (customDataUri !== undefined && customDataUri.length > 0) {
    return customDataUri;
  }
  const color = template.iconColor ?? DEFAULT_ICON_COLOR;
  const svgType = getRoleSvgType(role);
  return generateEncodedSVG(svgType, color);
}

function downloadNodeTemplates(templates: CustomNodeTemplate[]): void {
  const blob = new Blob([serializeCustomNodeTemplates(templates)], {
    type: "application/json;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = NODE_TEMPLATES_EXPORT_FILENAME;
  link.click();
  URL.revokeObjectURL(url);
}

const REACTFLOW_NODE_MIME_TYPE = "application/reactflow-node";
const ACTION_HOVER_BG = "action.hover";
const TEXT_SECONDARY = "text.secondary";
const MONACO_PRELOAD_DELAY_MS = 750;
const CANVAS_DRAG_FALLBACK_KEY = "__CLAB_UI_CANVAS_DRAG_DATA__";

type CanvasDragPayload = Record<string, unknown>;
type CanvasDragWindow = Window & {
  [CANVAS_DRAG_FALLBACK_KEY]?: {
    payload: CanvasDragPayload;
    timestamp: number;
  };
};

function isSourceTab(tabId: string): boolean {
  return tabId === "yaml" || tabId === "json";
}

const MonacoCodeEditor = React.lazy(preloadMonacoCodeEditor);

const SourceEditorTab: React.FC<{
  readOnly: boolean;
  error: string | null;
  language: "yaml" | "json";
  value: string;
  jsonSchema?: object;
  onChange: (next: string) => void;
}> = ({ readOnly, error, language, value, jsonSchema, onChange }) => (
  <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
    {error !== null && error.length > 0 && (
      <Typography variant="caption" color="error" sx={{ px: 2, py: 0.5 }}>
        {error}
      </Typography>
    )}
    <Box sx={{ flex: 1, minHeight: 0 }}>
      <Suspense
        fallback={
          <Box
            sx={{
              alignItems: "center",
              color: TEXT_SECONDARY,
              display: "flex",
              height: "100%",
              justifyContent: "center"
            }}
          >
            <Typography variant="caption">Loading editor...</Typography>
          </Box>
        }
      >
        <MonacoCodeEditor
          language={language}
          value={value}
          readOnly={readOnly}
          jsonSchema={jsonSchema}
          onChange={readOnly ? undefined : onChange}
        />
      </Suspense>
    </Box>
  </Box>
);

const PaletteDraggableCard: React.FC<{
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd?: () => void;
  children: React.ReactNode;
}> = ({ onDragStart, onDragEnd, children }) => (
  <Tooltip
    title="Drag to canvas"
    placement="top"
    enterDelay={500}
    slotProps={{ popper: { modifiers: [{ name: "offset", options: { offset: [-20, -20] } }] } }}
  >
    <Card
      variant="outlined"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      sx={{
        p: 1,
        cursor: "grab",
        display: "flex",
        alignItems: "center",
        gap: 1,
        "&:hover": { bgcolor: ACTION_HOVER_BG },
        "&:active": { cursor: "grabbing" }
      }}
    >
      {children}
    </Card>
  </Tooltip>
);

const SectionHeader: React.FC<{ title: string; action?: React.ReactNode }> = ({
  title,
  action
}) => (
  <>
    <Divider />
    <Box
      sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 2, py: 1 }}
    >
      <Typography variant="subtitle2">{title}</Typography>
      {action}
    </Box>
    <Divider />
  </>
);

type AnnotationPayload = {
  annotationType: "text" | "shape" | "group" | "traffic-rate";
  shapeType?: string;
};

function setCanvasDragPayload(event: React.DragEvent, payload: CanvasDragPayload): void {
  const serialized = JSON.stringify(payload);
  event.dataTransfer.setData(REACTFLOW_NODE_MIME_TYPE, serialized);
  event.dataTransfer.setData("text/plain", serialized);
  event.dataTransfer.effectAllowed = "move";
  (window as CanvasDragWindow)[CANVAS_DRAG_FALLBACK_KEY] = {
    payload,
    timestamp: Date.now()
  };
}

function clearCanvasDragPayload(): void {
  delete (window as CanvasDragWindow)[CANVAS_DRAG_FALLBACK_KEY];
}

interface DraggableNodeProps {
  template: CustomNodeTemplate;
  customIconMap: Map<string, string>;
  isDefault?: boolean;
  onEdit?: (name: string) => void;
  onDelete?: (name: string) => void;
  onSetDefault?: (name: string) => void;
}

const DraggableNode: React.FC<DraggableNodeProps> = ({
  template,
  customIconMap,
  isDefault,
  onEdit,
  onDelete,
  onSetDefault
}) => {
  const isDefaultNode = isDefault === true;
  const onDragStart = useCallback(
    (event: React.DragEvent) => {
      setCanvasDragPayload(event, {
        type: "node",
        templateName: template.name
      });
    },
    [template.name]
  );

  const iconUrl = useMemo(
    () => getTemplateIconUrl(template, customIconMap),
    [template, customIconMap]
  );

  return (
    <PaletteDraggableCard onDragStart={onDragStart} onDragEnd={clearCanvasDragPayload}>
      <Box sx={{ flexShrink: 0 }}>
        <IconPreview src={iconUrl} size={28} cornerRadius={template.iconCornerRadius} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          variant="body2"
          noWrap
          sx={{ fontWeight: (theme) => theme.typography.fontWeightMedium }}
        >
          {template.name}
        </Typography>
        <Typography variant="caption" color={TEXT_SECONDARY} noWrap>
          {template.kind}
        </Typography>
      </Box>
      <Box sx={{ display: "flex", gap: 0.25 }}>
        <Tooltip title={isDefaultNode ? "Default node" : "Set as default"}>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              if (!isDefaultNode) onSetDefault?.(template.name);
            }}
            sx={{ color: isDefaultNode ? "warning.main" : TEXT_SECONDARY }}
          >
            {isDefaultNode ? <StarIcon fontSize="small" /> : <StarOutlineIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Edit">
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onEdit?.(template.name);
            }}
          >
            <EditIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete">
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onDelete?.(template.name);
            }}
            sx={{ "&:hover": { color: "error.main" } }}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </PaletteDraggableCard>
  );
};

interface DraggableAnnotationProps {
  label: string;
  kind: string;
  icon: React.ReactNode;
  payload: AnnotationPayload;
}

interface PaletteSimpleDraggableProps {
  dragPayload: Record<string, unknown>;
  icon: React.ReactNode;
  label: string;
  subtitle: string;
}

const PaletteSimpleDraggable: React.FC<PaletteSimpleDraggableProps> = ({
  dragPayload,
  icon,
  label,
  subtitle
}) => {
  const onDragStart = useCallback(
    (event: React.DragEvent) => {
      setCanvasDragPayload(event, dragPayload);
    },
    [dragPayload]
  );

  return (
    <PaletteDraggableCard onDragStart={onDragStart} onDragEnd={clearCanvasDragPayload}>
      <Box sx={{ color: TEXT_SECONDARY }}>{icon}</Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          variant="body2"
          noWrap
          sx={{ fontWeight: (theme) => theme.typography.fontWeightMedium }}
        >
          {label}
        </Typography>
        <Typography variant="caption" color={TEXT_SECONDARY} noWrap>
          {subtitle}
        </Typography>
      </Box>
    </PaletteDraggableCard>
  );
};

const DraggableNetwork: React.FC<{ network: NetworkTypeDefinition }> = ({ network }) => (
  <PaletteSimpleDraggable
    dragPayload={{ type: "network", networkType: network.type }}
    icon={network.icon}
    label={network.label}
    subtitle={network.type}
  />
);

const DraggableAnnotation: React.FC<DraggableAnnotationProps> = ({
  label,
  kind,
  icon,
  payload
}) => (
  <PaletteSimpleDraggable
    dragPayload={{ type: "annotation", ...payload }}
    icon={icon}
    label={label}
    subtitle={kind}
  />
);

export const PALETTE_TABS: TabDefinition[] = [
  { id: "info", label: "Info" },
  { id: "edit", label: "Edit" },
  { id: "nodes", label: "Nodes" },
  { id: "annotations", label: "Annotations" },
  { id: "yaml", label: "YAML" },
  { id: "json", label: "JSON" }
];

/* eslint-disable complexity */
export const PaletteSection: React.FC<PaletteSectionProps> = ({
  mode = "edit",
  isLocked = false,
  requestedTab,
  onEditCustomNode,
  onDeleteCustomNode,
  onSetDefaultCustomNode,
  editTabContent,
  showEditTab = false,
  editTabTitle,
  onEditDelete,
  onEditTabLeave,
  infoTabContent,
  showInfoTab = false,
  infoTabTitle
}) => {
  const sessionClient = useTopologySessionClient();
  const customNodes = useCustomNodes();
  const customIcons = useCustomIcons();
  const defaultNode = useTopoViewerStore((state) => state.defaultNode);
  const yamlFileName = useTopoViewerStore((state) => state.yamlFileName);
  const annotationsFileName = useTopoViewerStore((state) => state.annotationsFileName);
  const yamlContent = useTopoViewerStore((state) => state.yamlContent);
  const annotationsContent = useTopoViewerStore((state) => state.annotationsContent);
  const [filter, setFilter] = useState("");
  const isViewMode = mode === "view";

  const visibleTabs = useMemo(
    () =>
      PALETTE_TABS.filter((t) => {
        if (t.id === "info" && !showInfoTab) return false;
        if (t.id === "edit" && !showEditTab) return false;
        return true;
      }),
    [showInfoTab, showEditTab]
  );

  const [userTab, setUserTab] = useState("nodes");

  useEffect(() => {
    const requestedTabId = requestedTab?.tabId;
    if (
      requestedTabId !== undefined &&
      requestedTabId.length > 0 &&
      visibleTabs.some((t) => t.id === requestedTabId)
    ) {
      setUserTab(requestedTabId);
    }
  }, [requestedTab, visibleTabs]);

  // Auto-switch when edit/info tab appears (one-time, not forced)
  useEffect(() => {
    if (showEditTab && !(isViewMode && showInfoTab)) setUserTab("edit");
  }, [showEditTab, isViewMode, showInfoTab]);

  useEffect(() => {
    if (showInfoTab && (isViewMode || !showEditTab)) setUserTab("info");
  }, [showInfoTab, showEditTab, isViewMode]);

  // Fall back to "nodes" when current tab is no longer visible
  useEffect(() => {
    if (visibleTabs.some((t) => t.id === userTab)) return;
    if (showEditTab) {
      setUserTab("edit");
      return;
    }
    if (showInfoTab) {
      setUserTab("info");
      return;
    }
    setUserTab("nodes");
  }, [visibleTabs, userTab, showEditTab, showInfoTab]);

  const activeTab = userTab;

  useEffect(() => {
    let idleCallbackId: number | null = null;
    const timerId = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === "function") {
        idleCallbackId = window.requestIdleCallback(
          () => {
            void preloadMonacoCodeEditor();
          },
          { timeout: 2500 }
        );
        return;
      }
      void preloadMonacoCodeEditor();
    }, MONACO_PRELOAD_DELAY_MS);

    return () => {
      window.clearTimeout(timerId);
      if (idleCallbackId !== null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleCallbackId);
      }
    };
  }, []);

  useEffect(() => {
    if (isSourceTab(activeTab)) {
      void preloadMonacoCodeEditor();
    }
  }, [activeTab]);

  const handleSourceTabIntent = useCallback((event: React.SyntheticEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const tabId = target.closest<HTMLElement>("[data-tab]")?.dataset.tab;
    if (tabId !== undefined && isSourceTab(tabId)) {
      void preloadMonacoCodeEditor();
    }
  }, []);

  const [yamlError, setYamlError] = useState<string | null>(null);
  const [annotationsError, setAnnotationsError] = useState<string | null>(null);
  const [yamlDraft, setYamlDraft] = useState<string>(yamlContent);
  const [annotationsDraft, setAnnotationsDraft] = useState<string>(annotationsContent);
  const [yamlDirty, setYamlDirty] = useState(false);
  const [annotationsDirty, setAnnotationsDirty] = useState(false);
  const isSourceReadOnly = isLocked;

  // Sync drafts with host unless user has local edits
  useEffect(() => {
    if (!yamlDirty) {
      setYamlDraft(yamlContent);
    }
  }, [yamlContent, yamlDirty]);

  useEffect(() => {
    if (!annotationsDirty) {
      setAnnotationsDraft(annotationsContent);
    }
  }, [annotationsContent, annotationsDirty]);

  useEffect(() => {
    setYamlDirty(false);
    setYamlError(null);
  }, [yamlFileName]);

  useEffect(() => {
    setAnnotationsDirty(false);
    setAnnotationsError(null);
  }, [annotationsFileName]);

  const filteredNodes = useMemo(() => {
    if (!filter) return customNodes;
    const search = filter.toLowerCase();
    return customNodes.filter((node) => {
      const nodeIcon = typeof node.icon === "string" ? node.icon : undefined;
      return (
        node.name.toLowerCase().includes(search) ||
        node.kind.toLowerCase().includes(search) ||
        (nodeIcon !== undefined && nodeIcon.toLowerCase().includes(search))
      );
    });
  }, [customNodes, filter]);
  const customIconMap = useMemo(() => buildCustomIconMap(customIcons), [customIcons]);

  const filteredNetworks = useMemo(() => {
    if (!filter) return NETWORK_TYPE_DEFINITIONS;
    const search = filter.toLowerCase();
    return NETWORK_TYPE_DEFINITIONS.filter(
      (net) => net.label.toLowerCase().includes(search) || net.type.toLowerCase().includes(search)
    );
  }, [filter]);

  const handleAddNewNode = useCallback(() => {
    onEditCustomNode?.("__new__");
  }, [onEditCustomNode]);

  const { sendImportCustomNodes } = useExtensionMessaging();

  const handleImportTemplates = useCallback(() => {
    sendImportCustomNodes();
  }, [sendImportCustomNodes]);

  const handleExportTemplates = useCallback(() => {
    downloadNodeTemplates(customNodes);
  }, [customNodes]);

  const drawerTitle = useMemo(() => {
    if (activeTab === "info") return infoTabTitle ?? "Properties";
    if (activeTab === "edit") return editTabTitle ?? "Editor";
    if (activeTab === "nodes" || activeTab === "annotations") return "Palette";
    if (activeTab === "yaml") return yamlFileName || "Topology";
    if (activeTab === "json") return annotationsFileName || "Annotations";
    return "";
  }, [activeTab, yamlFileName, annotationsFileName, editTabTitle, infoTabTitle]);

  const handleSaveYaml = useCallback(async () => {
    try {
      await executeTopologyCommand(
        { command: "setYamlContent", payload: { content: yamlDraft } },
        {},
        sessionClient
      );
      setYamlDirty(false);
      setYamlError(null);
    } catch (err) {
      setYamlError(err instanceof Error ? err.message : String(err));
    }
  }, [sessionClient, yamlDraft]);

  const handleSaveAnnotations = useCallback(async () => {
    try {
      await executeTopologyCommand(
        {
          command: "setAnnotationsContent",
          payload: { content: annotationsDraft }
        },
        {},
        sessionClient
      );
      setAnnotationsDirty(false);
      setAnnotationsError(null);
    } catch (err) {
      setAnnotationsError(err instanceof Error ? err.message : String(err));
    }
  }, [annotationsDraft, sessionClient]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2,
          height: 40,
          flexShrink: 0
        }}
      >
        <Typography
          variant="subtitle1"
          sx={{ fontWeight: (theme) => theme.typography.fontWeightBold }}
        >
          {drawerTitle}
        </Typography>
        {activeTab === "edit" && onEditDelete && (
          <IconButton size="small" onClick={onEditDelete} color="error" title="Delete">
            <DeleteIcon fontSize="small" />
          </IconButton>
        )}
        {activeTab === "yaml" && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.25 }}>
            {!isSourceReadOnly && (
              <IconButton
                size="small"
                onClick={() => {
                  handleSaveYaml().catch(() => undefined);
                }}
                disabled={!yamlDirty}
                title="Save"
              >
                <SaveIcon fontSize="small" />
              </IconButton>
            )}
          </Box>
        )}
        {activeTab === "json" && !isSourceReadOnly && (
          <IconButton
            size="small"
            onClick={() => {
              handleSaveAnnotations().catch(() => undefined);
            }}
            disabled={!annotationsDirty}
            title="Save"
          >
            <SaveIcon fontSize="small" />
          </IconButton>
        )}
      </Box>
      <Divider />
      <Box onPointerOver={handleSourceTabIntent} onFocusCapture={handleSourceTabIntent}>
        <TabNavigation
          tabs={visibleTabs}
          activeTab={activeTab}
          onTabChange={(id) => {
            if (isSourceTab(id)) {
              void preloadMonacoCodeEditor();
            }
            if (activeTab === "edit" && id !== "edit") {
              onEditTabLeave?.();
            }
            setUserTab(id);
          }}
        />
      </Box>
      {(activeTab === "nodes" || activeTab === "annotations") && (
        <Box sx={{ flex: 1, overflow: "auto", minHeight: 0 }}>
          {activeTab === "nodes" && (
            <Box
              sx={{
                ...(isLocked || isViewMode ? { pointerEvents: "none", opacity: 0.6 } : undefined)
              }}
            >
              <Box sx={{ p: 2 }}>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Search nodes..."
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchIcon fontSize="small" />
                        </InputAdornment>
                      ),
                      endAdornment: filter ? (
                        <InputAdornment position="end">
                          <IconButton size="small" onClick={() => setFilter("")}>
                            <ClearIcon fontSize="small" />
                          </IconButton>
                        </InputAdornment>
                      ) : undefined
                    }
                  }}
                />
              </Box>

              <SectionHeader
                title="Node Templates"
                action={
                  !filter ? (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.25 }}>
                      <Tooltip title="Import templates">
                        <IconButton
                          size="small"
                          onClick={handleImportTemplates}
                          data-testid="palette-import-templates"
                        >
                          <FileUploadIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Export templates">
                        <span>
                          <IconButton
                            size="small"
                            onClick={handleExportTemplates}
                            disabled={customNodes.length === 0}
                            data-testid="palette-export-templates"
                          >
                            <FileDownloadIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Button
                        variant="text"
                        size="small"
                        startIcon={<AddIcon />}
                        onClick={handleAddNewNode}
                        sx={{ py: 0 }}
                      >
                        Add
                      </Button>
                    </Box>
                  ) : undefined
                }
              />
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1, p: 2 }}>
                {filteredNodes.length === 0 && (
                  <Typography variant="body2" color={TEXT_SECONDARY}>
                    {filter ? "No matching templates" : "No node templates defined"}
                  </Typography>
                )}
                {filteredNodes.map((template) => (
                  <DraggableNode
                    key={template.name}
                    template={template}
                    customIconMap={customIconMap}
                    isDefault={template.name === defaultNode || template.setDefault}
                    onEdit={onEditCustomNode}
                    onDelete={onDeleteCustomNode}
                    onSetDefault={onSetDefaultCustomNode}
                  />
                ))}
              </Box>

              <SectionHeader title="Networks" />
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, p: 2 }}>
                {filteredNetworks.length === 0 ? (
                  <Typography variant="body2" color={TEXT_SECONDARY}>
                    No matching networks
                  </Typography>
                ) : (
                  filteredNetworks.map((network) => (
                    <DraggableNetwork key={network.type} network={network} />
                  ))
                )}
              </Box>
            </Box>
          )}

          {activeTab === "annotations" && (
            <Box sx={{ ...(isLocked ? { pointerEvents: "none" } : undefined) }}>
              <SectionHeader title="Text" />
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1, p: 2 }}>
                <DraggableAnnotation
                  label="Text"
                  kind="annotation"
                  icon={<TextFieldsIcon fontSize="small" />}
                  payload={{ annotationType: "text" }}
                />
              </Box>

              <SectionHeader title="Shapes" />
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1, p: 2 }}>
                <DraggableAnnotation
                  label="Rectangle"
                  kind="shape"
                  icon={<CropSquareIcon fontSize="small" />}
                  payload={{ annotationType: "shape", shapeType: "rectangle" }}
                />
                <DraggableAnnotation
                  label="Circle"
                  kind="shape"
                  icon={<CircleOutlinedIcon fontSize="small" />}
                  payload={{ annotationType: "shape", shapeType: "circle" }}
                />
                <DraggableAnnotation
                  label="Line"
                  kind="shape"
                  icon={<RemoveIcon fontSize="small" />}
                  payload={{ annotationType: "shape", shapeType: "line" }}
                />
              </Box>

              <SectionHeader title="Groups" />
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1, p: 2 }}>
                <DraggableAnnotation
                  label="Group"
                  kind="annotation"
                  icon={<SelectAllIcon fontSize="small" />}
                  payload={{ annotationType: "group" }}
                />
              </Box>

              <SectionHeader title="Monitoring" />
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1, p: 2 }}>
                <DraggableAnnotation
                  label="Traffic Rate"
                  kind="monitor"
                  icon={<SpeedIcon fontSize="small" />}
                  payload={{ annotationType: "traffic-rate" }}
                />
              </Box>
            </Box>
          )}
        </Box>
      )}

      {activeTab === "yaml" && (
        <SourceEditorTab
          readOnly={isSourceReadOnly}
          error={yamlError}
          language="yaml"
          value={yamlDraft}
          jsonSchema={clabSchema}
          onChange={(next) => {
            setYamlDraft(next);
            setYamlDirty(true);
          }}
        />
      )}

      {activeTab === "json" && (
        <SourceEditorTab
          readOnly={isSourceReadOnly}
          error={annotationsError}
          language="json"
          value={annotationsDraft}
          onChange={(next) => {
            setAnnotationsDraft(next);
            setAnnotationsDirty(true);
          }}
        />
      )}

      {activeTab === "info" && (
        <Box sx={{ flex: 1, overflow: "auto", minHeight: 0 }}>{infoTabContent}</Box>
      )}

      {activeTab === "edit" && (
        <Box sx={{ flex: 1, overflow: "auto", minHeight: 0 }}>{editTabContent}</Box>
      )}
    </Box>
  );
};
/* eslint-enable complexity */
