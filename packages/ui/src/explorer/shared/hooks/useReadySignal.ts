import { useEffect, useRef } from "react";

import { getClabUiHost } from "../../../host";

export function useReadySignal(): void {
  const sentRef = useRef(false);

  useEffect(() => {
    if (sentRef.current) {
      return;
    }

    sentRef.current = true;
    getClabUiHost().explorer.connect();
  }, []);
}
