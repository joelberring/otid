import { describe, expect, it } from "vitest";
import { drawMap, readMapFile } from "../src";
import { spatialIndexOf } from "../src/render/spatial-index";
import { fakeContext } from "./fake-canvas";
import { syntheticForestMap } from "./synthetic-map";

/**
 * ADR-0218: prestandan för en stor skogskarta (50 000 objekt, ca 11 MB OCAD). Gränserna är generösa (flera gånger det som
 * mäts lokalt) så att testet bara slår larm när läsningen blir påtagligt långsammare, inte av en upptagen CI-maskin.
 */
describe("stor karta (ADR-0218)", () => {
  const { bytes, objects } = syntheticForestMap();

  it("läser 50 000 objekt utan varningar och inom gränsen", () => {
    expect(objects).toBe(50_000);
    expect(bytes.length).toBeGreaterThan(5_000_000);
    readMapFile(bytes, "syntetisk.ocd");
    const start = performance.now();
    const map = readMapFile(bytes, "syntetisk.ocd");
    const ms = performance.now() - start;
    expect(map.objects).toHaveLength(50_000);
    expect(map.warnings).toEqual([]);
    // Lokalt ca 0,3 s.
    expect(ms).toBeLessThan(5_000);
  });

  it("indexet byggs snabbt och en inzoomad vy planerar bara en liten del av kartan", () => {
    const map = readMapFile(bytes, "syntetisk.ocd");
    const start = performance.now();
    const index = spatialIndexOf(map);
    // Lokalt ca 0,1 s.
    expect(performance.now() - start).toBeLessThan(3_000);
    expect(index.size).toBe(50_000);
    // 1 000 × 700 px i 10 px/mm = 100 × 70 mm av kartans ca 800 × 780 mm.
    const zoomed = drawMap(fakeContext(1000, 700).ctx, map, { pxPerMm: 10, origin: { x: 0, y: 0 }, cull: true });
    expect(zoomed.parts).toBeGreaterThan(0);
    expect(zoomed.parts).toBeLessThan(map.objects.length / 10);
  });
});
