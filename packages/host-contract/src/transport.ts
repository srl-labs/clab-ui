import type {
  LifecycleAction,
  LifecycleResult,
  NodeRuntimeData,
  TopologyCommand,
  TopologyHostEvent,
  TopologyHostResponse,
  TopologySnapshotState
} from "./types";

export type Unsubscribe = () => void;

/**
 * Transport-neutral interface for topology host communication.
 * Implemented by each adapter package.
 */
export interface TopologyHostTransport {
  requestSnapshot(): Promise<TopologySnapshotState>;

  dispatch(command: TopologyCommand, revision: number): Promise<TopologyHostResponse>;

  subscribe(handler: (event: TopologyHostEvent) => void): Unsubscribe;

  executeLifecycleAction?(action: LifecycleAction): Promise<LifecycleResult>;

  getNodeRuntime?(labName: string, nodeName: string): Promise<NodeRuntimeData>;

  dispose(): void;
}
