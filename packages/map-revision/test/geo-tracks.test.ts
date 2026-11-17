import { describe, expect, it } from "vitest";
import type { GroundGrid } from "../../../scripts/geo-cliffs";
import { localRelief } from "../../../scripts/geo-ditches";
import { linkTracks, straightPieces, trackLines } from "../../../scripts/geo-tracks";

/** Ägaren 2026-11-17: släpstigar ur terrängformen, med hål som gissas igen. */
function ground(): GroundGrid {
  // 400 × 300 m skogsmark med lite brus; ett spår (två hjulspår 0,2 m djupa) diagonalt med ett hål på 30 m.
  const width = 400, height = 300, z = new Float32Array(width * height);
  let seed = 7;
  const noise = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) {
    let value = 50 + x * 0.01 + 0.03 * noise();
    // Spåret: y = 0,4·x + 50, från x = 30 till 370, hål mellan x = 190 och 220.
    const across = (y - 0.4 * x - 50) / Math.hypot(1, 0.4);
    if (x > 30 && x < 370 && !(x > 190 && x < 220) && (Math.abs(across - 1) < 0.6 || Math.abs(across + 1) < 0.6)) value -= 0.2;
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
});
