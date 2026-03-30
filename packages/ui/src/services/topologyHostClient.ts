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
import { getClabUiHost } from "../host";

let revision = 1;
let hostContext: TopologyUiContext = {};

export function setHostContext(update: Partial<TopologyUiContext>): void {
  hostContext = { ...hostContext, ...update };
}

export function getHostContext(): TopologyUiContext {
  return hostContext;
}

export function getHostRevision(): number {
  return revision;
}

export function setHostRevision(nextRevision: number): void {
  revision = nextRevision;
}

export async function requestSnapshot(
  options: { externalChange?: boolean } = {}
): Promise<TopologySnapshot> {
  return getClabUiHost().topology.requestSnapshot(hostContext, options);
}

export async function dispatchTopologyCommand(
  command: TopologyHostCommand
): Promise<TopologyHostResponseMessage> {
  return getClabUiHost().topology.dispatchCommand(hostContext, revision, command);
}

export type {
  HostRuntimeContainer,
  HostRuntimeInterface,
  HostRuntimeInterfaceStats,
  TopologyUiContext as HostContext
};
