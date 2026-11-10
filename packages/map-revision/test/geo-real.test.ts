import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { cliffLines, cliffsFromTicks, readTicks, thin, type Tick } from "../../../scripts/geo-cliffs";
import { moistureFromHeightMaps, readHeightMap } from "../../../scripts/geo-moisture";
import { decodeGrayPng, readWorldFile, vegetationFromTiles } from "../../../scripts/geo-vegetation";
import { mergeWaterGrids, polygonsOf, readWaterGrid, waterFromGrids, waterMask, type WaterGrid } from "../../../scripts/geo-water";
import { iniWith } from "../../../scripts/geo-worker";
import { importLayers, importObjects, suggestSymbol } from "../src/vector-import";
import { parseDxf, parseGeoJson, type SourceData } from "../src/vector-parse";

/**
 * Grundkartan ur laser (ägaren 2026-11-10: «tester för alla typer av lager och hur utdatat blir»). Riktig laserdata (300 × 300 m
 * av Kungshatt, fixtures/laser/LASMIG.md) och det Karttapullautin 2.15.4 ger för den: varje resultatfil läses som importen
 * läser den, och lagren ska få rätt symbol och form och ligga inom rutan.
 */
const dir = join(import.meta.dirname, "../../../fixtures/laser");
const BOX = { minX: 664_780, minY: 6_576_500, maxX: 665_080, maxY: 6_576_800 };
const dxf = (name: string) => parseDxf(gunzipSync(readFileSync(join(dir, "kungshatt-300m", `${name}.dxf.gz`))).toString("utf8"));
const symbols = [...["101", "102", "103", "104", "201", "202", "305", "306"].map(code => ({ id: `s${code}`, code, kind: "line" })),
  ...["109", "111"].map(code => ({ id: `s${code}`, code, kind: "point" })),
  ...["301", "308", "310", "401", "406", "407", "408", "409", "410"].map(code => ({ id: `s${code}`, code, kind: "area" }))];
const suggested = (data: SourceData) => Object.fromEntries(importLayers(data).map(layer => [layer.name, suggestSymbol(layer, symbols)]));
const counts = (data: SourceData) => Object.fromEntries(importLayers(data).map(layer => [layer.name, layer.count]));
function extent(data: SourceData) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { geometry } of data.features) {
    const points = geometry.kind === "point" ? [geometry.at] : geometry.kind === "line" ? geometry.points : geometry.rings.flat();
    for (const [x, y] of points) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  }
  return { minX, minY, maxX, maxY };
}
/** Inom rutan, med några meters marginal för det Karttapullautin ritar i kanten. */
const within = (data: SourceData, slack = 2) => {
  const box = extent(data);
  return box.minX >= BOX.minX - slack && box.minY >= BOX.minY - slack && box.maxX <= BOX.maxX + slack && box.maxY <= BOX.maxY + slack;
};

