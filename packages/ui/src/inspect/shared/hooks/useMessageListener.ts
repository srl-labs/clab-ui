import { useEffect, useRef } from "react";

import { getClabUiHost } from "../../../host";

interface WebviewMessage {
  command?: string;
  type?: string;
}

export function useMessageListener<T extends WebviewMessage>(
  handler: (message: T) => void
): void {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    return getClabUiHost().subscribe((event) => {
      handlerRef.current(event.data as T);
    });
  }, []);
}
