import type { SourceFeature } from "@o-tid/map-revision";
import { compactMask, maskOutlines, simplifyRing } from "./map-project-photo-interpret";

/**
 * Grundkartan G8, tomter (ägaren 2026-11-11: «tomter kommer inte med»). Varken lasern, marktäcket eller OpenStreetMap har
 * tomtgränser, så en första tomt räknas ur husen: allt inom `radius` meter från ett bostadsstort hus (högst `maxBuilding` m²)
 * blir lagret `tomtmark_hus` (förslag 520, område som inte får beträdas). Det är ett grovt förslag att rätta i terrängen: husen
 * räknas på ett rutnät, närliggande tomter flyter ihop och små öar tas bort. Fastighetsgränser används inte (personuppgifter).
 */
export interface YardSettings { readonly radius: number; readonly cell: number; readonly maxBuilding: number; readonly minArea: number }
export const DEFAULT_YARDS: YardSettings = { radius: 20, cell: 2, maxBuilding: 400, minArea: 300 };
const BUILDING = /^(byggnad|OSM byggnad)$/;
const MAX_CELLS = 4_000_000;
type Ring = readonly (readonly [number, number])[];

const ringArea = (ring: Ring) => Math.abs(ring.reduce((sum, [x, y], i) => { const [nx, ny] = ring[(i + 1) % ring.length]!; return sum + x * ny - nx * y; }, 0)) / 2;
function inside(ring: Ring, x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
const outerRing = (feature: SourceFeature): Ring | undefined => feature.geometry.kind === "area" ? feature.geometry.rings[0]
  : feature.geometry.kind === "line" && feature.geometry.closed ? feature.geometry.points : undefined;

/** Tomterna kring husen i `features` (meter, SWEREF 99 TM eller annat metriskt system) som slutna linjer i lagret `tomtmark_hus`. */
export function yardsOf(features: readonly SourceFeature[], settings: YardSettings = DEFAULT_YARDS): SourceFeature[] {
  // Hus som redan ligger i en tomt (OpenStreetMaps bostadsområde, marktäckets låga bebyggelse) får ingen egen ring.
  const yards = features.filter(feature => /^tomtmark_/.test(feature.layer)).map(outerRing).filter((ring): ring is Ring => !!ring && ring.length >= 3);
  const houses = features.filter(feature => BUILDING.test(feature.layer)).map(outerRing)
    .filter((ring): ring is Ring => !!ring && ring.length >= 3 && ringArea(ring) <= settings.maxBuilding)
    .filter(ring => { const [x, y] = [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length]; return !yards.some(yard => inside(yard, x, y)); });
  if (!houses.length) return [];
  const xs = houses.flatMap(ring => ring.map(point => point[0])), ys = houses.flatMap(ring => ring.map(point => point[1]));
  const pad = settings.radius + settings.cell * 2;
  const minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad, maxX = Math.max(...xs) + pad, maxY = Math.max(...ys) + pad;
  const cell = Math.max(settings.cell, Math.sqrt((maxX - minX) * (maxY - minY) / MAX_CELLS));
  const columns = Math.ceil((maxX - minX) / cell), rows = Math.ceil((maxY - minY) / cell);
  // Avståndet (i rutor) till närmaste hus, med två svep (avfasat avstånd, 1 och √2).
  const far = 1e9, distance = new Float32Array(columns * rows).fill(far);
  for (const ring of houses) {
    const rx = ring.map(point => point[0]), ry = ring.map(point => point[1]);
    const c0 = Math.floor((Math.min(...rx) - minX) / cell), c1 = Math.ceil((Math.max(...rx) - minX) / cell);
    const r0 = Math.floor((Math.min(...ry) - minY) / cell), r1 = Math.ceil((Math.max(...ry) - minY) / cell);
    let any = false;
    for (let row = r0; row <= r1; row += 1) for (let column = c0; column <= c1; column += 1) {
      if (inside(ring, minX + (column + 0.5) * cell, minY + (row + 0.5) * cell)) { distance[row * columns + column] = 0; any = true; }
    }
    // Ett hus mindre än en ruta får sin mittruta.
    if (!any) distance[Math.floor((r0 + r1) / 2) * columns + Math.floor((c0 + c1) / 2)] = 0;
  }
  const at = (column: number, row: number) => column < 0 || row < 0 || column >= columns || row >= rows ? far : distance[row * columns + column]!;
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    const index = row * columns + column;
    distance[index] = Math.min(distance[index]!, at(column - 1, row) + 1, at(column, row - 1) + 1, at(column - 1, row - 1) + Math.SQRT2, at(column + 1, row - 1) + Math.SQRT2);
  }
  for (let row = rows - 1; row >= 0; row -= 1) for (let column = columns - 1; column >= 0; column -= 1) {
    const index = row * columns + column;
    distance[index] = Math.min(distance[index]!, at(column + 1, row) + 1, at(column, row + 1) + 1, at(column + 1, row + 1) + Math.SQRT2, at(column - 1, row + 1) + Math.SQRT2);
  }
  const reach = settings.radius / cell;
  // Maskhjälparna vill ha kolumnvis ordning (kolumn × rader + rad).
  const near = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) near[column * rows + row] = distance[row * columns + column]! <= reach ? 1 : 0;
  const mask = compactMask(near, columns, rows, Math.ceil(settings.minArea / (cell * cell)));
  // Rutnätets rad 0 är söder; ytterkanterna räknas från rutornas hörn.
  return maskOutlines(mask, columns, rows).map(ring => simplifyRing(ring, 0.75)).filter(ring => ring.length >= 4)
    .map(ring => ({ layer: "tomtmark_hus", geometry: { kind: "line" as const, closed: true, points: ring.map(([column, row]) => [minX + column * cell, minY + row * cell] as [number, number]) } }));
}
