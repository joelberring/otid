import { describe, expect, it } from "vitest";
import { buildCostModel, calibrateSpeeds, DEFAULT_SPEED_BY_CLASS, legGrid, type CalibrationSample } from "../src";
import { forest, MM, rect } from "./synthetic";

/** Ett deterministiskt slumptal (så att testet alltid ger samma svar). */
function random(seed: number): () => number {
  let state = seed;
  return () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648; };
}

/**
 * Löpare som springer öster ut i band på kartan: y < 0 är normal skog (405), 0–200 är 406 (SLOW) och en stig (506)
 * längs y = 300. Sann fart: skog 4 m/s, 406 2,4 m/s (0,6), stig 5,6 m/s (1,4); varje löpare har en egen faktor.
 */
function samples(driftMeters: number, count = 6): CalibrationSample[] {
  const next = random(7);
  const out: CalibrationSample[] = [];
  const truth = { forest: 4, slow: 2.4, path: 5.6 };
  for (let runner = 0; runner < count; runner += 1) {
    const factor = 0.85 + 0.3 * next();
    for (const [y, speed] of [[-100, truth.forest], [100, truth.slow], [300, truth.path]] as const) {
      const points: { x: number; y: number; ms: number }[] = [];
      let ms = 0;
      // GPS-fel som driver långsamt (±`driftMeters`, period ~200 m) plus vitt brus ±2 m.
      const phase = next() * 2 * Math.PI;
      for (let x = -800; x <= 800; x += 5) {
        const dx = driftMeters * Math.cos(x / 31 + phase) + (next() - 0.5) * 4, dy = driftMeters * Math.sin(x / 37 + phase) + (next() - 0.5) * 4;
        points.push({ x: (x + dx) * MM, y: (y + dy) * MM, ms });
        ms += 5 / (speed * factor) * 1000;
      }
      out.push({ key: `${runner}-${y}`, runner: String(runner), points });
    }
  }
  return out;
}

