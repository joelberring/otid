import { describe, expect, it } from "vitest";
import { generalizeVegetation, vegetationLayerMask, vegetationRing, VEG_DIFFICULT, VEG_FOREST, VEG_NONE, VEG_OPEN, VEG_SLOW } from "../src/base-map/vegetation-shapes";

/** Ägaren 2026-11-17: gränserna mellan grönt, skog och öppen mark – inga smala mellanzoner, inga fläckar, delade kanter. */
const columns = 100, rows = 100;
const grid = (label: (x: number, y: number) => number) => Uint8Array.from({ length: columns * rows }, (_, i) => label(Math.floor(i / rows), i % rows));
const at = (labels: Uint8Array, x: number, y: number) => labels[x * rows + y];
const options = { cellMeters: 2, scale: 15_000, level: 4 };
const count = (labels: Uint8Array, label: number) => labels.reduce((sum, value) => sum + (value === label ? 1 : 0), 0);

describe("generalisering av vegetationen som en indelning", () => {
  it("ett smalt band av 406 runt 408 försvinner (mellanzon), men ett brett står kvar", () => {
    // 408 i mitten (radie 20), 406 som en ring 2 celler (4 m) bred runt den, skog utanför.
    const thin = grid((x, y) => { const d = Math.hypot(x - 50, y - 50); return d < 20 ? VEG_DIFFICULT : d < 22 ? VEG_SLOW : VEG_FOREST; });
    expect(count(generalizeVegetation(thin, columns, rows, options), VEG_SLOW)).toBe(0);
    // Samma med en 406-ring på 12 celler (24 m): den är en egen yta.
    const wide = grid((x, y) => { const d = Math.hypot(x - 50, y - 50); return d < 20 ? VEG_DIFFICULT : d < 32 ? VEG_SLOW : VEG_FOREST; });
    expect(count(generalizeVegetation(wide, columns, rows, options), VEG_SLOW)).toBeGreaterThan(1000);
  });
  it("en smal vit strimma mellan gult och grönt går till grannarna", () => {
    const strip = grid(x => x < 48 ? VEG_OPEN : x < 50 ? VEG_FOREST : VEG_SLOW);
    const out = generalizeVegetation(strip, columns, rows, options);
    for (let y = 10; y < 90; y += 10) expect([48, 49].map(x => at(out, x, y))).not.toContain(VEG_FOREST);
  });
  it("strödda pixlar försvinner och små fläckar slås ihop med grannen", () => {
    // Var femte cell grön (spridda träd i laserns klassbild) och en liten 408-fläck på 3 × 3 celler.
    const noisy = grid((x, y) => (x * 7 + y * 3) % 5 === 0 ? VEG_SLOW : x >= 70 && x < 73 && y >= 70 && y < 73 ? VEG_DIFFICULT : VEG_FOREST);
    const out = generalizeVegetation(noisy, columns, rows, options);
    expect(count(out, VEG_SLOW) + count(out, VEG_DIFFICULT)).toBe(0);
  });
  it("vatten (0) rörs inte och får inget", () => {
    const lake = grid((x, y) => Math.hypot(x - 30, y - 30) < 15 ? VEG_NONE : x > 60 ? VEG_SLOW : VEG_FOREST);
    const out = generalizeVegetation(lake, columns, rows, options);
    for (let i = 0; i < out.length; i += 1) expect(out[i] === VEG_NONE).toBe(lake[i] === VEG_NONE);
  });
  it("läge 0 lämnar etiketterna", () => {
    const labels = grid(x => x < 50 ? VEG_OPEN : VEG_FOREST);
    expect(generalizeVegetation(labels, columns, rows, { ...options, level: 0 })).toBe(labels);
  });
  it("högre läge ger mindre kant", () => {
    const blobs = grid((x, y) => Math.sin(x / 3) + Math.cos(y / 4) + Math.sin((x + y) / 7) > 0.6 ? VEG_SLOW : VEG_FOREST);
    const edge = (labels: Uint8Array) => { let sum = 0; for (let i = rows; i < labels.length; i += 1) if (labels[i] !== labels[i - rows]) sum += 1; return sum; };
    expect(edge(generalizeVegetation(blobs, columns, rows, { ...options, level: 8 }))).toBeLessThan(edge(generalizeVegetation(blobs, columns, rows, { ...options, level: 2 })));
  });
  it("grönt är kapslat och öppet ligger en cell in under grönt (ingen vit strimma)", () => {
    const labels = grid(x => x < 40 ? VEG_OPEN : x < 70 ? VEG_SLOW : VEG_DIFFICULT);
    const open = vegetationLayerMask(labels, columns, rows, VEG_OPEN), slow = vegetationLayerMask(labels, columns, rows, VEG_SLOW);
    expect(open[40 * rows + 50]).toBe(1);
    expect(open[41 * rows + 50]).toBe(0);
    expect(slow[80 * rows + 50]).toBe(1);
  });
  it("en fläck 408 utan ljusare kant blir inte också en 406 med samma kant (ägaren 2026-11-23: «ligger trippelt»)", () => {
    // Vänster: bara 408 (ingen 406 runt). Höger: 408 med en bred 406-ring. Kapslingen står kvar där 406 finns.
    const labels = grid((x, y) => Math.hypot(x - 25, y - 50) < 12 ? VEG_DIFFICULT
      : Math.hypot(x - 75, y - 50) < 10 ? VEG_DIFFICULT : Math.hypot(x - 75, y - 50) < 20 ? VEG_SLOW : VEG_FOREST);
    const slow = vegetationLayerMask(labels, columns, rows, VEG_SLOW), difficult = vegetationLayerMask(labels, columns, rows, VEG_DIFFICULT);
    expect(at(slow, 25, 50)).toBe(0);
    expect(at(difficult, 25, 50)).toBe(1);
    expect(at(slow, 75, 50)).toBe(1);
    expect(at(slow, 75, 35)).toBe(1);
  });
  it("kanten blir en ritad kurva: trappsteg förenklas och hörnen rundas", () => {
    const stairs: [number, number][] = [];
    for (let k = 0; k < 20; k += 1) stairs.push([k, k], [k + 1, k]);
    stairs.push([20, 20], [0, 20]);
    const ring = vegetationRing(stairs, 1, 3);
    expect(ring.length).toBeLessThan(stairs.length * 2);
    // Trappan blir en rak diagonal: ingen punkt mer än en och en halv cell under den.
    for (const [x, y] of ring) expect(x - y).toBeLessThan(1.5);
  });
  it("reassign väljer majoritetsgranne i stället för fast V/Ö/S/N-ordning", () => {
    // En 1-cellsfläck 408 inne i skog med öppet endast i väster (1 granne) och skog i Ö/S/N (3 grannar) blir skog (majoritet), inte öppet.
    const island = grid((x, y) => x < 48 ? VEG_OPEN : x === 48 && y === 50 ? VEG_DIFFICULT : VEG_FOREST);
    const out = generalizeVegetation(island, columns, rows, { cellMeters: 2, scale: 15_000, level: 1 });
    expect(at(out, 48, 50)).toBe(VEG_FOREST);
  });
});
