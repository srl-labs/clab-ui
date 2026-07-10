import type {
  ClabUiHost,
  TopoViewerLifecycleAction,
  TopoViewerNodeAction
} from "./contracts";

export interface ClabUiHostFeatureCapabilities {
  grafanaExport: boolean;
  interfaceCapture: boolean;
  linkImpairment: boolean;
  splitView: boolean;
}

export interface ClabUiHostCapabilities {
  readonly lifecycleActions: Readonly<Record<TopoViewerLifecycleAction, boolean>>;
  readonly nodeActions: Readonly<Record<TopoViewerNodeAction, boolean>>;
  readonly features: Readonly<ClabUiHostFeatureCapabilities>;
}

export interface ClabUiHostCapabilitiesOverrides {
  lifecycleActions?: Partial<Record<TopoViewerLifecycleAction, boolean>>;
  nodeActions?: Partial<Record<TopoViewerNodeAction, boolean>>;
  features?: Partial<ClabUiHostFeatureCapabilities>;
}

const ALL_LIFECYCLE_ACTIONS: Readonly<Record<TopoViewerLifecycleAction, boolean>> =
  Object.freeze({
    deployLab: true,
    deployLabCleanup: true,
    destroyLab: true,
    destroyLabCleanup: true,
    redeployLab: true,
    redeployLabCleanup: true,
    applyLab: true,
    startLab: true,
    stopLab: true,
    restartLab: true
  });

const ALL_NODE_ACTIONS: Readonly<Record<TopoViewerNodeAction, boolean>> = Object.freeze({
  ssh: true,
  shell: true,
  logs: true,
  start: true,
  stop: true,
  restart: true
});

const ALL_FEATURES: Readonly<ClabUiHostFeatureCapabilities> = Object.freeze({
  grafanaExport: true,
  interfaceCapture: true,
  linkImpairment: true,
  splitView: true
});

const NO_LIFECYCLE_ACTIONS: Readonly<Record<TopoViewerLifecycleAction, boolean>> =
  Object.freeze({
    deployLab: false,
    deployLabCleanup: false,
    destroyLab: false,
    destroyLabCleanup: false,
    redeployLab: false,
    redeployLabCleanup: false,
    applyLab: false,
    startLab: false,
    stopLab: false,
    restartLab: false
  });

const NO_NODE_ACTIONS: Readonly<Record<TopoViewerNodeAction, boolean>> = Object.freeze({
  ssh: false,
  shell: false,
  logs: false,
  start: false,
  stop: false,
  restart: false
});

const NO_FEATURES: Readonly<ClabUiHostFeatureCapabilities> = Object.freeze({
  grafanaExport: false,
  interfaceCapture: false,
  linkImpairment: false,
  splitView: false
});

/**
 * Backward-compatible capability set for hosts that predate negotiation.
 *
 * A host that supplies `capabilities` opts into fail-closed negotiation and
 * must explicitly advertise available operations. Older hosts omit the field
 * and continue to expose the complete historical surface.
 */
export const ALL_CLAB_UI_HOST_CAPABILITIES: ClabUiHostCapabilities = Object.freeze({
  lifecycleActions: ALL_LIFECYCLE_ACTIONS,
  nodeActions: ALL_NODE_ACTIONS,
  features: ALL_FEATURES
});

/** Safe default for a new or partially negotiated backend. */
export const NO_CLAB_UI_HOST_CAPABILITIES: ClabUiHostCapabilities = Object.freeze({
  lifecycleActions: NO_LIFECYCLE_ACTIONS,
  nodeActions: NO_NODE_ACTIONS,
  features: NO_FEATURES
});

export function createClabUiHostCapabilities(
  overrides: ClabUiHostCapabilitiesOverrides = {}
): ClabUiHostCapabilities {
  return Object.freeze({
    lifecycleActions: Object.freeze({
      ...NO_LIFECYCLE_ACTIONS,
      ...overrides.lifecycleActions
    }),
    nodeActions: Object.freeze({
      ...NO_NODE_ACTIONS,
      ...overrides.nodeActions
    }),
    features: Object.freeze({
      ...NO_FEATURES,
      ...overrides.features
    })
  });
}

export function resolveClabUiHostCapabilities(
  host: Pick<ClabUiHost, "capabilities">
): ClabUiHostCapabilities {
  return host.capabilities ?? ALL_CLAB_UI_HOST_CAPABILITIES;
}
