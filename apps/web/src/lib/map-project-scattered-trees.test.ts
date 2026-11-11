import { describe, expect, it } from "vitest";
import { scatteredTrees } from "./map-project-scattered-trees";

const shade = (value: number) => (value & 15) >= 2 ? (value & 15) - 2 : -1;
/** 40 × 40 celler kolumnvis. */
const grid = (at: (x: number, y: number) => number) => { const out = new Uint8Array(1600); for (let x = 0; x < 40; x += 1) for (let y = 0; y < 40; y += 1) out[x * 40 + y] = at(x, y); return out; };

describe("öppen mark med spridda träd (404, ägaren 2026-11-11)", () => {
  it("blandad glänta blir 404, en rak kant mellan öppet och skog blir det inte", () => {
    const mixed = scatteredTrees(grid((x, y) => (x + y) % 3 === 0 ? 0 : 1), 40, 40, shade, 2);
    expect(mixed[20 * 40 + 20]).toBe(1);
    const edge = scatteredTrees(grid(x => x < 20 ? 1 : 0), 40, 40, shade, 2);
    expect(edge.reduce((sum, value) => sum + value, 0)).toBe(0);
  });
  it("inte i grönt", () => {
    const green = scatteredTrees(grid((x, y) => (x + y) % 3 === 0 ? 6 : 1), 40, 40, shade, 2);
    expect(green.reduce((sum, value) => sum + value, 0)).toBe(0);
  });
});
