/**
 * TopologyHost client - dispatches semantic snapshot and command requests to the active host.
 */

import type {
  TopologyHostCommand,
  TopologyHostResponseMessage,
  TopologySnapshot
} from "../core/types/messages";
import type {
  HostRuntimeContainer,
  HostRuntimeInterface,
  HostRuntimeInterfaceStats,
  TopologyUiContext
} from "../host";
import type { TopologySessionClient } from "../session/client";

export function setHostContext(
  update: Partial<TopologyUiContext>,
  client: TopologySessionClient
): void {
  client.setContext(update);
}

export function getHostContext(client: TopologySessionClient): TopologyUiContext {
  return client.getContext();
}

export function getHostRevision(client: TopologySessionClient): number {
  return client.getRevision();
}

export function setHostRevision(nextRevision: number, client: TopologySessionClient): void {
  client.setRevision(nextRevision);
}

export async function requestSnapshot(
  options: { externalChange?: boolean } = {},
  client: TopologySessionClient
): Promise<TopologySnapshot> {
  return client.requestSnapshot(options);
}

export async function dispatchTopologyCommand(
  command: TopologyHostCommand,
  client: TopologySessionClient
): Promise<TopologyHostResponseMessage> {
  return client.dispatchCommand(command);
}

export type {
  HostRuntimeContainer,
  HostRuntimeInterface,
  HostRuntimeInterfaceStats,
  TopologyUiContext as HostContext
};

export function getHostCommandQueueScope(client: TopologySessionClient): object {
  return client as object;
}
