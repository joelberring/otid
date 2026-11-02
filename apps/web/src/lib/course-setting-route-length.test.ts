import { describe, expect, it } from "vitest";
import { applyEdit } from "@o-tid/course-setting";
import { routeLengthLegs, routeLengthSummary, type LegLength } from "./course-setting-route-length";
import { testDocument } from "./course-setting-test-document";

describe("ADR-0190 beslut 6: längd längs vägval", () => {
  it("sträckorna i banan och summan mot fågelvägen när alla är räknade", () => {
    const document = testDocument();
    const legs = routeLengthLegs(document, "k", undefined)!;
    expect(legs.variant).toBe("");
    expect(legs.legs).toHaveLength(3);
    const results = new Map<string, LegLength>(legs.legs.slice(0, 2).map(leg => [leg.key, { best: 150, straight: 100 }]));
    expect(routeLengthSummary(legs.legs, results)).toEqual({ kind: "partial", done: 2, total: 3 });
    results.set(legs.legs[2]!.key, { best: 150, straight: 100 });
    expect(routeLengthSummary(legs.legs, results)).toEqual({ kind: "done", best: 450, straight: 300, percent: 50 });
    results.set(legs.legs[2]!.key, { best: undefined, straight: 100 });
    expect(routeLengthSummary(legs.legs, results)).toEqual({ kind: "no-route", legs: 1 });
  });

  it("gafflad bana: vald variant, annars den första; poängbana och Alla kontroller: inget", () => {
    const forked = applyEdit(testDocument(), { type: "ADD_SPLIT", course: "k", at: "c2", kind: "LOOP", branches: 1 }).document;
    expect(routeLengthLegs(forked, "k", undefined)!.variant).toBe("A");
    expect(routeLengthLegs(forked, "ALL_CONTROLS", undefined)).toBeUndefined();
    const score = applyEdit(testDocument(), { type: "UPDATE_COURSE", course: "k", changes: { kind: "SCORE" } }).document;
    expect(routeLengthLegs(score, "k", undefined)).toBeUndefined();
    // En flyttad kontroll ger nya nycklar för sina två sträckor (bara de räknas om).
    const before = routeLengthLegs(testDocument(), "k", undefined)!.legs.map(leg => leg.key);
    const moved = applyEdit(testDocument(), { type: "MOVE_CONTROL", control: "b", at: { x: 25, y: 12 } }).document;
    const after = routeLengthLegs(moved, "k", undefined)!.legs.map(leg => leg.key);
    expect(after.filter(key => !before.includes(key))).toHaveLength(2);
  });
});