describe("Karttapullautins riktiga resultat för testrutan", () => {
  it("kurvorna: hjälpkurvorna på halva ekvidistansen hoppas över, kurvor och stödkurvor får 101 och 102", () => {
    const data = dxf("kurvor");
    expect(counts(data)).toEqual({ contour_intermed: 35, contour: 20, contour_index: 6 });
    expect(suggested(data)).toEqual({ contour_intermed: undefined, contour: "s101", contour_index: "s102" });
    expect(within(data, 0.01)).toBe(true);
    // Hela kurvor: få och långa, inte tusentals stumpar.
    const lengths = data.features.filter(feature => feature.layer === "contour").map(feature => feature.geometry.kind === "line" ? feature.geometry.points.length : 0);
    expect(Math.max(...lengths)).toBeGreaterThan(200);
  });

  it("formlinjerna blir stödkurvor (103)", () => {
    const data = dxf("formlinjer");
    expect(counts(data)).toEqual({ formline: 47 });
    expect(suggested(data)).toEqual({ formline: "s103" });
    expect(within(data, 0.01)).toBe(true);
  });

  it("branterna: passerbara (cliff2) blir 202, opasserbara (cliff3 och cliff4) blir 201; allt är korta streck", () => {
    const low = dxf("branter"), high = dxf("stup");
    expect(counts(low)).toEqual({ cliff2: 771 });
    expect(counts(high)).toEqual({ cliff3: 6947, cliff4: 1182 });
    expect(suggested(low)).toEqual({ cliff2: "s202" });
    expect(suggested(high)).toEqual({ cliff3: "s201", cliff4: "s201" });
    // Varje brant är ett streck med två punkter (G4 i planen gör linjer av dem).
    expect(low.features.every(feature => feature.geometry.kind === "line" && feature.geometry.points.length === 2)).toBe(true);
    expect(within(low) && within(high)).toBe(true);
  });

  it("knollarna och punktgroparna blir punkter (109 och 111)", () => {
    const data = dxf("knollar");
    expect(counts(data)).toEqual({ uglydotknoll: 4, dotknoll: 1, uglyudepression: 1 });
    expect(suggested(data)).toEqual({ uglydotknoll: "s109", dotknoll: "s109", uglyudepression: "s111" });
    expect(data.features.every(feature => feature.geometry.kind === "point")).toBe(true);
    expect(within(data)).toBe(true);
  });

  it("fuktigheten ur det riktiga höjdrastret: blött, fuktigt och fuktstråk i dalen", () => {
    const grid = readHeightMap(new Uint8Array(gunzipSync(readFileSync(join(dir, "kungshatt-300m/xyz2.hmap.gz")))));
    expect(grid).toMatchObject({ minX: 664_780, minY: 6_576_500, cell: 2, width: 151, height: 151 });
    const moisture = moistureFromHeightMaps([grid]);
    expect(moisture.summary).toEqual({ wetHa: 0.76, moistHa: 1.01, wetAreas: 2, moistAreas: 3, channels: 1 });
    const data = parseDxf(moisture.dxf);
    expect(suggested(data)).toEqual({ blott: "s308", fuktigt: "s310", fuktstrak: "s306" });
    expect(within(data)).toBe(true);
  });

  it("vegetationen ur de riktiga klassbilderna: öppen mark, grönt och undervegetation som ytor", () => {
    const read = (name: string) => decodeGrayPng(new Uint8Array(readFileSync(join(dir, "kungshatt-300m", name))));
    const tiles = [{ vege: read("ruta00_vege_bit.png"), undergrowth: read("ruta00_undergrowth_bit.png"),
      world: readWorldFile(readFileSync(join(dir, "kungshatt-300m/ruta00_vege_bit.pgw"), "utf8")) }];
    const vegetation = vegetationFromTiles(tiles);
    expect(vegetation.summary).toEqual({ ha401: 0.44, ha406: 1.64, ha408: 0.03, ha410: 0, ha407: 0.04, ha409: 0.04 });
    const data = parseDxf(vegetation.dxf);
    expect(suggested(data)).toEqual({ oppen_mark: "s401", gron_lattlopt: "s406", gron_svarlopt: "s408", undervegetation_lattlopt: "s407",
      undervegetation_svarlopt: "s409" });
    expect(within(data)).toBe(true);
    // Allt blir slutna ytor.
    expect(importLayers(data).every(layer => layer.closedLines === layer.count)).toBe(true);
  });

  it("allt läses in som objekt på kartan och klipps mot kartans kant", () => {
    const data = dxf("kurvor");
    // Kartan är rutans inre 200 × 200 m i 1:10 000: 20 × 20 mm.
    const toMap = (x: number, y: number) => ({ x: (x - 664_830) / 10, y: (y - 6_576_550) / 10 });
    const result = importObjects(data.features, { toMap, bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
      mapping: new Map([["contour", { symbol: "s101", kind: "line" as const }], ["contour_index", { symbol: "s102", kind: "line" as const }]]) });
    expect(result.objects.length).toBeGreaterThan(10);
    expect(result.clipped).toBeGreaterThan(0);
    for (const object of result.objects) for (const command of object.kind === "line" ? object.path : []) if ("x" in command) {
      expect(command.x).toBeGreaterThanOrEqual(-1e-6); expect(command.x).toBeLessThanOrEqual(20 + 1e-6);
      expect(command.y).toBeGreaterThanOrEqual(-1e-6); expect(command.y).toBeLessThanOrEqual(20 + 1e-6);
    }
  });
});

