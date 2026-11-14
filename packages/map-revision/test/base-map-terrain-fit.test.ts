import { describe, expect, it } from "vitest";
import { fitTerrain, terrainFitPlan } from "../src/base-map/terrain-fit";

type Position = [number, number];
/** En kuperad mark: två vågor som korsar varandra, så att kurvorna går åt alla håll. */
const ground = (x: number, y: number) => 20 * Math.sin(x / 90) + 20 * Math.cos(y / 110) + 0.02 * x;
/** Höjdkurvor på marken: spåras på nivån med små steg längs höjdlinjen. */
function contoursOf(height: (x: number, y: number) => number, size: number): Position[][] {
  const lines: Position[][] = [];
  for (let level = -30; level <= 40; level += 5) for (let start = 40; start < size; start += 160) {
    // Sök en punkt på nivån längs en lodrät linje och följ kurvan därifrån.
    let y0: number | undefined;
    for (let y = 40; y < size - 40; y += 2) if ((height(start, y) - level) * (height(start, y + 2) - level) <= 0) { y0 = y; break; }
    if (y0 === undefined) continue;
    const line: Position[] = [];
    let x = start, y = y0;
    for (let step = 0; step < 220; step += 1) {
      const gx = (height(x + 0.5, y) - height(x - 0.5, y)), gy = (height(x, y + 0.5) - height(x, y - 0.5)), norm = Math.hypot(gx, gy);
      if (norm < 1e-6) break;
      // Rätta tillbaka till nivån och gå längs kurvan.
      const off = (height(x, y) - level) / (norm * norm);
      x -= gx * off; y -= gy * off;
      if (x < 20 || y < 20 || x > size - 20 || y > size - 20) break;
      line.push([x, y]);
      x += -gy / norm * 5; y += gx / norm * 5;
    }
    if (line.length > 40) lines.push(line);
  }
  return lines;
}
const SIZE = 1500;
const truth = contoursOf(ground, SIZE);
const heightAt = (x: number, y: number) => x < 0 || y < 0 || x > SIZE || y > SIZE ? undefined : ground(x, y);

describe("passa in en karta mot laserns mark", () => {
  it("delar kurvorna i bitar och lägger noder där det finns nog med kurvor", () => {
    const plan = terrainFitPlan(truth);
    expect(plan.pieces.length).toBeGreaterThan(100);
    expect(plan.nodes.length).toBeGreaterThan(8);
    expect(plan.nodes.every(node => node.pieces.length >= 12)).toBe(true);
    expect(terrainFitPlan([]).nodes).toEqual([]);
  });
  it("lämnar en karta som redan ligger rätt orörd", () => {
    const fit = fitTerrain(truth, heightAt);
    expect(fit.maxShift).toBeLessThanOrEqual(3);
    expect(fit.medianShift).toBe(0);
    expect(fit.after).toBeLessThanOrEqual(fit.before);
  });
  it("hittar en gemensam förskjutning och minskar kurvornas avvikelse från jämn höjd", () => {
    // Kartan ligger 12 m för långt österut och 9 m för långt söderut: den ska flyttas (−12, +9).
    const moved = truth.map(line => line.map(([x, y]) => [x + 12, y - 9] as Position));
    const fit = fitTerrain(moved, heightAt);
    expect(fit.before).toBeGreaterThan(0.25);
    expect(fit.after).toBeLessThan(fit.before / 3);
    const inner = fit.nodes.filter(node => node.pieces >= 25);
    expect(inner.length).toBeGreaterThan(4);
    for (const node of inner) { expect(node.shift[0]).toBeGreaterThanOrEqual(-15); expect(node.shift[0]).toBeLessThanOrEqual(-9); expect(node.shift[1]).toBeGreaterThanOrEqual(6); expect(node.shift[1]).toBeLessThanOrEqual(12); }
  });
  it("följer en förskjutning som växer över kartan (skev karta)", () => {
    // Ingen flytt i väster, 18 m österut längst i öster.
    const skew = truth.map(line => line.map(([x, y]) => [x + 18 * x / SIZE, y] as Position));
    const fit = fitTerrain(skew, heightAt);
    const west = fit.nodes.filter(node => node.at[0] < 400 && node.pieces >= 20), east = fit.nodes.filter(node => node.at[0] > 1100 && node.pieces >= 20);
    const mean = (nodes: typeof west) => nodes.reduce((sum, node) => sum + node.shift[0], 0) / nodes.length;
    expect(west.length).toBeGreaterThan(0); expect(east.length).toBeGreaterThan(0);
    expect(mean(west)).toBeGreaterThan(-7);
    expect(mean(east)).toBeLessThan(-10);
  });
  it("ger inga noder utan höjd", () => {
    const fit = fitTerrain(truth, () => undefined);
    expect(fit.nodes).toEqual([]);
    // Höjd bara i västra halvan: noderna i öster blir inga passpunkter.
    const half = fitTerrain(truth, (x, y) => x > SIZE / 2 ? undefined : heightAt(x, y));
    expect(half.nodes.length).toBeGreaterThan(0);
    expect(half.nodes.every(node => node.at[0] < SIZE / 2 + 450)).toBe(true);
  });
});
