import { describe, expect, it } from "vitest";
import type { SourceFeature } from "@o-tid/map-revision";
import { clearCutFeatures, withoutCutVegetation } from "./map-project-clear-cuts";

const square = (x: number): [number, number][] => [[x, 0], [x + 100, 0], [x + 100, 100], [x, 100], [x, 0]];
const cut = (x: number, date: string | null) => ({ rings: [square(x)], date, kind: "Slutavverkning" });

describe("hyggen efter ålder", () => {
  it("delar in i färskt, sly och ungskog och hoppar över gamla och odaterade", () => {
    const result = clearCutFeatures([cut(0, "2025-06-01"), cut(200, "2021-05-01"), cut(400, "2015-05-01"), cut(600, "2005-05-01"), cut(800, null)], "2026-11-11", "2023-04-20");
    // Skanningen 2023 är nyare än hyggena från 2021 och 2015: lasern visar dem, så bara slyets raster läggs på.
    expect(result.features.filter(feature => feature.geometry.kind === "area").map(feature => feature.layer)).toEqual(["hygge_farskt", "hygge_sly"]);
    // Utan skanningsdatum går allt på åldern: slyet får ödemark under rastret.
    expect(clearCutFeatures([cut(0, "2025-06-01"), cut(200, "2021-05-01"), cut(400, "2015-05-01")], "2026-11-11", null).features
      .filter(feature => feature.geometry.kind === "area").map(feature => feature.layer)).toEqual(["hygge_farskt", "hygge_sly_mark", "hygge_sly", "hygge_ungskog"]);
    expect(result.features.filter(feature => feature.layer === "bestandsgrans")).toHaveLength(3);
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
});
