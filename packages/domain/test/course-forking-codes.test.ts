import { describe, expect, it } from "vitest";
import { forkingVariantCodeMap, generateForkingVariants, type CourseForking } from "../src";

/** ADR-0175 beslut 3, tillägg 2026-11-12: löparnas koder när en gafflad banas struktur sparas om. */
const control = (code: number) => ({ kind: "CONTROL" as const, code });
const fork = (...branches: number[][]) => ({ kind: "FORK" as const, branches });
const course = (second: number[][], first: number[][] = [[41], [42]]): CourseForking =>
  ({ items: [control(31), control(40), fork(...first), control(50), control(60), fork(...second), control(70), control(100)] });
const map = (before: CourseForking, after: CourseForking, withForking = true) => Object.fromEntries(forkingVariantCodeMap(
  { forking: withForking ? before : undefined, variants: generateForkingVariants(before) },
  { forking: after, variants: generateForkingVariants(after) }));

// Användartestet 2026-11-12: 31 40 [A:41 | B:42] 50 60 [C:61 62 | D:63 | E:64] 70 100.
const tested = course([[61, 62], [63], [64]]);

describe("forkingVariantCodeMap", () => {
  it("en rättad kontrollkod i ett alternativ: alla behåller sin kod", () => {
    expect(map(tested, course([[61, 62], [63], [65]]))).toEqual({ AC: "AC", AD: "AD", AE: "AE", BC: "BC", BD: "BD", BE: "BE" });
    // Också utan sparad struktur (banfil): strukturen härleds ur varianterna.
    expect(map(tested, course([[61, 62], [63], [65]]), false)).toEqual({ AC: "AC", AD: "AD", AE: "AE", BC: "BC", BD: "BD", BE: "BE" });
  });

  it("en rättad kontrollkod i grundföljden: alla behåller sin kod", () => {
    const after: CourseForking = { items: tested.items.map(item => item.kind === "CONTROL" && item.code === 50 ? control(51) : item) };
    expect(Object.values(map(tested, after))).toEqual(["AC", "AD", "AE", "BC", "BD", "BE"]);
  });

  it("ett alternativ läggs till i mitten: löparna följer sin kontrollföljd under de nya bokstäverna", () => {
    expect(map(tested, course([[61, 62], [66], [63], [64]]))).toEqual({ AC: "AC", AD: "AE", AE: "AF", BC: "BC", BD: "BE", BE: "BF" });
  });

  it("ett alternativ tas bort sist: bara dess koder försvinner", () => {
    expect(map(tested, course([[61, 62], [63]]))).toEqual({ AC: "AC", AD: "AD", AE: null, BC: "BC", BD: "BD", BE: null });
  });

  it("ett alternativ tas bort i mitten: de bakom följer sin kontrollföljd, bara det borttagnas koder försvinner", () => {
    // D (63) tas bort; E (64) blir D. AD är upptagen av de gamla AE, så de gamla AD får ny variant.
    expect(map(tested, course([[61, 62], [64]]))).toEqual({ AC: "AC", AD: null, AE: "AD", BC: "BC", BD: null, BE: "BD" });
  });

  it("två alternativ byter innehåll: löparna följer sin kontrollföljd", () => {
    expect(map(tested, course([[61, 62], [64], [63]]))).toEqual({ AC: "AC", AD: "AE", AE: "AD", BC: "BC", BD: "BE", BE: "BD" });
  });

  it("rättad kod och bokstäver som flyttas samtidigt: koden som en annan kontrollföljd tagit försvinner", () => {
    // Nytt alternativ först: C (66), D (61 62), E (63), F (65 i stället för 64).
    expect(map(tested, course([[66], [61, 62], [63], [65]]))).toEqual({ AC: "AD", AD: "AE", AE: null, BC: "BD", BD: "BE", BE: null });
  });

  it("en gaffling blir fjäril (annat slag av gafflingspunkt): koderna betyder något annat och försvinner", () => {
    const loops: CourseForking = { items: [control(31), control(40), fork([41], [42]), control(50),
      { kind: "LOOP", center: 60, loops: [[61, 62], [63]] }, control(70), control(100)] };
    const before = course([[61, 62], [63]]);
    expect(map(before, loops)).toEqual({ AC: null, AD: null, BC: null, BD: null });
  });

  it("en gaffling tas bort: koderna försvinner utom där kontrollföljden finns kvar; utan gafflingar blir banan vanlig", () => {
    const one: CourseForking = { items: [control(31), control(40), fork([41], [42]), control(50), control(60), control(64), control(70), control(100)] };
    expect(map(tested, one)).toEqual({ AC: null, AD: null, AE: "A", BC: null, BD: null, BE: "B" });
    expect(Object.fromEntries(forkingVariantCodeMap({ forking: tested, variants: generateForkingVariants(tested) },
      { forking: null, variants: [] }))).toEqual({ AC: null, AD: null, AE: null, BC: null, BD: null, BE: null });
  });
});
