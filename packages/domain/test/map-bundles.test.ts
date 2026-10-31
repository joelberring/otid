import { describe, expect, it } from "vitest";
import {
  forkingReadiness, generateForkingVariants, mapBackPages, mapBundlesByClass, mapBundlesByTime, mapPrintChanges, mapReserveCount,
  planMapBundles, printedMapState, type CourseForking, type MapBundleClassInput, type MapBundleEntryInput
} from "../src";

const at = (minute: number) => new Date(Date.parse("2026-12-09T17:00:00.000Z") + minute * 60_000).toISOString();
const h21: MapBundleClassInput = { id: "c-h21", name: "H21", courseVersionId: "v-lang", courseName: "Lång", variantCodes: ["AC", "AD", "BC", "BD"],
  startMode: "MINUTE", vacancies: [at(4), at(6)] };
const d21: MapBundleClassInput = { id: "c-d21", name: "D21", courseVersionId: "v-kort", courseName: "Kort", variantCodes: [],
  startMode: "MINUTE", vacancies: [] };
const runner = (id: string, name: string, classId: string, minute: number | null, variantCode: string | null): MapBundleEntryInput =>
  ({ id, name, club: "OK Natt", classId, startTime: minute === null ? null : at(minute), variantCode });
const entries = [
  runner("e1", "Ada Ek", "c-h21", 0, "AC"), runner("e2", "Bo Lind", "c-h21", 1, "AD"), runner("e3", "Cia Holm", "c-h21", 2, "BC"),
  runner("e4", "Dan Berg", "c-h21", 3, "AC"), runner("e5", "Eva Sjö", "c-d21", 0, null), runner("e6", "Fia Strand", "c-h21", 5, null)
];

describe("kartbuntsplan (steg 61)", () => {
  it("räknar tryckantal per variant med löpare, lediga tider och reserv", () => {
    const plan = planMapBundles({ classes: [h21, d21], entries, reserve: { kind: "COUNT", value: 1 } });
    const count = (variant: string | null) => plan.groups.find(group => group.variantCode === variant && group.courseName ===
      (variant ? "Lång" : "Kort"))!;
    // AC har Ada och Dan; de lediga tiderna 17:04 och 17:06 får de minst använda varianterna (BD, sedan AD).
    expect(count("AC")).toMatchObject({ runnerCount: 2, vacancyCount: 0, reserveCount: 1, printCount: 3 });
    expect(count("BD")).toMatchObject({ runnerCount: 0, vacancyCount: 1, printCount: 2 });
    expect(count("AD")).toMatchObject({ runnerCount: 1, vacancyCount: 1, printCount: 3 });
    expect(count("BC")).toMatchObject({ runnerCount: 1, vacancyCount: 0, printCount: 2 });
    expect(count(null)).toMatchObject({ runnerCount: 1, printCount: 2 });
    // Fia saknar variant och ingår inte förrän hon fått en.
    expect(plan.missingVariant).toEqual([{ entryId: "e6", name: "Fia Strand", className: "H21" }]);
    expect(plan.groups.map(group => `${group.courseName}-${group.variantCode ?? ""}`)).toEqual(["Kort-", "Lång-AC", "Lång-AD", "Lång-BC", "Lång-BD"]);
  });

  it("reserv i procent avrundas uppåt per grupp", () => {
    expect(mapReserveCount(23, { kind: "PERCENT", value: 10 })).toBe(3);
    expect(mapReserveCount(0, { kind: "PERCENT", value: 10 })).toBe(0);
    expect(mapReserveCount(5, { kind: "COUNT", value: 2 })).toBe(2);
  });

  it("startnummer i startordning, lediga tider får egna nummer och listan grupperas per minut", () => {
    const plan = planMapBundles({ classes: [h21, d21], entries, reserve: { kind: "PERCENT", value: 0 } });
    expect(plan.rows.map(row => [row.number, row.name ?? "ledig", row.className, row.variantCode])).toEqual([
      [1, "Eva Sjö", "D21", null], [2, "Ada Ek", "H21", "AC"], [3, "Bo Lind", "H21", "AD"], [4, "Cia Holm", "H21", "BC"],
      [5, "Dan Berg", "H21", "AC"], [6, "ledig", "H21", "BD"], [7, "ledig", "H21", "AD"]]);
    const minutes = mapBundlesByTime(plan.rows);
    expect(minutes[0]!.rows.map(row => row.name)).toEqual(["Eva Sjö", "Ada Ek"]);
    expect(minutes).toHaveLength(6);
  });

  it("masstart: per klass och variant i banans ordning", () => {
    const mass = { ...h21, startMode: "MASS" as const, vacancies: [] };
    const plan = planMapBundles({ classes: [mass], entries: entries.filter(entry => entry.classId === "c-h21"), reserve: { kind: "COUNT", value: 0 } });
    const groups = mapBundlesByClass(plan.rows, () => mass.variantCodes);
    expect(groups.map(group => [group.variantCode, group.rows.map(row => row.name)])).toEqual([
      ["AC", ["Ada Ek", "Dan Berg"]], ["AD", ["Bo Lind"]], ["BC", ["Cia Holm"]]]);
  });

  it("baksidorna: en avdelare per variant och exakt tryckantalet sidor i kartbuntens ordning", () => {
    const plan = planMapBundles({ classes: [h21, d21], entries, reserve: { kind: "COUNT", value: 1 } });
    const pages = mapBackPages(plan.groups);
    const ac = plan.groups.find(group => group.variantCode === "AC")!;
    const start = pages.findIndex(page => page.kind === "DIVIDER" && page.variantCode === "AC");
    expect(pages[start]).toMatchObject({ kind: "DIVIDER", printCount: 3 });
    expect(pages.slice(start + 1, start + 1 + ac.printCount).map(page => page.kind === "RUNNER" ? page.item.name : page.kind))
      .toEqual(["Ada Ek", "Dan Berg", "RESERVE"]);
    for (const group of plan.groups) {
      expect(pages.filter(page => page.kind !== "DIVIDER" && page.courseName === group.courseName && page.variantCode === group.variantCode))
        .toHaveLength(group.printCount);
    }
  });

  it("ändringar sedan utskriften: variantbyte, efteranmäld och nytt tryckantal", () => {
    const reserve = { kind: "COUNT" as const, value: 0 };
    const before = printedMapState(planMapBundles({ classes: [h21, d21], entries, reserve }));
    const changed = entries.map(entry => entry.id === "e4" ? { ...entry, variantCode: "BD" } : entry);
    const after = printedMapState(planMapBundles({ classes: [{ ...h21, vacancies: [at(6)] }, d21],
      entries: [...changed, runner("e7", "Gun Ås", "c-h21", 4, "BD")], reserve }));
    const changes = mapPrintChanges(before, after, { counts: true });
    expect(changes).toContainEqual({ kind: "VARIANT", name: "Dan Berg", className: "H21", from: "AC", to: "BD" });
    expect(changes).toContainEqual({ kind: "ADDED", name: "Gun Ås", className: "H21", variantCode: "BD" });
    // Den lediga tiden 17:06 får nu AC (minst använd), så AD har en karta mindre och BD en mer.
    expect(changes).toContainEqual({ kind: "COUNT", courseName: "Lång", variantCode: "AD", from: 2, to: 1 });
    expect(changes).toContainEqual({ kind: "COUNT", courseName: "Lång", variantCode: "BD", from: 1, to: 2 });
    expect(mapPrintChanges(before, before, { counts: true })).toEqual([]);
  });
});

