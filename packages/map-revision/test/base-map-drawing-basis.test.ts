import { describe, expect, it } from "vitest";
import { parseDxf } from "../src";
import {
  bankLines, basisLayerName, contourClass, dxfLayerName, hillshade, mosaicGrids, rgbOf, isolines, localRelief, reliefColor, simplifyLine, smoothGrid, stepColor, VEGETATION_STEPS
} from "../src/base-map/drawing-basis";
import { writeDxf } from "../src/base-map/dxf-write";
import type { HeightGrid } from "../src/base-map/clear-contours";

const gridOf = (columns: number, rows: number, z: (column: number, row: number) => number): HeightGrid => {
  const meters = new Float32Array(columns * rows);
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) meters[row * columns + column] = z(column, row);
  return { columns, rows, meters };
};

describe("isolines (täta kurvor)", () => {
  it("ger en sluten ring per nivå runt en kulle, med radien efter höjden", () => {
    // Kon: 3 m hög i mitten, 0,1 m per cell nedåt.
    const grid = gridOf(61, 61, (c, r) => 3 - 0.1 * Math.hypot(c - 30, r - 30));
    // Under 0 m räcker inte rutnätet runt kullen; de nivåerna klipps av kanten.
    const lines = isolines(grid, 0.25).filter(line => line.level >= 0);
    const levels = [...new Set(lines.map(line => line.level))].sort((a, b) => a - b);
    expect(levels[0]).toBe(0);
    expect(levels.at(-1)).toBe(2.75);
    for (const line of lines) {
      expect(line.closed).toBe(true);
      const radius = (3 - line.level) / 0.1;
      for (const [c, r] of line.points) expect(Math.abs(Math.hypot(c - 30, r - 30) - radius)).toBeLessThan(0.15);
    }
    expect(lines.filter(line => line.level === 1)).toHaveLength(1);
  });

  it("öppna linjer slutar vid kanten och vid saknad data", () => {
    const grid = gridOf(20, 10, c => c * 0.1);
    grid.meters[5 * 20 + 10] = NaN;
    const lines = isolines(grid, 0.5);
    expect(lines.every(line => !line.closed)).toBe(true);
    // Nivån 1,0 m går genom cellen utan data och delas i två.
    expect(lines.filter(line => line.level === 1)).toHaveLength(2);
  });

  it("tar bort små ringar (brus) men behåller stora", () => {
    const grid = gridOf(40, 40, (c, r) => (c === 3 && r === 3 ? 0.4 : 0) + Math.max(0, 2 - 0.1 * Math.hypot(c - 25, r - 25)));
    const all = isolines(grid, 0.25), kept = isolines(grid, 0.25, { minRingCells: 8 });
    expect(kept.length).toBeLessThan(all.length);
    expect(kept.every(line => !line.closed || line.points.length >= 8)).toBe(true);
  });

  it("klassar nivåerna efter hela och femte metrar", () => {
    expect(contourClass(0.25, 0.25)).toBe(0.25);
    expect(contourClass(3, 0.25)).toBe(1);
    expect(contourClass(10, 0.25)).toBe(5);
    expect(contourClass(10, 2.5)).toBe(5);
    expect(contourClass(7.5, 2.5)).toBe(2.5);
    expect(contourClass(50, 5)).toBe(25);
  });
});

describe("utjämning och förenkling", () => {
  it("låter saknad data vara och sprider den inte", () => {
    const grid = gridOf(5, 5, () => 1);
    grid.meters[12] = NaN;
    const smooth = smoothGrid(grid, 2);
    expect(Number.isNaN(smooth.meters[12])).toBe(true);
    expect(smooth.meters[11]).toBeCloseTo(1);
  });
  it("Douglas–Peucker tar bort punkter på en rak linje", () => {
    expect(simplifyLine([[0, 0], [1, 0.01], [2, 0], [3, 0]], 0.1)).toEqual([[0, 0], [3, 0]]);
  });
});

