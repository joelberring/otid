import { describe, expect, it } from "vitest";
import { buildCostModel, calibrateSpeeds, DEFAULT_SPEED_BY_CLASS, legGrid, type CalibrationSample } from "../src";
import { preparedOf } from "../src/cost-model";
import { boxFrame, rasterize } from "../src/raster";
import { search, SearchWorkspace, type SearchGrid } from "../src/search";
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

  it("paritet: kombinerat raster och chunk-fallback (> 2 000 000 celler) ger konsekventa kalibreringsresultat", () => {
    // 1) Två geografiskt åtskilda kluster i 1:10 000 (4 km isär i både x och y → > 6 M celler ihop → chunk-fallback).
    const bigMap = forest(6000)
      .area("406", rect(-1000, 0, 1000, 200))
      .line("506", 0.18, [-1000, 300], [1000, 300])
      .area("406", rect(3000, 4000, 5000, 4200))
      .line("506", 0.18, [3000, 4300], [5000, 4300])
      .build();
    const bigModel = buildCostModel(bigMap);
    const baseSamples = samples(2, 4);
    // Andra klustret flyttat (+4000 m, +4000 m) med identisk lokal terräng (tvingar > 2M celler ihop).
    const shifted = baseSamples.map(s => ({
      ...s,
      key: `${s.key}-ne`,
      points: s.points.map(p => ({ x: p.x + 4000 * MM, y: p.y + 4000 * MM, ms: p.ms }))
    }));
    const singleCluster = calibrateSpeeds(bigModel, baseSamples);
    const multiCluster = calibrateSpeeds(bigModel, [...baseSamples, ...shifted]);
    // Exakt samma underliggande sanna farter i båda klustren → identiska skattningar (med 2× så många segment).
    expect(multiCluster.speedByClass.SLOW).toBeCloseTo(singleCluster.speedByClass.SLOW, 2);
    expect(multiCluster.speedByClass.FAST).toBeCloseTo(singleCluster.speedByClass.FAST, 2);
    expect(multiCluster.segmentsUsed).toBeGreaterThanOrEqual(singleCluster.segmentsUsed * 1.9);

    // 2) Ett uteliggande GPS-spår 5 km bort tvingar chunk-fallback utan att ändra huvudklustrets resultat alls!
    const farSample: CalibrationSample = {
      key: "far",
      runner: "99",
      points: [{ x: 5000 * MM, y: 5000 * MM, ms: 0 }, { x: 5010 * MM, y: 5000 * MM, ms: 3000 }]
    };
    const withOutlier = calibrateSpeeds(bigModel, [...baseSamples, farSample]);
    expect(withOutlier).toEqual(singleCluster);
  });
});

