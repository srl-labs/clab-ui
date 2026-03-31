import { resolveWindowVsCodeApi } from "../../../utils/vscodeApi";

interface VsCodeApiLike {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

let fallbackState: unknown;

export function getVSCodeApi(): VsCodeApiLike {
  const vscodeApi = resolveWindowVsCodeApi(window);
  return {
    postMessage: (message: unknown) => {
      vscodeApi?.postMessage(message);
    },
    getState: () => vscodeApi?.getState?.() ?? fallbackState,
    setState: (state: unknown) => {
      fallbackState = state;
      vscodeApi?.setState?.(state);
    }
  };
}
