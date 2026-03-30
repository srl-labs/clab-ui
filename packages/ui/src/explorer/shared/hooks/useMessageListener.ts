import { useEffect, useRef } from "react";

import { getClabUiHost } from "../../../host";
import type { ExplorerIncomingMessage } from "../explorer/types";

export function useMessageListener<T extends ExplorerIncomingMessage>(
  handler: (message: T) => void
): void {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    return getClabUiHost().explorer.subscribe((message) => {
      handlerRef.current(message as T);
    });
  }, []);
}
