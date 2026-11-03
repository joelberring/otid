import { describe, expect, it } from "vitest";
import { forkingReadiness, pruneVariants, unusedAfterExclusion, type CourseForking, type PrunableVariant } from "../src";

/**
 * ADR-0198: tre gafflingar i följd (A/B, C/D, E/F) ger åtta varianter. B, D och F är längre (+200, +100, +300 m) med var
 * sin egen kontroll (42, 44, 46). ACE är kortast (3000 m), BDF längst (3600 m).
 */
const extra: Record<string, number> = { A: 0, B: 200, C: 0, D: 100, E: 0, F: 300 };
const own: Record<string, string> = { A: "41", B: "42", C: "43", D: "44", E: "45", F: "46" };
const codes = ["ACE", "ACF", "ADE", "ADF", "BCE", "BCF", "BDE", "BDF"];
function variant(code: string, route?: number, climb?: number): PrunableVariant {
  const controls = ["31", own[code[0]!]!, "32", own[code[1]!]!, "33", own[code[2]!]!, "34"];
  const points = ["S", ...controls, "F"];
  return { code, controls, legs: points.slice(1).map((point, index) => `${points[index]}>${point}`),
    straightMeters: 3000 + [...code].reduce((sum, letter) => sum + extra[letter]!, 0),
    ...(route !== undefined ? { routeMeters: route } : {}), ...(climb !== undefined ? { climbMeters: climb } : {}) };
}
const eight = codes.map(code => variant(code));

describe("färre varianter: längst i alla avseenden (ADR-0198)", () => {
  it("med bara fågelvägen tas de längre bort tills varje kontroll bara har en variant kvar (skyddet)", () => {
    const result = pruneVariants(eight, { dominated: true });
    expect(result.measures).toEqual(["STRAIGHT"]);
    expect(result.kept).toEqual(["ACE", "ACF", "ADE", "BCE"]);
    expect(result.excluded.map(row => [row.code, row.reason, row.by])).toEqual([
      ["ADF", "DOMINATED", "ACE"], ["BCF", "DOMINATED", "ACE"], ["BDE", "DOMINATED", "ACE"], ["BDF", "DOMINATED", "ACE"]]);
    expect(result.protected).toEqual([
      { code: "ACF", reason: "DOMINATED", control: "46" }, { code: "ADE", reason: "DOMINATED", control: "44" },
      { code: "BCE", reason: "DOMINATED", control: "42" }]);
    expect(unusedAfterExclusion(eight, new Set(result.excluded.map(row => row.code)))).toEqual({ controls: [], legs: [] });
  });

  it("utan skydd blir bara den kortaste kvar", () => {
    const result = pruneVariants(eight, { dominated: true, guard: false });
    expect(result.kept).toEqual(["ACE"]);
    expect(unusedAfterExclusion(eight, new Set(result.excluded.map(row => row.code))).controls.slice().sort()).toEqual(["42", "44", "46"]);
  });

  it("längs vägval räknas med när den finns för alla: en variant som är kortast längs vägval behålls", () => {
    // ADF är längre fågelvägen men kortast längs vägval (stigen); ingen annan är kortare i båda.
    const routes: Record<string, number> = { ACE: 3500, ACF: 3900, ADE: 3600, ADF: 3300, BCE: 3800, BCF: 4200, BDE: 3900, BDF: 4300 };
    const withRoutes = codes.map(code => variant(code, routes[code]));
    const result = pruneVariants(withRoutes, { dominated: true, guard: false });
    expect(result.measures).toEqual(["STRAIGHT", "ROUTE"]);
    expect(result.lengthMeasure).toBe("ROUTE");
    expect(result.kept).toEqual(["ACE", "ADF"]);
    // Saknas vägvalet för någon variant jämförs bara fågelvägen.
    const partial = pruneVariants([...withRoutes.slice(0, 7), variant("BDF")], { dominated: true, guard: false });
    expect(partial.measures).toEqual(["STRAIGHT"]);
    expect(partial.kept).toEqual(["ACE"]);
  });

  it("stigningen räknas med när den finns för alla", () => {
    const climbs = codes.map((code, index) => variant(code, undefined, index === 7 ? 10 : 50));
    const result = pruneVariants(climbs, { dominated: true, guard: false });
    expect(result.measures).toEqual(["STRAIGHT", "CLIMB"]);
    // BDF är längst men har minst stigning.
    expect(result.kept).toEqual(["ACE", "BDF"]);
  });

  it("lika långa varianter tar inte bort varandra", () => {
    const tie = [variant("ACE"), { ...variant("ACF"), straightMeters: 3000 }, variant("BDF")];
    const result = pruneVariants(tie, { dominated: true, guard: false });
    expect(result.kept).toEqual(["ACE", "ACF"]);
    expect(result.excluded).toEqual([{ code: "BDF", reason: "DOMINATED", by: "ACE" }]);
    // Under en meter räknas som lika.
    expect(pruneVariants([variant("ACE"), { ...variant("ACF"), straightMeters: 3000.3 }], { dominated: true }).kept).toEqual(["ACE", "ACF"]);
  });

  it("den sista varianten tas aldrig bort", () => {
    expect(pruneVariants([variant("ACE")], { dominated: true, maxCount: 1, maxPercentLonger: 0 }).kept).toEqual(["ACE"]);
  });
});

