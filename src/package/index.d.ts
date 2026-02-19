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

export declare function getWebviewAssetManifest(): WebviewAssetManifest;
export declare function resolveAssetPath(assetId: WebviewAssetId): string;
