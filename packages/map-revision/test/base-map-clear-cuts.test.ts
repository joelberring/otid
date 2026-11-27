import { describe, expect, it } from "vitest";
import type { SourceFeature } from "../src";
import { clearCutFeatures, cutRing, fillRingScanline, withoutCutVegetation } from "../src/base-map/clear-cuts";

const square = (x: number): [number, number][] => [[x, 0], [x + 100, 0], [x + 100, 100], [x, 100], [x, 0]];
const cut = (x: number, date: string | null) => ({ rings: [square(x)], date, kind: "Slutavverkning" });

describe("hyggen efter ålder", () => {
  it("delar in i färskt, sly och ungskog och hoppar över gamla och odaterade", () => {
    const result = clearCutFeatures([cut(0, "2025-06-01"), cut(200, "2021-05-01"), cut(400, "2015-05-01"), cut(600, "2005-05-01"), cut(800, null)], "2026-11-11", "2023-04-20");
    // Skanningen 2023 är nyare än hyggena från 2021 och 2015: lasern visar dem, så de tas inte med (ägaren 2026-11-17).
    expect(result.features.filter(feature => feature.geometry.kind === "area").map(feature => feature.layer)).toEqual(["hygge_farskt"]);
    // Utan skanningsdatum går allt på åldern: slyet får ödemark under rastret.
    expect(clearCutFeatures([cut(0, "2025-06-01"), cut(200, "2021-05-01"), cut(400, "2015-05-01")], "2026-11-11", null).features
      .filter(feature => feature.geometry.kind === "area").map(feature => feature.layer)).toEqual(["hygge_farskt", "hygge_sly_mark", "hygge_sly", "hygge_ungskog"]);
    expect(result.features.filter(feature => feature.layer === "bestandsgrans")).toHaveLength(1);
    expect(result.counts).toEqual({ fresh: 1, scrub: 1, young: 1 });
    // Bara hygget från 2025 är yngre än skanningen 2023.
    expect(result.afterScan).toHaveLength(1);
  });
  it("tar bort laserns vegetation i ett hygge som är yngre än skanningen", () => {
    const green = (x: number): SourceFeature => ({ layer: "gron_lattlopt", geometry: { kind: "line", closed: true, points: square(x).slice(0, -1).map(([a, b]) => [a + 10, b + 10]) } });
    const contour: SourceFeature = { layer: "contour", geometry: { kind: "line", closed: false, points: [[20, 20], [30, 30]] } };
    const { afterScan } = clearCutFeatures([cut(0, "2025-06-01")], "2026-11-11", "2023-04-20");
    expect(withoutCutVegetation([green(0), green(300), contour], afterScan).map(feature => feature.layer)).toEqual(["gron_lattlopt", "contour"]);
  });
  it("hyggets hackiga kant (10 m-rutor) generaliseras: inga små hack, rakare kant, nästan samma yta", () => {
    // 200 × 120 m med trappsteg om 10 m längs överkanten och ett hack på 10 × 10 m i nederkanten.
    const ring: [number, number][] = [[0, 0], [90, 0], [90, 10], [100, 10], [100, 0], [200, 0], [200, 120]];
    for (let x = 190; x >= 0; x -= 10) ring.push([x + 10, x % 20 === 0 ? 120 : 110], [x, x % 20 === 0 ? 120 : 110]);
    ring.push([0, 0]);
    const smooth = cutRing(ring)!;
    const area = (points: readonly [number, number][]) => Math.abs(points.reduce((sum, [x, y], i) => { const [nx, ny] = points[(i + 1) % points.length]!; return sum + x * ny - nx * y; }, 0)) / 2;
    expect(Math.abs(area(smooth) / area(ring) - 1)).toBeLessThan(0.12);
    // Hacket (95, 5) är fyllt, och kanten följer inte trappstegen.
    const inside = (x: number, y: number) => { let hit = false; for (let i = 0, j = smooth.length - 1; i < smooth.length; j = i, i += 1) { const [xi, yi] = smooth[i]!, [xj, yj] = smooth[j]!; if (yi > y !== yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit; } return hit; };
    expect(inside(95, 5)).toBe(true);
    expect(smooth.length).toBeLessThan(ring.length * 3);
  });
  it("ett litet hygge (40 × 40 m) försvinner inte i generaliseringen", () => {
    const square: [number, number][] = [[0, 0], [40, 0], [40, 40], [0, 40], [0, 0]];
    expect(cutRing(square)!.length).toBeGreaterThanOrEqual(4);
  });
  it("stora hyggen behåller raka hörn, små hack rundas bort (ägaren 2026-11-18)", () => {
    // 300 × 200 m i 10 m-rutor med ett trappsteg och ett hack på 10 × 10 m mitt på nederkanten.
    const ring: [number, number][] = [[1000, 1000], [1140, 1000], [1140, 1010], [1150, 1010], [1150, 1000], [1300, 1000], [1300, 1200], [1010, 1200], [1010, 1190], [1000, 1190], [1000, 1000]];
    const smooth = cutRing(ring)!;
    const nearest = (x: number, y: number) => Math.min(...smooth.map(([px, py]) => Math.hypot(px - x, py - y)));
    // Tre hörn ligger skarpt (inom 3 m); det fjärde har trappsteget och får rundas.
    expect(nearest(1000, 1000)).toBeLessThan(3);
    expect(nearest(1300, 1000)).toBeLessThan(3);
    expect(nearest(1300, 1200)).toBeLessThan(3);
    // Hacket är borta: ingen punkt nära hackets botten.
    expect(nearest(1145, 1010)).toBeGreaterThan(5);
  });
  it("ett runt eller sneddat hygge får inga påhittade hörn", () => {
    const circle: [number, number][] = Array.from({ length: 40 }, (_, i) => [Math.round(100 * Math.cos(i / 40 * 2 * Math.PI) / 10) * 10, Math.round(100 * Math.sin(i / 40 * 2 * Math.PI) / 10) * 10] as [number, number]);
    circle.push(circle[0]!);
    const smooth = cutRing(circle)!;
    // Ingen punkt utanför cirkeln med marginal (ett påhittat hörn i skärningen mellan två sidor skulle sticka ut).
    expect(Math.max(...smooth.map(([x, y]) => Math.hypot(x, y)))).toBeLessThan(108);
  });
  it("scanline-fyllningen har bitexakt paritet mot per-cell PIP på konkava polygoner och kantfall", () => {
    const insideRef = (ring: readonly (readonly [number, number])[], x: number, y: number) => {
      let hit = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
      }
      return hit;
    };
    // Konkav U-form + hörn exakt på cellmittpunkter (u = 1, 3, 5, ...) + horisontella och sneda sidor.
    const shapes: [number, number][][] = [
      [[1, 1], [31, 1], [31, 11], [15, 11], [15, 21], [31, 21], [31, 31], [1, 31], [1, 1]],
      [[0, 0], [20, 5], [40, 0], [35, 15], [50, 25], [25, 20], [15, 35], [10, 17], [0, 20], [0, 0]],
      [[5, 5], [15, 5], [15, 15], [25, 15], [25, 5], [35, 5], [35, 25], [5, 25], [5, 5]]
    ];
    for (const poly of shapes) {
      const left = -10, top = 45, cols = 36, rows = 30, cell = 2;
      const scanline = new Uint8Array(cols * rows);
      const naive = new Uint8Array(cols * rows);
      fillRingScanline(scanline, poly, left, top, cols, rows, cell, 1);
      for (let c = 0; c < cols; c += 1) {
        const x = left + (c + 0.5) * cell;
        for (let r = 0; r < rows; r += 1) {
          if (insideRef(poly, x, top - (r + 0.5) * cell)) naive[c * rows + r] = 1;
        }
      }
      expect(scanline).toEqual(naive);
    }
    // Prestanda: 600 × 600 m polygon med 200 hörn.
    const bigPoly: [number, number][] = Array.from({ length: 200 }, (_, i) => {
      const a = (i / 200) * Math.PI * 2;
      const r = 240 + (i % 5 === 0 ? 40 : 0);
      return [300 + r * Math.cos(a), 300 + r * Math.sin(a)];
    });
    bigPoly.push(bigPoly[0]!);
    const buf = new Uint8Array(320 * 320);
    const started = performance.now();
    fillRingScanline(buf, bigPoly, -20, 620, 320, 320, 2, 1);
    expect(performance.now() - started).toBeLessThan(150);
    expect(buf.reduce((s, v) => s + v, 0)).toBeGreaterThan(40_000);
  });
});
