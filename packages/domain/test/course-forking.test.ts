import { describe, expect, it } from "vitest";
import {
  courseForkingFairness, courseLengthMeters, courseVariantGraph, deriveCourseForking, forkingChoicesFor, forkingLetters,
  generateForkingVariants, validateCourseForking, type CourseForking
} from "../src";

const control = (code: number) => ({ kind: "CONTROL" as const, code });

describe("gafflingsstruktur: generering av varianter (steg 49)", () => {
  it("enkel gaffling ger ett alternativ per variant med bokstäverna A, B, C", () => {
    const forking: CourseForking = { items: [control(31), { kind: "FORK", branches: [[41], [42, 43], [44]] }, control(32)] };
    expect(validateCourseForking(forking)).toEqual([]);
    expect(generateForkingVariants(forking).map(variant => [variant.code, variant.controlCodes.join(" ")])).toEqual([
      ["A", "31 41 32"], ["B", "31 42 43 32"], ["C", "31 44 32"]]);
  });

  it("fjäril: alla slingor i alla ordningar, tillbaka till mitten efter varje slinga", () => {
    const forking: CourseForking = { items: [control(31), { kind: "LOOP", center: 50, loops: [[41, 42], [43]] }, control(33)] };
    expect(generateForkingVariants(forking).map(variant => [variant.code, variant.controlCodes.join(" ")])).toEqual([
      ["A", "31 50 41 42 50 43 50 33"], ["B", "31 50 43 50 41 42 50 33"]]);
    const three: CourseForking = { items: [{ kind: "LOOP", center: 50, loops: [[41], [42], [43]] }] };
    const codes = generateForkingVariants(three).map(variant => variant.code);
    expect(codes).toEqual(["AB", "AC", "BA", "BC", "CA", "CB"]);
    expect(generateForkingVariants(three)[3]!.controlCodes).toEqual([50, 42, 50, 43, 50, 41, 50]);
  });

  it("kombination: fjäril och enkel gaffling i följd delar ut bokstäverna i följd (OCAD/Purple Pen)", () => {
    const forking: CourseForking = { items: [control(31), { kind: "LOOP", center: 50, loops: [[41], [42]] },
      { kind: "FORK", branches: [[61], [62]] }, control(33)] };
    expect(forkingLetters(forking)).toEqual([null, ["A", "B"], ["C", "D"], null]);
    const variants = generateForkingVariants(forking);
    expect(variants.map(variant => variant.code)).toEqual(["AC", "AD", "BC", "BD"]);
    expect(variants[3]!.controlCodes).toEqual([31, 50, 42, 50, 41, 50, 62, 33]);
    expect(forkingChoicesFor(forking, variants[2]!.controlCodes)).toEqual([null, [1, 0], 0, null]);
  });

  it("regler: 2–4 alternativ med kontroller, olika alternativ, högst 100 varianter", () => {
    expect(validateCourseForking({ items: [{ kind: "FORK", branches: [[41]] }] }).map(problem => problem.kind)).toEqual(["TOO_FEW_BRANCHES"]);
    expect(validateCourseForking({ items: [{ kind: "FORK", branches: [[41], []] }] }).map(problem => problem.kind)).toEqual(["EMPTY_BRANCH"]);
    expect(validateCourseForking({ items: [{ kind: "FORK", branches: [[41], [41]] }] }).map(problem => problem.kind)).toEqual(["SAME_BRANCHES"]);
    expect(validateCourseForking({ items: [{ kind: "LOOP", center: 50, loops: [[41], [50]] }] }).map(problem => problem.kind))
      .toEqual(["LOOP_CONTAINS_CENTER"]);
    const big: CourseForking = { items: [1, 2, 3, 4].map(index => ({ kind: "LOOP" as const, center: index, loops: [[10 + index], [20 + index], [30 + index]] })) };
    expect(validateCourseForking(big)).toContainEqual({ kind: "TOO_MANY_VARIANTS", count: 1296 });
  });
});

