import { describe, expect, it } from "vitest";
import { drawMap, objectBoxes, readMapFile, SpatialIndex, spatialIndexOf, type ParsedMap } from "../src";
import { fakeContext } from "./fake-canvas";
import { buildOcd, concat, element, ocdCoord, seededRandom, symbolBody } from "./ocd-builder";
import { syntheticForestMap } from "./synthetic-map";

type Box = { minX: number; minY: number; maxX: number; maxY: number };

/** Rutorna som skär `box`, räknade en och en (facit). */
function bruteForce(boxes: Float64Array, box: Box): number[] {
  const out: number[] = [];
  for (let i = 0; i < boxes.length / 4; i += 1) {
    if (boxes[4 * i]! <= box.maxX && boxes[4 * i + 2]! >= box.minX && boxes[4 * i + 1]! <= box.maxY && boxes[4 * i + 3]! >= box.minY) out.push(i);
  }
  return out;
}

describe("rumsligt index (ADR-0218)", () => {
  it("ger samma objekt som en genomgång av alla, i kartans ordning, också för stora objekt och objekt utan ruta", () => {
    const random = seededRandom(7);
    const count = 5000;
    const boxes = new Float64Array(count * 4);
    for (let i = 0; i < count; i += 1) {
      if (i % 97 === 0) { boxes.fill(Number.NaN, 4 * i, 4 * i + 4); continue; }
      const x = random() * 1000 - 500, y = random() * 800 - 400;
      // Var femtionde är stor (en lång höjdkurva), resten små.
      const w = i % 50 === 0 ? 300 + random() * 600 : random() * 6, h = i % 50 === 0 ? 200 + random() * 400 : random() * 6;
      boxes.set([x, y, x + w, y + h], 4 * i);
    }
    const index = SpatialIndex.build(boxes);
    expect(index.size).toBe(count);
    for (let q = 0; q < 200; q += 1) {
      const x = random() * 1200 - 600, y = random() * 1000 - 500, w = random() * (q % 10 === 0 ? 1500 : 60), h = random() * 60;
      const box = { minX: x, minY: y, maxX: x + w, maxY: y + h };
      expect([...index.query(box)]).toEqual(bruteForce(boxes, box));
    }
    // Utanför allt och en punkt.
    expect([...index.query({ minX: 5000, minY: 5000, maxX: 6000, maxY: 6000 })]).toEqual([]);
    const point = { minX: boxes[4]!, minY: boxes[5]!, maxX: boxes[4]!, maxY: boxes[5]! };
    expect([...index.query(point)]).toEqual(bruteForce(boxes, point));
  });

  it("klarar en karta utan objekt och ett enda objekt", () => {
    expect([...SpatialIndex.build(new Float64Array(0)).query({ minX: -1, minY: -1, maxX: 1, maxY: 1 })]).toEqual([]);
    const one = SpatialIndex.build(Float64Array.from([2, 2, 2, 2]));
    expect([...one.query({ minX: 0, minY: 0, maxX: 3, maxY: 3 })]).toEqual([0]);
    expect([...one.query({ minX: 3, minY: 3, maxX: 4, maxY: 4 })]).toEqual([]);
  });

  it("räknar med det symbolen ritar utanför geometrin: punktsymbolens storlek, linjens bredd och textens längd", () => {
    const strings = [{ type: 9, value: "Svart\tn2\tc0\tm0\ty0\tk100" }];
    // Ring med diameter 6 mm, linje 2 mm bred, text 4 mm.
    const ring = element(3, 2, 20, 600, [ocdCoord(0, 0)]);
    const map = readMapFile(buildOcd({
      strings,
      symbols: [
        { number: 101000, type: 1, body: concat(symbolBody(4, { 796: ring.length / 8 }), ring) },
        { number: 102000, type: 2, body: symbolBody(80, { 796: 2, 798: 200, 800: 0 }) },
        { number: 103000, type: 4, body: symbolBody(60, { 828: 2, 830: 400, 832: 400 }) }
      ],
      objects: [
        { symbol: 101000, type: 1, coords: [ocdCoord(1000, 1000)] },
        { symbol: 102000, type: 2, coords: [ocdCoord(0, 0), ocdCoord(2000, 0)] },
        { symbol: 103000, type: 4, coords: [ocdCoord(0, 5000)], text: "Långt namn" }
      ]
    }), "test.ocd");
    const boxes = objectBoxes(map);
    expect([...boxes.subarray(0, 4)]).toEqual([7, 7, 13, 13]);
    expect([...boxes.subarray(4, 8)]).toEqual([-1, -1, 21, 1]);
    // Texten: åtminstone tio tecken à 4 mm åt alla håll.
    expect(boxes[10]!).toBeGreaterThanOrEqual(40);
    expect(50 - boxes[9]!).toBeGreaterThanOrEqual(40);
  });

  it("ritar samma sak med index som utan för objekten som syns, i samma ordning", () => {
    const map = readMapFile(syntheticForestMap({ objects: 3000, widthMm: 200, heightMm: 150, seed: 3 }).bytes, "syntetisk.ocd");
    const options = { pxPerMm: 8, origin: { x: -20, y: 30 } } as const;
    const width = 400, height = 300;
    // Samma marginal som drawMap: 0,5 mm och 2 px.
    const margin = 0.5 + 2 / 8;
    const view = { minX: -20 - margin, maxX: -20 + width / 8 + margin, minY: 30 - height / 8 - margin, maxY: 30 + margin };
    const boxes = objectBoxes(map);
    const visible: ParsedMap = { ...map, objects: bruteForce(boxes, view).map(index => map.objects[index]!) };
    const culled = fakeContext(width, height), reference = fakeContext(width, height);
    const report = drawMap(culled.ctx, map, { ...options, cull: true });
    drawMap(reference.ctx, visible, options);
    expect(culled.calls).toEqual(reference.calls);
    expect(report.parts).toBeLessThan(map.objects.length / 5);
    // Utan index planeras allt.
    expect(drawMap(fakeContext(width, height).ctx, map, options).parts).toBeGreaterThan(map.objects.length * 0.9);
    expect(spatialIndexOf(map)).toBe(spatialIndexOf(map));
  });
});
