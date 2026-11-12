import { describe, expect, it } from "vitest";
import {
  deriveCourseForking, forkingLetters, forkingVariantCodeMap, generateForkingVariants, validateCourseForking, withAssignedForkingLetters,
  withExplicitForkingLetters, type CourseForking, type ForkingItem
} from "../src";

/**
 * ADR-0175 beslut 3, tilläggen 2026-11-12 och 2026-11-12 (b): bokstäverna är alternativens identitet. Löparna behåller sina
 * bokstäver i de gafflingspunkter som finns kvar; bara den vars bokstav försvinner får en ny variant.
 */
const control = (code: number) => ({ kind: "CONTROL" as const, code });
const fork = (...branches: number[][]): ForkingItem => ({ kind: "FORK", branches });
const lettered = (letters: (string | null)[], ...branches: number[][]): ForkingItem => ({ kind: "FORK", branches, letters });
const course = (second: ForkingItem, first: ForkingItem = fork([41], [42])): CourseForking =>
  ({ items: [control(31), control(40), first, control(50), control(60), second, control(70), control(100)] });

/** Sparar `request` över `before` som planen gör: bokstäverna tilldelas och löparnas koder räknas om. */
function save(before: CourseForking, request: CourseForking, withForking = true) {
  const after = withAssignedForkingLetters(before, request);
  expect(validateCourseForking(after)).toEqual([]);
  const codes = Object.fromEntries(forkingVariantCodeMap({ forking: withForking ? before : undefined, variants: generateForkingVariants(before) },
    { forking: after, variants: generateForkingVariants(after) }));
  return { after, codes, letters: forkingLetters(after).filter(own => own !== null) };
}

// Användartestet 2026-11-12: 31 40 [A:41 | B:42] 50 60 [C:61 62 | D:63 | E:64] 70 100.
const tested = course(fork([61, 62], [63], [64]));
const all = ["AC", "AD", "AE", "BC", "BD", "BE"] as const;

describe("bakåtkompatibilitet: strukturer sparade före tillägget", () => {
  it("utan sparade bokstäver blir koderna exakt som förut (bokstäver i följd)", () => {
    expect(generateForkingVariants(tested).map(variant => variant.code)).toEqual([...all]);
    const butterflies: CourseForking = { items: [control(31), { kind: "LOOP", center: 50, loops: [[41], [42], [43]] }, fork([61], [62])] };
    expect(generateForkingVariants(butterflies).map(variant => variant.code)).toEqual(["ABD", "ABE", "ACD", "ACE", "BAD", "BAE", "BCD", "BCE",
      "CAD", "CAE", "CBD", "CBE"]);
    // Med bokstäverna utskrivna ger samma struktur samma koder och kontroller.
    expect(generateForkingVariants(withExplicitForkingLetters(butterflies))).toEqual(generateForkingVariants(butterflies));
  });

  it("samma struktur sparad igen ändrar ingenting", () => {
    const { after, codes } = save(tested, tested);
    expect(after).toEqual(withExplicitForkingLetters(tested));
    expect(codes).toEqual(Object.fromEntries(all.map(code => [code, code])));
  });
});