describe("kontroll före tävlingen (steg 61)", () => {
  const forking: CourseForking = { items: [{ kind: "CONTROL", code: 31 }, { kind: "FORK", branches: [[41], [42]] },
    { kind: "CONTROL", code: 32 }, { kind: "FORK", branches: [[51], [52]] }, { kind: "CONTROL", code: 33 }] };
  const variants = generateForkingVariants(forking);
  const choices = new Map(variants.map(variant => [variant.code, variant.choices]));
  const codes = variants.map(variant => variant.code);

  it("jämn fördelning utan saknade varianter är ok", () => {
    const result = forkingReadiness({ variantCodes: codes, forking, choices, classes: [{ name: "H21", runnerVariants: ["AC", "AD", "BC", "BD"] }] });
    expect(result).toMatchObject({ ok: true, unusedVariants: [], missingVariant: [], uneven: [], variantCount: 4 });
  });

  it("ojämn gafflingspunkt, saknad variant och oanvänd variant", () => {
    const result = forkingReadiness({ variantCodes: codes, forking, choices,
      classes: [{ name: "H21", runnerVariants: ["AC", "AD", "AC", "AD", "BC", null] }] });
    expect(result.ok).toBe(false);
    expect(result.missingVariant).toEqual([{ className: "H21", count: 1 }]);
    expect(result.unusedVariants).toEqual(["BD"]);
    expect(result.unusedExpected).toBe(false);
    expect(result.uneven).toEqual([{ className: "H21", point: 1, counts: [{ letters: "A", count: 4 }, { letters: "B", count: 1 }] }]);
  });

  it("färre löpare än varianter: oanvända varianter är väntade", () => {
    const result = forkingReadiness({ variantCodes: codes, forking, choices, classes: [{ name: "H21", runnerVariants: ["AC", "BD"] }] });
    expect(result).toMatchObject({ ok: true, unusedExpected: true, unusedVariants: ["AD", "BC"] });
  });

  it("för många varianter och bokstäver", () => {
    const many = Array.from({ length: 101 }, (_value, index) => `V${index}`);
    expect(forkingReadiness({ variantCodes: many, classes: [] })).toMatchObject({ tooManyVariants: true, ok: false });
    const letters: CourseForking = { items: Array.from({ length: 7 }, (_value, index) => ({ kind: "FORK" as const,
      branches: [[100 + index * 4], [101 + index * 4], [102 + index * 4], [103 + index * 4]] })) };
    expect(forkingReadiness({ variantCodes: ["A"], forking: letters, classes: [] }).tooManyLetters).toBe(true);
  });
});
