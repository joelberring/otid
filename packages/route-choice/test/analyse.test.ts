import { describe, expect, it } from "vitest";
import { analyseCourse, analyseLeg, buildCostModel, legGrid, SLOPE_FACTOR, slopeExcess, type LegInput } from "../src";
import { forest, m, rect, ring } from "./synthetic";

function leg(from: [number, number], to: [number, number], extra: Partial<LegInput> = {}): LegInput {
  return { key: "1-2", from: m(...from), to: m(...to), ...extra };
}

/** Punkter på en cirkelbåge (meter), grader moturs från öster. */
function circle(cx: number, cy: number, r: number, from = 0, to = 360, steps = 128): [number, number][] {
  const points: [number, number][] = [];
  for (let k = 0; k <= steps; k += 1) {
    const a = (from + (to - from) * k / steps) * Math.PI / 180;
    points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return points;
}

/**
 * En kulle med kurvorna `rings` runt (200, 0) mellan kontrollerna (0, 0) och (400, 0). Utanför radien `outer` är det
 * förbjudet utom i två kilar mot kontrollerna, så att omvägen måste skrå längs kullens sida.
 */
function hillBetween(rings: readonly number[], outer: number) {
  const map = forest();
  for (const r of rings) map.line("101", 0.14, ...circle(200, 0, r));
  for (const [from, to] of [[20, 160], [200, 340]] as const) {
    map.area("520", ring([...circle(200, 0, outer, from, to, 32), ...circle(200, 0, 900, to, from, 32)].map(([x, y]) => m(x, y))));
  }
  return map;
}

describe("analyseLeg", () => {
  it("går rakt i öppen skog (fågelväg ±2 %)", () => {
    const model = buildCostModel(forest().build());
    for (const [to, label] of [[[400, 0], "öster"], [[300, 170], "snett"], [[123, 377], "brant vinkel"]] as const) {
      const result = analyseLeg(model, leg([0, 0], to as [number, number]));
      expect(result.best, label).toBeDefined();
      expect(result.best!.meters / result.straightMeters, label).toBeGreaterThanOrEqual(0.999);
      expect(result.best!.meters / result.straightMeters, label).toBeLessThan(1.02);
      expect(result.verdict, label).toBe("NO_CHOICE");
      expect(result.alternatives, label).toHaveLength(0);
      expect(result.warnings, label).toEqual([]);
      // 6:00/km i normal skog.
      expect(result.best!.seconds / result.best!.meters).toBeCloseTo(0.36, 2);
    }
  });

  it("går runt en sjö och ser två vägval på var sida", () => {
    const model = buildCostModel(forest().area("301", rect(150, -100, 250, 100)).build());
    const result = analyseLeg(model, leg([0, 0], [400, 0]));
    expect(result.best!.meters).toBeGreaterThan(result.straightMeters * 1.03);
    expect(["ROUTE_CHOICE", "ABOUT_EQUAL"]).toContain(result.verdict);
    expect(result.alternatives.length).toBeGreaterThanOrEqual(1);
    const sides = [result.best!, ...result.alternatives].map(line => Math.sign(line.points.reduce((sum, p) => sum + p.y, 0)));
    expect(new Set(sides).size).toBe(2);
    // Stråket finns på båda sidor om sjön.
    const corridor = result.corridor!;
    expect(corridor).toBeDefined();
    expect(corridor.mask.reduce((sum, v) => sum + v, 0)).toBeGreaterThan(100);
    // `origin` är nedre vänstra hörnet: bästa vägens punkter ligger i stråkets celler (inte förskjutna en höjd uppåt).
    const inside = result.best!.points.filter(p => {
      const col = Math.floor((p.x - corridor.origin.x) / corridor.cellMm);
      const row = corridor.height - 1 - Math.floor((p.y - corridor.origin.y) / corridor.cellMm);
      return col >= 0 && col < corridor.width && row >= 0 && row < corridor.height && corridor.mask[row * corridor.width + col] === 1;
    });
    expect(inside.length / result.best!.points.length).toBeGreaterThan(0.8);
  });

  it("tar stigen när omvägen lönar sig och inte annars", () => {
    // Stig i en båge norrut; rakt fram är skogen tät eller lättlöpt.
    const path: [number, number][] = [[0, 0], [100, 150], [300, 150], [400, 0]];
    const slow = buildCostModel(forest().area("410", rect(20, -300, 380, 130)).line("505", 0.25, ...path).build());
    const viaPath = analyseLeg(slow, leg([0, 0], [400, 0]));
    expect(Math.max(...viaPath.best!.points.map(p => p.y))).toBeGreaterThan(140 * 0.1);
    const easy = buildCostModel(forest().line("505", 0.25, ...path).build());
    const straight = analyseLeg(easy, leg([0, 0], [400, 0]));
    expect(Math.max(...straight.best!.points.map(p => Math.abs(p.y)))).toBeLessThan(5 * 0.1);
    expect(straight.best!.meters / straight.straightMeters).toBeLessThan(1.02);
  });

  it("följer en stig genom tät skog och räknar den som snabb", () => {
    const model = buildCostModel(forest().area("410", rect(-500, -500, 500, 500)).line("506", 0.18, [0, 0], [400, 0]).build());
    const result = analyseLeg(model, leg([0, 0], [400, 0]));
    expect(result.best!.meters / result.straightMeters).toBeLessThan(1.02);
    expect(result.best!.seconds).toBeLessThan(400 * 0.36);
  });

  it("går genom öppningen i ett ej passerbart staket", () => {
    const model = buildCostModel(forest().line("518", 0.25, [200, -3000], [200, 150]).line("518", 0.25, [200, 170], [200, 3000]).build());
    const result = analyseLeg(model, leg([0, 0], [400, 0]));
    const crossing = result.best!.points.find((p, index, all) => index > 0 && (all[index - 1]!.x - 20) * (p.x - 20) <= 0);
    expect(crossing).toBeDefined();
    const ys = result.best!.points.map(p => p.y / 0.1);
    expect(Math.max(...ys)).toBeGreaterThan(140);
    // Genom öppningen (y 150–170): minst 2 × √(200² + 150²) = 500 m.
    expect(result.best!.meters).toBeGreaterThan(495);
    expect(result.best!.meters).toBeLessThan(515);
  });

  it("räknar stigning ur höjdkurvorna", () => {
    const contours = forest();
    for (let x = 100; x <= 300; x += 50) contours.line("101", 0.14, [x, -1000], [x, 1000]);
    contours.line("103", 0.1, [325, -1000], [325, 1000]);
    const model = buildCostModel(contours.build());
    // Lutningen av, så att bara kurvpassagerna räknas.
    const result = analyseLeg(model, leg([0, 0], [400, 0]), { version: 1, slopeFactor: 0 });
    // 27,5 passerade höjdmeter; riktningen syns inte, så stigningen uppför är i snitt hälften.
    expect(result.best!.climbMeters).toBeCloseTo((5 * 5 + 2.5) / 2, 5);
    // Varje passerad höjdmeter kostar (8 upp + 3 ned) / 2 = 5,5 m plan väg: 151,25 m extra.
    expect(result.best!.seconds).toBeCloseTo((400 + 151.25) * 0.36, 0);
    const steeper = analyseLeg(model, leg([0, 0], [400, 0]), { version: 1, slopeFactor: 0, descentFactor: 4 });
    expect(steeper.best!.seconds).toBeCloseTo((400 + 27.5 * 6) * 0.36, 0);
    const flat = analyseLeg(buildCostModel(forest().build()), leg([0, 0], [400, 0]));
    expect(flat.best!.climbMeters).toBe(0);
  });

  it("räknar en kulle som en gång upp och en gång ned, inte två gånger upp", () => {
    // Tre ringar runt (200, 0): rakt över är 6 passager = 15 m upp och 15 m ned; runt den yttersta ringen är ≈ 601 m.
    const hill = forest();
    for (const r of [100, 150, 190]) hill.line("101", 0.14, ...circle(200, 0, r));
    const model = buildCostModel(hill.build());
    // 400 + 30 × (8 + 3) / 2 = 565 < 601: över kullen.
    const over = analyseLeg(model, leg([0, 0], [400, 0]), { version: 1, slopeFactor: 0 });
    expect(over.best!.climbMeters).toBeCloseTo(15, 5);
    expect(over.best!.meters / over.straightMeters).toBeLessThan(1.02);
    // Den gamla regeln (nedför lika dyrt som uppför): 400 + 30 × 8 = 640 > 601, runt.
    const around = analyseLeg(model, leg([0, 0], [400, 0]), { version: 1, slopeFactor: 0, descentFactor: 8 });
    expect(around.best!.climbMeters).toBeLessThanOrEqual(5);
    expect(around.best!.meters / around.straightMeters).toBeGreaterThan(1.2);
  });

  it("skattar lutningen ur kurvtätheten och gör skrå i brant mark långsamt, men inte på stigen", () => {
    // Parallella kurvor var 10:e meter längs sträckan: lutning 5 / 10 = 50 %.
    const slope = forest();
    for (let y = -200; y <= 200; y += 10) slope.line("101", 0.14, [-1000, y], [1000, y]);
    const model = buildCostModel(slope.build());
    const grid = legGrid(model, leg([0, 5], [400, 5]));
    const middle = Math.floor(grid.height / 2) * grid.width + Math.floor(grid.width / 2);
    // Rutan (41 m) rymmer 4 eller 5 kurvor: lutningen skattas till 45–55 %.
    expect(grid.steep[middle]).toBeGreaterThan(slopeExcess(0.45));
    expect(grid.steep[middle]).toBeLessThan(slopeExcess(0.55));
    const traverse = analyseLeg(model, leg([0, 5], [400, 5]));
    expect(traverse.best!.climbMeters).toBe(0);
    // Tiden i plan skog gånger 1 + 0,2 × lutningens tillägg (≈ 1,6 vid 50 %).
    const factor = traverse.best!.seconds / (400 * 0.36);
    expect(factor).toBeGreaterThan(1 + SLOPE_FACTOR * slopeExcess(0.45));
    expect(factor).toBeLessThan(1 + SLOPE_FACTOR * slopeExcess(0.55));
    const off = analyseLeg(model, leg([0, 5], [400, 5]), { version: 1, slopeFactor: 0 });
    expect(off.best!.seconds).toBeCloseTo(400 * 0.36, 0);
    // En stig längs sluttningen påverkas inte av lutningen.
    const path = buildCostModel(slope.line("505", 0.25, [-1000, 5], [1000, 5]).build());
    expect(analyseLeg(path, leg([0, 5], [400, 5])).best!.seconds).toBeCloseTo(400 / 1.25 * 0.36, 0);
  });

  it("tar stigen som skrår runt en hög kulle men inte samma omväg i brant skog med branter", () => {
    // Kullen: kurvor var 8:e meter (lutning ≈ 60 %) från radien 60 till 84, platt topp; rakt över är 8 passager
    // (20 m upp och 20 m ned). Omvägen skrår i sluttningen (utanför är det förbjudet).
    const rings = [60, 68, 76, 84];
    const arc = circle(200, 0, 80, 180, 0, 64);
    const viaPath = analyseLeg(buildCostModel(hillBetween(rings, 85).line("505", 0.25, [0, 0], ...arc, [400, 0]).build()),
      leg([0, 0], [400, 0]));
    const highest = (line: { points: readonly { y: number }[] }) => Math.max(...line.points.map(p => Math.abs(p.y))) / 0.1;
    // Stigen vinner: omvägen följer den runt kullen.
    expect(highest(viaPath.best!)).toBeGreaterThan(70);
    expect(viaPath.best!.climbMeters).toBeLessThanOrEqual(5);
    // Samma omväg utan stig, i brant skrå med branter (202) tvärs över, förlorar mot raka vägen över toppen.
    const rough = hillBetween(rings, 85);
    for (const angle of [40, 65, 90, 115, 140, 220, 245, 270, 295, 320]) {
      const radians = angle * Math.PI / 180;
      rough.line("202", 0.25, [200 + 55 * Math.cos(radians), 55 * Math.sin(radians)], [200 + 86 * Math.cos(radians), 86 * Math.sin(radians)]);
    }
    const viaForest = analyseLeg(buildCostModel(rough.build()), leg([0, 0], [400, 0]));
    expect(highest(viaForest.best!)).toBeLessThan(20);
    expect(viaForest.best!.climbMeters).toBeCloseTo(20, 0);
  });

  it("räknar en passerbar brant som en kostnad per passage, men inte där en stig går igenom", () => {
    const cliff = forest().line("202", 0.25, [200, -1000], [200, 1000]);
    const result = analyseLeg(buildCostModel(cliff.build()), leg([0, 0], [400, 0]));
    expect(result.best!.meters / result.straightMeters).toBeLessThan(1.02);
    expect(result.best!.seconds).toBeCloseTo((400 + 15) * 0.36, 0);
    const own = analyseLeg(buildCostModel(cliff.build(), { version: 1, crossingMetersBySymbol: { "202": 40 } }), leg([0, 0], [400, 0]));
    expect(own.best!.seconds).toBeCloseTo((400 + 40) * 0.36, 0);
    const withPath = buildCostModel(cliff.line("506", 0.18, [0, 0], [400, 0]).build());
    expect(analyseLeg(withPath, leg([0, 0], [400, 0])).best!.seconds).toBeCloseTo(400 / 1.25 * 0.36, 0);
  });

  it("väljer att gå runt en kulle när stigningen kostar mer än omvägen", () => {
    const hill = forest();
    for (const r of [40, 60, 80]) {
      const points: [number, number][] = [];
      for (let a = 0; a <= 64; a += 1) points.push([200 + r * Math.cos(a / 32 * Math.PI), r * Math.sin(a / 32 * Math.PI)]);
      hill.line("101", 0.14, ...points);
    }
    const result = analyseLeg(buildCostModel(hill.build()), leg([0, 0], [400, 0]), { version: 1, climbFactor: 20 });
    expect(result.best!.climbMeters).toBe(0);
  });

  it("flyttar en kontroll i en byggnad och varnar", () => {
    const model = buildCostModel(forest().area("521", rect(390, -5, 410, 5)).build());
    const result = analyseLeg(model, leg([0, 0], [401, 0]));
    expect(result.warnings).toContainEqual({ kind: "CONTROL_IN_IMPASSABLE", end: "to" });
    expect(result.best).toBeDefined();
  });

  it("ger NO_ROUTE när kontrollen är instängd", () => {
    const model = buildCostModel(forest().line("518", 0.25, [350, -50], [450, -50], [450, 50], [350, 50], [350, -50]).build());
    const result = analyseLeg(model, leg([0, 0], [400, 0]));
    expect(result.warnings).toContainEqual({ kind: "NO_ROUTE" });
    expect(result.best).toBeUndefined();
    expect(result.verdict).toBe("NO_CHOICE");
  });

  it("läcker inte diagonalt genom en tunn spärrlinje", () => {
    // Snett staket (inte i 45°) och en bézierkurva, båda tunnare än en cell, som stänger in målet helt.
    const model = buildCostModel(forest()
      .line("515", 0.01, [300, -200], [337, 0], [300, 200])
      .curve("515", 0.01, [300, 200], [600, 400], [600, -400], [300, -200])
      .build());
    const result = analyseLeg(model, leg([0, 0], [400, 13]));
    expect(result.warnings).toContainEqual({ kind: "NO_ROUTE" });
  });

  it("respekterar hål i ytor", () => {
    // Förbjudet område med ett hål där kontrollen står och en gång in genom en genomgång.
    const model = buildCostModel(forest()
      .area("520", rect(100, -200, 500, 200), rect(250, -50, 350, 50))
      .build());
    const result = analyseLeg(model, leg([0, 0], [300, 0]));
    expect(result.warnings).toContainEqual({ kind: "NO_ROUTE" });
    const open = buildCostModel(forest().area("520", rect(100, -200, 500, 200), rect(250, -50, 350, 50), rect(100, -10, 250, 10)).build());
    expect(analyseLeg(open, leg([0, 0], [300, 0])).best).toBeDefined();
  });

  it("varnar när bästa vägen går genom en annan kontrolls ring", () => {
    const model = buildCostModel(forest().build());
    const result = analyseLeg(model, leg([0, 0], [400, 0], { otherControls: [{ code: "33", at: m(200, 20) }, { code: "34", at: m(200, 100) }] }));
    expect(result.warnings).toEqual([{ kind: "THROUGH_OTHER_CONTROL", code: "33" }]);
  });

  it("ger svar efter hand för en hel bana", () => {
    const model = buildCostModel(forest().build());
    const seen: string[] = [];
    const legs: LegInput[] = [{ key: "S-1", from: m(0, 0), to: m(200, 0) }, { key: "1-2", from: m(200, 0), to: m(200, 300) }];
    const results = analyseCourse(model, legs, undefined, analysis => seen.push(analysis.key));
    expect(seen).toEqual(["S-1", "1-2"]);
    expect(results.every(result => result.milliseconds >= 0)).toBe(true);
  });
});