describe("bokstäverna står kvar när ett alternativ tas bort (redigeringen bär bokstäverna)", () => {
  const explicit = withExplicitForkingLetters(tested);

  it("i mitten: A, C, E med lucka; bara D-löparna får ny variant", () => {
    const { codes, letters, after } = save(explicit, course(lettered(["C", "E"], [61, 62], [64]), explicit.items[2]));
    expect(letters).toEqual([["A", "B"], ["C", "E"]]);
    expect(after.retiredLetters).toEqual(["D"]);
    expect(codes).toEqual({ AC: "AC", AD: null, AE: "AE", BC: "BC", BD: null, BE: "BE" });
    expect(generateForkingVariants(after).find(variant => variant.code === "AE")!.controlCodes).toEqual([31, 40, 41, 50, 60, 64, 70, 100]);
  });

  it("först: D och E står kvar", () => {
    const { codes, letters } = save(explicit, course(lettered(["D", "E"], [63], [64]), explicit.items[2]));
    expect(letters).toEqual([["A", "B"], ["D", "E"]]);
    expect(codes).toEqual({ AC: null, AD: "AD", AE: "AE", BC: null, BD: "BD", BE: "BE" });
  });

  it("sist: C och D står kvar", () => {
    const { codes } = save(explicit, course(lettered(["C", "D"], [61, 62], [63]), explicit.items[2]));
    expect(codes).toEqual({ AC: "AC", AD: "AD", AE: null, BC: "BC", BD: "BD", BE: null });
  });

  it("ett nytt alternativ efter en borttagning får en bokstav som aldrig har använts, inte den borttagnas", () => {
    const removed = save(explicit, course(lettered(["C", "E"], [61, 62], [64]), explicit.items[2])).after;
    const added = save(removed, course(lettered(["C", "E", null], [61, 62], [64], [66]), removed.items[2]));
    expect(added.letters).toEqual([["A", "B"], ["C", "E", "F"]]);
    expect(added.after.retiredLetters).toEqual(["D"]);
    expect(added.codes).toEqual({ AC: "AC", AE: "AE", BC: "BC", BE: "BE" });
    // En begäran som försöker ge det nya alternativet den borttagna bokstaven får också en ny bokstav.
    expect(save(removed, course(lettered(["C", "E", "D"], [61, 62], [64], [66]), removed.items[2])).letters).toEqual([["A", "B"], ["C", "E", "F"]]);
  });

  it("ett nytt alternativ i mitten: övriga behåller bokstav och kod", () => {
    const { codes, letters } = save(explicit, course(lettered(["C", null, "D", "E"], [61, 62], [66], [63], [64]), explicit.items[2]));
    expect(letters).toEqual([["A", "B"], ["C", "F", "D", "E"]]);
    expect(codes).toEqual(Object.fromEntries(all.map(code => [code, code])));
  });

  it("rättad kod och borttagning i samma ändring: E rättas 64 → 65 och D tas bort", () => {
    const { codes, after } = save(explicit, course(lettered(["C", "E"], [61, 62], [65]), explicit.items[2]));
    expect(codes).toEqual({ AC: "AC", AD: null, AE: "AE", BC: "BC", BD: null, BE: "BE" });
    expect(generateForkingVariants(after).find(variant => variant.code === "BE")!.controlCodes).toEqual([31, 40, 42, 50, 60, 65, 70, 100]);
  });

  it("en rättad kontrollkod i ett alternativ eller i grundföljden: alla behåller sin kod", () => {
    expect(save(explicit, course(lettered(["C", "D", "E"], [61, 62], [63], [65]), explicit.items[2])).codes)
      .toEqual(Object.fromEntries(all.map(code => [code, code])));
    const base: CourseForking = { items: explicit.items.map(item => item.kind === "CONTROL" && item.code === 50 ? control(51) : item) };
    expect(Object.values(save(explicit, base).codes)).toEqual([...all]);
  });
});

describe("en hel gafflingspunkt tas bort", () => {
  it("den kvarvarande punkten behåller sina bokstäver (C, D, E); löparna behåller sin bokstav där", () => {
    const explicit = withExplicitForkingLetters(tested);
    const request: CourseForking = { items: [control(31), control(40), control(41), control(50), control(60), explicit.items[5]!, control(70), control(100)] };
    const { codes, letters } = save(explicit, request);
    expect(letters).toEqual([["C", "D", "E"]]);
    // "AC" och "BC" blir "C": A-löparna springer samma kontroller som förut, B-löparna behöver ny karta (41 i stället för 42).
    expect(codes).toEqual({ AC: "C", AD: "D", AE: "E", BC: "C", BD: "D", BE: "E" });
  });

  it("den andra punkten tas bort: A och B står kvar", () => {
    const one: CourseForking = { items: [control(31), control(40), fork([41], [42]), control(50), control(60), control(64), control(70), control(100)] };
    expect(save(tested, one).codes).toEqual({ AC: "A", AD: "A", AE: "A", BC: "B", BD: "B", BE: "B" });
  });

  it("utan gafflingar blir banan vanlig och alla koder försvinner", () => {
    expect(Object.fromEntries(forkingVariantCodeMap({ forking: tested, variants: generateForkingVariants(tested) },
      { forking: null, variants: [] }))).toEqual({ AC: null, AD: null, AE: null, BC: null, BD: null, BE: null });
  });

  it("en ny gafflingspunkt: löparna saknar bokstav där och får ny variant", () => {
    const two = course(fork([61], [62]), fork([41], [42]));
    const three: CourseForking = { items: [...two.items.slice(0, -1), fork([81], [82]), control(100)] };
    const { codes, letters } = save(two, three);
    expect(letters).toEqual([["A", "B"], ["C", "D"], ["E", "F"]]);
    expect(Object.values(codes)).toEqual([null, null, null, null]);
  });

  it("en gaffling blir fjäril (annat slag): koderna försvinner", () => {
    const before = course(fork([61, 62], [63]));
    const loops: CourseForking = { items: [control(31), control(40), fork([41], [42]), control(50),
      { kind: "LOOP", center: 60, loops: [[61, 62], [63]] }, control(70), control(100)] };
    expect(save(before, loops).codes).toEqual({ AC: null, AD: null, BC: null, BD: null });
  });
});

