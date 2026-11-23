import { describe, expect, it } from "vitest";
import { parseDxf, type SourceGeometry } from "../src/vector-parse";

/** ADR-0219 K6b-tillägget 2026-11-23: HATCH-ytor (Stockholms byggnader och sjöar), bågar och buktiga polylinjer i DXF. */
const dxf = (...entities: (string | number)[][]) => ["0", "SECTION", "2", "ENTITIES", ...entities.flat().map(String), "0", "ENDSEC", "0", "EOF"].join("\n");
/** En HATCH med lagret och gränsvägarna (redan kodade), som i Stockholms baskarta: elevation, mönster, fyllning, sedan 91. */
const hatch = (layer: string, paths: (string | number)[][], tail: (string | number)[] = []) => ["0", "HATCH", "8", layer, "100", "AcDbHatch",
  "10", 0, "20", 0, "30", 0, "2", "SOLID", "70", 1, "71", 0, "91", paths.length, ...paths.flat(), "75", 0, "76", 1, "98", 1, "10", 5, "20", 5, ...tail];
/** En polylinjeväg (vägtyp 2) med hörn [x, y, bulge?]. */
const polyPath = (vertices: number[][]) => {
  const bulge = vertices.some(vertex => vertex[2] !== undefined);
  return ["92", 2, "72", bulge ? 1 : 0, "73", 1, "93", vertices.length,
    ...vertices.flatMap(([x, y, b]) => ["10", x!, "20", y!, ...(bulge ? ["42", b ?? 0] : [])]), "97", 0];
};
const shoelace = (ring: readonly (readonly [number, number])[]) =>
  Math.abs(ring.reduce((sum, point, index) => { const next = ring[(index + 1) % ring.length]!; return sum + point[0] * next[1] - next[0] * point[1]; }, 0)) / 2;
const area = (geometry: SourceGeometry) => {
  if (geometry.kind !== "area") throw new Error(geometry.kind);
  return shoelace(geometry.rings[0]!) - geometry.rings.slice(1).reduce((sum, ring) => sum + shoelace(ring), 0);
};
const HALF_DISC = Math.PI * 25 / 2;

