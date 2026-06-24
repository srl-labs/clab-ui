import type { FreeTextAnnotation } from "../../core/types/topology";

/** Offset (px) applied to a duplicated annotation so it does not sit exactly on top of the original. */
export const DUPLICATE_OFFSET = 20;

/**
 * Create a copy of a free-text annotation with a new id and a small position
 * offset, preserving its text, styling and group membership.
 */
export function cloneFreeTextAnnotation(
  source: FreeTextAnnotation,
  newId: string
): FreeTextAnnotation {
  return {
    ...source,
    id: newId,
    position: {
      x: source.position.x + DUPLICATE_OFFSET,
      y: source.position.y + DUPLICATE_OFFSET
    }
  };
}
