import { describe, expect, it } from "vitest";
import {
  courseVariantForReadout, distributeCourseVariants, entryCourseControls, evaluateCardReadout, leastUsedCourseVariant, storedResultCourseVariant,
  unevenCourseVariantLegs, withProposedCourseVersion, withProposedEntryVariants, type EvaluationReadout, type RaceSnapshot
} from "../src";

const ids = {
  race: "00000000-0000-4000-8000-000000000001",
  class: "00000000-0000-4000-8000-000000000002",
  course: "00000000-0000-4000-8000-000000000003",
  version: "00000000-0000-4000-8000-000000000004",
  entry: "00000000-0000-4000-8000-000000000005"
};

// Två fjärilar: centrum 50 med slingorna A (41 42) och B (43 44), centrum 60 med C (61 62) och D (63 64).
const loops = { A: [50, 41, 42], B: [50, 43, 44], C: [60, 61, 62], D: [60, 63, 64] } as const;
function variantCodes(code: "AC" | "AD" | "BC" | "BD"): number[] {
  const [first, second] = [code[0] as "A" | "B", code[1] as "C" | "D"];
  const other1 = first === "A" ? "B" : "A", other2 = second === "C" ? "D" : "C";
  return [31, ...loops[first], ...loops[other1], 50, 32, ...loops[second], ...loops[other2], 60, 33];
}
const VARIANTS = ["AC", "AD", "BC", "BD"] as const;

function snapshot(variantCode?: string): RaceSnapshot {
  return {
    race: { id: ids.race, eventId: "event", name: "Lopp", raceDate: "2026-10-08", snapshotVersion: 1 },
    classes: [{ id: ids.class, raceId: ids.race, name: "H21", courseVersionId: ids.version, startRule: "PUNCH" }],
    courses: [{ id: ids.course, raceId: ids.race, name: "Lång", versions: [{
      id: ids.version, courseId: ids.course, version: 1, createdAt: "2026-10-08T08:00:00Z", controls: [],
      variants: VARIANTS.map((code, variantIndex) => ({ id: `variant-${code}`, courseVersionId: ids.version, code,
        sequence: variantIndex + 1, controls: variantCodes(code).map((controlCode, index) => ({ id: `${code}-${index}`,
          courseVariantId: `variant-${code}`, controlId: `control-${controlCode}`, sequence: index + 1, controlCode })) }))
    }] }],
    entries: [{ id: ids.entry, raceId: ids.race, classId: ids.class, givenName: "Ada", familyName: "Ek",
      ...(variantCode ? { courseVariantCode: variantCode } : {}) }],
    cardAssignments: [{ id: "assignment", raceId: ids.race, entryId: ids.entry, cardNumber: "8001", active: true }],
    classControlNeutralizations: []
  };
}

function readout(codes: readonly number[]): EvaluationReadout {
  return { cardNumber: "8001", startPunchedAt: "2026-10-08T16:00:00.000Z", finishPunchedAt: "2026-10-08T17:00:00.000Z",
    punches: codes.map((code, index) => ({ code, punchedAt: new Date(Date.parse("2026-10-08T16:01:00.000Z") + index * 60_000).toISOString() })) };
}