describe("färre varianter: tak (ADR-0198)", () => {
  it("högst 5 % längre än den kortaste; skyddet behåller den enda med 42 och 46", () => {
    const result = pruneVariants(eight, { dominated: false, maxPercentLonger: 5 });
    expect(result.kept).toEqual(["ACE", "ACF", "ADE", "BCE"]);
    expect(result.excluded.every(row => row.reason === "OVER_PERCENT")).toBe(true);
    expect(result.protected.map(row => [row.code, row.control])).toEqual([["ACF", "46"], ["BCE", "42"]]);
    expect(pruneVariants(eight, { dominated: false, maxPercentLonger: 5, guard: false }).kept).toEqual(["ACE", "ADE"]);
  });

  it("högst N varianter: de kortaste behålls; skyddet kan ge fler", () => {
    expect(pruneVariants(eight, { dominated: false, maxCount: 3, guard: false }).kept).toEqual(["ACE", "ADE", "BCE"]);
    const guarded = pruneVariants(eight, { dominated: false, maxCount: 3 });
    expect(guarded.kept).toEqual(["ACE", "ACF", "ADE", "BCE"]);
    expect(guarded.protected.map(row => row.reason)).toEqual(["OVER_COUNT", "OVER_COUNT", "OVER_COUNT"]);
    expect(pruneVariants(eight, { dominated: false, maxCount: 6 }).kept).toEqual(["ACE", "ACF", "ADE", "ADF", "BCE", "BDE"]);
  });

  it("båda taken och dominansen tillsammans", () => {
    const result = pruneVariants(eight, { dominated: true, maxPercentLonger: 50, maxCount: 100 });
    expect(result.kept).toEqual(["ACE", "ACF", "ADE", "BCE"]);
    expect(pruneVariants(eight, { dominated: false }).kept).toEqual(codes);
  });

  it("skyddet gäller sträckor också (samma kontroller i annan ordning)", () => {
    const a: PrunableVariant = { code: "A", controls: ["1", "2"], legs: ["S>1", "1>2", "2>F"], straightMeters: 1000 };
    const b: PrunableVariant = { code: "B", controls: ["1", "2"], legs: ["S>2", "2>1", "1>F"], straightMeters: 1100 };
    expect(pruneVariants([a, b], { dominated: true }).protected).toEqual([{ code: "B", reason: "DOMINATED", leg: "S>2" }]);
  });
});

describe("kontrollen före tävlingen med bortvalda varianter (ADR-0198)", () => {
  const forking: CourseForking = { items: [{ kind: "CONTROL", code: 31 }, { kind: "FORK", branches: [[41], [42]] },
    { kind: "FORK", branches: [[43], [44]] }, { kind: "CONTROL", code: 32 }] };
  const choices = new Map([["AC", [null, 0, 0, null]], ["AD", [null, 0, 1, null]], ["BC", [null, 1, 0, null]], ["BD", [null, 1, 1, null]]]);

  it("bortvalda räknas inte: antalet, oanvända och löpare med en bortvald kod saknar variant", () => {
    const readiness = forkingReadiness({ variantCodes: ["AC", "AD", "BC", "BD"], excludedVariantCodes: ["BD"], forking, choices,
      classes: [{ name: "H21", runnerVariants: ["AC", "AD", "BC", "BD"] }] });
    expect(readiness.variantCount).toBe(3);
    expect(readiness.excludedCount).toBe(1);
    expect(readiness.unusedVariants).toEqual([]);
    expect(readiness.missingVariant).toEqual([{ className: "H21", count: 1 }]);
    expect(readiness.ok).toBe(false);
    const without = forkingReadiness({ variantCodes: ["AC", "AD", "BC", "BD"], forking, choices, classes: [{ name: "H21", runnerVariants: ["AC", "AD", "BC", "BD"] }] });
    expect([without.variantCount, without.excludedCount, without.ok]).toEqual([4, 0, true]);
  });

  it("för många varianter och bokstäver räknas på de behållna", () => {
    const many = Array.from({ length: 103 }, (_value, index) => `V${index}`);
    expect(forkingReadiness({ variantCodes: many, classes: [] }).tooManyVariants).toBe(true);
    expect(forkingReadiness({ variantCodes: many, excludedVariantCodes: many.slice(0, 3), classes: [] }).tooManyVariants).toBe(false);
    // Fjorton gafflingar med två alternativ = 28 bokstäver; behålls bara första alternativet används 14.
    const wide: CourseForking = { items: Array.from({ length: 14 }, () => ({ kind: "FORK" as const, branches: [[41], [42]] })) };
    const keep = new Map([["K", Array.from({ length: 14 }, () => 0)], ["X", Array.from({ length: 14 }, () => 1)]]);
    expect(forkingReadiness({ variantCodes: ["K", "X"], forking: wide, choices: keep, classes: [] }).tooManyLetters).toBe(true);
    expect(forkingReadiness({ variantCodes: ["K", "X"], excludedVariantCodes: ["X"], forking: wide, choices: keep, classes: [] }).tooManyLetters).toBe(false);
  });
});
