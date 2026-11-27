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
interface Box { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }
const boxOf = (polygon: Polygon): Box => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of polygon[0] ?? []) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
};
const touchesBox = (a: Box, b: Box) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
const inBox = (b: Box, x: number, y: number) => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;

class BoxIndex<T extends { readonly box: Box }> {
  private readonly cells = new Map<number, number[]>();
  private readonly overflow: number[] = [];
  private readonly seen: Int32Array;
  private stamp = 0;
  private readonly cell: number;
  private readonly originX: number;
  private readonly originY: number;
  constructor(private readonly items: readonly T[]) {
    this.seen = new Int32Array(items.length);
    let sum = 0, ox = Infinity, oy = Infinity;
    for (const item of items) {
      sum += Math.max(item.box.maxX - item.box.minX, item.box.maxY - item.box.minY);
      if (item.box.minX < ox) ox = item.box.minX;
      if (item.box.minY < oy) oy = item.box.minY;
    }
    this.originX = Number.isFinite(ox) ? ox : 0;
    this.originY = Number.isFinite(oy) ? oy : 0;
    this.cell = items.length ? Math.max(1, Math.min(200, sum / items.length)) : 1;
    for (let i = 0; i < items.length; i += 1) {
      const b = items[i]!.box;
      const x0 = Math.floor((b.minX - this.originX) / this.cell), x1 = Math.floor((b.maxX - this.originX) / this.cell);
      const y0 = Math.floor((b.minY - this.originY) / this.cell), y1 = Math.floor((b.maxY - this.originY) / this.cell);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64 || Math.abs(x0) > 1e7 || Math.abs(x1) > 1e7 || Math.abs(y0) > 1e7 || Math.abs(y1) > 1e7) {
        this.overflow.push(i);
        continue;
      }
      for (let cx = x0; cx <= x1; cx += 1) for (let cy = y0; cy <= y1; cy += 1) {
        const key = (cx + 0x1000000) * 0x2000000 + (cy + 0x1000000);
        const list = this.cells.get(key);
        if (list) list.push(i); else this.cells.set(key, [i]);
      }
    }
  }
  someAt(x: number, y: number, test: (item: T) => boolean): boolean {
    if (this.items.length === 0) return false;
    const cx = Math.floor((x - this.originX) / this.cell), cy = Math.floor((y - this.originY) / this.cell);
    if (Math.abs(cx) <= 1e7 && Math.abs(cy) <= 1e7) {
      const list = this.cells.get((cx + 0x1000000) * 0x2000000 + (cy + 0x1000000));
      if (list) for (let i = 0; i < list.length; i += 1) {
        const item = this.items[list[i]!]!;
        if (inBox(item.box, x, y) && test(item)) return true;
      }
    }
    for (let i = 0; i < this.overflow.length; i += 1) {
      const item = this.items[this.overflow[i]!]!;
      if (inBox(item.box, x, y) && test(item)) return true;
    }
    return false;
  }
  queryBox(box: Box): T[] {
    const out: T[] = [];
    if (this.items.length === 0) return out;
    this.stamp += 1;
    if (this.stamp === 0x7fffffff) { this.seen.fill(0); this.stamp = 1; }
    const x0 = Math.floor((box.minX - this.originX) / this.cell), x1 = Math.floor((box.maxX - this.originX) / this.cell);
    const y0 = Math.floor((box.minY - this.originY) / this.cell), y1 = Math.floor((box.maxY - this.originY) / this.cell);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 256 || Math.abs(x0) > 1e7 || Math.abs(x1) > 1e7 || Math.abs(y0) > 1e7 || Math.abs(y1) > 1e7) {
      for (let i = 0; i < this.items.length; i += 1) {
        if (touchesBox(this.items[i]!.box, box)) out.push(this.items[i]!);
      }
      return out;
    }
    for (let cx = x0; cx <= x1; cx += 1) for (let cy = y0; cy <= y1; cy += 1) {
      const list = this.cells.get((cx + 0x1000000) * 0x2000000 + (cy + 0x1000000));
      if (!list) continue;
      for (let i = 0; i < list.length; i += 1) {
        const idx = list[i]!;
        if (this.seen[idx] === this.stamp) continue;
        this.seen[idx] = this.stamp;
        const item = this.items[idx]!;
        if (touchesBox(item.box, box)) out.push(item);
      }
    }
    for (let i = 0; i < this.overflow.length; i += 1) {
      const idx = this.overflow[i]!;
      if (this.seen[idx] === this.stamp) continue;
      this.seen[idx] = this.stamp;
      const item = this.items[idx]!;
      if (touchesBox(item.box, box)) out.push(item);
    }
    return out;
  }
}
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
  const builtIndex = new BoxIndex(built.map(polygon => ({ polygon, box: boxOf(polygon) })));
  const inside = (x: number, y: number) => builtIndex.someAt(x, y, ({ polygon }) =>
    inRing(polygon[0]!, x, y) && !polygon.slice(1).some(hole => inRing(hole, x, y)));
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
      if (polygon.length === 0) { objects.push(object); continue; }
      const near = builtIndex.queryBox(box).map(item => item.polygon);
      if (near.length === 0) { objects.push(object); continue; }
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
  const oldBySymbol = new Map<string, { id: K; object: Area; polygon: Polygon; box: Box }[]>();
  for (const row of existing) {
    if (row.object.kind !== "area") continue;
    const polygon = polygonOf(row.object);
    if (polygon.length === 0) continue;
    const item = { id: row.id, object: row.object, polygon, box: boxOf(polygon) };
    const list = oldBySymbol.get(row.object.symbol);
    if (list) list.push(item); else oldBySymbol.set(row.object.symbol, [item]);
  }
  const bySymbol = new Map<string, Area[]>();
  for (const object of candidates) {
    if (object.kind !== "area") { adds.push(object); continue; }
    const list = bySymbol.get(object.symbol);
    if (list) list.push(object); else bySymbol.set(object.symbol, [object]);
  }
  const overlaps = (a: Polygon, b: Polygon) => { try { return polygonClipping.intersection(a, b).length > 0; } catch { return false; } };
  for (const [symbol, areas] of bySymbol) {
    const oldRows = oldBySymbol.get(symbol) ?? [];
    if (oldRows.length === 0) { adds.push(...areas); continue; }
    const nodes: { object: Area; polygon: Polygon; box: Box; id: K | undefined; old: boolean; index: number }[] = [];
    for (const object of areas) {
      const polygon = polygonOf(object);
      if (polygon.length === 0) continue;
      nodes.push({ object, polygon, box: boxOf(polygon), id: undefined, old: false, index: nodes.length });
    }
    const newCount = nodes.length;
    const oldNodes: typeof nodes = [];
    for (const row of oldRows) {
      const node = { object: row.object, polygon: row.polygon, box: row.box, id: row.id as K | undefined, old: true, index: nodes.length };
      nodes.push(node);
      oldNodes.push(node);
    }
    // Grupper av ytor som överlappar (union–find); bara kandidater som rör en gammal yta slås ihop.
    const parent = nodes.map((_, i) => i);
    const root = (i: number): number => parent[i] === i ? i : (parent[i] = root(parent[i]!));
    const oldIndex = new BoxIndex(oldNodes);
    for (let i = 0; i < newCount; i += 1) {
      const candidate = nodes[i]!;
      for (const oldNode of oldIndex.queryBox(candidate.box)) {
        if (root(i) !== root(oldNode.index) && overlaps(candidate.polygon, oldNode.polygon)) parent[root(i)] = root(oldNode.index);
      }
    }
    const groups = new Map<number, typeof nodes>();
    for (let i = 0; i < nodes.length; i += 1) {
      const r = root(i), list = groups.get(r);
      if (list) list.push(nodes[i]!); else groups.set(r, [nodes[i]!]);
    }
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