describe("HATCH i DXF", () => {
  it("läser en polylinjeväg med bulge som en yta med bågen utplattad", () => {
    const data = parseDxf(dxf(hatch("BostadsbyggnadFlerbostadshusgy", [polyPath([[0, 0, 1], [10, 0], [10, 10], [0, 10]])])));
    expect(data.skipped).toBe(0);
    const [feature] = data.features;
    expect(feature?.layer).toBe("BostadsbyggnadFlerbostadshusgy");
    expect(area(feature!.geometry)).toBeCloseTo(100 + HALF_DISC, 0);
    // Positiv bulge från (0, 0) till (10, 0) går moturs runt (5, 0), alltså under linjen; frökornets 10/20 efter vägarna läses inte.
    const ys = feature!.geometry.kind === "area" ? feature!.geometry.rings[0]!.map(([, y]) => y) : [];
    expect(Math.min(...ys)).toBeCloseTo(-5, 1);
    expect(Math.max(...ys)).toBe(10);
  });

  it("läser kantvägar med linjer och bågar, moturs och medurs", () => {
    const ccw = ["92", 1, "93", 4, "72", 1, "10", 0, "20", 0, "11", 10, "21", 0,
      "72", 2, "10", 10, "20", 5, "40", 5, "50", 270, "51", 90, "73", 1,
      "72", 1, "10", 10, "20", 10, "11", 0, "21", 10, "72", 1, "10", 0, "20", 10, "11", 0, "21", 0, "97", 1, "330", "ABC"];
    // Samma yta åt andra hållet: medurs båge från (10, 10) till (10, 0) med vinklarna som 360 − vinkeln.
    const cw = ["92", 1, "93", 4, "72", 1, "10", 0, "20", 0, "11", 0, "21", 10, "72", 1, "10", 0, "20", 10, "11", 10, "21", 10,
      "72", 2, "10", 10, "20", 5, "40", 5, "50", 270, "51", 90, "73", 0, "72", 1, "10", 10, "20", 0, "11", 0, "21", 0, "97", 0];
    const data = parseDxf(dxf(hatch("A", [ccw]), hatch("B", [cw])));
    expect(data.features).toHaveLength(2);
    for (const feature of data.features) {
      expect(area(feature.geometry), feature.layer).toBeCloseTo(100 + HALF_DISC, 0);
      const xs = feature.geometry.kind === "area" ? feature.geometry.rings[0]!.map(([x]) => x) : [];
      expect(Math.max(...xs), feature.layer).toBeCloseTo(15, 5);
    }
  });

  it("läser ellips- och splinekanter", () => {
    const ellipse = ["92", 1, "93", 2, "72", 3, "10", 0, "20", 0, "11", 10, "21", 0, "40", 0.5, "50", 0, "51", 180, "73", 1,
      "72", 1, "10", -10, "20", 0, "11", 10, "21", 0, "97", 0];
    const spline = ["92", 1, "93", 2, "72", 4, "94", 3, "73", 0, "74", 0, "95", 8, "96", 4, ...[0, 0, 0, 0, 1, 1, 1, 1].flatMap(k => ["40", k]),
      "10", 0, "20", 0, "10", 3, "20", 5, "10", 7, "20", 5, "10", 10, "20", 0, "72", 1, "10", 10, "20", 0, "11", 0, "21", 0, "97", 0];
    const [half, curve] = parseDxf(dxf(hatch("E", [ellipse]), hatch("S", [spline]))).features;
    expect(area(half!.geometry)).toBeCloseTo(Math.PI * 10 * 5 / 2, 0);
    expect(curve!.geometry.kind === "area" ? curve!.geometry.rings[0]!.length : 0).toBe(4);
  });

  it("gör en inre väg till ett hål och en väg bredvid till en egen yta", () => {
    const data = parseDxf(dxf(hatch("H", [
      polyPath([[0, 0], [10, 0], [10, 10], [0, 10]]), polyPath([[2, 2], [4, 2], [4, 4], [2, 4]]), polyPath([[20, 0], [30, 0], [30, 10], [20, 10]])
    ])));
    expect(data.features).toHaveLength(2);
    const [holed, beside] = data.features;
    expect(holed!.geometry.kind === "area" ? holed!.geometry.rings.length : 0).toBe(2);
    expect(area(holed!.geometry)).toBeCloseTo(96, 6);
    expect(area(beside!.geometry)).toBeCloseTo(100, 6);
  });

  it("räknar en HATCH utan gränsväg som överhoppad", () => {
    const data = parseDxf(dxf(hatch("Tom", []), hatch("Platt", [polyPath([[0, 0], [1, 1]])])));
    expect(data.features).toHaveLength(0);
    expect(data.skipped).toBe(2);
  });
});

describe("bågar i DXF", () => {
  it("plattar ut ARC och LWPOLYLINE med bulge", () => {
    const data = parseDxf(dxf(
      ["0", "ARC", "8", "Kant", "10", 0, "20", 0, "40", 10, "50", 0, "51", 90],
      ["0", "LWPOLYLINE", "8", "Kant", "70", 0, "90", 2, "10", 0, "20", 0, "42", -1, "10", 10, "20", 0]
    ));
    const [arc, bulged] = data.features.map(feature => feature.geometry.kind === "line" ? feature.geometry.points : []);
    expect(arc![0]![0]).toBeCloseTo(10, 9);
    expect(arc![arc!.length - 1]![1]).toBeCloseTo(10, 9);
    expect(arc!.length).toBeGreaterThanOrEqual(10);
    // Negativ bulge: medurs, alltså över linjen.
    expect(Math.max(...bulged!.map(([, y]) => y))).toBeCloseTo(5, 1);
    expect(bulged![bulged!.length - 1]).toEqual([10, 0]);
  });
});
