import { describe, expect, it } from "vitest";
import { clipFeaturesToBox, joinStages } from "../src/base-map";
import type { SourceFeature } from "../src";

const box = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
const line = (points: [number, number][], closed = false, layer = "kurva"): SourceFeature => ({ layer, geometry: { kind: "line", points, closed } });

describe("etapperna som en grundkarta", () => {
  it("klipper punkter, linjer och ytor till etappens ruta", () => {
    const out = clipFeaturesToBox([
      { layer: "sten", geometry: { kind: "point", at: [50, 50] } },
      { layer: "sten", geometry: { kind: "point", at: [150, 50] } },
      line([[50, 50], [150, 50]]),
      { layer: "grönt", geometry: { kind: "area", rings: [[[50, 10], [150, 10], [150, 90], [50, 90]], [[120, 40], [140, 40], [140, 60]]] } }
    ], box);
    expect(out.map(feature => feature.geometry.kind)).toEqual(["point", "line", "area"]);
    const cut = out[1]!.geometry;
    expect(cut.kind === "line" && cut.points).toEqual([[50, 50], [100, 50]]);
    const area = out[2]!.geometry;
    // Ytterringen slutar vid kanten och hålet utanför rutan försvinner.
    expect(area.kind === "area" && area.rings.length).toBe(1);
    expect(area.kind === "area" && Math.max(...area.rings[0]!.map(([x]) => x))).toBe(100);
  });

  it("delar en sluten kurva som går över kanten i öppna bitar", () => {
    const out = clipFeaturesToBox([line([[80, 40], [120, 40], [120, 60], [80, 60]], true)], box);
    expect(out).toHaveLength(2);
    expect(out.every(feature => feature.geometry.kind === "line" && !feature.geometry.closed)).toBe(true);
  });

  it("slår ihop samma fil från alla etapper utan överlappet mellan dem", () => {
    // Två etapper kant i kant vid x = 100; båda har bearbetats med marginal, så samma kurva finns i båda.
    const curve = line([[60, 50], [140, 50]]);
    const joined = joinStages([
      { box, parts: [{ name: "kurvor.dxf", data: { features: [curve], skipped: 0, crs: 3006 } }] },
      { box: { minX: 100, minY: 0, maxX: 200, maxY: 100 }, parts: [
        { name: "kurvor.dxf", data: { features: [curve], skipped: 1 } },
        { name: "branter.dxf", data: { features: [line([[150, 10], [160, 20]])], skipped: 0 } }
      ] }
    ]);
    expect(joined.map(part => part.name)).toEqual(["kurvor.dxf", "branter.dxf"]);
    const kurvor = joined[0]!.data;
    expect(kurvor.crs).toBe(3006);
    expect(kurvor.skipped).toBe(1);
    // Kurvan finns en gång: 60–100 från första etappen och 100–140 från den andra.
    expect(kurvor.features.map(feature => feature.geometry.kind === "line" ? feature.geometry.points : [])).toEqual([[[60, 50], [100, 50]], [[100, 50], [140, 50]]]);
  });
});