describe("branterna som linjer", () => {
  const raw = (name: string) => gunzipSync(readFileSync(join(dir, "kungshatt-300m", `${name}.dxf.gz`))).toString("utf8");
  const grid = readHeightMap(new Uint8Array(gunzipSync(readFileSync(join(dir, "kungshatt-300m/xyz2.hmap.gz")))));
  const height = (x: number, y: number) => {
    const column = Math.round((x - grid.minX) / grid.cell), row = Math.round((y - grid.minY) / grid.cell);
    return column < 0 || row < 0 || column >= grid.width || row >= grid.height ? NaN : grid.z[column * grid.height + row]!;
  };

  it("Karttapullautins streck: lika långa, och marken är lägre till vänster om strecket", () => {
    const ticks = readTicks(raw("stup"));
    expect(ticks).toHaveLength(8129);
    let lower = 0, measured = 0;
    for (const [x1, y1, x2, y2] of ticks) {
      const length = Math.hypot(x2 - x1, y2 - y1);
      expect(length).toBeCloseTo(2.94, 2);
      const left = height((x1 + x2) / 2 - (y2 - y1) / length * 3, (y1 + y2) / 2 + (x2 - x1) / length * 3);
      const right = height((x1 + x2) / 2 + (y2 - y1) / length * 3, (y1 + y2) / 2 - (x2 - x1) / length * 3);
      if (Number.isFinite(left) && Number.isFinite(right)) { measured += 1; if (left < right) lower += 1; }
    }
    expect(lower / measured).toBeGreaterThan(0.98);
  });

  it("8 129 streck blir ett fåtal linjer med nedför till höger, och föreslås som 201", () => {
    const cliffs = cliffsFromTicks(readTicks(raw("stup")), readTicks(raw("branter")));
    expect(cliffs.summary.cliffs201).toBeGreaterThan(5);
    expect(cliffs.summary.cliffs201).toBeLessThan(40);
    expect(cliffs.summary.cliffMeters201).toBeGreaterThan(300);
    // De passerbara strecken ligger här där det redan är opasserbart.
    expect(cliffs.summary.cliffs202).toBe(0);
    let lower = 0, measured = 0;
    for (const line of cliffs.lines.impassable) {
      for (let i = 1; i < line.length; i += 1) {
        const [ax, ay] = line[i - 1]!, [bx, by] = line[i]!, length = Math.hypot(bx - ax, by - ay);
        if (length < 1) continue;
        const right = height((ax + bx) / 2 + (by - ay) / length * 4, (ay + by) / 2 - (bx - ax) / length * 4);
        const left = height((ax + bx) / 2 - (by - ay) / length * 4, (ay + by) / 2 + (bx - ax) / length * 4);
        if (Number.isFinite(left) && Number.isFinite(right)) { measured += 1; if (right < left) lower += 1; }
      }
    }
    expect(measured).toBeGreaterThan(40);
    expect(lower / measured).toBeGreaterThan(0.9);
    const data = parseDxf(cliffs.dxf);
    expect(suggested(data)).toEqual({ brant_opasserbar: "s201" });
    expect(within(data, 3)).toBe(true);
  });

  it("en rak brant av streck blir en linje åt rätt håll, en passerbar blir 202, korta stumpar tas bort", () => {
    // Streck längs y = 100 från väst till öst: nedför är till vänster om strecken, alltså norrut.
    const row = (y: number, from: number, to: number): Tick[] => Array.from({ length: (to - from) / 2 }, (_, i) => [from + i * 2, y, from + i * 2 + 2.94, y] as const);
    const [line] = cliffLines(row(100, 0, 40));
    // Nedför (norr) ska vara till höger: linjen går från öst till väst.
    expect(line![0]![0]).toBeGreaterThan(line!.at(-1)![0]);
    expect(Math.abs(line![0]![0] - line!.at(-1)![0])).toBeGreaterThan(35);
    expect(cliffLines(row(100, 0, 4))).toEqual([]);
    const both = cliffsFromTicks(row(100, 0, 40), [...row(100.5, 0, 40), ...row(160, 0, 30)]);
    expect(both.summary).toMatchObject({ cliffs201: 1, cliffs202: 1 });
    expect(suggested(parseDxf(both.dxf))).toEqual({ brant_opasserbar: "s201", brant_passerbar: "s202" });
    expect(cliffLines([])).toEqual([]);
    // Tunningen lämnar en cell bred linje av ett band som är tre celler brett.
    const mask = new Uint8Array(20 * 9);
    for (let x = 2; x < 18; x += 1) for (let y = 3; y < 6; y += 1) mask[x * 9 + y] = 1;
    const thinned = thin(mask, 20, 9);
    for (let x = 4; x < 16; x += 1) expect([3, 4, 5].reduce((sum, y) => sum + thinned[x * 9 + y]!, 0)).toBe(1);
  });
});

