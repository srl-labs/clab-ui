/**
 * Layout algorithms for React Flow topology viewer
 */
export type { LayoutName, LayoutOptions } from "./layout/types";
export {
  hasPresetPositions,
  isLayoutableNode,
  applyPositionMap,
  normalizeLayoutableNodePositions
} from "./layout/types";
export { applyForceLayout } from "./layout/forceLayout";
export { applyAutoLayout } from "./layout/autoLayout";
export { applyRadialLayout } from "./layout/radialLayout";

import type { Node, Edge } from "@xyflow/react";
import type { LayoutName, LayoutOptions } from "./layout/types";
import { applyForceLayout } from "./layout/forceLayout";
import { applyAutoLayout } from "./layout/autoLayout";
import { applyRadialLayout } from "./layout/radialLayout";

/**
 * Unified layout dispatcher — always returns Promise<{ nodes, edges }>.
 * Callers never need to branch on layout name or unwrap different return shapes.
 */
export async function applyLayout(
  name: LayoutName,
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions = {}
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  switch (name) {
    case "auto":
      return applyAutoLayout(nodes, edges, options);
    case "radial":
      return applyRadialLayout(nodes, edges, options);
    case "force":
      return { nodes: applyForceLayout(nodes, edges, options), edges };
    case "preset":
    case "geo":
    default:
      // These layouts return nodes immediately or are unknown (treated as preset)
      return { nodes, edges };
  }
}

/**
 * Get layout options for a given layout name
 * (For compatibility with existing code)
 */
export function getLayoutOptions(layoutName: string): { name: string } {
  return { name: layoutName };
}
