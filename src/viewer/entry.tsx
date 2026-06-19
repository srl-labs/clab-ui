import type { Root } from "react-dom/client";

import { mountViewer } from "./mountViewer";

// Standalone viewer bootstrap, intended to be served as a static page and embedded in an <iframe>.
// The host page sends the topology over postMessage; we render it read-only. A handshake is used so
// the host knows when to send: on load we post "clab-viewer:ready", then await "clab-viewer:render".
//
// Message in:  { type: "clab-viewer:render", yaml: string, annotations?: string, theme?: "light"|"dark" }
// Message out: { type: "clab-viewer:ready" }
//
// For direct embedding/tests, set window.__CLAB_VIEWER__ = { yaml, annotations, theme } before load.

interface RenderMessage {
  type: "clab-viewer:render";
  yaml: string;
  annotations?: string;
  theme?: "light" | "dark";
}

function isRenderMessage(data: unknown): data is RenderMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "clab-viewer:render" &&
    typeof (data as { yaml?: unknown }).yaml === "string"
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");

let root: Root | null = null;

function render(msg: { yaml: string; annotations?: string; theme?: "light" | "dark" }): void {
  root?.unmount();
  root = mountViewer(container as Element, {
    yaml: msg.yaml,
    annotations: msg.annotations,
    theme: msg.theme
  });
}

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (isRenderMessage(event.data)) render(event.data);
});

const injected = (window as unknown as { __CLAB_VIEWER__?: RenderMessage }).__CLAB_VIEWER__;
if (injected && typeof injected.yaml === "string") {
  render(injected);
} else if (window.parent !== window) {
  window.parent.postMessage({ type: "clab-viewer:ready" }, "*");
}