describe("småformer och släntkanter", () => {
  it("en sten syns som plus och ett dike som minus", () => {
    const grid = gridOf(30, 30, (c, r) => (c === 8 && r === 8 ? 1 : 0) + (c === 20 ? -0.5 : 0));
    const relief = localRelief(grid, 4);
    expect(relief[8 * 30 + 8]).toBeGreaterThan(0.9);
    expect(relief[15 * 30 + 20]).toBeLessThan(-0.4);
    expect(reliefColor(0)).toEqual([255, 255, 255]);
    expect(reliefColor(1)[2]).toBeLessThan(100);
  });

  it("hittar en vägbank men inte en jämnt brant sluttning, med lägre sidan till höger", () => {
    // Plan mark som tar ett steg på 1 m över två celler vid kolumn 20 (högre i öster); i nedre halvan en jämn sluttning.
    const grid = gridOf(40, 60, (c, r) => r < 30 ? (c < 20 ? 0 : c === 20 ? 0.75 : 1.5) : c * 0.6);
    const lines = bankLines(grid, 1);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) for (const [c, r] of line.points) { expect(r).toBeLessThan(31); expect(Math.abs(c - 20.5)).toBeLessThan(2.5); }
    // Lägre (väster) till höger: linjen går söderut (rader växer).
    const longest = lines.reduce((a, b) => a.points.length >= b.points.length ? a : b);
    expect(longest.points.at(-1)![1]).toBeGreaterThan(longest.points[0]![1]);
  });
});

describe("DXF och färger", () => {
  it("skriver R12 som går att läsa igen, med lager och höjd", () => {
    const text = writeDxf([
      { name: "101_hojdkurva", lines: [{ points: [[100, 200], [110, 205]], closed: false, z: 12.25 }] },
      { name: "113_kulle", lines: [], points: [[150, 250]] }
    ]);
    expect(text).toContain("AC1009");
    const parsed = parseDxf(text);
    expect(parsed.features.map(feature => feature.layer)).toEqual(["101_hojdkurva", "113_kulle"]);
    expect(parsed.features[0]!.elevation).toBeCloseTo(12.25);
  });
  it("lagernamn utan åäö och mellanslag", () => {
    expect(dxfLayerName("305 Dike – liten")).toBe("305_Dike_liten");
    expect(dxfLayerName("101 Höjdkurva")).toBe("101_Hojdkurva");
  });
  it("vegetationens skikt", () => {
    expect(stepColor(VEGETATION_STEPS, 0.2)).toEqual([255, 255, 255]);
    expect(stepColor(VEGETATION_STEPS, 1)).toEqual([250, 214, 120]);
    expect(stepColor(VEGETATION_STEPS, 30)).toEqual([232, 245, 230]);
  });
});

describe("etapper och lagernamn", () => {
  it("lägger ihop två etapper till ett rutnät", () => {
    const west = { grid: gridOf(3, 2, () => 1), affine: [1, 0, 100, 0, -1, 200] as const };
    const east = { grid: gridOf(3, 2, () => 2), affine: [1, 0, 103, 0, -1, 200] as const };
    const joined = mosaicGrids([west, east])!;
    expect(joined.grid.columns).toBe(6);
    expect(joined.grid.rows).toBe(2);
    expect([...joined.grid.meters.slice(0, 6)]).toEqual([1, 1, 1, 2, 2, 2]);
    expect(joined.affine).toEqual([1, 0, 100, 0, -1, 200]);
  });
  it("ger ISOM-numret ur lagrets namn", () => {
    const line = { name: "contour", count: 5, points: 0, lines: 5, closedLines: 0, areas: 0 };
    expect(basisLayerName(line, "kurvor.dxf")).toMatch(/^101_/);
    expect(basisLayerName({ ...line, name: "okant" }, "diken.dxf")).toBe("diken_okant");
  });
});

describe("skuggning och färgbilder", () => {
  it("sluttningen mot nordväst är ljusare än den mot sydost, plan mark mittemellan", () => {
    // En kulle; raderna växer söderut.
    const grid = gridOf(21, 21, (c, r) => Math.max(0, 5 - 0.5 * Math.hypot(c - 10, r - 10)));
    const shade = hillshade(grid, 1, [315], 1);
    const northwest = shade[6 * 21 + 6]!, southeast = shade[14 * 21 + 14]!, flat = shade[0]!;
    expect(northwest).toBeGreaterThan(flat);
    expect(southeast).toBeLessThan(flat);
    const both = hillshade(grid, 1, [315, 135], 1);
    expect(Math.abs(both[6 * 21 + 6]! - both[14 * 21 + 14]!)).toBeLessThan(3);
  });
  it("RGB med vitt där data saknas", () => {
    expect([...rgbOf([NaN, 1], () => [1, 2, 3])]).toEqual([255, 255, 255, 1, 2, 3]);
  });
});