describe("härledning ur importerade varianter", () => {
  // Två fjärilar som i fixtures/iof/course-data-forked.xml (Purple Pen-export, en Course per variant).
  const loop = (first: number[], second: number[], center: number) => [center, ...first, center, ...second, center];
  const imported = [
    { code: "AC", controlCodes: [31, ...loop([41, 42], [43, 44], 50), 32, ...loop([61, 62], [63, 64], 60), 33] },
    { code: "AD", controlCodes: [31, ...loop([41, 42], [43, 44], 50), 32, ...loop([63, 64], [61, 62], 60), 33] },
    { code: "BC", controlCodes: [31, ...loop([43, 44], [41, 42], 50), 32, ...loop([61, 62], [63, 64], 60), 33] },
    { code: "BD", controlCodes: [31, ...loop([43, 44], [41, 42], 50), 32, ...loop([63, 64], [61, 62], 60), 33] }
  ];

  it("hittar fjärilarna och ger samma varianter och koder", () => {
    const derived = deriveCourseForking(imported);
    expect(derived.forking.items).toEqual([control(31), { kind: "LOOP", center: 50, loops: [[41, 42], [43, 44]] }, control(32),
      { kind: "LOOP", center: 60, loops: [[61, 62], [63, 64]] }, control(33)]);
    expect(derived.convertible).toBe(true);
    expect(derived.addedCount).toBe(0);
    expect(generateForkingVariants(derived.forking).map(variant => variant.code)).toEqual(["AC", "AD", "BC", "BD"]);
    expect(derived.choices.get("BD")).toEqual([null, [1, 0], null, [1, 0], null]);
  });

  it("hittar enkla gafflingar och säger hur många varianter som tillkommer", () => {
    const derived = deriveCourseForking([{ code: "1", controlCodes: [31, 41, 32, 51, 33] }, { code: "2", controlCodes: [31, 42, 32, 52, 33] }]);
    expect(derived.forking.items).toEqual([control(31), { kind: "FORK", branches: [[41], [42]] }, control(32),
      { kind: "FORK", branches: [[51], [52]] }, control(33)]);
    expect(derived.convertible).toBe(true);
    expect(derived.addedCount).toBe(2);
  });

  it("varianter som inte går att göra om ger ändå en bild där varje variant är en väg", () => {
    const variants = [{ code: "X", controlCodes: [31, 32] }, { code: "Y", controlCodes: [31, 33] }, { code: "Z", controlCodes: [31, 34] },
      { code: "W", controlCodes: [31, 35] }, { code: "V", controlCodes: [31, 36] }];
    const derived = deriveCourseForking(variants);
    expect(derived.convertible).toBe(false);
    expect(derived.forking.items[1]).toEqual({ kind: "FORK", branches: [[32], [33], [34], [35], [36]] });
    expect(derived.choices.get("V")).toEqual([null, 4]);
  });

  it("grafen har kontrollerna som noder och sträckorna som kanter med varianterna", () => {
    const graph = courseVariantGraph([{ code: "A", controlCodes: [31, 41, 32] }, { code: "B", controlCodes: [31, 42, 32] }]);
    expect(graph.nodes).toEqual(["START", 31, 41, 32, 42, "FINISH"]);
    expect(graph.edges.find(edge => edge.from === 31 && edge.to === 41)?.variantCodes).toEqual(["A"]);
    expect(graph.edges.find(edge => edge.from === "START")?.variantCodes).toEqual(["A", "B"]);
  });
});

describe("rättvisekontroll per gafflingssätt", () => {
  const fork = [{ code: "A", controlCodes: [31, 41, 33], lengthMeters: 4100 }, { code: "B", controlCodes: [31, 42, 33], lengthMeters: 4180 }];

  it("fulgaffling: alternativen är bara en upplysning, med längd och skillnad mot den kortaste", () => {
    const fairness = courseForkingFairness({ mode: "UNEQUAL", variants: fork });
    expect(fairness.level).toBe("NOTICE");
    expect(fairness.warningLegs).toEqual([]);
    expect(fairness.noticeLegs.map(leg => `${leg.from}-${leg.to}`)).toEqual(["31-41", "41-33", "31-42", "42-33"]);
    expect(fairness.lengths).toEqual([{ code: "A", lengthMeters: 4100, differenceMeters: 0 }, { code: "B", lengthMeters: 4180, differenceMeters: 80 }]);
  });

  it("utjämnad: samma alternativ ger en varning", () => {
    expect(courseForkingFairness({ mode: "BALANCED", variants: fork }).level).toBe("WARNING");
  });

  it("fjärilar ger samma sträckor; en ojämn fjäril varnar även i en fulgaffling", () => {
    const even = generateForkingVariants({ items: [control(31), { kind: "LOOP", center: 50, loops: [[41], [42]] }, control(33)] });
    expect(courseForkingFairness({ mode: "BALANCED", variants: even }).level).toBe("NONE");
    const uneven = [{ code: "A", controlCodes: [31, 50, 41, 50, 42, 50, 33] }, { code: "B", controlCodes: [31, 50, 41, 50, 41, 50, 33] }];
    const fairness = courseForkingFairness({ mode: "UNEQUAL", variants: uneven,
      forking: { items: [control(31), { kind: "LOOP", center: 50, loops: [[41], [42]] }, control(33)] } });
    expect(fairness.level).toBe("WARNING");
    expect(fairness.lengths[0]!.differenceMeters).toBeNull();
  });

  it("längd ur lägen: raka avstånd, null när ett läge saknas", () => {
    expect(courseLengthMeters([{ x: 0, y: 0 }, { x: 300, y: 400 }, { x: 300, y: 0 }])).toBe(900);
    expect(courseLengthMeters([{ x: 0, y: 0 }, undefined])).toBeNull();
  });
});
