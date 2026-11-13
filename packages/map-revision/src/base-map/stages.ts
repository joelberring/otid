import type { SourceData, SourceFeature } from "../vector-parse";
import { clipLine, clipRing } from "../vector-import";

/**
 * Ägaren 2026-11-13 (Ornö södra, delad i tre etapper: «man kan bara se en remsa i taget … går det att fixa så att alla remsor
 * ses samtidigt eller att de läses ihop?»): en laserkörning som servern delat i etapper läses in som en grundkarta. Varje
 * etapp bearbetas med 50 m marginal, så etapperna överlappar; varje etapps objekt klipps till etappens egen klippruta och
 * filerna med samma namn slås ihop innan grundkartan sätts ihop (`mergeBaseMap`). Klipprutorna ligger kant i kant.
 */
export interface StageBox { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }
type Pair = readonly [number, number];

const inside = (box: StageBox, [x, y]: Pair) => x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
const toPoints = (points: readonly Pair[]) => points.map(([x, y]) => ({ x, y }));
const toPairs = (points: readonly { x: number; y: number }[]): [number, number][] => points.map(point => [point.x, point.y]);

/** Objekten klippta till rutan: punkter utanför tas bort, linjer delas vid kanten och ytor klipps (hål som hamnar utanför försvinner). */
export function clipFeaturesToBox(features: readonly SourceFeature[], box: StageBox): SourceFeature[] {
  const out: SourceFeature[] = [];
  for (const feature of features) {
    const geometry = feature.geometry;
    if (geometry.kind === "point") { if (inside(box, geometry.at)) out.push(feature); continue; }
    if (geometry.kind === "line") {
      if (geometry.points.every(point => inside(box, point))) { out.push(feature); continue; }
      // En sluten linje som går över kanten blir öppna bitar (med den stängande sträckan).
      const points = geometry.closed ? [...geometry.points, geometry.points[0]!] : geometry.points;
      for (const piece of clipLine(toPoints(points), box)) out.push({ ...feature, geometry: { kind: "line", points: toPairs(piece), closed: false } });
      continue;
    }
    if (geometry.rings.every(ring => ring.every(point => inside(box, point)))) { out.push(feature); continue; }
    const [outer, ...holes] = geometry.rings.map(ring => toPairs(clipRing(toPoints(ring), box)));
    if (!outer || outer.length < 3) continue;
    out.push({ ...feature, geometry: { kind: "area", rings: [outer, ...holes.filter(ring => ring.length >= 3)] } });
  }
  return out;
}

/**
 * Etapperna som en uppsättning filer: varje fil klippt till sin etapp och filerna med samma namn ihopslagna, i den ordning
 * namnen först förekommer. Koordinatsystemet tas från den första filen som anger det.
 */
export function joinStages(stages: readonly { readonly box: StageBox; readonly parts: readonly { readonly name: string; readonly data: SourceData }[] }[]):
  { name: string; data: SourceData }[] {
  const byName = new Map<string, { features: SourceFeature[]; crs: number | undefined; skipped: number }>();
  for (const stage of stages) {
    for (const part of stage.parts) {
      const joined = byName.get(part.name) ?? { features: [], crs: undefined, skipped: 0 };
      joined.features.push(...clipFeaturesToBox(part.data.features, stage.box));
      joined.crs ??= part.data.crs;
      joined.skipped += part.data.skipped;
      byName.set(part.name, joined);
    }
  }
  return [...byName].map(([name, joined]) => ({ name, data: { features: joined.features, skipped: joined.skipped, ...(joined.crs !== undefined ? { crs: joined.crs } : {}) } }));
}
