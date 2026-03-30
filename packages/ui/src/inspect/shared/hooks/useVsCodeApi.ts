import { getClabUiHost } from "../../../host";

interface VsCodeApiLike {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

let fallbackState: unknown;

export function getVSCodeApi(): VsCodeApiLike {
  return {
    postMessage: (message: unknown) => {
      getClabUiHost().postMessage(message);
    },
    getState: () => fallbackState,
    setState: (state: unknown) => {
      fallbackState = state;
    }
  };
}
