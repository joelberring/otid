import { describe, expect, it } from "vitest";
import type { SourceFeature } from "@o-tid/map-revision";
import { smallRingsToPoints } from "./map-project-small-rings";

const ring = (cx: number, cy: number, r: number, elevation: number, layer = "contour"): SourceFeature => ({ layer, elevation,
  geometry: { kind: "line", closed: true, points: Array.from({ length: 12 }, (_, i) => [cx + r * Math.cos(i * Math.PI / 6), cy + r * Math.sin(i * Math.PI / 6)] as [number, number]) } });

describe("små slutna kurvor blir punkthöjder", () => {
  it("en liten ring på en högre nivå än omgivningen blir en liten kulle, en lägre blir en grop", () => {
    const out = smallRingsToPoints([ring(0, 0, 100, 10), ring(0, 0, 5, 15), ring(50, 0, 4, 5)], 10000);
    expect(out.filter(f => f.geometry.kind === "line")).toHaveLength(1);
    expect(out.filter(f => f.geometry.kind === "point").map(f => f.layer).sort()).toEqual(["dotknoll", "udepression"]);
  });
  it("lämnar stora ringar, och gör ingen ny kulle där Karttapullautins knoll redan ligger", () => {
    const knoll: SourceFeature = { layer: "dotknoll", geometry: { kind: "point", at: [1, 0] } };
    const out = smallRingsToPoints([ring(0, 0, 100, 10), ring(0, 0, 5, 15), ring(300, 0, 30, 10), knoll], 10000);
    expect(out.filter(f => f.geometry.kind === "point")).toEqual([knoll]);
    expect(out.filter(f => f.geometry.kind === "line")).toHaveLength(2);
  });
});
