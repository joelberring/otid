import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { suggestSymbol } from "../src";
import { parseDxf } from "../src/vector-parse";
import { decodeGrayPng, readWorldFile, vegetationFromTiles, vegetationMosaic, type ClassImage } from "../../../scripts/geo-vegetation";

/** ADR-0219 K5c del 3: vegetationen ur Karttapullautins klassbilder i geo-arbetaren (scripts/geo-vegetation.ts). */
function grayPng(image: ClassImage, filters: readonly number[] = [0]): Uint8Array {
  const { width, height, data } = image;
  const raw = Buffer.alloc(height * (width + 1));
  for (let row = 0; row < height; row += 1) {
    const filter = filters[row % filters.length]!;
    raw[row * (width + 1)] = filter;
    for (let x = 0; x < width; x += 1) {
      const value = data[row * width + x]!, left = x > 0 ? data[row * width + x - 1]! : 0, up = row > 0 ? data[(row - 1) * width + x]! : 0;
      const corner = row > 0 && x > 0 ? data[(row - 1) * width + x - 1]! : 0;
      const p = left + up - corner, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - corner);
      const predicted = filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1
        : filter === 4 ? (pa <= pb && pa <= pc ? left : pb <= pc ? up : corner) : 0;
      raw[row * (width + 1) + 1 + x] = (value - predicted) & 0xff;
    }
  }
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, "ascii");
    return Buffer.concat([head, body, Buffer.alloc(4)]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header.set([8, 0, 0, 0, 0], 8);
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
function image(width: number, height: number, f: (column: number, row: number) => number): ClassImage {
  const data = new Uint8Array(width * height);
  for (let row = 0; row < height; row += 1) for (let column = 0; column < width; column += 1) data[row * width + column] = f(column, row);
  return { width, height, data };
}
const world = (left: number, top: number) => ({ size: 1, left: left + 0.5, top: top - 0.5 });

describe("vegetationen ur klassbilderna", () => {
  it("avkodar gråskale-PNG med alla filter och läser världsfilen", () => {
    const source = image(37, 23, (column, row) => (column * 7 + row * 13) % 11);
    for (const filters of [[0], [1], [2], [3], [4], [0, 1, 2, 3, 4]]) expect(decodeGrayPng(grayPng(source, filters)).data).toEqual(source.data);
    expect(readWorldFile("1.0\r\n0.0\r\n0.0\r\n-1.0\r\n675000.5\r\n6580999.5\r\n")).toEqual({ size: 1, left: 675000.5, top: 6580999.5 });
    expect(() => decodeGrayPng(new Uint8Array(40))).toThrow();
    expect(() => readWorldFile("1\n0\n0\n1\n0\n0")).toThrow();
  });

  it("slår ihop rutorna i 2 m-celler med flest röster", () => {
    const a = image(100, 100, column => column < 50 ? 1 : 0), b = image(100, 100, () => 7);
    const { grid, classes } = vegetationMosaic([{ vege: a, world: world(675_000, 6_581_000) }, { vege: b, world: world(675_100, 6_581_000) }]);
    expect(grid).toMatchObject({ minX: 675_001, minY: 6_580_901, cell: 2, width: 100, height: 50 });
    expect(classes[10 * 50 + 10]).toBe(1);
    expect(classes[30 * 50 + 10]).toBe(0);
    expect(classes[80 * 50 + 10]).toBe(7);
  });

  it("ger kapslade ytor för öppen mark, tre gröna och undervegetation, utan små öar", () => {
    // 200 × 200 m: öppen mark i väster, grönt (nyans 2 → 406) i mitten med en kärna av nyans 6 (410) och en liten fläck
    // (nyans 6, 4 m²) som är för liten; undervegetation som glesa streck i öster.
    const vege = image(200, 200, (column, row) => column < 60 ? 1
      : column < 140 ? (Math.hypot(column - 100, row - 100) < 20 ? 8 : 4) : (column === 170 && row === 20) || (column === 171 && row === 20) ? 8 : 0);
    const undergrowth = image(200, 200, (column, row) => column >= 150 && row >= 120 && row < 180 && column % 4 === 0 && row % 4 === 0 ? 2 : 0);
    const result = vegetationFromTiles([{ vege, undergrowth, world: world(675_000, 6_581_000) }], { minAreaM2: 100 });
    expect(result.summary.ha401).toBeCloseTo(1.2, 1);
    expect(result.summary.ha406).toBeCloseTo(1.6, 1);
    expect(result.summary.ha408).toBeCloseTo(0.13, 1);
    expect(result.summary.ha410).toBeCloseTo(0.13, 1);
    expect(result.summary.ha407).toBeGreaterThan(0.2);
    expect(result.summary.ha409).toBe(result.summary.ha407);
    const data = parseDxf(result.dxf);
    const layers = new Map(data.features.map(feature => [feature.layer, feature.geometry.kind]));
    expect([...layers.keys()].sort()).toEqual(["gron_lattlopt", "gron_mycket_svarlopt", "gron_svarlopt", "oppen_mark", "undervegetation_lattlopt",
      "undervegetation_svarlopt"]);
    expect(data.features.filter(feature => feature.layer === "gron_mycket_svarlopt")).toHaveLength(1);
  });

  it("punktmolnets öppet och tätt går före Karttapullautins klass (lärt av Högdalenkartan 2026-11-11)", () => {
    // Karttapullautin säger skog överallt; punktmolnet säger öppet i väster och tätt buskskikt i öster.
    const vege = image(100, 100, () => 2);
    const signals = { openAt: (x: number) => x < 675_040, denseAt: (x: number) => x >= 675_060 };
    const result = vegetationFromTiles([{ vege, world: world(675_000, 6_581_000) }], { minAreaM2: 100 }, undefined, signals);
    expect(result.summary.ha401).toBeCloseTo(0.4, 1);
    expect(result.summary.ha406).toBeCloseTo(0.4, 1);
    expect(vegetationFromTiles([{ vege, world: world(675_000, 6_581_000) }], { minAreaM2: 100 }).summary).toMatchObject({ ha401: 0, ha406: 0 });
  });

  it("föreslår ISOM-symbolerna för vegetationens lager", () => {
    const symbols = ["401", "406", "407", "408", "409", "410"].map(code => ({ id: `area${code}`, code, kind: "area" }));
    const suggested = (name: string) => suggestSymbol({ name, count: 1, points: 0, lines: 0, closedLines: 4, areas: 0 }, symbols);
    expect(["oppen_mark", "gron_lattlopt", "undervegetation_lattlopt", "gron_svarlopt", "undervegetation_svarlopt", "gron_mycket_svarlopt"].map(suggested))
      .toEqual(["area401", "area406", "area407", "area408", "area409", "area410"]);
    // G8: tomterna ur husen blir område som inte får beträdas.
    expect(suggestSymbol({ name: "tomtmark_osm", count: 1, points: 0, lines: 0, closedLines: 1, areas: 0 }, [{ id: "area520", code: "520", kind: "area" }])).toBe("area520");
  });
});
