import { describe, expect, it } from "vitest";
import { joinSeams, parseDxf, type SourceFeature } from "../src";

const line = (points: [number, number][], elevation?: number, layer = "contour"): SourceFeature =>
  ({ layer, ...(elevation !== undefined ? { elevation } : {}), geometry: { kind: "line", points, closed: false } });

describe("kurvorna fogas över rutornas skarvar", () => {
  it("fogar linjer på samma höjd vars ändar möts, åt båda hållen", () => {
    const joined = joinSeams([line([[0, 0], [10, 0]], 5), line([[20, 5], [10.2, 0.1]], 5), line([[-8, 3], [0, 0]], 5)]);
    expect(joined).toHaveLength(1);
    expect(joined[0]!.geometry).toEqual({ kind: "line", closed: false, points: [[-8, 3], [0, 0], [10, 0], [20, 5]] });
    expect(joined[0]!.elevation).toBe(5);
  });
  it("sluter en kedja som möter sig själv och rör inte andra höjder eller lager", () => {
    const ring = joinSeams([line([[0, 0], [10, 0], [10, 10]], 2.5), line([[10, 10], [0, 10], [0, 0.2]], 2.5)]);
    expect(ring).toHaveLength(1);
    expect(ring[0]!.geometry.kind === "line" && ring[0]!.geometry.closed).toBe(true);
    expect(joinSeams([line([[0, 0], [10, 0]], 5), line([[10, 0], [20, 0]], 7.5)])).toHaveLength(2);
    expect(joinSeams([line([[0, 0], [10, 0]], undefined, "cliff"), line([[10, 0], [20, 0]], undefined, "cliff")])).toHaveLength(2);
  });
  it("läser höjden ur DXF", () => {
    const dxf = ["0", "SECTION", "2", "ENTITIES", "0", "POLYLINE", "8", "contour", "38", "12.5", "0", "VERTEX", "8", "contour", "10", "1", "20", "2", "30", "12.5",
      "0", "VERTEX", "8", "contour", "10", "3", "20", "4", "30", "12.5", "0", "SEQEND", "0", "LWPOLYLINE", "8", "x", "10", "0", "20", "0", "10", "1", "20", "1",
      "0", "ENDSEC", "0", "EOF"].join("\n");
    const data = parseDxf(dxf);
    expect(data.features.map(feature => feature.elevation)).toEqual([12.5, undefined]);
  });
  it("fogar en lång kedja om 1 000 kurvbitar i båda riktningar utan O(N^2)-kopiering", () => {
    const pieces: SourceFeature[] = [];
    // Blanda framåt- och bakåtbitar så både framåt- och bakåtpasset växer stort.
    for (let i = 0; i < 1000; i += 1) {
      const seg: [number, number][] = i % 2 === 0 ? [[i * 10, 0], [(i + 1) * 10, 0]] : [[(i + 1) * 10, 0], [i * 10, 0]];
      pieces.push(line(seg, 15));
    }
    const ordered = [pieces[500]!, ...pieces.slice(501), ...pieces.slice(0, 500).reverse()];
    const started = performance.now();
    const joined = joinSeams(ordered);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(joined).toHaveLength(1);
    expect(joined[0]!.geometry.kind === "line" && joined[0]!.geometry.points).toHaveLength(1001);
  });
});