describe("rasterize och SearchWorkspace byte-paritet", () => {
  it("rasterize ger 100 % byte-identiskt raster med spatialt rutnät (>= 256 objekt) och partiell utom-ramen-markering", () => {
    const builder = forest(400);
    // Lägg till 320 små objekt så att FeatureGrid (>= 256) aktiveras.
    for (let i = 0; i < 160; i += 1) {
      const x = -350 + (i % 20) * 35, y = -350 + Math.floor(i / 20) * 85;
      builder.area("406", rect(x, y, x + 20, y + 40));
      builder.line("101", 0.14, [x - 5, y + 10], [x + 25, y + 30]);
    }
    const map = builder.build();
    const prepared = preparedOf(buildCostModel(map));
    expect(prepared.features.length).toBeGreaterThanOrEqual(256);

    // Testa flera ramar: helt inuti, delvis utanför åt alla håll, samt helt utanför bounds.
    const frames = [
      boxFrame({ minX: -20, minY: -20, maxX: 20, maxY: 20 }, prepared.scale),
      boxFrame({ minX: -55, minY: -55, maxX: 55, maxY: 55 }, prepared.scale),
      boxFrame({ minX: -60, minY: -10, maxX: 10, maxY: 60 }, prepared.scale),
      boxFrame({ minX: 60, minY: 60, maxX: 80, maxY: 80 }, prepared.scale)
    ];

    const sameArray = (a: ArrayLike<number>, b: ArrayLike<number>) => {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
      return true;
    };

    for (const frame of frames) {
      const fast = rasterize(prepared, frame, DEFAULT_SPEED_BY_CLASS);
      const bounds = prepared.bounds!;
      let outsideMismatch = 0, insideBlocked = 0;
      for (let row = 0; row < frame.height; row += 1) {
        const y = frame.yTop - (row + 0.5) * frame.cellMm;
        for (let col = 0; col < frame.width; col += 1) {
          const x = frame.x0 + (col + 0.5) * frame.cellMm;
          const idx = row * frame.width + col;
          const outside = x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY;
          if (outside && fast.ground[idx] !== 5) outsideMismatch += 1;
          else if (!outside && fast.ground[idx] === 5) insideBlocked += 1;
        }
      }
      expect(outsideMismatch).toBe(0);
      expect(insideBlocked).toBe(0);
      const again = rasterize(prepared, frame, DEFAULT_SPEED_BY_CLASS);
      expect(sameArray(fast.ground, again.ground)).toBe(true);
      expect(sameArray(fast.track, again.track)).toBe(true);
      expect(sameArray(fast.contour, again.contour)).toBe(true);
      expect(sameArray(fast.barrier, again.barrier)).toBe(true);
      expect(sameArray(fast.steep, again.steep)).toBe(true);
    }

    // Direkt jämförelse: liten sub-ram som skär < 50 objekt — filtrerad feature-lista (< 256, inget rutnät) vs hela modellen (>= 256, med rutnät)!
    const subFrame = boxFrame({ minX: -10, minY: -10, maxX: 15, maxY: 15 }, prepared.scale);
    const matching = prepared.features.filter(f =>
      f.box.maxX >= subFrame.x0 && f.box.minX <= subFrame.x0 + subFrame.width * subFrame.cellMm &&
      f.box.minY <= subFrame.yTop && f.box.maxY >= subFrame.yTop - subFrame.height * subFrame.cellMm
    );
    expect(matching.length).toBeLessThan(256);
    const withGrid = rasterize(prepared, subFrame, DEFAULT_SPEED_BY_CLASS);
    const withoutGrid = rasterize({ ...prepared, features: matching }, subFrame, DEFAULT_SPEED_BY_CLASS);
    expect(sameArray(withGrid.ground, withoutGrid.ground)).toBe(true);
    expect(sameArray(withGrid.track, withoutGrid.track)).toBe(true);
    expect(sameArray(withGrid.contour, withoutGrid.contour)).toBe(true);
    expect(sameArray(withGrid.barrier, withoutGrid.barrier)).toBe(true);
    expect(sameArray(withGrid.steep, withoutGrid.steep)).toBe(true);
  });

  it("SearchWorkspace återanvänder sin Heap mellan sökningar med bit-identiska resultat", () => {
    const w = 40, h = 40, n = w * h;
    const pace = new Float32Array(n).fill(1);
    for (let r = 5; r < 35; r += 1) pace[r * w + 20] = Infinity; // vägg i mitten
    const grid: SearchGrid = {
      width: w, height: h, cellMeters: 2, pace,
      contour: new Uint8Array(n), climbCostPerUnit: 1, barrier: new Uint8Array(n)
    };
    const ws = new SearchWorkspace(n);
    const queries = [
      { start: 10 * w + 5, goal: 10 * w + 35 },
      { start: 30 * w + 35, goal: 2 * w + 2 },
      { start: 20 * w + 10, goal: 20 * w + 30 }
    ];
    for (const q of queries) {
      const fresh = search(grid, pace, q.start, { goal: q.goal, minPace: 1 });
      const reused = search(grid, pace, q.start, { goal: q.goal, minPace: 1 }, ws);
      expect(reused.cost[q.goal]).toBe(fresh.cost[q.goal]);
      expect(reused.parent[q.goal]).toBe(fresh.parent[q.goal]);
    }
  });
});
