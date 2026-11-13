import { describe, expect, it } from "vitest";
import type { GroundGrid } from "../../../scripts/geo-cliffs";
import { moistureDxf } from "../../../scripts/geo-moisture";
import { bareRock, boulders, knolls } from "../../../scripts/geo-rock";
import { parseDxf } from "../src";

/** 80 × 60 m lutande mark: en sten (1,4 m, 2 × 2 m), ett block (2,5 m), en kulle (1,5 m men 14 m bred) och en brantkant. */
function ground(): GroundGrid {
  const width = 80, height = 60, z = new Float32Array(width * height);
  for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) {
    let value = 10 + x * 0.05;
    if (x >= 20 && x <= 21 && y >= 20 && y <= 21) value += 1.4;
    if (x === 40 && y === 20) value += 2.5;
    value += Math.max(0, 1.5 - Math.hypot(x - 20, y - 45) / 7 * 1.5);
    if (x >= 60) value += 3;
    z[x * height + y] = value;
  }
  return { minX: 0, minY: 0, cell: 1, width, height, z };
}

describe("stenar och berg i dagen ur markrastret", () => {
  it("hittar stenen och blocket men inte kullen eller brantkanten", () => {
    const found = boulders(ground());
    expect(found.map(stone => stone.name).sort()).toEqual(["sten", "stort_block"]);
    const block = found.find(stone => stone.name === "stort_block")!;
    expect(block.at).toEqual([40.5, 20.5]);
    expect(boulders(ground(), undefined, () => true)).toEqual([]);
  });
  it("små kullar: kullen blir en punkthöjd, men inte stenarna eller brantkanten (ägaren 2026-11-11)", () => {
    const grid = ground(), stones = boulders(grid);
    const found = knolls(grid, stones);
    expect(found).toHaveLength(1);
    expect(Math.hypot(found[0]![0] - 20.5, found[0]![1] - 45.5)).toBeLessThan(1.5);
    expect(knolls(grid, stones, 2)).toEqual([]);
  });
  it("små kullar: en kulle i en sluttning hittas fast marken är högre åt ett håll (lärt av Högdalenkartan)", () => {
    const width = 60, height = 60, z = new Float32Array(width * height);
    for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) {
      z[x * height + y] = 10 + x * 0.16 + Math.max(0, 1.8 - Math.hypot(x - 30, y - 30) / 4 * 1.8);
    }
    const grid: GroundGrid = { minX: 0, minY: 0, cell: 1, width, height, z };
    const found = knolls(grid, []);
    expect(found).toHaveLength(1);
    expect(Math.hypot(found[0]![0] - 30.5, found[0]![1] - 30.5)).toBeLessThan(2.5);
    expect(knolls(grid, [], undefined, undefined, undefined, 1)).toEqual([]);
  });
  it("berg i dagen: ojämn, öppen och upphöjd mark, inte det släta eller det skogsklädda", () => {
    const knobGrid = (amplitude: number): GroundGrid => {
      const width = 60, height = 60, z = new Float32Array(width * height);
      for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) {
        const knob = Math.max(0, 3 - Math.hypot(x - 20, y - 30) / 6);
        const rough = knob > 0 ? amplitude * Math.sin(x * 1.7) * Math.cos(y * 2.3) : 0;
        z[x * height + y] = 10 + knob + rough;
      }
      return { minX: 0, minY: 0, cell: 1, width, height, z };
    };
    const grid = knobGrid(0.35);
    const rock = bareRock(grid, () => true);
    expect(rock.length).toBeGreaterThan(0);
    const xs = rock.flat().map(point => point[0]);
    expect(Math.min(...xs)).toBeGreaterThan(1); expect(Math.max(...xs)).toBeLessThan(39);
    expect(bareRock(grid, () => false)).toEqual([]);
    // Under vanlig skog (inte grönt) med strängare krav: den ojämna hällen men inte en slät kulle (ägaren 2026-11-11, Högdalen).
    expect(bareRock(grid, () => false, undefined, undefined, () => true).length).toBeGreaterThan(0);
    expect(bareRock(knobGrid(0.1), () => false, undefined, undefined, () => true)).toEqual([]);
  });
  it("skrivs som DXF med punkterna", () => {
    const data = parseDxf(moistureDxf([{ name: "sten", closed: false, parts: [], points: [[1, 2]] }]));
    expect(data.features).toEqual([{ layer: "sten", geometry: { kind: "point", at: [1, 2] } }]);
  });
});

describe("branten i överkanten", () => {
  it("flyttar linjen från mitten av fallet till överkanten", async () => {
    const { toTopEdge } = await import("../../../scripts/geo-cliffs");
    const width = 40, height = 60, z = new Float32Array(width * height);
    for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) z[x * height + y] = y >= 30 ? 15 : y <= 26 ? 11 : 11 + (y - 26);
    const grid: GroundGrid = { minX: 0, minY: 0, cell: 1, width, height, z };
    // Österut med nedför till höger (söderut), mitt i fallet.
    const top = toTopEdge([[5, 28.5], [20, 28.5], [35, 28.5]], grid);
    for (const [, y] of top) { expect(y).toBeGreaterThan(29.4); expect(y).toBeLessThan(31.1); }
    // Plan mark: linjen ligger kvar.
    const flat: GroundGrid = { ...grid, z: new Float32Array(width * height).fill(10) };
    expect(toTopEdge([[5, 28.5], [20, 28.5]], flat)).toEqual([[5, 28.5], [20, 28.5]]);
  });
});

describe("valet bland de möjliga kullarna är lika i geo-arbetaren och i webbläsaren", () => {
  it("ger samma punkter för samma gränser", async () => {
    const { chooseKnolls } = await import("../../../scripts/geo-rock.ts");
    const browser = await import("../src/base-map/knoll-choice");
    // Var femte ligger i sankmark: de tas bara med när de är uppenbara (ägaren 2026-11-12).
    const candidates = Array.from({ length: 400 }, (_, i) => ({ at: [(i * 37) % 500, (i * 91) % 500] as [number, number],
      rise: 0.5 + ((i * 13) % 30) / 10, share: 0.5 + ((i * 7) % 50) / 100, footM2: 20 + (i * 11) % 140, ...(i % 5 === 0 ? { wet: true } : {}) }));
    expect(chooseKnolls([{ at: [0, 0], rise: 1.2, share: 0.9, footM2: 40, wet: true }, { at: [50, 0], rise: 1.7, share: 0.9, footM2: 40, wet: true }],
      { minRise: 1, lowerShare: 0.8, maxFootM2: 80, spacing: 10 })).toEqual([[50, 0]]);
    for (const limits of [{ minRise: 1, lowerShare: 0.8, maxFootM2: 80, spacing: 10 }, { minRise: 0.6, lowerShare: 0.6, maxFootM2: 150, spacing: 25 }]) {
      expect(browser.chooseKnolls(candidates, limits)).toEqual(chooseKnolls(candidates, limits));
    }
  });
});
