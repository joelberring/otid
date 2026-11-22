import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { slimDxf } from "../../../scripts/geo-slim.ts";
import { parseDxf, type SourceGeometry } from "../src/vector-parse";

/** Ägaren 2026-11-22: geo-serverns DXF-filer förenklas innan de skickas (scripts/geo-slim.ts). */
const fixture = (name: string) => gunzipSync(readFileSync(new URL(`../../../fixtures/laser/kungshatt-300m/${name}`, import.meta.url))).toString("utf8");
const coordinates = (geometry: SourceGeometry): number[][] =>
  (geometry.kind === "point" ? [geometry.at] : geometry.kind === "line" ? geometry.points : geometry.rings.flat()).map(([x, y]) => [x, y]);
const distance = (p: number[], a: number[], b: number[]) => {
  const dx = b[0]! - a[0]!, dy = b[1]! - a[1]!, length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p[0]! - a[0]!) * dx + (p[1]! - a[1]!) * dy) / length)) : 0;
  return Math.hypot(p[0]! - a[0]! - t * dx, p[1]! - a[1]! - t * dy);
};

describe("förenklade DXF-filer från geo-servern", () => {
  it("gör Karttapullautins kurvor mycket mindre med samma linjer, lager och höjder", () => {
    const text = fixture("kurvor.dxf.gz"), slim = slimDxf(text);
    const before = parseDxf(text).features, after = parseDxf(slim).features;
    expect(slim.length).toBeLessThan(text.length * 0.4);
    expect(after.map(feature => [feature.layer, feature.elevation])).toEqual(before.map(feature => [feature.layer, feature.elevation]));
    let worst = 0;
    before.forEach((feature, index) => {
      const geometry = after[index]!.geometry, line = coordinates(geometry);
      if (geometry.kind === "line" && geometry.closed) line.push(line[0]!);
      expect(line.length).toBeGreaterThanOrEqual(2);
      for (const point of coordinates(feature.geometry)) {
        let nearest = Infinity;
        for (let k = 0; k + 1 < line.length; k += 1) nearest = Math.min(nearest, distance(point, line[k]!, line[k + 1]!));
        worst = Math.max(worst, nearest);
      }
    });
    expect(worst).toBeGreaterThan(0.05);
    expect(worst).toBeLessThan(0.22);
  });
  it("behåller slutna linjer slutna och korta streck som de är", () => {
    const ring = ["0", "SECTION", "2", "ENTITIES", "0", "POLYLINE", "8", "yta", "66", "1", "70", "1",
      ...[[0, 0], [5, 0.01], [10, 0], [10, 10], [0, 10]].flatMap(([x, y]) => ["0", "VERTEX", "8", "yta", "10", String(x), "20", String(y)]),
      "0", "SEQEND", "0", "POLYLINE", "8", "streck", "66", "1",
      ...[[1.123456789, 2], [3, 4.987654321]].flatMap(([x, y]) => ["0", "VERTEX", "8", "streck", "10", String(x), "20", String(y)]),
      "0", "SEQEND", "0", "ENDSEC", "0", "EOF"].join("\n");
    const [area, tick] = parseDxf(slimDxf(ring)).features;
    expect(area!.geometry.kind === "line" && area!.geometry.closed).toBe(true);
    expect(coordinates(area!.geometry)).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);
    expect(coordinates(tick!.geometry)).toEqual([[1.12, 2], [3, 4.99]]);
  });
});
