import { describe, expect, it } from "vitest";
import type { GroundGrid } from "../../../scripts/geo-cliffs";
import { moistureDxf } from "../../../scripts/geo-moisture";
import { bareRock, boulders } from "../../../scripts/geo-rock";
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
  it("berg i dagen: ojämn, öppen och upphöjd mark, inte det släta eller det skogsklädda", () => {
    const width = 60, height = 60, z = new Float32Array(width * height);
    for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) {
      const knob = Math.max(0, 3 - Math.hypot(x - 20, y - 30) / 6);
      const rough = knob > 0 ? 0.35 * Math.sin(x * 1.7) * Math.cos(y * 2.3) : 0;
      z[x * height + y] = 10 + knob + rough;
    }
    const grid: GroundGrid = { minX: 0, minY: 0, cell: 1, width, height, z };
    const rock = bareRock(grid, () => true);
    expect(rock.length).toBeGreaterThan(0);
    const xs = rock.flat().map(point => point[0]);
    expect(Math.min(...xs)).toBeGreaterThan(1); expect(Math.max(...xs)).toBeLessThan(39);
    expect(bareRock(grid, () => false)).toEqual([]);
  });
  it("skrivs som DXF med punkterna", () => {
    const data = parseDxf(moistureDxf([{ name: "sten", closed: false, parts: [], points: [[1, 2]] }]));
    expect(data.features).toEqual([{ layer: "sten", geometry: { kind: "point", at: [1, 2] } }]);
  });
});
