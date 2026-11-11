import { describe, expect, it } from "vitest";
import type { GroundGrid } from "../../../scripts/geo-cliffs";
import { ditchLines, localRelief, reliefImage } from "../../../scripts/geo-ditches";

/** 120 × 80 m lutande mark (1 m celler): ett rakt dike (1 m brett, 0,5 m djupt), en krokig rännil och en bred grop (16 m). */
function ground(): GroundGrid {
  const width = 120, height = 80, z = new Float32Array(width * height);
  for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) {
    let value = 20 + x * 0.02;
    if (y === 20 && x >= 10 && x <= 90) value -= 0.5;
    const wiggle = Math.round(50 + 6 * Math.sin(x / 6));
    if (y === wiggle && x >= 10 && x <= 90) value -= 0.5;
    if (Math.hypot(x - 105, y - 60) < 8) value -= 1;
    z[x * height + y] = value;
  }
  return { minX: 1000, minY: 2000, cell: 1, width, height, z };
}

describe("diken ur terrängformen", () => {
  it("det raka diket blir dike, den krokiga rännilen bara där det är fuktigt, och gropen inget", () => {
    const grid = ground(), relief = localRelief(grid, 4);
    // Utan fuktigheten blir det inga (hällsprickor); med fukt bara vid diket blir det bara diket.
    expect(ditchLines(grid, relief)).toEqual([]);
    const dry = ditchLines(grid, relief, undefined, (_x, y) => y < 2030);
    expect(dry.map(line => line.name)).toEqual(["dike"]);
    const ys = dry[0]!.points.map(point => point[1]);
    expect(Math.min(...ys)).toBeGreaterThan(2019); expect(Math.max(...ys)).toBeLessThan(2022);
    const length = Math.abs(dry[0]!.points.at(-1)![0] - dry[0]!.points[0]![0]);
    expect(length).toBeGreaterThan(60);
    const wet = ditchLines(grid, relief, undefined, () => true);
    expect(wet.map(line => line.name).sort()).toEqual(["dike", "fuktstrak_terrang"]);
    // I vattnet letas inga diken.
    expect(ditchLines(grid, relief, undefined, undefined, () => true)).toEqual([]);
  });
  it("reliefen blir en bild", () => {
    const grid = ground(), image = reliefImage(grid, localRelief(grid, 4));
    expect(image.png.subarray(1, 4).toString()).toBe("PNG");
    expect(image.world.split("\n")[0]).toBe("1");
  });
});
