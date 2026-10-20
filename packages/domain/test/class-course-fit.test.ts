import { describe, expect, it } from "vitest";
import { rankClassesByCourseFit, type Punch, type RaceSnapshot } from "../src";

/**
 * PLAN.md steg 29 punkt 4: en okänd brickas stämplingar jämförs mot alla klassers banor med samma bästa-passning som
 * gafflingar. Lång: 31 32 33 34. Kort: 31 32. Gafflad: 41 (A: 42, B: 43) 44. Rogaining räknas inte.
 */
const race = "00000000-0000-4000-8000-000000000001";
const course = (id: string, name: string, codes: readonly number[], variants?: Record<string, readonly number[]>) => ({
  id: `course-${id}`, raceId: race, name, versions: [{ id: `version-${id}`, courseId: `course-${id}`, version: 1,
    createdAt: "2026-10-08T08:00:00Z", controls: codes.map((controlCode, index) => ({ id: `${id}-${index}`, courseVersionId: `version-${id}`,
      controlId: `control-${controlCode}`, sequence: index + 1, controlCode })),
    ...(variants ? { variants: Object.entries(variants).map(([code, controls], variantIndex) => ({ id: `${id}-${code}`,
      courseVersionId: `version-${id}`, code, sequence: variantIndex + 1, controls: controls.map((controlCode, index) => ({
        id: `${id}-${code}-${index}`, courseVariantId: `${id}-${code}`, controlId: `control-${controlCode}`, sequence: index + 1, controlCode })) })) } : {})
  }]
});
const raceClass = (id: string, name: string, courseId: string, extra: Record<string, unknown> = {}) =>
  ({ id, raceId: race, name, courseVersionId: `version-${courseId}`, startRule: "PUNCH" as const, ...extra });

const snapshot: RaceSnapshot = {
  race: { id: race, eventId: "event", name: "Lopp", raceDate: "2026-10-08", snapshotVersion: 1 },
  courses: [course("long", "Lång", [31, 32, 33, 34]), course("short", "Kort", [31, 32]),
    course("forked", "Gafflad", [], { A: [41, 42, 44], B: [41, 43, 44] }), course("rogaining", "Poäng", [31, 32, 33, 34]),
    course("empty", "Inskolning", [])],
  classes: [raceClass("h21", "H21", "long"), raceClass("d21", "D21", "long"), raceClass("h10", "H10", "short"),
    raceClass("open", "Öppen gafflad", "forked"), raceClass("poang", "Poäng", "rogaining",
      { rogaining: { timeLimitSeconds: 3600, penaltyPointsPerMinute: 1 } }), raceClass("inskolning", "Inskolning", "empty")],
  entries: [], cardAssignments: []
};

const punches = (codes: readonly number[]): Punch[] =>
  codes.map((code, index) => ({ code, punchedAt: new Date(Date.parse("2026-10-08T16:01:00Z") + index * 60_000).toISOString() }));

describe("klass efter banans passning (PLAN.md steg 29)", () => {
  it("godkänd först; vid lika förklarar den längre banan fler stämplingar; sedan klassnamnet", () => {
    const ranked = rankClassesByCourseFit(punches([31, 32, 33, 34]), snapshot);
    expect(ranked.map((fit) => [fit.classId, fit.ok, fit.missingControls, fit.extraPunches])).toEqual([
      ["d21", true, [], 0], ["h21", true, [], 0], ["h10", true, [], 2], ["open", false, [41, 42, 44], 4]]);
  });

  it("utan godkänd bana kommer färst saknade kontroller först", () => {
    const ranked = rankClassesByCourseFit(punches([31, 32, 34]), snapshot);
    expect(ranked[0]).toMatchObject({ classId: "h10", ok: true });
    expect(ranked.slice(1, 3).map((fit) => [fit.classId, fit.ok, fit.missingControls])).toEqual([["d21", false, [33]], ["h21", false, [33]]]);
  });

  it("fel ordning är inte godkänt", () => {
    const ranked = rankClassesByCourseFit(punches([31, 33, 32, 34]), snapshot, new Set(["h21"]));
    expect(ranked).toEqual([{ classId: "h21", courseVersionId: "version-long", ok: false, missingControls: [33], extraPunches: 1 }]);
  });

  it("gafflad bana: varianten som passar bäst gäller", () => {
    const ranked = rankClassesByCourseFit(punches([41, 43, 44]), snapshot);
    expect(ranked[0]).toEqual({ classId: "open", courseVersionId: "version-forked", variantCode: "B", ok: true, missingControls: [],
      extraPunches: 0 });
  });

  it("struken kontroll krävs inte; rogaining och banor utan kontroller ingår aldrig", () => {
    const neutralized: RaceSnapshot = { ...snapshot, controlsOutOfOrder: [{ id: "n", controlCode: 33 }] };
    const ranked = rankClassesByCourseFit(punches([31, 32, 34]), neutralized);
    expect(ranked.find((fit) => fit.classId === "h21")).toMatchObject({ ok: true, missingControls: [] });
    expect(ranked.map((fit) => fit.classId)).not.toContain("poang");
    expect(ranked.map((fit) => fit.classId)).not.toContain("inskolning");
    expect(rankClassesByCourseFit([], snapshot).every((fit) => !fit.ok)).toBe(true);
  });
});
