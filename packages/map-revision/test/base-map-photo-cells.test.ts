import type { MapObject, MapSymbol, Point } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import { classifyPhotoCell, PHOTO_CONFIDENT, PHOTO_MAX_AUTO_M2, photoCellStats, type PhotoRaster } from "../src/base-map/photo-cells";
import { photoFillCells, photoFillCuts, type PhotoFillMap } from "../src/base-map/photo-fill";
import { objectBox } from "../src";

/** En bild 40 × 40 bildpunkter, 0,1 mm per bildpunkt, över kartans 0–4 mm (y uppåt). */
function raster(pixel: (x: number, y: number) => [number, number, number] | undefined): PhotoRaster {
  const width = 40, height = 40, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const value = pixel(x, y);
    if (value) data.set([...value, 255], (y * width + x) * 4);
  }
  return { width, height, data, minX: 0, maxY: 4, step: 0.1 };
}
const square: Point[][] = [[{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }]];
const classify = (rgb: PhotoRaster, ir?: PhotoRaster, areaM2 = 200) => classifyPhotoCell(photoCellStats(rgb, square, ir), areaM2);
/** Brus som är detsamma varje gång. */
const noise = (x: number, y: number) => (((x * 73 + y * 151) % 17) / 16) - 0.5;

describe("Fyll ytor ur flygbilden: klassningen", () => {
  it("grå asfalt med lite brus blir hårdgjord och säker", () => {
    const result = classify(raster((x, y) => { const v = 120 + noise(x, y) * 10; return [v, v + 2, v + 4]; }));
    expect(result.guess).toBe("paved");
    expect(result.confidence).toBeGreaterThanOrEqual(PHOTO_CONFIDENT);
  });
  it("jämnt grönt gräs blir gräs, fläckiga trädkronor blir träd", () => {
    expect(classify(raster((x, y) => [95 + noise(x, y) * 6, 150 + noise(x, y) * 6, 60])).guess).toBe("grass");
    const trees = classify(raster((x, y) => (x * 7 + y * 3) % 5 < 2 ? [40, 90, 35] : [80, 140, 60]));
    expect(trees.guess).toBe("trees");
    expect(trees.confidence).toBeGreaterThanOrEqual(PHOTO_CONFIDENT);
  });
  it("husets skugga på asfalt blir inte träd: de mörka bildpunkterna räknas inte och resten avgör", () => {
    const result = classify(raster((x, y) => x < 18 ? [22, 24, 30] : [125 + noise(x, y) * 8, 127, 130]));
    expect(result.guess).toBe("paved");
    const stats = photoCellStats(raster((x, y) => x < 18 ? [22, 24, 30] : [125 + noise(x, y) * 8, 127, 130]), square);
    expect(stats.shadow).toBeGreaterThan(600);
  });
  it("nästan bara skugga är osäker", () => {
    const result = classify(raster(x => x < 37 ? [20, 22, 28] : [120, 120, 120]));
    expect(result.confidence).toBeLessThan(PHOTO_CONFIDENT);
    expect(result.reason).toBe("shadow");
  });
  it("NDVI ur IR-bilden avgör: grön-grå mark med mycket IR är växtlighet, grått med lite IR är hårdgjort", () => {
    const rgb = raster(() => [110, 120, 100]);
    // Falskfärg: R = IR, G = rött, B = grönt.
    expect(classify(rgb, raster(() => [210, 60, 90])).guess).toBe("grass");
    expect(classify(rgb, raster(() => [80, 110, 100])).guess).toBe("paved");
  });
  it("mörkt blått och jämnt utan växtlighet är vatten", () => {
    expect(classify(raster(() => [30, 50, 70])).guess).toBe("water");
  });
  it("blandad ruta (halva gräs, halva asfalt) är osäker", () => {
    const result = classify(raster(x => x < 20 ? [95, 150, 60] : [120, 122, 124]));
    expect(result.confidence).toBeLessThan(PHOTO_CONFIDENT);
  });
  it("en ruta över gränsen för automatisk klassning är osäker, och en ruta utanför bilden saknar foto", () => {
    expect(classify(raster(() => [120, 122, 124]), undefined, PHOTO_MAX_AUTO_M2 + 1).reason).toBe("large");
    expect(classify(raster(() => undefined)).reason).toBe("no-photo");
  });
  it("kolumn 0 jämförs aldrig med föregående rads högerkant i texturberäkningen", () => {
    // Varje kolumn har konstant ljushet längs y, men vänster kant är ljus och höger kant är mörk.
    // En smal ruta i kolumn 0 och en i kolumn 39: kolumn 0 får inte ärva föregående rads kolumn 39.
    const width = 4, height = 4, data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      data.set([200, 200, 200, 255], (y * width + 0) * 4);
      data.set([20, 20, 20, 255], (y * width + 3) * 4);
    }
    const img: PhotoRaster = { width, height, data, minX: 0, maxY: 4, step: 1 };
    // Två separata ringar: kolumn 0 (x 0..1) och kolumn 3 (x 3..4). Ingen granne inom samma rad, lika vertikalt -> textur = 0.
    const rings: Point[][] = [
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 4 }, { x: 0, y: 4 }],
      [{ x: 3, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 3, y: 4 }]
    ];
    const stats = photoCellStats(img, rings);
    expect(stats.valid).toBe(8);
    expect(stats.texture).toBe(0);
  });
});