describe("begäran utan bokstäver (äldre klient): bokstäverna paras efter innehåll", () => {
  it("i mitten borttaget: E står kvar på 64", () => {
    const { codes, letters } = save(tested, course(fork([61, 62], [64])));
    expect(letters).toEqual([["A", "B"], ["C", "E"]]);
    expect(codes).toEqual({ AC: "AC", AD: null, AE: "AE", BC: "BC", BD: null, BE: "BE" });
    // Också utan sparad struktur (banfil): strukturen härleds ur varianterna.
    expect(save(tested, course(fork([61, 62], [64])), false).codes).toEqual(codes);
  });

  it("två alternativ byter plats: bokstäverna följer innehållet och koderna står kvar", () => {
    const { codes, letters } = save(tested, course(fork([61, 62], [64], [63])));
    expect(letters).toEqual([["A", "B"], ["C", "E", "D"]]);
    expect(codes).toEqual(Object.fromEntries(all.map(code => [code, code])));
  });

  it("en rättad kod (lika många alternativ): alternativet behåller bokstaven", () => {
    expect(save(tested, course(fork([61, 62], [63], [65]))).codes).toEqual(Object.fromEntries(all.map(code => [code, code])));
  });

  it("rättad kod och borttagning utan bokstäver går inte att skilja åt: de oparade får ny bokstav", () => {
    const { codes, letters } = save(tested, course(fork([61, 62], [65])));
    expect(letters).toEqual([["A", "B"], ["C", "F"]]);
    expect(codes).toEqual({ AC: "AC", AD: null, AE: null, BC: "BC", BD: null, BE: null });
  });
});

describe("utjämnad gaffling (fjärilar) och fulgaffling", () => {
  const butterfly: CourseForking = { items: [control(31), { kind: "LOOP", center: 50, loops: [[41], [42], [43]] }, control(33)] };

  it("utjämnad: en slinga tas bort; löparna behåller ordningen på de kvarvarande slingorna", () => {
    const explicit = withExplicitForkingLetters(butterfly);
    const request: CourseForking = { items: [control(31), { kind: "LOOP", center: 50, loops: [[41], [43]], letters: ["A", "C"] }, control(33)] };
    const { codes, letters } = save(explicit, request);
    expect(letters).toEqual([["A", "C"]]);
    // ABC → A, C: "A"; BCA → C, A: "C".
    expect(codes).toEqual({ AB: "A", AC: "A", BA: "A", BC: "C", CA: "C", CB: "C" });
  });

  it("utjämnad: en slinga läggs till; alla behöver nya kartor (ny variant)", () => {
    const request: CourseForking = { items: [control(31), { kind: "LOOP", center: 50, loops: [[41], [42], [43], [44]], letters: ["A", "B", "C", null] }, control(33)] };
    expect(Object.values(save(withExplicitForkingLetters(butterfly), request).codes).every(code => code === null)).toBe(true);
  });

  it("fulgaffling: alternativ med olika längd följer samma regel (bokstaven, inte längden)", () => {
    const unequal = course(fork([61, 62, 63], [64]), fork([41], [42, 43, 44]));
    const explicit = withExplicitForkingLetters(unequal);
    const { codes } = save(explicit, course(lettered(["C", "D", null], [61, 62, 63], [64], [65]), lettered(["A", "B"], [41], [42, 43, 45])));
    expect(codes).toEqual({ AC: "AC", AD: "AD", BC: "BC", BD: "BD" });
  });
});

describe("härledd struktur: bokstäverna ur varianternas koder", () => {
  it("en banfil med lucka (A, C) ger bokstäverna A och C, inte A och B", () => {
    const derived = deriveCourseForking([{ code: "A", controlCodes: [31, 41, 33] }, { code: "C", controlCodes: [31, 43, 33] }]);
    expect(forkingLetters(derived.forking)).toEqual([null, ["A", "C"], null]);
    expect(generateForkingVariants(derived.forking).map(variant => variant.code)).toEqual(["A", "C"]);
  });

  it("koder som inte går att läsa som bokstäver ger bokstäver i följd", () => {
    const derived = deriveCourseForking([{ code: "1", controlCodes: [31, 41, 33] }, { code: "2", controlCodes: [31, 43, 33] }]);
    expect(forkingLetters(derived.forking)).toEqual([null, ["A", "B"], null]);
  });

  it("ogiltiga bokstäver stoppas av reglerna", () => {
    expect(validateCourseForking({ items: [lettered(["A", "A"], [41], [42])] }).map(problem => problem.kind)).toEqual(["INVALID_LETTERS"]);
    expect(validateCourseForking({ items: [lettered(["A"], [41], [42])] }).map(problem => problem.kind)).toEqual(["INVALID_LETTERS"]);
    expect(validateCourseForking({ items: [lettered(["A", null], [41], [42]), lettered(["A", "C"], [51], [52])] }).map(problem => problem.kind))
      .toEqual(["INVALID_LETTERS"]);
  });
});
