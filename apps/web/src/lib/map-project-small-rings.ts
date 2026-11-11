import type { SourceFeature } from "@o-tid/map-revision";

/**
 * Grundkartan G3, små slutna kurvor (ägaren 2026-11-11: «många små höjder borde ritats som punkthöjder i stället, för att minska
 * på antal täta kurvor»). En sluten kurva som är smalare än `widthMm` på kartan blir en punkt: liten kulle (`dotknoll`, 112)
 * om marken utanför är lägre, liten grop (`udepression`, 111) om den är högre. Ligger Karttapullautins egen knoll eller grop
 * redan inom ringen blir det ingen till. Marken utanför avgörs av den närmaste omslutande kurvan, annars av närmaste kurva
 * med annan höjd inom 40 m. Ringar som inte går att avgöra (utan höjd) lämnas.
 */
export const SMALL_RING_MM = 1.1;
const CONTOUR = /^contour(_index|_intermed)?$/;
const NEAR_METERS = 40;
type Ring = readonly (readonly [number, number])[];

const areaOf = (ring: Ring) => Math.abs(ring.reduce((sum, [x, y], i) => { const [nx, ny] = ring[(i + 1) % ring.length]!; return sum + x * ny - nx * y; }, 0)) / 2;
const centreOf = (ring: Ring): [number, number] => [ring.reduce((sum, p) => sum + p[0], 0) / ring.length, ring.reduce((sum, p) => sum + p[1], 0) / ring.length];
function inside(ring: Ring, x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** `scale` är kartans skala (t.ex. 10000); kurvorna i meter. */
export function smallRingsToPoints(features: readonly SourceFeature[], scale: number, widthMm = SMALL_RING_MM): SourceFeature[] {
  const maxWidth = widthMm * scale / 1000;
  const contours = features.filter(feature => CONTOUR.test(feature.layer) && feature.geometry.kind === "line" && feature.elevation !== undefined);
  const rings = contours.filter(feature => feature.geometry.kind === "line" && feature.geometry.closed)
    .map(feature => ({ feature, ring: (feature.geometry as { points: Ring }).points, area: areaOf((feature.geometry as { points: Ring }).points) }));
  const small = rings.filter(row => row.ring.length >= 3 && 2 * Math.sqrt(row.area / Math.PI) < maxWidth);
  if (!small.length) return [...features];
  const marks = features.filter(feature => feature.geometry.kind === "point" && /DOTKNOLL|DEPRESSION/i.test(feature.layer))
    .map(feature => (feature.geometry as { at: readonly [number, number] }).at);
  const removed = new Set<SourceFeature>(), added: SourceFeature[] = [];
  for (const row of small) {
    const height = row.feature.elevation!;
    const [cx, cy] = centreOf(row.ring);
    // Den minsta större ringen som omsluter mitten, annars närmaste kurva med annan höjd.
    const around = rings.filter(other => other !== row && other.area > row.area && other.feature.elevation !== height && inside(other.ring, cx, cy))
      .sort((a, b) => a.area - b.area)[0];
    let outside = around?.feature.elevation;
    if (outside === undefined) {
      let best = NEAR_METERS;
      for (const other of contours) {
        if (other.elevation === height) continue;
        for (const [x, y] of (other.geometry as { points: Ring }).points) {
          const distance = Math.hypot(x - cx, y - cy);
          if (distance < best) { best = distance; outside = other.elevation; }
        }
      }
    }
    if (outside === undefined) continue;
    removed.add(row.feature);
    if ([...marks, ...added.map(point => (point.geometry as { at: readonly [number, number] }).at)].some(([x, y]) => inside(row.ring, x, y))) continue;
    added.push({ layer: outside < height ? "dotknoll" : "udepression", geometry: { kind: "point", at: [cx, cy] } });
  }
  return [...features.filter(feature => !removed.has(feature)), ...added];
}