describe("calibrateSpeeds", () => {
  const model = buildCostModel(forest().area("406", rect(-1000, 0, 1000, 200)).line("506", 0.18, [-1000, 300], [1000, 300]).build());

  it("skattar farterna ur rutterna relativt normal skog", () => {
    const result = calibrateSpeeds(model, samples(2));
    expect(result.speedByClass.NORMAL).toBe(DEFAULT_SPEED_BY_CLASS.NORMAL);
    expect(result.speedByClass.SLOW).toBeCloseTo(0.6, 1);
    expect(result.speedByClass.FAST).toBeCloseTo(1.4, 1);
    expect(result.perClass.SLOW.estimated).toBe(true);
    expect(result.perClass.FAST.estimated).toBe(true);
    // Klasser utan data behåller sitt värde.
    expect(result.perClass.FIGHT.estimated).toBe(false);
    expect(result.speedByClass.FIGHT).toBe(DEFAULT_SPEED_BY_CLASS.FIGHT);
    expect(result.samplesUsed).toBe(18);
    expect(["MEDIUM", "HIGH"]).toContain(result.reliability);
  });

  it("tål GPS-brus och hopp", () => {
    const noisy = samples(8);
    // Ett GPS-hopp på 300 m i en rutt och ett stopp i en annan.
    const first = noisy[0]!.points as { x: number; y: number; ms: number }[];
    first[50] = { ...first[50]!, x: first[50]!.x + 300 * MM };
    const second = noisy[1]!.points as { x: number; y: number; ms: number }[];
    for (let index = 100; index < second.length; index += 1) second[index] = { ...second[index]!, ms: second[index]!.ms + 120_000 };
    const result = calibrateSpeeds(model, noisy);
    expect(result.speedByClass.SLOW).toBeGreaterThan(0.5);
    expect(result.speedByClass.SLOW).toBeLessThan(0.7);
    expect(result.speedByClass.FAST).toBeGreaterThan(1.25);
    expect(result.speedByClass.FAST).toBeLessThan(1.55);
    expect(result.segmentsRejected).toBeGreaterThan(0);
  });

  it("skattar stigningen och lutningsfaktorn ur rutter i brant terräng", () => {
    // Kurvor var 10:e meter mellan y = 0 och 300 (lutning 50 %). Sanningen: climbFactor 10 (med descentFactor 3, alltså
    // 32,5 m per kurvpassage) och slopeFactor 0,5. Löparna skrår längs sluttningen, springer i plan skog och tvärs över.
    const slope = forest();
    for (let y = 0; y <= 300; y += 10) slope.line("101", 0.14, [-1000, y], [1000, y]);
    const steepModel = buildCostModel(slope.build());
    const grid = legGrid(steepModel, { from: { x: -900 * MM, y: -300 * MM }, to: { x: 900 * MM, y: 600 * MM } });
    const steepAt = (x: number, y: number) => grid.steep[Math.floor((grid.yTop - y * MM) / grid.cellMm) * grid.width + Math.floor((x * MM - grid.x0) / grid.cellMm)]!;
    const next = random(11);
    const out: CalibrationSample[] = [];
    const run = (runner: string, key: string, path: [number, number][]) => {
      const points: { x: number; y: number; ms: number }[] = [];
      let ms = 0;
      for (let index = 0; index < path.length; index += 1) {
        const [x, y] = path[index]!;
        points.push({ x: (x + (next() - 0.5) * 2) * MM, y: (y + (next() - 0.5) * 2) * MM, ms });
        const following = path[index + 1];
        if (!following) break;
        const meters = Math.hypot(following[0] - x, following[1] - y);
        const crossings = Math.abs(Math.floor(Math.min(following[1], 305) / 10) - Math.floor(Math.min(y, 305) / 10)) *
          (Math.max(y, following[1]) > -5 ? 1 : 0);
        ms += (meters * (1 + 0.5 * steepAt(x, y)) + crossings * 32.5) / 4 * 1000;
      }
      out.push({ key, runner, points });
    };
    for (let runner = 0; runner < 6; runner += 1) {
      const line = (x0: number, y0: number, x1: number, y1: number): [number, number][] => {
        const steps = Math.round(Math.hypot(x1 - x0, y1 - y0) / 5);
        return Array.from({ length: steps + 1 }, (_, k) => [x0 + (x1 - x0) * k / steps, y0 + (y1 - y0) * k / steps]);
      };
      run(String(runner), "skrå", line(-700, 155 + runner * 10 - 25, 700, 155 + runner * 10 - 25));
      run(String(runner), "plant", line(-700, -200 - runner * 10, 700, -200 - runner * 10));
      for (const x of [-500, -100, 300]) run(String(runner), `upp${x}`, line(x + runner * 20, -150, x + runner * 20, 450));
    }
    const result = calibrateSpeeds(steepModel, out);
    expect(result.terrain.climbEstimated).toBe(true);
    expect(result.terrain.slopeEstimated).toBe(true);
    // Inom ungefär 25 % (i dag 8,8 och 0,38): löparnas egna faktorer tar upp en del av skillnaden.
    expect(result.terrain.climbFactor).toBeGreaterThan(7.5);
    expect(result.terrain.climbFactor).toBeLessThan(12.5);
    expect(result.terrain.slopeFactor).toBeGreaterThan(0.3);
    expect(result.terrain.slopeFactor).toBeLessThan(0.7);
    // Utan tillräckligt med branta rutter behålls inställningarna.
    const flat = calibrateSpeeds(model, samples(2));
    expect(flat.terrain).toEqual({ climbFactor: 8, climbEstimated: false, slopeFactor: 0.2, slopeEstimated: false });
  });

  it("ändrar inget utan tillräckligt med data", () => {
    const result = calibrateSpeeds(model, samples(2, 1).slice(0, 1));
    expect(result.reliability).toBe("NONE");
    expect(result.speedByClass).toEqual(DEFAULT_SPEED_BY_CLASS);
    expect(calibrateSpeeds(model, []).reliability).toBe("NONE");
  });
});
