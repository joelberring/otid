import type { MapObject, PathCommand } from "@o-tid/map-file";
import { samplePath } from "@o-tid/map-revision";
import polygonClipping, { type MultiPolygon, type Polygon } from "polygon-clipping";

/**
 * Ägaren 2026-11-12 («gör 2. vissa saker ska väl ändå synas på tomtmark? kolla reglerna»): det som redan är ritat som
 * tomtmark (520), hårdgjord yta (501), byggnad (521) eller skärmtak (522) undantas när kandidater läses in. I tätortsnära
 * kartor hamnade en femtedel till hälften av grundkartans förslag där (Högdalen, Djurgården).
 *
 * Reglerna: ISOM 2017-2 säger om 520 att inget ska redovisas i ytan utom mycket framträdande föremål (järnvägar, stora
 * byggnader, mycket stora träd) och att vägars infarter ska synas; ISOM 2000 sade «bara höjdkurvor och framträdande föremål».
 * Kartritarna ritar i praktiken kurvorna igenom: i Högdalen, Djurgården och Gömmaren har tomtmarken hälften så mycket kurva
 * som terrängen omkring, enstaka branter, och inga kärr, punkthöjder, stenar eller undervegetation. Därför behålls kurvor,
 * branter, vatten, vägar, stigar, byggnader och annat människogjort; markens detaljer och vegetationen tas bort.
 */
export const BUILT_MAINS: ReadonlySet<number> = new Set([501, 520, 521, 522]);
/** Symbolerna (huvudnummer) som inte läses in i det bebyggda: små landformer, sten, sankmark och diken, vegetation. */
const MASKED = (main: number) => (main >= 109 && main <= 115) || (main >= 204 && main <= 214) || (main >= 305 && main <= 310) || (main >= 401 && main <= 413);

type Area = Extract<MapObject, { kind: "area" }>;
const ringOf = (ring: readonly PathCommand[]): [number, number][] => {
  const points = samplePath(ring, 0.1).map(point => [point.x, point.y] as [number, number]);
  if (points.length && (points[0]![0] !== points[points.length - 1]![0] || points[0]![1] !== points[points.length - 1]![1])) points.push([...points[0]!]);
  return points;
};
const polygonOf = (area: Area): Polygon => area.rings.map(ringOf).filter(ring => ring.length >= 4);

/** Kartans bebyggda ytor som polygoner (kartans mm), för Workern. */
export function builtPolygons(objects: readonly MapObject[], mainOf: (symbol: string) => number | undefined): Polygon[] {
  return objects.filter((object): object is Area => object.kind === "area" && BUILT_MAINS.has(mainOf(object.symbol) ?? -1))
    .map(polygonOf).filter(polygon => polygon.length > 0);
}

const inRing = (ring: readonly (readonly [number, number])[], x: number, y: number) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [x1, y1] = ring[i]!, [x2, y2] = ring[j]!;
    if ((y1 > y) !== (y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1) hit = !hit;
  }
  return hit;
};
const boxOf = (polygon: Polygon) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of polygon[0] ?? []) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  return { minX, minY, maxX, maxY };
};
const ringArea = (ring: readonly (readonly [number, number])[]) => Math.abs(ring.reduce((sum, [x, y], i) => {
  const [nx, ny] = ring[(i + 1) % ring.length]!;
  return sum + x * ny - nx * y;
}, 0)) / 2;

/** Minsta bit (mm² på kartan) som blir kvar av en yta efter klippningen; mindre är en skärva längs kanten. */
const MIN_PIECE_MM2 = 0.25;

/**
 * Kandidaterna utan det som ligger i kartans bebyggda ytor: punkter i en yta tas bort, linjer med minst hälften av sina
 * punkter där tas bort, och ytor klipps mot dem (en yta kan bli flera). Symboler som ska synas även där lämnas orörda.
 */
export function maskBuilt(candidates: readonly MapObject[], built: readonly Polygon[], mainOf: (symbol: string) => number | undefined): { objects: MapObject[]; removed: number; clipped: number } {
  if (built.length === 0) return { objects: [...candidates], removed: 0, clipped: 0 };
  const boxes = built.map(boxOf);
  const inside = (x: number, y: number) => built.some((polygon, i) => {
    const box = boxes[i]!;
    return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY && inRing(polygon[0]!, x, y) && !polygon.slice(1).some(hole => inRing(hole, x, y));
  });
  const objects: MapObject[] = [];
  let removed = 0, clipped = 0;
  for (const object of candidates) {
    const main = mainOf(object.symbol);
    if (main === undefined || !MASKED(main)) { objects.push(object); continue; }
    if (object.kind === "point" || object.kind === "text") {
      if (inside(object.at.x, object.at.y)) removed += 1; else objects.push(object);
    } else if (object.kind === "line") {
      const points = samplePath(object.path, 0.3);
      if (points.length && points.filter(point => inside(point.x, point.y)).length * 2 >= points.length) removed += 1; else objects.push(object);
    } else {
      const polygon = polygonOf(object), box = boxOf(polygon);
      const near = built.filter((_, i) => { const other = boxes[i]!; return other.minX <= box.maxX && other.maxX >= box.minX && other.minY <= box.maxY && other.maxY >= box.minY; });
      if (near.length === 0 || polygon.length === 0) { objects.push(object); continue; }
      let pieces: MultiPolygon;
      try { pieces = polygonClipping.difference(polygon, ...near); } catch { objects.push(object); continue; }
      const kept = pieces.filter(piece => piece[0] && ringArea(piece[0]) >= MIN_PIECE_MM2);
      const before = ringArea(polygon[0]!), after = kept.reduce((sum, piece) => sum + ringArea(piece[0]!), 0);
      if (kept.length === 0) { removed += 1; continue; }
      if (kept.length === 1 && after > before * 0.999) { objects.push(object); continue; }
      clipped += 1;
      for (const piece of kept) {
        objects.push({ ...object, rings: piece.map(ring => ring.map(([x, y], i) => ({ type: i === 0 ? "M" as const : "L" as const, x, y }))) });
      }
    }
  }
  return { objects, removed, clipped };
}
