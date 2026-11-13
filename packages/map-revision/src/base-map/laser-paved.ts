import type { SourceFeature } from "../index";
import { splitLarge, tidyRing } from "./sprint-osm";

/**
 * Belagd yta ur lasern (geo-arbetarens `belagt.dxf`, ägaren 2026-11-13). En DXF har inga ytor med hål: filen har varje
 * ring som en sluten linje, ytterkanterna moturs och hålen (kvarteren i ett gatunät) medurs. Här blir de ytor med sina
 * hål, så att kvarteren inte fylls, och ett stort gatunät delas som OpenStreetMaps belagda ytor (`splitLarge`).
 */
export const LASER_PAVED_FILE = "belagt.dxf";
export const LASER_PAVED_LAYER = "belagd_yta_laser";

type Position = readonly [number, number];
const signedArea = (ring: readonly Position[]) => ring.reduce((sum, [x, y], i) => { const [nx, ny] = ring[(i + 1) % ring.length]!; return sum + x * ny - nx * y; }, 0) / 2;
function inside(ring: readonly Position[], [px, py]: Position): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Lagrets slutna linjer som ytor med hål; allt annat i `features` lämnas som det är. */
export function laserPavedAreas(features: readonly SourceFeature[]): SourceFeature[] {
  const rest: SourceFeature[] = [], outers: { ring: [number, number][]; area: number; holes: [number, number][][] }[] = [], holes: [number, number][][] = [];
  for (const feature of features) {
    const { geometry } = feature;
    if (feature.layer !== LASER_PAVED_LAYER || geometry.kind !== "line" || !geometry.closed || geometry.points.length < 3) { rest.push(feature); continue; }
    const ring = tidyRing(geometry.points, 0), area = signedArea(ring);
    if (area > 0) outers.push({ ring, area, holes: [] }); else if (area < 0) holes.push(ring);
  }
  // Hålet hör till den minsta ytterkanten som innehåller det.
  for (const hole of holes) outers.filter(outer => inside(outer.ring, hole[0]!)).sort((a, b) => a.area - b.area)[0]?.holes.push(hole);
  const areas = outers.flatMap(outer => splitLarge([outer.ring, ...outer.holes].map(ring => [...ring, ring[0]!])))
    .map(piece => piece.map(ring => tidyRing(ring, 0)).filter(ring => ring.length >= 3))
    .filter(rings => rings.length > 0)
    .map((rings): SourceFeature => ({ layer: LASER_PAVED_LAYER, geometry: { kind: "area", rings } }));
  return [...rest, ...areas];
}
