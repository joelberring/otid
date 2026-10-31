import { describe, expect, it } from "vitest";
import { buildCostModel, calibrateSpeeds, DEFAULT_SPEED_BY_CLASS, type CalibrationSample } from "../src";
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

  it("ändrar inget utan tillräckligt med data", () => {
    const result = calibrateSpeeds(model, samples(2, 1).slice(0, 1));
    expect(result.reliability).toBe("NONE");
    expect(result.speedByClass).toEqual(DEFAULT_SPEED_BY_CLASS);
    expect(calibrateSpeeds(model, []).reliability).toBe("NONE");
  });
});
