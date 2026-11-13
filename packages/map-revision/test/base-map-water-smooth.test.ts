import { describe, expect, it } from "vitest";
import { joinStages, mergeBaseMap, smoothRing, smoothWater } from "../src/base-map";
import type { SourceFeature } from "../src";

const area = (ring: readonly (readonly [number, number])[]) => Math.abs(ring.reduce((sum, [x, y], i) => {
  const [nx, ny] = ring[(i + 1) % ring.length]!; return sum + x * ny - nx * y; }, 0)) / 2;

/** En cirkel med radien `r` ritad som ett 2 m-rasters trappsteg. */
function staircaseCircle(r: number): [number, number][] {
  const points: [number, number][] = [];
  for (let k = 0; k < 360; k += 1) {
    const a = k * Math.PI / 180, x = Math.round(r * Math.cos(a) / 2) * 2, y = Math.round(r * Math.sin(a) / 2) * 2;
    const last = points[points.length - 1];
    if (last && last[0] !== x && last[1] !== y) points.push([x, last[1]]);
    if (!last || last[0] !== x || last[1] !== y) points.push([x, y]);
  }
  return points;
}

describe("vattnets kant jämnas ut (ägaren 2026-11-13: «strandlinjer blir väldigt hackiga»)", () => {
  it("gör ett trappsteg till en jämn kant med samma storlek", () => {
    const ring = staircaseCircle(60), smooth = smoothRing(ring);
    expect(smooth.length).toBeLessThan(ring.length);
    expect(area(smooth) / area(ring)).toBeGreaterThan(0.97);
    expect(area(smooth) / area(ring)).toBeLessThan(1.03);
    // Kanten ligger nära den sanna cirkeln: inga trappsteg kvar.
    for (const [x, y] of smooth) expect(Math.abs(Math.hypot(x, y) - 60)).toBeLessThan(1.5);
  });

  it("flyttar inte punkter på körningens kant och krymper inte en liten ö bort", () => {
    const lake: SourceFeature = { layer: "vatten", geometry: { kind: "area", rings: [[[0, 0], [100, 0], [100, 50], [60, 52], [40, 48], [0, 50]]] } };
    const [smoothed] = smoothWater([lake], { minX: 0, minY: 0, maxX: 100, maxY: 100 });
    const ring = smoothed!.geometry.kind === "area" ? smoothed!.geometry.rings[0]! : [];
    for (const corner of [[0, 0], [100, 0]]) expect(ring).toContainEqual(corner);
    const islet = staircaseCircle(6);
    // Mot den sanna cirkelns yta (trappstegens hörn sticker ut): högst några procent mindre.
    expect(area(smoothRing(islet)) / (Math.PI * 36)).toBeGreaterThan(0.85);
  });

  it("strandlinjen över en etappgräns går inte rakt över sjön", () => {
    // En sjö som går över gränsen x = 100 mellan två etapper; varje etapp har sjön med 50 m marginal.
    const lake = (): SourceFeature => ({ layer: "vatten", geometry: { kind: "area", rings: [[[50, 20], [150, 20], [150, 80], [50, 80]]] } });
    const parts = joinStages([
      { box: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, parts: [{ name: "vatten.geojson", data: { features: [lake()], skipped: 0 } }] },
      { box: { minX: 100, minY: 0, maxX: 200, maxY: 100 }, parts: [{ name: "vatten.geojson", data: { features: [lake()], skipped: 0 } }] }
    ]);
    expect(parts[0]!.data.features).toHaveLength(1);
    const shore = mergeBaseMap(parts).features.filter(feature => feature.layer === "strandlinje");
    const crossing = shore.some(feature => feature.geometry.kind === "line" && feature.geometry.points.some(([x, y]) => Math.abs(x - 100) < 1 && y > 25 && y < 75));
    expect(crossing).toBe(false);
  });
});
