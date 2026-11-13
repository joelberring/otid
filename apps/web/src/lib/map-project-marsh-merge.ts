import type { SourceFeature } from "@o-tid/map-revision";
import polygonClipping, { type Polygon } from "polygon-clipping";

/**
 * Ägaren 2026-11-12 («kärr verkar kunna hamna dubbelt … tre kärr på varandra»): grundkartan fick sankmark från tre håll som
 * låg ovanpå varandra: laserns «blött» (308), laserns «fuktigt» (310, som också täckte det blöta) och marktäckets sankmark.
 * Här får varje plats en enda sankmark, i ordningen blött, marktäckets våta, fuktigt, marktäckets fasta: det som kommer
 * senare klipps mot det som redan finns. Skärvor under `MIN_PIECE_M2` tas bort.
 */
const MARSH = ["blott", "sankmark_vat", "fuktigt", "sankmark_fast"] as const;
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

/** Grundkartans objekt med sankmarken utan överlapp. Annat än sankmarkens ytor lämnas orört och behåller sin ordning först. */
export const singleMarsh = (features: readonly SourceFeature[]) => withoutOverlap(features, MARSH);
/**
 * Skött mark har inga kärr: laserns blöta och fuktiga mark klipps mot åker, fruktodling och tomtmark (marktäcket) och mot
 * `managed` (OpenStreetMaps gräsytor, parker, idrottsplatser och odlingar). Mätt mot tio rutor ur fem kartor 2026-11-13 med
 * kartornas egna ytor för odlat och öppen mark (401) som mask: träffen (F) för sankmark steg i medel från 0,62 till 0,65.
 * Marktäckets egen sankmark rörs inte.
 */
const MANAGED = "\u0000skott_mark";
const OFF_MANAGED = [MANAGED, "aker", "fruktodling", "tomtmark_marktacke", "tomtmark_osm", "blott", "fuktigt"] as const;
export function marshOutsideManaged(features: readonly SourceFeature[], managed: readonly SourceFeature[] = []): SourceFeature[] {
  const marked = managed.map(feature => ({ ...feature, layer: MANAGED }));
  return withoutOverlap([...features, ...marked], OFF_MANAGED, 5).features.filter(feature => feature.layer !== MANAGED);
}
/** Grundkartans objekt med undervegetationen utanför det gröna och utan dubbla raster. */
export const undergrowthOutsideGreen = (features: readonly SourceFeature[]) => withoutOverlap(features, UNDERGROWTH, 2);

/** Lagren i `order` utan överlapp: ett senare lager klipps mot de tidigare. Lagren före `from` är bara hinder och klipps inte. */
function withoutOverlap(features: readonly SourceFeature[], order: readonly string[], from = 0): { features: SourceFeature[]; clipped: number; removed: number } {
  const ORDER = order;
  const rank = (feature: SourceFeature) => ORDER.indexOf(feature.layer.toLowerCase());
  const marsh = features.map(feature => ({ feature, rank: rank(feature), polygon: rank(feature) >= 0 ? polygonOf(feature) : undefined })).filter(row => row.polygon);
  if (new Set(marsh.map(row => row.rank)).size < 2 || !marsh.some(row => row.rank >= from)) return { features: [...features], clipped: 0, removed: 0 };
  const taken = new Set(marsh.map(row => row.feature));
  const kept: { polygon: Polygon; box: Box }[] = [];
  const out: SourceFeature[] = features.filter(feature => !taken.has(feature));
  let clipped = 0, removed = 0;
  for (const level of ORDER.keys()) {
    const added: { polygon: Polygon; box: Box }[] = [];
    for (const row of marsh) {
      if (row.rank !== level) continue;
      const polygon = row.polygon!, box = boxOf(polygon);
      if (level < from) { out.push(row.feature); added.push({ polygon, box }); continue; }
      const over = kept.filter(other => touches(box, other.box)).map(other => other.polygon);
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
    kept.push(...added);
  }
  return { features: out, clipped, removed };
}
