import type { GeoClip } from "@o-tid/contracts";

/** Klipprutan för laserdatan (G1): uträkningen delas med servern (AI-kopplingens laserkörningar) och ligger i map-revision. */
export { laserClip } from "@o-tid/map-revision";

/** G6, provrutan (ägaren 2026-11-11): en ruta på `side` m kring `center` (SWEREF 99 TM), inom jobbets klippruta. */
export const SAMPLE_SIDE_M = 250;
export function sampleClip(center: readonly [number, number], within: GeoClip | null, side = SAMPLE_SIDE_M): GeoClip | undefined {
  const half = side / 2, [cx, cy] = [Math.round(center[0]), Math.round(center[1])];
  const box = { minX: cx - half, minY: cy - half, maxX: cx + half, maxY: cy + half };
  const clipped = within ? { minX: Math.max(box.minX, within.minX), minY: Math.max(box.minY, within.minY), maxX: Math.min(box.maxX, within.maxX),
    maxY: Math.min(box.maxY, within.maxY) } : box;
  return clipped.maxX - clipped.minX >= 50 && clipped.maxY - clipped.minY >= 50 ? clipped : undefined;
}
export const clipCenter = (clip: GeoClip): [number, number] => [(clip.minX + clip.maxX) / 2, (clip.minY + clip.maxY) / 2];