const symbol = (id: string, code: string): MapSymbol => ({ id, kind: "AREA", hidden: false, name: code,
  code: { text: code, main: Number(code.split(".")[0]), sub: 0 } }) as unknown as MapSymbol;
const line = (symbolId: string, points: [number, number][]): MapObject => ({ kind: "line", symbol: symbolId,
  path: points.map(([x, y], i) => ({ type: i === 0 ? "M" as const : "L" as const, x, y })) });
const area = (symbolId: string, points: [number, number][]): MapObject => ({ kind: "area", symbol: symbolId, angle: 0,
  rings: [[...points, points[0]!].map(([x, y], i) => ({ type: i === 0 ? "M" as const : "L" as const, x, y }))] });

describe("Fyll ytor ur flygbilden: rutorna och inläggningen", () => {
  // 1:4 000: 1 mm = 4 m. En gata mellan två kantlinjer (501.1) i en ruta om 40 × 40 mm, och ett hus.
  const symbols = new Map([["edge", symbol("edge", "501.1")], ["house", symbol("house", "521")], ["open", symbol("open", "401")],
    ["paved", symbol("paved", "501")], ["frame", symbol("frame", "990")], ["rock", symbol("rock", "214")]]);
  const objects: MapObject[] = [
    line("frame", [[0, 0], [40, 0], [40, 40], [0, 40], [0, 0]]),
    line("edge", [[0, 18], [40, 18]]), line("edge", [[0, 22], [40, 22]]),
    area("house", [[5, 28], [12, 28], [12, 35], [5, 35]]),
    // Grundkartans gräs ligger över både gatan och marken söder om den.
    area("open", [[2, 2], [30, 2], [30, 20], [2, 20]])
  ];
  const map: PhotoFillMap = { objects, boxes: objects.map(objectBox), symbols, scale: 4000, norm: "ISSPROM" };
  const box = { minX: -1, minY: -1, maxX: 41, maxY: 41 };

  it("ger gatans ruta, marken på var sida (huset som hål) och hoppar över huset; grundkartans markytor är inga gränser", () => {
    const cells = photoFillCells(map, box, { includeGround: true })!;
    expect(cells).toHaveLength(3);
    const street = cells.find(cell => cell.at.y > 18 && cell.at.y < 22)!;
    expect(street.areaM2).toBeCloseTo(40 * 4 * 16, 0);
    const north = cells.find(cell => cell.at.y > 22)!;
    expect(north.rings).toHaveLength(2);
    expect(north.state).toBe("empty");
    expect(cells.find(cell => cell.at.y < 18)!.state).toBe("ground");
    // Utan markytorna: bara de ofyllda.
    expect(photoFillCells(map, box)!.every(cell => cell.state === "empty")).toBe(true);
    // Samma karta ger samma id.
    expect(photoFillCells(map, box, { includeGround: true })!.map(cell => cell.id)).toEqual(cells.map(cell => cell.id));
  });

  it("inläggningen klipper grundkartans gräs mot alla nya ytor på en gång och rensar berg under den hårdgjorda ytan", () => {
    const withRock = [...objects, area("rock", [[10, 19], [14, 19], [14, 21], [10, 21]])];
    const rockMap = { ...map, objects: withRock, boxes: withRock.map(objectBox) };
    const cells = photoFillCells(rockMap, box, { includeGround: true })!;
    const street = cells.find(cell => cell.at.y > 18 && cell.at.y < 22)!, south = cells.find(cell => cell.at.y < 18)!;
    const cuts = photoFillCuts(rockMap, [{ rings: street.rings, symbol: "paved" }, { rings: south.rings, symbol: "open" }]);
    const grass = cuts.find(cut => cut.index === 4)!;
    expect(grass.objects).toHaveLength(0);
    // Berghällen är en markyta: den klipps bort helt under gatan.
    expect(cuts.find(cut => cut.index === 5)!.objects).toHaveLength(0);
    expect(cuts.filter(cut => cut.index === 4)).toHaveLength(1);
  });

  it("avbryter tidigt när maxSegments överskrids och blandar inte ihop byggda polygoner när en ruta saknar giltig ring", () => {
    expect(photoFillCells(map, box, { includeGround: true }, 2)).toBeUndefined();
    // En ogiltig (tom) ruta före den hårdgjorda rutan får inte förskjuta indexet för built-maskningen.
    const withRock = [...objects, area("rock", [[10, 19], [14, 19], [14, 21], [10, 21]])];
    const rockMap = { ...map, objects: withRock, boxes: withRock.map(objectBox) };
    const cells = photoFillCells(rockMap, box, { includeGround: true })!;
    const street = cells.find(cell => cell.at.y > 18 && cell.at.y < 22)!;
    const cuts = photoFillCuts(rockMap, [
      { rings: [[{ x: 0, y: 0 }, { x: 1, y: 0 }]], symbol: "open" },
      { rings: street.rings, symbol: "paved" }
    ]);
    expect(cuts.find(cut => cut.index === 5)?.objects).toEqual([]);
  });
});
