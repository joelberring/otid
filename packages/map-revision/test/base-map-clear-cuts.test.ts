import { describe, expect, it } from "vitest";
import type { SourceFeature } from "../src";
import { clearCutFeatures, cutRing, withoutCutVegetation } from "../src/base-map/clear-cuts";

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
});
