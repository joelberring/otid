import type { SourceFeature } from "../index";
import polygonClipping, { type Polygon } from "polygon-clipping";

/**
 * Ägaren 2026-11-12 («kärr verkar kunna hamna dubbelt … tre kärr på varandra»): grundkartan fick sankmark från tre håll som
 * låg ovanpå varandra: laserns «blött» (308), laserns «fuktigt» (310, som också täckte det blöta) och marktäckets sankmark.
 * Här får varje plats en enda sankmark, i ordningen blött, marktäckets våta, fuktigt, marktäckets fasta: det som kommer
 * senare klipps mot det som redan finns. Skärvor under `MIN_PIECE_M2` tas bort.
 */
// Ägaren 2026-11-17: NMD:s öppna våtmark (`land-cover.ts`) efter laserns blöta mark och marktäckets våta, före fuktigt.
const MARSH = ["blott", "sankmark_vat", "sankmark_oppen_nmd", "fuktigt", "sankmark_fast"] as const;
/**
 * Undervegetationens raster (407, 409) läggs ovanpå vit skog och gult, men får enligt normen inte kombineras med grönt
 * (406, 408): de klipps mot det gröna, och 407 mot 409 så att rastren inte ligger dubbelt. Det gröna självt rörs inte.
 */
const UNDERGROWTH = ["gron_lattlopt", "hygge_ungskog", "undervegetation_svarlopt", "undervegetation_lattlopt", "hygge_sly"] as const;
const MIN_PIECE_M2 = 40;

type Ring = [number, number][];
const closedRing = (points: readonly (readonly [number, number])[]): Ring => {
  const ring = points.map(([x, y]) => [x, y] as [number, number]);
  const first = ring[0], last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push([first[0], first[1]]);
  return ring;
};
const polygonOf = (feature: SourceFeature): Polygon | undefined => {
  const geometry = feature.geometry;
  const rings = geometry.kind === "area" ? geometry.rings.map(closedRing) : geometry.kind === "line" && geometry.closed ? [closedRing(geometry.points)] : [];
  const valid = rings.filter(ring => ring.length >= 4);
  return valid.length ? valid : undefined;
};
const ringArea = (ring: Ring) => Math.abs(ring.reduce((sum, [x, y], i) => { const [nx, ny] = ring[(i + 1) % ring.length]!; return sum + x * ny - nx * y; }, 0)) / 2;
const boxOf = (polygon: Polygon) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of polygon[0] ?? []) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  return { minX, minY, maxX, maxY };
};
type Box = ReturnType<typeof boxOf>;
const touches = (a: Box, b: Box) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

/** Ytornas hjälpfunktioner för `soil-marsh.ts` (samlade i ett objekt så att de inte krockar med andra filers namn i `index.ts`). */
export const marshGeometry = { polygonOf, ringArea, boxOf, touches };

/** Grundkartans objekt med sankmarken utan överlapp. Annat än sankmarkens ytor lämnas orört och behåller sin ordning först. */
export const singleMarsh = (features: readonly SourceFeature[]) => withoutOverlap(features, MARSH);
/**
 * Skött mark har inga kärr: laserns blöta och fuktiga mark klipps mot åker, fruktodling och tomtmark (marktäcket) och mot
 * `managed` (OpenStreetMaps gräsytor, parker, idrottsplatser och odlingar). Mätt mot tio rutor ur fem kartor 2026-11-13 med
 * kartornas egna ytor för odlat och öppen mark (401) som mask: träffen (F) för sankmark steg i medel från 0,62 till 0,65.
 * Marktäckets egen sankmark rörs inte.
 */
const MANAGED = "\u0000skott_mark";
const OFF_MANAGED = [MANAGED, "aker", "fruktodling", "tomtmark_marktacke", "tomtmark_osm", "tomtmark_fastighet", "blott", "fuktigt", "sankmark_oppen_nmd"] as const;
export function marshOutsideManaged(features: readonly SourceFeature[], managed: readonly SourceFeature[] = []): SourceFeature[] {
  const marked = managed.map(feature => ({ ...feature, layer: MANAGED }));
  return withoutOverlap([...features, ...marked], OFF_MANAGED, 5).features.filter(feature => feature.layer !== MANAGED);
}
/**
 * Ägaren 2026-11-16 («halvöppen mark hamnar ovanför tomtmark»): 404:s vita prickar ritas över olivgrönt, så den halvöppna
 * marken klipps mot tomterna.
 */
const OFF_YARDS = ["tomtmark_marktacke", "tomtmark_osm", "tomtmark_fastighet", "tomtmark_hus", "oppen_mark_spridda_trad"] as const;
export const semiOpenOutsideYards = (features: readonly SourceFeature[]) => withoutOverlap(features, OFF_YARDS, 4).features;
/** Grundkartans objekt med undervegetationen utanför det gröna och utan dubbla raster. */
export const undergrowthOutsideGreen = (features: readonly SourceFeature[]) => withoutOverlap(features, UNDERGROWTH, 2);

