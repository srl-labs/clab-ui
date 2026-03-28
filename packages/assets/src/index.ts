export type WebviewAssetId =
  | "reactTopoViewerWebview"
  | "reactTopoViewerStyles"
  | "explorerWebview"
  | "welcomeWebview"
  | "inspectWebview"
  | "nodeImpairmentsWebview"
  | "wiresharkVncWebview"
  | "monacoEditorWorker"
  | "monacoJsonWorker"
  | "maplibreWorker";

export interface WebviewAssetManifest {
  reactTopoViewerWebview: string;
  reactTopoViewerStyles: string;
  explorerWebview: string;
  welcomeWebview: string;
  inspectWebview: string;
  nodeImpairmentsWebview: string;
  wiresharkVncWebview: string;
  monacoEditorWorker: string;
  monacoJsonWorker: string;
  maplibreWorker: string;
}

const MANIFEST: WebviewAssetManifest = {
  reactTopoViewerWebview: "reactTopoViewerWebview.js",
  reactTopoViewerStyles: "reactTopoViewerStyles.css",
  explorerWebview: "containerlabExplorerView.js",
  welcomeWebview: "welcomePageWebview.js",
  inspectWebview: "inspectWebview.js",
  nodeImpairmentsWebview: "nodeImpairmentsWebview.js",
  wiresharkVncWebview: "wiresharkVncWebview.js",
  monacoEditorWorker: "monaco-editor-worker.js",
  monacoJsonWorker: "monaco-json-worker.js",
  maplibreWorker: "maplibre-gl-csp-worker.js"
};

export function getWebviewAssetManifest(): WebviewAssetManifest {
  return { ...MANIFEST };
}

export function resolveAssetPath(assetId: WebviewAssetId): string {
  return MANIFEST[assetId];
}