/** Ett vattenraster: mark överallt utom där `open` säger annat; `water` ger vattenpunkter. */
function waterGrid(width: number, height: number, open: (x: number, y: number) => boolean, water: (x: number, y: number) => boolean): WaterGrid {
  const cells = new Uint8Array(width * height);
  for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) cells[x * height + y] = open(x, y) ? (water(x, y) ? 2 : 0) : 1;
  return { minX: 664_000, minY: 6_576_000, cell: 2, width, height, cells };
}

describe("vattnet ur laserns klasser", () => {
  const lake = (x: number, y: number) => Math.hypot(x - 40, y - 40) < 20 && Math.hypot(x - 40, y - 40) >= 6;
  const hole = (x: number, y: number) => x >= 80 && x < 95 && y >= 10 && y < 25;
  const grid = waterGrid(120, 80, (x, y) => lake(x, y) || hole(x, y) || (x === 70 && y === 70), (x, y) => lake(x, y) && (x + y) % 7 === 0);

  it("sjön med vattenpunkter är vatten, luckan i skogen utan vattenpunkter är det inte, ön står kvar", () => {
    const mask = waterMask(grid);
    const at = (x: number, y: number) => mask[x * grid.height + y];
    expect(at(40, 55)).toBe(1);
    expect(at(40, 40)).toBe(0);
    expect(at(85, 15)).toBe(0);
    expect(at(70, 70)).toBe(0);
    expect(at(5, 5)).toBe(0);
  });

  it("en sten i sjön räknas som vatten, och rutornas raster läggs ihop", () => {
    const stone = waterGrid(120, 80, (x, y) => (lake(x, y) || hole(x, y)) && !(x === 40 && y === 55), (x, y) => lake(x, y) && (x + y) % 7 === 0);
    expect(waterMask(stone)[40 * 80 + 55]).toBe(1);
    // Den andra rutan har mark där sjön är: då är det mark.
    const other = waterGrid(120, 80, () => false, () => false);
    expect(waterMask(mergeWaterGrids([grid, other])).some(value => value === 1)).toBe(false);
    expect(() => mergeWaterGrids([grid, { ...other, width: 60, cells: other.cells.subarray(0, 60 * 80) }])).toThrow();
  });

  it("ytorna blir GeoJSON i lagret vatten med ön som hål, och föreslås som 301", () => {
    const water = waterFromGrids([grid]);
    expect(water.summary.waterAreas).toBe(1);
    expect(water.summary.waterHa).toBeGreaterThan(0.4);
    const data = parseGeoJson(water.geojson);
    expect(suggested(data)).toEqual({ vatten: "s301" });
    const [feature] = data.features;
    expect(feature?.geometry.kind === "area" && feature.geometry.rings.length).toBe(2);
    expect(water.at(664_000 + 80, 6_576_000 + 110)).toBe(true);
    expect(water.at(664_000 + 80, 6_576_000 + 80)).toBe(false);
    expect(polygonsOf([])).toEqual([]);
  });

  it("läser lasclips fil", () => {
    const bytes = new Uint8Array(40 + 6), view = new DataView(bytes.buffer);
    view.setFloat64(0, 664_780, true); view.setFloat64(8, 6_576_500, true); view.setFloat64(16, 2, true);
    view.setBigUint64(24, 3n, true); view.setBigUint64(32, 2n, true);
    bytes.set([1, 0, 2, 3, 1, 1], 40);
    expect(readWaterGrid(bytes)).toMatchObject({ minX: 664_780, cell: 2, width: 3, height: 2 });
    expect(() => readWaterGrid(bytes.subarray(0, 44))).toThrow();
  });

  it("vattnet undantas ur fuktigheten och vegetationen", () => {
    const grid = readHeightMap(new Uint8Array(gunzipSync(readFileSync(join(dir, "kungshatt-300m/xyz2.hmap.gz")))));
    // Allt väster om 664 900 räknas som vatten: där låg det mesta av det blöta.
    const west = (x: number) => x < 664_900;
    const moisture = moistureFromHeightMaps([grid], undefined, west);
    expect(moisture.summary.wetHa).toBeLessThan(0.3);
    expect(extent(parseDxf(moisture.dxf)).minX).toBeGreaterThanOrEqual(664_899);
    const read = (name: string) => decodeGrayPng(new Uint8Array(readFileSync(join(dir, "kungshatt-300m", name))));
    const tiles = [{ vege: read("ruta00_vege_bit.png"), world: readWorldFile(readFileSync(join(dir, "kungshatt-300m/ruta00_vege_bit.pgw"), "utf8")) }];
    const vegetation = vegetationFromTiles(tiles, undefined, west);
    expect(vegetation.summary.ha406).toBeLessThan(1.64);
    expect(extent(parseDxf(vegetation.dxf)).minX).toBeGreaterThanOrEqual(664_899);
  });
});