/** Dynamiskt spatialt rutnätsindex över redan lagda ytor så varje ny yta bara klipps mot närliggande hinder. */
class KeptGrid {
  private readonly items: { polygon: Polygon; box: Box }[] = [];
  private readonly cells = new Map<number, number[]>();
  private readonly overflow: number[] = [];
  private seen = new Int32Array(0);
  private stamp = 0;
  constructor(private readonly cell: number, private readonly originX: number, private readonly originY: number) {}
  add(item: { polygon: Polygon; box: Box }) {
    const idx = this.items.length;
    this.items.push(item);
    const b = item.box;
    const x0 = Math.floor((b.minX - this.originX) / this.cell), x1 = Math.floor((b.maxX - this.originX) / this.cell);
    const y0 = Math.floor((b.minY - this.originY) / this.cell), y1 = Math.floor((b.maxY - this.originY) / this.cell);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64 || Math.abs(x0) > 1e7 || Math.abs(x1) > 1e7 || Math.abs(y0) > 1e7 || Math.abs(y1) > 1e7) {
      this.overflow.push(idx);
      return;
    }
    for (let cx = x0; cx <= x1; cx += 1) for (let cy = y0; cy <= y1; cy += 1) {
      const key = (cx + 0x1000000) * 0x2000000 + (cy + 0x1000000);
      const list = this.cells.get(key);
      if (list) list.push(idx); else this.cells.set(key, [idx]);
    }
  }
  touching(box: Box): Polygon[] {
    const out: Polygon[] = [];
    if (this.items.length === 0) return out;
    if (this.seen.length < this.items.length) this.seen = new Int32Array(Math.max(this.items.length, this.seen.length * 2));
    this.stamp += 1;
    if (this.stamp === 0x7fffffff) { this.seen.fill(0); this.stamp = 1; }
    const x0 = Math.floor((box.minX - this.originX) / this.cell), x1 = Math.floor((box.maxX - this.originX) / this.cell);
    const y0 = Math.floor((box.minY - this.originY) / this.cell), y1 = Math.floor((box.maxY - this.originY) / this.cell);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 256 || Math.abs(x0) > 1e7 || Math.abs(x1) > 1e7 || Math.abs(y0) > 1e7 || Math.abs(y1) > 1e7) {
      for (let i = 0; i < this.items.length; i += 1) {
        const item = this.items[i]!;
        if (touches(box, item.box)) out.push(item.polygon);
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
        if (touches(box, item.box)) out.push(item.polygon);
      }
    }
    for (let i = 0; i < this.overflow.length; i += 1) {
      const idx = this.overflow[i]!;
      if (this.seen[idx] === this.stamp) continue;
      this.seen[idx] = this.stamp;
      const item = this.items[idx]!;
      if (touches(box, item.box)) out.push(item.polygon);
    }
    return out;
  }
}

/** Lagren i `order` utan överlapp: ett senare lager klipps mot de tidigare. Lagren före `from` är bara hinder och klipps inte. */
function withoutOverlap(features: readonly SourceFeature[], order: readonly string[], from = 0): { features: SourceFeature[]; clipped: number; removed: number } {
  const ORDER = order;
  const rank = (feature: SourceFeature) => ORDER.indexOf(feature.layer.toLowerCase());
  const marsh = features.map(feature => ({ feature, rank: rank(feature), polygon: rank(feature) >= 0 ? polygonOf(feature) : undefined }))
    .filter((row): row is { feature: SourceFeature; rank: number; polygon: Polygon } => !!row.polygon)
    .map(row => ({ ...row, box: boxOf(row.polygon) }));
  if (new Set(marsh.map(row => row.rank)).size < 2 || !marsh.some(row => row.rank >= from)) return { features: [...features], clipped: 0, removed: 0 };
  const taken = new Set(marsh.map(row => row.feature));
  let sizeSum = 0, ox = Infinity, oy = Infinity;
  for (const row of marsh) {
    sizeSum += Math.max(row.box.maxX - row.box.minX, row.box.maxY - row.box.minY);
    if (row.box.minX < ox) ox = row.box.minX;
    if (row.box.minY < oy) oy = row.box.minY;
  }
  const kept = new KeptGrid(Math.max(10, Math.min(500, sizeSum / marsh.length)), Number.isFinite(ox) ? ox : 0, Number.isFinite(oy) ? oy : 0);
  const byLevel: (typeof marsh)[] = Array.from({ length: ORDER.length }, () => []);
  for (const row of marsh) byLevel[row.rank]!.push(row);
  const out: SourceFeature[] = features.filter(feature => !taken.has(feature));
  let clipped = 0, removed = 0;
  for (let level = 0; level < ORDER.length; level += 1) {
    const added: { polygon: Polygon; box: Box }[] = [];
    for (const row of byLevel[level]!) {
      const { polygon, box } = row;
      if (level < from) { out.push(row.feature); added.push({ polygon, box }); continue; }
      const over = kept.touching(box);
      if (over.length === 0) { out.push(row.feature); added.push({ polygon, box }); continue; }
      let pieces: Polygon[];
      try { pieces = polygonClipping.difference(polygon, ...over).filter(piece => ringArea(piece[0] as Ring) >= MIN_PIECE_M2); }
      catch { out.push(row.feature); added.push({ polygon, box }); continue; }
      // Oförändrad bara om hela ytan (ytterkant minus hål) är kvar: ett blött kärr mitt i ett fuktigt ger ett hål, inte en ny kant.
      const net = (rings: readonly (readonly (readonly number[])[])[]) => rings.reduce((sum, ring, i) => sum + (i === 0 ? 1 : -1) * ringArea(ring as Ring), 0);
      const same = pieces.length === 1 && Math.abs(net(pieces[0]!) - net(polygon)) < 1;
      if (same) { out.push(row.feature); added.push({ polygon, box }); continue; }
      if (pieces.length === 0) { removed += 1; continue; }
      clipped += 1;
      for (const piece of pieces) {
        out.push({ layer: row.feature.layer, geometry: { kind: "area", rings: piece.map(ring => ring.map(([x, y]) => [x, y] as [number, number])) } });
        added.push({ polygon: piece, box: boxOf(piece) });
      }
    }
    for (const item of added) kept.add(item);
  }
  return { features: out, clipped, removed };
}
