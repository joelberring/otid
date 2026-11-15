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

/** Om en punkt ligger i sankmark bland objekten (ytan utan sina hål). */
export function marshTest(features: readonly SourceFeature[]): (x: number, y: number) => boolean {
  const areas = features.filter(feature => MARSH_LAYERS.test(feature.layer)).flatMap(feature => {
    const polygon = polygonOf(feature);
    return polygon ? [{ polygon, box: boxOf(polygon) }] : [];
  });
  return (x, y) => areas.some(({ polygon, box }) => x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY
    && insideRing(polygon[0]!, x, y) && !polygon.slice(1).some(hole => insideRing(hole, x, y)));
}

/** Objekten utan Karttapullautins gropar i sankmark. Ger samma lista (samma objekt) när inget tas bort. */
export function withoutMarshPits(features: readonly SourceFeature[]): { features: SourceFeature[]; removed: number } {
  if (!features.some(feature => feature.geometry.kind === "point" && PIT_POINT.test(feature.layer))) return { features: [...features], removed: 0 };
  const inMarsh = marshTest(features);
  const kept = features.filter(feature => !(feature.geometry.kind === "point" && PIT_POINT.test(feature.layer) && inMarsh(...feature.geometry.at)));
  return { features: kept, removed: features.length - kept.length };
}
