import React from "react";

import type { TopologySessionClient } from "../session/client";
import type { ClabUiHost } from "./contracts";

export interface ClabUiRuntime {
  host: ClabUiHost;
  session: TopologySessionClient;
}

const ClabUiRuntimeContext = React.createContext<ClabUiRuntime | null>(null);

interface ClabUiRuntimeProviderProps {
  children: React.ReactNode;
  runtime: ClabUiRuntime;
}

export function ClabUiRuntimeProvider({
  children,
  runtime
}: ClabUiRuntimeProviderProps): React.JSX.Element {
  return <ClabUiRuntimeContext.Provider value={runtime}>{children}</ClabUiRuntimeContext.Provider>;
}

export function useClabUiRuntime(): ClabUiRuntime {
  const runtime = React.useContext(ClabUiRuntimeContext);
  if (!runtime) {
    throw new Error("clab-ui runtime is not configured. Wrap the tree in ClabUiRuntimeProvider.");
  }
  return runtime;
}

export function useClabUiHost(): ClabUiHost {
  return useClabUiRuntime().host;
}

export function useTopologySessionClient(): TopologySessionClient {
  return useClabUiRuntime().session;
}
