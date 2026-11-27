import type { SourceFeature } from "../index";
import { marshGeometry } from "./marsh-merge";

/**
 * Ägaren 2026-11-15 (bild på en grop mitt i ett kärr: «det ritas ut många naturliga gropar, som denna mitt på ett kärr»): i
 * sankmark är marken plan och blöt, och laserns markmodell får små gropar av vattenytor, tuvor och glesa markträffar. En
 * kartritare ritar inte gropar där. Gropar i sankmark tas därför bort: Karttapullautins (`udepression…`, `uglyudepression`)
 * alltid, eftersom de saknar djup, och den egna sökningens (`pit-search.ts`) när de är grundare än `MARSH_PIT_KEEP_DEPTH`.
 */
const { polygonOf, boxOf } = marshGeometry;
/** Sankmarkens lager (laserns fuktsteg och Lantmäteriets marktäcke), som i `marsh-merge.ts`. */
export const MARSH_LAYERS = /^(blott|fuktigt|sankmark_vat|sankmark_fast|sankmark_misstankt_ooverkomlig)$/;
/** En grop ur den egna sökningen som är så här djup (meter) står kvar också i sankmark. */
export const MARSH_PIT_KEEP_DEPTH = 1;
const PIT_POINT = /^(ugly)?udepression/i;

type Ring = readonly (readonly [number, number])[];
const insideRing = (ring: Ring, x: number, y: number) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** Om en punkt ligger i sankmark bland objekten (ytan utan sina hål), med spatialt rutnätsindex. */
export function marshTest(features: readonly SourceFeature[]): (x: number, y: number) => boolean {
  const areas = features.filter(feature => MARSH_LAYERS.test(feature.layer)).flatMap(feature => {
    const polygon = polygonOf(feature);
    return polygon ? [{ polygon, box: boxOf(polygon) }] : [];
  });
  if (areas.length === 0) return () => false;
  let sizeSum = 0, ox = Infinity, oy = Infinity;
  for (const area of areas) {
    sizeSum += Math.max(area.box.maxX - area.box.minX, area.box.maxY - area.box.minY);
    if (area.box.minX < ox) ox = area.box.minX;
    if (area.box.minY < oy) oy = area.box.minY;
  }
  const cell = Math.max(10, Math.min(500, sizeSum / areas.length));
  const originX = Number.isFinite(ox) ? ox : 0, originY = Number.isFinite(oy) ? oy : 0;
  const cells = new Map<number, number[]>(), overflow: number[] = [];
  for (let i = 0; i < areas.length; i += 1) {
    const b = areas[i]!.box;
    const x0 = Math.floor((b.minX - originX) / cell), x1 = Math.floor((b.maxX - originX) / cell);
    const y0 = Math.floor((b.minY - originY) / cell), y1 = Math.floor((b.maxY - originY) / cell);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64 || Math.abs(x0) > 1e7 || Math.abs(x1) > 1e7 || Math.abs(y0) > 1e7 || Math.abs(y1) > 1e7) {
      overflow.push(i);
      continue;
    }
    for (let cx = x0; cx <= x1; cx += 1) for (let cy = y0; cy <= y1; cy += 1) {
      const key = (cx + 0x1000000) * 0x2000000 + (cy + 0x1000000);
      const list = cells.get(key);
      if (list) list.push(i); else cells.set(key, [i]);
    }
  }
  const hitArea = (idx: number, x: number, y: number) => {
    const { polygon, box } = areas[idx]!;
    return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY
      && insideRing(polygon[0]!, x, y) && !polygon.slice(1).some(hole => insideRing(hole, x, y));
  };
  return (x, y) => {
    const cx = Math.floor((x - originX) / cell), cy = Math.floor((y - originY) / cell);
    if (Math.abs(cx) <= 1e7 && Math.abs(cy) <= 1e7) {
      const list = cells.get((cx + 0x1000000) * 0x2000000 + (cy + 0x1000000));
      if (list) for (let i = 0; i < list.length; i += 1) if (hitArea(list[i]!, x, y)) return true;
    }
    for (let i = 0; i < overflow.length; i += 1) if (hitArea(overflow[i]!, x, y)) return true;
    return false;
  };
}

/** Objekten utan Karttapullautins gropar i sankmark. Ger samma lista (samma objekt) när inget tas bort. */
export function withoutMarshPits(features: readonly SourceFeature[]): { features: SourceFeature[]; removed: number } {
  if (!features.some(feature => feature.geometry.kind === "point" && PIT_POINT.test(feature.layer))) return { features: [...features], removed: 0 };
  const inMarsh = marshTest(features);
  const kept = features.filter(feature => !(feature.geometry.kind === "point" && PIT_POINT.test(feature.layer) && inMarsh(...feature.geometry.at)));
  return { features: kept, removed: features.length - kept.length };
}