describe("bedömning per variant", () => {
  it("bedömer mot löparens variant: AD:s kontroller är godkända på AD men felstämplade på AC", () => {
    const punchedAd = readout(variantCodes("AD"));
    const onAd = evaluateCardReadout(punchedAd, snapshot("AD"));
    expect(onAd).toMatchObject({ status: "OK", reason: "COMPLETE", entryId: ids.entry, courseVersionId: ids.version, missingControls: [] });
    expect(onAd.splits.map((split) => split.controlCode)).toEqual(variantCodes("AD"));
    const onAc = evaluateCardReadout(punchedAd, snapshot("AC"));
    expect(onAc.status).toBe("MP");
    expect(onAc.missingControls.length).toBeGreaterThan(0);
    expect(courseVariantForReadout(punchedAd, snapshot("AC"))).toEqual({ code: "AC", assigned: true });
  });

  it("saknar löparen variant väljs den variant som stämplingarna passar", () => {
    const punchedBc = readout(variantCodes("BC"));
    expect(evaluateCardReadout(punchedBc, snapshot())).toMatchObject({ status: "OK", reason: "COMPLETE" });
    expect(courseVariantForReadout(punchedBc, snapshot())).toEqual({ code: "BC", assigned: false });
    // En kod som banan inte har räknas som saknad variant.
    expect(courseVariantForReadout(punchedBc, snapshot("XY"))).toEqual({ code: "BC", assigned: false });
    // Ingen variant passar: den med färst saknade kontroller, vid lika den första.
    const missing = readout(variantCodes("BD").filter((code) => code !== 63));
    expect(evaluateCardReadout(missing, snapshot())).toMatchObject({ status: "MP", reason: "MISSING_CONTROL", missingControls: [63] });
    expect(courseVariantForReadout(missing, snapshot())).toEqual({ code: "BD", assigned: false });
  });

  it("banor utan varianter bedöms som förut och har ingen variant", () => {
    const plain: RaceSnapshot = { ...snapshot(), courses: [{ id: ids.course, raceId: ids.race, name: "Kort", versions: [{
      id: ids.version, courseId: ids.course, version: 1, createdAt: "2026-10-08T08:00:00Z",
      controls: [31, 32].map((controlCode, index) => ({ id: `cc-${index}`, courseVersionId: ids.version, controlId: `control-${controlCode}`,
        sequence: index + 1, controlCode })) }] }] };
    expect(evaluateCardReadout(readout([31, 32]), plain)).toMatchObject({ status: "OK" });
    expect(courseVariantForReadout(readout([31, 32]), plain)).toBeUndefined();
    expect(entryCourseControls(plain, ids.entry)).toEqual({ assigned: false, controlCodes: [31, 32] });
  });

  it("ger löparens kontrollföljd och byter variant i en föreslagen ögonblicksbild", () => {
    expect(entryCourseControls(snapshot("BD"), ids.entry)).toEqual({ variantCode: "BD", assigned: true, controlCodes: variantCodes("BD") });
    expect(entryCourseControls(snapshot(), ids.entry)).toEqual({ variantCode: "AC", assigned: false, controlCodes: variantCodes("AC") });
    const proposed = withProposedEntryVariants(snapshot("AC"), new Map([[ids.entry, "AD"]]));
    expect(evaluateCardReadout(readout(variantCodes("AD")), proposed).status).toBe("OK");
    expect(withProposedEntryVariants(snapshot("AC"), new Map([[ids.entry, null]])).entries[0]).not.toHaveProperty("courseVariantCode");
  });

  it("en ny banversion med ändrad variant bedöms mot den nya kontrollföljden", () => {
    const changed = withProposedCourseVersion(snapshot("AD"), ids.course, ids.version, { id: "proposed", version: 2,
      createdAt: "2026-10-08T09:00:00Z", controlCodes: [],
      variants: VARIANTS.map((code) => ({ code, controlCodes: code === "AD" ? variantCodes("AD").filter((c) => c !== 63) : variantCodes(code) })) });
    const result = evaluateCardReadout(readout(variantCodes("AD").filter((c) => c !== 63)), changed);
    expect(result).toMatchObject({ status: "OK", courseVersionId: "proposed" });
  });
});

describe("gafflingskontroll", () => {
  it("fjärilsvarianter täcker samma sträckor", () => {
    expect(unevenCourseVariantLegs(VARIANTS.map((code) => ({ code, controlCodes: variantCodes(code) })))).toEqual([]);
  });

  it("varnar för sträckor som inte finns i alla varianter", () => {
    const uneven = unevenCourseVariantLegs([
      { code: "AC", controlCodes: [31, 41, 33, 61, 35] },
      { code: "AD", controlCodes: [31, 41, 33, 62, 35] }
    ]);
    expect(uneven).toEqual([
      { from: 33, to: 61, variantCodes: ["AC"] }, { from: 61, to: 35, variantCodes: ["AC"] },
      { from: 33, to: 62, variantCodes: ["AD"] }, { from: 62, to: 35, variantCodes: ["AD"] }
    ]);
    expect(unevenCourseVariantLegs([{ code: "A", controlCodes: [31, 32] }, { code: "B", controlCodes: [32, 31] }]))
      .toEqual([{ from: "START", to: 31, variantCodes: ["A"] }, { from: 31, to: 32, variantCodes: ["A"] },
        { from: 32, to: "FINISH", variantCodes: ["A"] }, { from: "START", to: 32, variantCodes: ["B"] },
        { from: 32, to: 31, variantCodes: ["B"] }, { from: 31, to: "FINISH", variantCodes: ["B"] }]);
    expect(unevenCourseVariantLegs([{ code: "A", controlCodes: [31] }])).toEqual([]);
  });
});

