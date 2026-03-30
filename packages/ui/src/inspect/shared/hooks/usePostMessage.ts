import { useCallback } from "react";

import { getClabUiHost } from "../../../host";

export function usePostMessage<T = unknown>(): (message: T) => void {
  return useCallback((message: T) => {
    getClabUiHost().postMessage(message);
  }, []);
}
