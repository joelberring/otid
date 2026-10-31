import { describe, expect, it } from "vitest";
import { analyseCourse, analyseLeg, buildCostModel, type LegInput } from "../src";
import { forest, m, rect } from "./synthetic";

function leg(from: [number, number], to: [number, number], extra: Partial<LegInput> = {}): LegInput {
  return { key: "1-2", from: m(...from), to: m(...to), ...extra };
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
    const result = analyseLeg(model, leg([0, 0], [400, 0]));
    expect(result.best!.climbMeters).toBeCloseTo(5 * 5 + 2.5, 5);
    // 27,5 m × 8 = 220 m plan väg extra.
    expect(result.best!.seconds).toBeCloseTo((400 + 220) * 0.36, 0);
    const flat = analyseLeg(buildCostModel(forest().build()), leg([0, 0], [400, 0]));
    expect(flat.best!.climbMeters).toBe(0);
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