describe("jämn fördelning av varianter", () => {
  const runners = Array.from({ length: 10 }, (_, index) => ({ entryId: `entry-${String(index).padStart(2, "0")}`, variantCode: null }));

  it("fördelar jämnt och deterministiskt med fröet", () => {
    const first = distributeCourseVariants({ seed: 42, variantCodes: [...VARIANTS], runners });
    expect(first.size).toBe(10);
    const counts = VARIANTS.map((code) => [...first.values()].filter((value) => value === code).length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(distributeCourseVariants({ seed: 42, variantCodes: [...VARIANTS], runners })).toEqual(first);
    const reversed = distributeCourseVariants({ seed: 42, variantCodes: [...VARIANTS], runners: [...runners].reverse() });
    expect(reversed).toEqual(first);
    const other = [1, 2, 3, 4, 5].map((seed) => JSON.stringify([...distributeCourseVariants({ seed, variantCodes: [...VARIANTS], runners })]));
    expect(new Set(other).size).toBeGreaterThan(1);
  });

  it("behåller giltiga varianter, ger avlästa sin stämplade variant och jämnar ut resten", () => {
    const mixed = [
      { entryId: "a", variantCode: "AC" }, { entryId: "b", variantCode: "AC" }, { entryId: "c", variantCode: "AC" },
      { entryId: "d", variantCode: "XX" }, { entryId: "e", variantCode: null, readoutVariantCode: "AC" },
      { entryId: "f", variantCode: null }, { entryId: "g", variantCode: null }, { entryId: "h", variantCode: null }
    ];
    const assigned = distributeCourseVariants({ seed: 7, variantCodes: [...VARIANTS], runners: mixed });
    expect(assigned.has("a")).toBe(false);
    expect(assigned.get("e")).toBe("AC");
    const open = ["d", "f", "g", "h"].map((id) => assigned.get(id));
    expect(open).not.toContain("AC");
    expect(new Set(open)).toEqual(new Set(["AD", "BC", "BD"]));
    const all = [...mixed.filter((runner) => !assigned.has(runner.entryId)).map((runner) => runner.variantCode), ...assigned.values()];
    expect(all.filter((code) => code === "AC")).toHaveLength(4);
    expect(distributeCourseVariants({ seed: 7, variantCodes: [], runners: mixed }).size).toBe(0);
  });

  it("efteranmäld får den minst använda varianten", () => {
    expect(leastUsedCourseVariant([...VARIANTS], ["AC", "AD", "BC", "AC", "AD"])).toBe("BD");
    expect(leastUsedCourseVariant([...VARIANTS], ["AC", "AD", "BC", "BD"])).toBe("AC");
    expect(leastUsedCourseVariant([], [])).toBeUndefined();
  });
});

describe("sparat resultats variant", () => {
  const variants = VARIANTS.map((code) => ({ code, controlCodes: variantCodes(code) }));
  it("ger löparens variant, annars den som sträcktiderna passar", () => {
    expect(storedResultCourseVariant(variants, "BD", variantCodes("AC"))?.code).toBe("BD");
    expect(storedResultCourseVariant(variants, null, variantCodes("BC"))?.code).toBe("BC");
    expect(storedResultCourseVariant(variants, "XX", [])?.code).toBe("AC");
    expect(storedResultCourseVariant([], "AC", [31])).toBeUndefined();
  });
});
