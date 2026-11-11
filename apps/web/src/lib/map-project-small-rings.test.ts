import { describe, expect, it } from "vitest";
import type { SourceFeature } from "@o-tid/map-revision";
import { smallRingsToPoints } from "./map-project-small-rings";

const ring = (cx: number, cy: number, r: number, elevation: number, layer = "contour"): SourceFeature => ({ layer, elevation,
  geometry: { kind: "line", closed: true, points: Array.from({ length: 12 }, (_, i) => [cx + r * Math.cos(i * Math.PI / 6), cy + r * Math.sin(i * Math.PI / 6)] as [number, number]) } });

describe("små slutna kurvor blir punkthöjder (ISOM 2017-2)", () => {
  it("följer normens minsta mått: en grop behöver 1,1 mm, en kulle 0,9 mm", () => {
    // 1:15 000: en ring med diametern 14 m räcker för en kulle (13,5 m) men inte för en grop (16,5 m).
    const out = smallRingsToPoints([ring(0, 0, 100, 10), ring(-40, 0, 7, 15), ring(40, 0, 7, 5)], 15000, 1);
    expect(out.filter(f => f.geometry.kind === "line").map(f => f.elevation).sort()).toEqual([10, 15]);
    expect(out.filter(f => f.geometry.kind === "point").map(f => f.layer)).toEqual(["udepression"]);
  });
  it("generaliserar med en marginal på 20 % över normens minsta", () => {
    // 14 m räcker för en kulle i 1:15 000 enligt normen (13,5 m) men inte med marginalen (16,2 m).
    expect(smallRingsToPoints([ring(0, 0, 100, 10), ring(-40, 0, 7, 15)], 15000).map(f => f.layer)).toEqual(["contour", "dotknoll"]);
  });
  it("gör en liten stödkurvering till vanlig kurva och tar bort små formlinjeringar", () => {
    const out = smallRingsToPoints([ring(0, 0, 100, 10), ring(0, 0, 9, 25, "contour_index"), { ...ring(200, 0, 5, 0, "formline"), elevation: undefined }], 15000, 1);
    expect(out.map(f => f.layer).sort()).toEqual(["contour", "contour"]);
  });
  it("en liten ring på en högre nivå än omgivningen blir en liten kulle, en lägre blir en grop", () => {
    const out = smallRingsToPoints([ring(0, 0, 100, 10), ring(0, 0, 5, 15), ring(50, 0, 4, 5)], 15000, 1);
    expect(out.filter(f => f.geometry.kind === "line")).toHaveLength(1);
    expect(out.filter(f => f.geometry.kind === "point").map(f => f.layer).sort()).toEqual(["dotknoll", "udepression"]);
  });
  it("lämnar stora ringar, och gör ingen ny kulle där Karttapullautins knoll redan ligger", () => {
    const knoll: SourceFeature = { layer: "dotknoll", geometry: { kind: "point", at: [1, 0] } };
    const out = smallRingsToPoints([ring(0, 0, 100, 10), ring(0, 0, 5, 15), ring(300, 0, 30, 10), knoll], 15000, 1);
    expect(out.filter(f => f.geometry.kind === "point")).toEqual([knoll]);
    expect(out.filter(f => f.geometry.kind === "line")).toHaveLength(2);
  });
  it("tar bort laserns kulle nära Karttapullautins eller inuti en kvarvarande liten toppkurva", () => {
    const laser = (x: number, y: number): SourceFeature => ({ layer: "dotknoll_laser", geometry: { kind: "point", at: [x, y] } });
    const knoll: SourceFeature = { layer: "dotknoll", geometry: { kind: "point", at: [200, 0] } };
    const out = smallRingsToPoints([ring(0, 0, 300, 10), ring(100, 0, 20, 15), knoll, laser(203, 0), laser(100, 0), laser(-150, 0)], 15000, 1);
    expect(out.filter(f => f.layer === "dotknoll_laser").map(f => (f.geometry as { at: readonly [number, number] }).at)).toEqual([[-150, 0]]);
  });
});
