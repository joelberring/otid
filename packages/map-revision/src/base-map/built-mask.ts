import type { MapObject, PathCommand } from "@o-tid/map-file";
import { samplePath } from "../index";
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
export function builtPolygons(objects: readonly MapObject[], mainOf: (symbol: string) => number | undefined, mains: ReadonlySet<number> = BUILT_MAINS): Polygon[] {
  return objects.filter((object): object is Area => object.kind === "area" && mains.has(mainOf(object.symbol) ?? -1))
    .map(polygonOf).filter(polygon => polygon.length > 0);
}

/**
 * Ägaren 2026-11-18 («en massa fält utan grönska blev berg»): plöjd åker och stubb är grå och ljusa i flygbilden. Det som redan
 * är ritat som odlad mark (412) eller fruktodling (413) undantas för berg i dagen och öppen mark (212–214, 401–404) när
 * kandidater läses in; resten av kandidaterna (kurvor, diken, vägar) rörs inte.
 */
export const FIELD_MAINS: ReadonlySet<number> = new Set([412, 413]);
const FIELD_MASKED = (main: number) => (main >= 212 && main <= 214) || (main >= 401 && main <= 404);

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
export function maskBuilt(candidates: readonly MapObject[], built: readonly Polygon[], mainOf: (symbol: string) => number | undefined,
  fields: readonly Polygon[] = []): { objects: MapObject[]; removed: number; clipped: number } {
  const first = maskWith(candidates, built, mainOf, MASKED);
  if (fields.length === 0) return first;
  const second = maskWith(first.objects, fields, mainOf, FIELD_MASKED);
  return { objects: second.objects, removed: first.removed + second.removed, clipped: first.clipped + second.clipped };
}

function maskWith(candidates: readonly MapObject[], built: readonly Polygon[], mainOf: (symbol: string) => number | undefined,
  masked: (main: number) => boolean): { objects: MapObject[]; removed: number; clipped: number } {
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
    if (main === undefined || !masked(main)) { objects.push(object); continue; }
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

/**
 * Ägaren 2026-11-16 (AI-kopplingens `subtract`): en yta utan det som täcks av andra ytor. Delarna som blir kvar (skärvor under
 * `MIN_PIECE_MM2` räknas inte); ingen del = ytan täcks helt. Går klippningen inte att räkna lämnas `undefined`.
 */
export function areaMinus(object: Area, cutters: readonly Area[]): Area[] | undefined {
  const polygon = polygonOf(object), others = cutters.map(polygonOf).filter(other => other.length > 0);
  if (polygon.length === 0) return undefined;
  if (others.length === 0) return [object];
  let pieces: MultiPolygon;
  try { pieces = polygonClipping.difference(polygon, ...others); } catch { return undefined; }
  return pieces.filter(piece => piece[0] && ringArea(piece[0]) >= MIN_PIECE_MM2)
    .map(piece => ({ ...object, rings: piece.map(ring => ring.map(([x, y], i) => ({ type: i === 0 ? "M" as const : "L" as const, x, y }))) }));
}

/**
 * Ägaren 2026-11-18 («borde det inte finnas typ utvidga befintliga och lägg till?»): kandidatytor som överlappar kartans ytor
 * med samma symbol slås ihop med dem (de gamla tas bort, sammanslagningen läggs till); övriga kandidater läggs till som de är.
 * `existing` är kartans ytor med kandidaternas symboler. Ytor som inte går att slå ihop (fel i geometrin) läggs till orörda.
 */
export function extendAreas<K>(candidates: readonly MapObject[], existing: readonly { readonly id: K; readonly object: MapObject }[])
  : { adds: MapObject[]; removed: K[]; extended: number } {
  const adds: MapObject[] = [], removed: K[] = [];
  let extended = 0;
  const olds = existing.flatMap(row => row.object.kind === "area" ? [{ id: row.id, object: row.object, polygon: polygonOf(row.object) }] : [])
    .filter(row => row.polygon.length > 0).map(row => ({ ...row, box: boxOf(row.polygon) }));
  const bySymbol = new Map<string, Area[]>();
  for (const object of candidates) {
    if (object.kind !== "area") { adds.push(object); continue; }
    bySymbol.set(object.symbol, [...(bySymbol.get(object.symbol) ?? []), object]);
  }
  const overlaps = (a: Polygon, b: Polygon) => { try { return polygonClipping.intersection(a, b).length > 0; } catch { return false; } };
  const near = (a: ReturnType<typeof boxOf>, b: ReturnType<typeof boxOf>) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
  for (const [symbol, areas] of bySymbol) {
    const nodes = [...areas.map(object => ({ object, polygon: polygonOf(object), id: undefined as K | undefined, old: false })),
      ...olds.filter(row => row.object.symbol === symbol).map(row => ({ object: row.object, polygon: row.polygon, id: row.id as K | undefined, old: true }))]
      .filter(node => node.polygon.length > 0).map(node => ({ ...node, box: boxOf(node.polygon) }));
    // Grupper av ytor som överlappar (union–find); bara kandidater som rör en gammal yta slås ihop.
    const parent = nodes.map((_, i) => i);
    const root = (i: number): number => parent[i] === i ? i : (parent[i] = root(parent[i]!));
    for (let i = 0; i < nodes.length; i += 1) for (let j = i + 1; j < nodes.length; j += 1) {
      if (!nodes[i]!.old && !nodes[j]!.old) continue;
      if (nodes[i]!.old && nodes[j]!.old) continue;
      if (near(nodes[i]!.box, nodes[j]!.box) && overlaps(nodes[i]!.polygon, nodes[j]!.polygon)) parent[root(i)] = root(j);
    }
    const groups = new Map<number, typeof nodes>();
    nodes.forEach((node, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), node]));
    for (const group of groups.values()) {
      const news = group.filter(node => !node.old), oldOnes = group.filter(node => node.old);
      if (news.length === 0) continue;
      if (oldOnes.length === 0) { adds.push(...news.map(node => node.object)); continue; }
      let union: MultiPolygon;
      try { union = polygonClipping.union(group[0]!.polygon, ...group.slice(1).map(node => node.polygon)); } catch { adds.push(...news.map(node => node.object)); continue; }
      const template = oldOnes[0]!.object;
      for (const piece of union) adds.push({ ...template, rings: piece.map(ring => ring.map(([x, y], i) => ({ type: i === 0 ? "M" as const : "L" as const, x, y }))) });
      removed.push(...oldOnes.map(node => node.id as K));
      extended += news.length;
    }
  }
  return { adds, removed, extended };
}
