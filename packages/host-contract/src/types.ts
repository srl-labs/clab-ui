import type {
  ModeChangedMessage,
  TopologyHostCommand,
  TopologyHostResponseMessage,
  TopologyHostSnapshotMessage,
  TopologySnapshot
} from "@srl-labs/clab-ui-core/types/messages";
import type { DeploymentState } from "@srl-labs/clab-ui-core/types/topology";

export type TopologyCommand = TopologyHostCommand;
export type TopologyHostResponse = TopologyHostResponseMessage;
export type TopologySnapshotState = TopologySnapshot;
export type TopologyHostEvent = TopologyHostSnapshotMessage | TopologyHostResponseMessage | ModeChangedMessage;

export type LifecycleActionType = "deploy" | "destroy" | "redeploy" | "save";

export interface LifecycleAction {
  action: LifecycleActionType;
  labName?: string;
  topologyPath?: string;
  payload?: Record<string, unknown>;
}

export interface LifecycleResult {
  ok: boolean;
  action: LifecycleActionType;
  deploymentState?: DeploymentState;
  message?: string;
  error?: string;
}

export interface NodeRuntimeData {
  labName: string;
  nodeName: string;
  state?: string;
  details?: Record<string, unknown>;
}