/**
 * Hela kedjan på riktigt, när verktygen finns (geo-avbildningen eller en egen byggd Karttapullautin): OTID_LASCLIP,
 * OTID_PULLAUTA och OTID_PULLAUTA_INI. Annars hoppas testet över.
 */
const tools = { lasclip: process.env.OTID_LASCLIP, pullauta: process.env.OTID_PULLAUTA, ini: process.env.OTID_PULLAUTA_INI };
describe.skipIf(!tools.lasclip || !tools.pullauta || !tools.ini || !existsSync(tools.pullauta))("hela kedjan med lasclip och Karttapullautin", () => {
  it("klipper rutan till 200 × 200 m, kör Karttapullautin och får kurvor, branter och vatten inom klippet", () => {
    const work = mkdtempSync(join(tmpdir(), "otid-geo-real-"));
    try {
      mkdirSync(join(work, "in"));
      copyFileSync(join(dir, "kungshatt-300m.laz"), join(work, "ruta.laz"));
      const clip = { minX: 664_880, minY: 6_576_500, maxX: 665_080, maxY: 6_576_700 };
      const kept = execFileSync(tools.lasclip!, ["ruta.laz", "in/ruta00.laz", ...Object.values(clip).map(String), "vatten0.bin"], { cwd: work }).toString().trim();
      expect(Number(kept)).toBeGreaterThan(50_000);
      expect(Number(kept)).toBeLessThan(239_966);
      writeFileSync(join(work, "pullauta.ini"), iniWith(readFileSync(tools.ini!, "utf8"), { contour_interval: 5, formline: 2 }, true, true));
      for (const args of [[], ["pngmerge", "1"], ["dxfmerge"]]) execFileSync(tools.pullauta!, args, { cwd: work, stdio: "ignore" });
      const contours = parseDxf(readFileSync(join(work, "merged_contours.dxf"), "utf8"));
      expect(Object.keys(counts(contours)).sort()).toEqual(["contour", "contour_index", "contour_intermed"]);
      const box = extent(contours);
      expect(box.minX).toBeGreaterThanOrEqual(clip.minX - 1); expect(box.maxX).toBeLessThanOrEqual(clip.maxX + 1);
      expect(box.minY).toBeGreaterThanOrEqual(clip.minY - 1); expect(box.maxY).toBeLessThanOrEqual(clip.maxY + 1);
      expect(parseDxf(readFileSync(join(work, "merged_c3g.dxf"), "utf8")).features.length).toBeGreaterThan(100);
      // Mälaren i rutans sydöstra hörn.
      const water = waterFromGrids([readWaterGrid(new Uint8Array(readFileSync(join(work, "vatten0.bin"))))]);
      expect(water.summary.waterAreas).toBeGreaterThan(0);
      expect(water.at(665_070, 6_576_504)).toBe(true);
      expect(water.at(664_950, 6_576_650)).toBe(false);
    } finally { rmSync(work, { recursive: true, force: true }); }
  }, 120_000);
});
