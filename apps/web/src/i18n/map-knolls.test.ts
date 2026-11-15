import { describe, expect, it } from "vitest";
import { formlineLimitsAt } from "@o-tid/map-revision/base-map";
import { mapClearContoursEn } from "./map-knolls-en";
import { mapClearContoursSv } from "./map-knolls-sv";

describe("reglaget Färre hjälpkurvor i ord", () => {
  const label = (level: number, text = mapClearContoursSv) => { const limits = formlineLimitsAt(level)!; return text.formlines(level, level === 5, String(limits.minConvex), String(limits.tight), limits.minForm); };
  it("förvalet nämner inte formen; över förvalet står vad som tas bort och att höjdformerna står kvar", () => {
    expect(label(5)).toBe("Färre hjälpkurvor: 5 av 10 (förval) – bara där marken ligger minst 0 m över omgivningen och inte närmare en höjdkurva än 5 m");
    expect(label(7)).toContain("bitar där marken är flack nedtill och brant upptill tas bort, höjdformerna står kvar");
    expect(label(9)).toContain("bitar i jämn lutning tas bort, höjdformerna står kvar");
    expect(label(10)).toContain("bara höjdformerna (avsatser och toppar mellan kurvorna) står kvar");
    expect(label(10, mapClearContoursEn)).toContain("only the hill forms (terraces and tops between the contours) remain");
    expect(mapClearContoursSv.formlines(0, false, "0", "0", -1)).toBe("Färre hjälpkurvor: av");
  });
});
