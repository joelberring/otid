import type { MapProjectClearCut } from "@o-tid/contracts";
import type { SourceFeature } from "@o-tid/map-revision";

/**
 * Ägaren 2026-11-11 («gör beräkningar beroende på hur gamla fotona/underlaget är … om hyggen är helt färska eller hunnit växa
 * upp och blivit sly»): Skogsstyrelsens hyggen delas in efter hur gamla de är i dag.
 *
 * - yngre än `fresh` år: färskt hygge, ris och stubbar (`hygge_farskt`, 403 öppen mark, svårframkomlig)
 * - till `scrub` år: sly och plantor under midjehöjd (`hygge_sly`, 407 undervegetation, lättlöpt)
 * - till `young` år: tät ungskog (`hygge_ungskog`, 406 löphindrande)
 * - äldre: lasern visar skogen som den är; hygget tas inte med.
 *
 * Hyggets kant blir en tydlig vegetationsgräns (`bestandsgrans`, 416) så länge hygget tas med. Ett hygge som är yngre än
 * laserskanningen syns inte i laserns vegetation (där står skogen kvar), så laserns vegetation inne i det tas bort i
 * grundkartan (`afterScan`). Åldrarna är grova; tillväxten skiljer sig mellan norr och söder och mellan marker.
 */
export interface ClearCutAges { readonly fresh: number; readonly scrub: number; readonly young: number }
export const DEFAULT_CLEAR_CUT_AGES: ClearCutAges = { fresh: 3, scrub: 8, young: 15 };
type Ring = readonly (readonly [number, number])[];

const years = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / (365.25 * 86_400_000);

export function clearCutFeatures(cuts: readonly MapProjectClearCut[], today: string, scannedAt: string | null, ages: ClearCutAges = DEFAULT_CLEAR_CUT_AGES)
  : { features: SourceFeature[]; afterScan: Ring[]; counts: Readonly<Record<"fresh" | "scrub" | "young", number>> } {
  const features: SourceFeature[] = [], afterScan: Ring[] = [];
  const counts = { fresh: 0, scrub: 0, young: 0 };
  for (const cut of cuts) {
    if (!cut.date || !cut.rings[0]) continue;
    const age = years(cut.date, today);
    if (!(age >= 0) || age >= ages.young) continue;
    const kind = age < ages.fresh ? "fresh" : age < ages.scrub ? "scrub" : "young";
    counts[kind] += 1;
    const layer = kind === "fresh" ? "hygge_farskt" : kind === "scrub" ? "hygge_sly" : "hygge_ungskog";
    features.push({ layer, geometry: { kind: "area", rings: cut.rings } });
    features.push({ layer: "bestandsgrans", geometry: { kind: "line", closed: true, points: cut.rings[0].slice(0, -1) } });
    if (scannedAt && cut.date > scannedAt) afterScan.push(cut.rings[0]);
  }
  return { features, afterScan, counts };
}

function inside(ring: Ring, x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
const VEGETATION = /^(oppen_mark|oppen_mark_laser|gron_|undervegetation_)/;
/** Laserns vegetationsytor vars mitt ligger i ett hygge som är yngre än skanningen tas bort (skogen där är avverkad). */
export function withoutCutVegetation(features: readonly SourceFeature[], afterScan: readonly Ring[]): SourceFeature[] {
  if (!afterScan.length) return [...features];
  return features.filter(feature => {
    if (!VEGETATION.test(feature.layer)) return true;
    const ring = feature.geometry.kind === "area" ? feature.geometry.rings[0] : feature.geometry.kind === "line" ? feature.geometry.points : undefined;
    if (!ring?.length) return true;
    const x = ring.reduce((sum, point) => sum + point[0], 0) / ring.length, y = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
    return !afterScan.some(cut => inside(cut, x, y));
  });
}
