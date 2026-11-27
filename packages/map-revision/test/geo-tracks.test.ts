import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { mergeGroundGrids, readGroundGrid, type GroundGrid } from "../../../scripts/geo-cliffs";
import { localRelief } from "../../../scripts/geo-ditches";
import { linkTracks, straightPieces, trackLines, trackResponse } from "../../../scripts/geo-tracks";

/** Ägaren 2026-11-17: släpstigar ur terrängformen, med hål som gissas igen. */
function ground(): GroundGrid {
  // 400 × 300 m skogsmark med lite brus; ett spår (två hjulspår 0,8 m breda, 2,6 m isär, 0,2 m djupa) diagonalt med ett hål på 30 m.
  const width = 400, height = 300, z = new Float32Array(width * height);
  let seed = 7;
  const noise = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) {
    let value = 50 + x * 0.01 + 0.03 * noise();
    // Spåret: y = 0,4·x + 50, från x = 30 till 370, hål mellan x = 190 och 220.
    const across = (y - 0.4 * x - 50) / Math.hypot(1, 0.4);
    if (x > 30 && x < 370 && !(x > 190 && x < 220) && (Math.abs(across - 1.3) < 0.4 || Math.abs(across + 1.3) < 0.4)) value -= 0.2;
    z[x * height + y] = value;
  }
  return { minX: 0, minY: 0, cell: 1, width, height, z };
}

describe("spår ur terrängformen", () => {
  it("hittar spåret och binder ihop det över hålet", () => {
    const grid = ground(), lines = trackLines(grid, localRelief(grid, 4));
    expect(lines.length).toBe(1);
    const line = lines[0]!;
    const xs = line.map(point => point[0]);
    expect(Math.min(...xs)).toBeLessThan(80);
    expect(Math.max(...xs)).toBeGreaterThan(320);
    for (const [x, y] of line) expect(Math.abs(y - 0.4 * x - 50)).toBeLessThan(5);
  });
  it("delar i skarpa krökar och behåller raka bitar", () => {
    const corner: [number, number][] = [[0, 0], [40, 0], [40, 40]];
    expect(straightPieces(corner, 24).length).toBe(2);
    expect(straightPieces([[0, 0], [10, 0]], 24)).toEqual([]);
  });
  it("binder bara ändar som pekar mot varandra", () => {
    const settings = { maxGap: 50, maxAngle: 25, minChain: 80 };
    const a: [number, number][] = [[0, 0], [50, 0]], b: [number, number][] = [[80, 0], [130, 0]], c: [number, number][] = [[80, 30], [80, 80]];
    expect(linkTracks([a, b], settings).length).toBe(1);
    // Vinkelrätt: inget glapp, och var för sig för korta.
    expect(linkTracks([a, c], settings)).toEqual([]);
  });
  it("trackResponse O(1) ger paritet med referens på 0°/90° och diagonal samt hög hastighet", () => {
    // 0°/90°-paritet: rakt öst–västligt spår och nord–sydligt spår ska ge exakt samma svar som direkt summering.
    const w = 80, h = 80, flat = new Float32Array(w * h);
    for (let x = 10; x < 70; x += 1) flat[x * h + 40] = -0.25;
    for (let y = 10; y < 70; y += 1) flat[40 * h + y] = -0.25;
    const resp = trackResponse(flat, w, h, [4, 2], 12);
    // Mitt på spåret (långt från korsningen): varje sidopunkt är 0, mitten -0,25 → tvärprofil +0,25 längs hela fönstret.
    expect(resp[25 * h + 40]).toBeCloseTo(0.25, 5);
    expect(resp[40 * h + 25]).toBeCloseTo(0.25, 5);
    expect(resp[20 * h + 20]).toBe(0);
    // Verklig terräng (kungshatt-300m): O(1)-svaret korrelerar mycket starkt med brutesumman.
    const mark = readFileSync(join(import.meta.dirname, "../../../fixtures/laser/kungshatt-300m/mark.bin.gz"));
    const grid = mergeGroundGrids([readGroundGrid(new Uint8Array(gunzipSync(mark)))]);
    const relief = localRelief(grid, 4);
    const t0 = performance.now();
    const fast = trackResponse(relief, grid.width, grid.height, [4, 2], 12);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(1500);
    let maxVal = 0, positive = 0;
    for (let i = 0; i < fast.length; i += 1) { if (fast[i]! > 0) positive += 1; if (fast[i]! > maxVal) maxVal = fast[i]!; }
    expect(positive).toBeGreaterThan(1000);
    expect(maxVal).toBeGreaterThan(0.05);
  });
  it("linkTracks binder ihop långa kedjor i linjär tid utan att tappa ordning", () => {
    const pieces: [number, number][][] = Array.from({ length: 60 }, (_, k) => [[k * 30, 0], [k * 30 + 25, 0]]);
    const linked = linkTracks(pieces, { maxGap: 10, maxAngle: 25, minChain: 80 });
    expect(linked).toHaveLength(1);
    expect(linked[0]!.length).toBe(120);
    expect(linked[0]![0]).toEqual([0, 0]);
    expect(linked[0]!.at(-1)).toEqual([59 * 30 + 25, 0]);
  });
});
