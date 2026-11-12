import { describe, expect, it } from "vitest";
import { fittingVariantForEntry, linkVariantChange, variantMatch, variantMatchRank, type EvaluationReadout, type RaceSnapshot } from "../src";

const ids = { race: "r", class: "c", course: "k", version: "v", hugo: "hugo", ida: "ida" };
// Två fjärilar: centrum 50 med slingorna A (41 42) och B (43 44), centrum 60 med C (61 62) och D (63 64).
const loops = { A: [50, 41, 42], B: [50, 43, 44], C: [60, 61, 62], D: [60, 63, 64] } as const;
type Code = "AC" | "AD" | "BC" | "BD";
function variantCodes(code: Code): number[] {
  const [first, second] = [code[0] as "A" | "B", code[1] as "C" | "D"];
  return [31, ...loops[first], ...loops[first === "A" ? "B" : "A"], 50, 32, ...loops[second], ...loops[second === "C" ? "D" : "C"], 60, 33];
}
const VARIANTS: readonly Code[] = ["AC", "AD", "BC", "BD"];

/** Hugo har tilldelad AD och bricka 8571001; Ida saknar variant och bricka. */
function snapshot(): RaceSnapshot {
  return {
    race: { id: ids.race, eventId: "e", name: "Lopp", raceDate: "2026-12-09", snapshotVersion: 1 },
    classes: [{ id: ids.class, raceId: ids.race, name: "Öppen", courseVersionId: ids.version, startRule: "PUNCH" }],
    courses: [{ id: ids.course, raceId: ids.race, name: "Lång", versions: [{
      id: ids.version, courseId: ids.course, version: 1, createdAt: "2026-12-09T08:00:00Z", controls: [],
      variants: VARIANTS.map((code, variantIndex) => ({ id: `variant-${code}`, courseVersionId: ids.version, code,
        sequence: variantIndex + 1, controls: variantCodes(code).map((controlCode, index) => ({ id: `${code}-${index}`,
          courseVariantId: `variant-${code}`, controlId: `control-${controlCode}`, sequence: index + 1, controlCode })) }))
    }] }],
    entries: [{ id: ids.hugo, raceId: ids.race, classId: ids.class, givenName: "Hugo", familyName: "H", courseVariantCode: "AD" },
      { id: ids.ida, raceId: ids.race, classId: ids.class, givenName: "Ida", familyName: "I" }],
    cardAssignments: [{ id: "a", raceId: ids.race, entryId: ids.hugo, cardNumber: "8571001", active: true }]
  };
}

/** En okänd bricka (ingen koppling) med stämplingarna för varianten. */
function unknownCard(code: Code): EvaluationReadout {
  return { cardNumber: "7505442", startPunchedAt: "2026-12-09T16:00:00.000Z", finishPunchedAt: "2026-12-09T17:00:00.000Z",
    punches: variantCodes(code).map((control, index) => ({ code: control, punchedAt: new Date(Date.parse("2026-12-09T16:01:00.000Z") +
      index * 60_000).toISOString() })) };
}

describe("okänd bricka och gafflad bana (användartestet 2026-11-12)", () => {
  it("varianten som stämplingarna passar, för vilken löpare som helst i klassen", () => {
    expect(fittingVariantForEntry(unknownCard("BD"), snapshot(), ids.hugo)).toBe("BD");
    expect(fittingVariantForEntry(unknownCard("AC"), snapshot(), ids.ida)).toBe("AC");
    expect(fittingVariantForEntry(unknownCard("AC"), snapshot(), "saknas")).toBeUndefined();
  });

  it("bytet syns när stämplingarna passar en annan variant än den tilldelade", () => {
    expect(linkVariantChange(unknownCard("BD"), snapshot(), ids.hugo)).toEqual({ assignedCode: "AD", fittingCode: "BD" });
    expect(linkVariantChange(unknownCard("AD"), snapshot(), ids.hugo)).toBeUndefined();
    // Utan tilldelad variant finns inget byte att visa.
    expect(linkVariantChange(unknownCard("BD"), snapshot(), ids.ida)).toBeUndefined();
  });

  it("förslagen: tilldelad variant som stämplingarna passar först, annan variant sist", () => {
    expect([variantMatch("BE", "BE"), variantMatch("AD", "BE"), variantMatch(null, "BE"), variantMatch("AD", undefined)])
      .toEqual(["SAME", "OTHER", "NONE", "NONE"]);
    const rows = [{ name: "AD", code: "AD" }, { name: "BE", code: "BE" }, { name: "utan", code: null }, { name: "BE2", code: "BE" }];
    expect([...rows].sort((left, right) => variantMatchRank(variantMatch(left.code, "BE")) - variantMatchRank(variantMatch(right.code, "BE")))
      .map((row) => row.name)).toEqual(["BE", "BE2", "utan", "AD"]);
  });
});
