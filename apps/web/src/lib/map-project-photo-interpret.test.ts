import { importLayers } from "@o-tid/map-revision";
import { describe, expect, it } from "vitest";
import { classifyPhoto, compactMask, interpretPhoto, maskOutlines, OPEN, ROCK, simplifyRing } from "./map-project-photo-interpret";

/** En bild 120 × 80 med skog (mörk, fläckig), en häll (grå), en äng (ljusgrön, jämn) och en liggande stam (smalt grått streck). */
function photo() {
  const width = 120, height = 80, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const i = (y * width + x) * 4, noise = ((x * 7 + y * 13) % 5) * 12;
    let color: [number, number, number] = [30 + noise, 60 + noise, 25 + noise];
    if (x >= 10 && x < 40 && y >= 10 && y < 40) color = [170, 172, 168];
    if (x >= 60 && x < 110 && y >= 20 && y < 60) color = [150, 190, 100];
    if (y === 70 && x >= 10 && x < 100) color = [180, 180, 178];
    data.set([...color, 255], i);
  }
  return { width, height, data };
}

describe("flygbildstolkning", () => {
  it("grå och ljus yta är berg i dagen, ljusgrön och jämn är öppen mark, mörk fläckig skog är inget", () => {
    const { columns, rows, classes } = classifyPhoto(photo(), { cellPixels: 2, minCells: 4 });
    expect([columns, rows]).toEqual([60, 40]);
    const at = (x: number, y: number) => classes[Math.floor(x / 2) * rows + Math.floor(y / 2)];
    expect(at(20, 20)).toBe(ROCK);
    expect(at(80, 40)).toBe(OPEN);
    expect(at(50, 50)).toBe(0);
    expect(at(4, 4)).toBe(0);
  });

  it("bara breda ytor räknas: den liggande stammen faller bort, hällen och ängen blir ytor i rätt lager", () => {
    const result = interpretPhoto(photo(), { cellPixels: 2, minCells: 20 }, (column, row) => [664_000 + column, 6_576_000 - row], 3006);
    expect(importLayers(result.data).map(layer => [layer.name, layer.closedLines])).toEqual([["berg_i_dagen", 1], ["oppen_mark_flygbild", 1]]);
    const rock = result.data.features[0]!.geometry;
    const xs = rock.kind === "line" ? rock.points.map(point => point[0]) : [];
    // Hällen ligger på x 10–40 i bilden.
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(664_010); expect(Math.max(...xs)).toBeLessThanOrEqual(664_040);
    expect(result.rockCells).toBeGreaterThan(150);
    expect(result.openCells).toBeGreaterThan(400);
    expect(result.data.crs).toBe(3006);
  });

  it("masken: en cell breda delar och små öar tas bort, ringarna följer kanten och förenklas", () => {
    const columns = 12, rows = 8, mask = new Uint8Array(columns * rows);
    for (let c = 1; c < 6; c += 1) for (let r = 1; r < 6; r += 1) mask[c * rows + r] = 1;
    for (let c = 6; c < 11; c += 1) mask[c * rows + 3] = 1;
    const compact = compactMask(mask, columns, rows, 4);
    expect(compact[8 * rows + 3]).toBe(0);
    expect(compact[3 * rows + 3]).toBe(1);
    const [ring] = maskOutlines(compact, columns, rows);
    expect(simplifyRing(ring!, 0.5).length).toBeLessThan(ring!.length);
    expect(maskOutlines(new Uint8Array(columns * rows), columns, rows)).toEqual([]);
    expect(compactMask(mask, columns, rows, 500).some(cell => cell === 1)).toBe(false);
  });
});
