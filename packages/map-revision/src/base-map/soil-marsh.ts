import polygonClipping, { type MultiPolygon, type Polygon } from "polygon-clipping";
import type { SourceFeature } from "../index";
import { marshGeometry } from "./marsh-merge";
import { isSoilWater, type SoilArea } from "./soil";

const { polygonOf, ringArea, boxOf, touches } = marshGeometry;
type Ring = [number, number][];
type Box = ReturnType<typeof boxOf>;

/**
 * Sankmarkens lager som regeln minskar: bara laserns fuktsteg (`blott` 308 och `fuktigt` 310). Lantmäteriets marktäcke
 * (`sankmark_vat`, `sankmark_fast`) är karterad sankmark ur flygbild och är säkrare än jordartskartans 25–200 m; den rörs inte.
 * Fuktreglagets lager är desamma (`SOIL_PANEL_LAYERS`), så kryssrutan där styr samma sak som grundkartan.
 */
export const SOIL_MARSH_LAYERS: ReadonlySet<string> = new Set(["blott", "fuktigt"]);
export const SOIL_PANEL_LAYERS: ReadonlySet<string> = new Set(["blott", "fuktigt"]);
/** Strandkärr inom så här långt från vatten (meter) blir kvar, som i `marsh-merge` och fuktreglaget. */
export const SOIL_WATER_BUFFER_M = 30;
/** Minsta yta (m²) för en rest av sankmark, som fuktreglagets förval. */
export const SOIL_MIN_MARSH_M2 = 400;

export interface SoilMarshOptions {
  /** Lagren som minskas (förval: sankmarkens alla). */
  readonly layers?: ReadonlySet<string> | undefined;
  readonly minAreaM2?: number | undefined;
  /** Kartans egna vattenytor (lagret `vatten`); jordartskartans vatten (kod 91) läggs till. */
  readonly water?: readonly SourceFeature[] | undefined;
}
export interface SoilMarshResult { readonly features: SourceFeature[]; readonly removedHa: number }

const net = (polygon: Polygon) => polygon.reduce((sum, ring, i) => sum + (i === 0 ? 1 : -1) * ringArea(ring as Ring), 0);
const near = (a: Box, b: Box, reach: number) => a.minX - reach <= b.maxX && b.minX - reach <= a.maxX && a.minY - reach <= b.maxY && b.minY - reach <= a.maxY;

/** Vattnets kanter som rektanglar (bredd två gånger `reach`, förlängda i ändarna): en grov buffert, nära nog för 30 m. */
function shoreBuffer(rings: readonly (readonly (readonly [number, number])[])[], targets: readonly Box[], reach: number): MultiPolygon {
  const pieces: Polygon[] = [];
  for (const ring of rings) for (let i = 0; i + 1 < ring.length; i += 1) {
    const [ax, ay] = ring[i]!, [bx, by] = ring[i + 1]!;
    const length = Math.hypot(bx - ax, by - ay);
    if (length < 1e-6) continue;
    const box = { minX: Math.min(ax, bx), minY: Math.min(ay, by), maxX: Math.max(ax, bx), maxY: Math.max(ay, by) };
    if (!targets.some(target => near(box, target, reach))) continue;
    const ux = (bx - ax) / length, uy = (by - ay) / length, nx = -uy * reach, ny = ux * reach, ex = ux * reach, ey = uy * reach;
    pieces.push([[[ax - ex + nx, ay - ey + ny], [bx + ex + nx, by + ey + ny], [bx + ex - nx, by + ey - ny], [ax - ex - nx, ay - ey - ny], [ax - ex + nx, ay - ey + ny]]]);
  }
  if (pieces.length === 0) return [];
  return polygonClipping.union(pieces[0]!, ...pieces.slice(1));
}

/**
 * Sankmarkens ytor minus torr mark (sand och grus) ur jordartskartan: `difference(sankmark, torr − vattenbuffert)`. Strandkärr
 * inom `SOIL_WATER_BUFFER_M` från vatten (kartans `vatten` och jordartskartans) blir kvar, och rester under minsta ytan tas bort.
 * Ytor som inte rörs behålls som de är. Går en uträkning inte (trasig geometri) lämnas ytan orörd.
 */
export function marshOffDrySoil(features: readonly SourceFeature[], soil: readonly SoilArea[], options: SoilMarshOptions = {}): SoilMarshResult {
  const layers = options.layers ?? SOIL_MARSH_LAYERS, minArea = options.minAreaM2 ?? SOIL_MIN_MARSH_M2;
  const marsh = features.map(feature => ({ feature, polygon: layers.has(feature.layer.toLowerCase()) ? polygonOf(feature) : undefined }))
    .filter((row): row is { feature: SourceFeature; polygon: Polygon } => !!row.polygon).map(row => ({ ...row, box: boxOf(row.polygon) }));
  const dry = soil.filter(area => area.cls === "dry").map(area => area.rings.map(ring => ring.map(([x, y]) => [x, y] as [number, number])).filter(ring => ring.length >= 4) as Polygon)
    .filter(polygon => polygon.length > 0).map(polygon => ({ polygon, box: boxOf(polygon) })).filter(row => marsh.some(m => touches(m.box, row.box)));
  if (marsh.length === 0 || dry.length === 0) return { features: [...features], removedHa: 0 };
  let effective: { polygon: Polygon; box: Box }[];
  try {
    const waterRings = [...soil.filter(isSoilWater).flatMap(area => area.rings),
      ...(options.water ?? []).flatMap(feature => feature.layer.toLowerCase() === "vatten" ? (polygonOf(feature) ?? []) : [])];
    const buffer = shoreBuffer(waterRings, dry.map(row => row.box), SOIL_WATER_BUFFER_M);
    const united = polygonClipping.union(dry[0]!.polygon, ...dry.slice(1).map(row => row.polygon));
    const rest = buffer.length ? polygonClipping.difference(united, buffer) : united;
    effective = rest.map(polygon => ({ polygon, box: boxOf(polygon) }));
  } catch { return { features: [...features], removedHa: 0 }; }
  const replaced = new Map<SourceFeature, SourceFeature[]>();
  let removed = 0;
  for (const row of marsh) {
    const over = effective.filter(other => touches(row.box, other.box)).map(other => other.polygon);
    if (over.length === 0) continue;
    let pieces: Polygon[];
    try { pieces = polygonClipping.difference(row.polygon, ...over); } catch { continue; }
    const kept = pieces.filter(piece => net(piece) >= minArea);
    const before = net(row.polygon), after = kept.reduce((sum, piece) => sum + net(piece), 0);
    if (pieces.length === 1 && kept.length === 1 && Math.abs(after - before) < 1) continue;
    removed += before - after;
    replaced.set(row.feature, kept.map(piece => ({ layer: row.feature.layer,
      geometry: { kind: "area" as const, rings: piece.map(ring => ring.map(([x, y]) => [x, y] as [number, number])) } })));
  }
  return { features: features.flatMap(feature => replaced.get(feature) ?? [feature]), removedHa: Math.round(removed / 100) / 100 };
}
