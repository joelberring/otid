import { describe, expect, it } from "vitest";
import { parseSymbolCode } from "@o-tid/map-file";
import {
  applyEdit, diffTouches, editTouches, hiddenSymbolIds, objectPatch, presetFilter, readPpen, setSymbol, symbolCatalog, symbolGroup, toggleGroup,
  trainingMapPasses, writePpen, type CourseTraining
} from "../src";
import { lineCourse, syntheticMap, training } from "./training-helpers";

describe("symbolgrupperna (ISOM 2017-2 / ISSprOM 2019-2)", () => {
  it("grupperar efter huvudnumret och okända efter namnet", () => {
    const group = (code: string, name = "") => symbolGroup(parseSymbolCode(code), name);
    expect(group("101.0")).toBe("LANDFORM");
    expect(group("115")).toBe("LANDFORM");
    expect(group("204.1")).toBe("ROCK");
    expect(group("304")).toBe("WATER");
    expect(group("406")).toBe("VEGETATION");
    expect(group("505")).toBe("PATHS");
    expect(group("501")).toBe("PATHS");
    expect(group("509", "Railway")).toBe("MANMADE");
    expect(group("509", "Narrow ride")).toBe("PATHS");
    expect(group("520")).toBe("FORBIDDEN");
    expect(group("521")).toBe("MANMADE");
    expect(group("601.1")).toBe("TECHNICAL");
    expect(group("709")).toBe("FORBIDDEN");
    expect(group("999", "Brun kurva, egen")).toBe("LANDFORM");
    expect(group("0", "Stenmur")).toBe("MANMADE");
    expect(group("950", "Big boulder")).toBe("ROCK");
    expect(group("0", "Mystisk")).toBe("OTHER");
  });

  it("förvalen behåller nordlinjer och förbjudet område; undantag per symbol går före gruppen", () => {
    const map = syntheticMap();
    const contours = presetFilter("CONTOURS");
    expect([...hiddenSymbolIds(map, [contours])].sort()).toEqual(["s0", "s406", "s505"]);
    expect([...hiddenSymbolIds(map, [presetFilter("NO_VEGETATION")])]).toEqual(["s406"]);
    expect([...hiddenSymbolIds(map, [presetFilter("PATHS_ROADS")])].sort()).toEqual(["s0", "s101", "s406", "s999"]);
    const custom = setSymbol(setSymbol(contours, "505", true), "999", false);
    expect(custom.preset).toBe("CUSTOM");
    expect([...hiddenSymbolIds(map, [custom])].sort()).toEqual(["s0", "s406", "s999"]);
    expect([...hiddenSymbolIds(map, [toggleGroup(contours, "OTHER", true)])].sort()).toEqual(["s406", "s505"]);
    // Två filter: en symbol syns bara om båda visar den.
    expect([...hiddenSymbolIds(map, [presetFilter("NO_PATHS"), presetFilter("NO_VEGETATION")])].sort()).toEqual(["s406", "s505"]);
  });

  it("katalogen listar kartans använda symboler med grupp och antal", () => {
    const catalog = symbolCatalog(syntheticMap());
    expect(catalog.map(row => [row.code, row.group, row.count])).toEqual([["101.0", "LANDFORM", 1], ["406.0", "VEGETATION", 2], ["505", "PATHS", 1],
      ["999", "LANDFORM", 1]]);
  });
});

describe("PUT_TRAINING och kartans pass", () => {
  it("ett filter för hela banan ger ett pass med filtret; en annan bana ritas som vanligt", () => {
    const { b, course } = lineCourse();
    const other = b.course("Annan");
    b.edit({ type: "PUT_TRAINING", courses: { [course]: training({ filter: presetFilter("CONTOURS") }) } });
    const passes = trainingMapPasses(b.document, { course })!;
    expect(passes).toHaveLength(1);
    expect(passes[0]!.within).toEqual([]);
    expect(passes[0]!.filters.map(filter => filter.preset)).toEqual(["CONTOURS"]);
    expect(trainingMapPasses(b.document, { course: other })).toBeUndefined();
    expect(trainingMapPasses(b.document, { course: "ALL_CONTROLS" })).toBeUndefined();
  });

  it("ett ritat område snävar in filtret där (och gäller valda banor)", () => {
    const { b, course } = lineCourse();
    const other = b.course("Annan");
    const polygon = [{ x: 0, y: -5 }, { x: 15, y: -5 }, { x: 15, y: 5 }, { x: 0, y: 5 }];
    b.edit({ type: "PUT_TRAINING", areas: { t1: { id: "t1", polygon, filter: presetFilter("CONTOURS"), courses: [course] } } });
    const passes = trainingMapPasses(b.document, { course })!;
    expect(passes).toHaveLength(2);
    expect(passes[0]!.within).toHaveLength(1);
    expect(passes[0]!.filters.map(filter => filter.preset)).toEqual(["CONTOURS"]);
    expect(passes[1]!.without).toHaveLength(1);
    expect(passes[1]!.filters).toEqual([]);
    expect(trainingMapPasses(b.document, { course: other })).toBeUndefined();
  });

  it("kontrollerar formen och tar bort tom träning", () => {
    const { b, course } = lineCourse();
    const bad = (value: unknown) => () => applyEdit(b.document, { type: "PUT_TRAINING", courses: { [course]: value as CourseTraining } });
    expect(bad({ outside: { kind: "TINT", lighten: 2 }, sections: [] })).toThrow(/Tonen/);
    expect(bad({ outside: { kind: "FULL" }, sections: [], filter: { preset: "X", groups: [], hide: [], show: [] } })).toThrow(/okänt/);
    expect(() => applyEdit(b.document, { type: "PUT_TRAINING", courses: { "99": training() } })).toThrow(/finns inte/);
    expect(() => applyEdit(b.document, { type: "PUT_TRAINING", areas: { t1: { id: "t2", polygon: [], filter: presetFilter("ALL"), courses: [] } } })).toThrow();
    b.edit({ type: "PUT_TRAINING", courses: { [course]: { ...training(), extra: 1 } as CourseTraining } });
    expect(b.document.training?.courses[course]).toEqual(training());
    b.edit({ type: "PUT_TRAINING", courses: { [course]: null } });
    expect(b.document.training).toBeUndefined();
  });
});

describe("samarbete och ångra", () => {
  it("touches per del, ångra med objectPatch och konflikter ur skillnaden", () => {
    const { b, course } = lineCourse();
    const before = b.document;
    const edit = { type: "PUT_TRAINING" as const, courses: { [course]: training({ filter: presetFilter("CONTOURS") }) },
      areas: { t1: { id: "t1", polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], filter: presetFilter("ALL"), courses: [] } } };
    expect(editTouches(edit)).toEqual([`training:area:t1`, `training:course:${course}`]);
    const after = applyEdit(before, edit).document;
    expect(diffTouches(before, after)).toEqual([`training:area:t1`, `training:course:${course}`]);
    const undo = objectPatch(after, before)!;
    expect(undo.training).toEqual({ courses: { [course]: null }, areas: { t1: null } });
    expect(applyEdit(after, undo).document.training).toBeUndefined();
    // Någon annan ändrar en annan banas träning: ångra rör den inte.
    const other = applyEdit(applyEdit(after, { type: "ADD_COURSE", name: "B" }).document, { type: "PUT_TRAINING", courses: { "2": training({ filter: presetFilter("NO_PATHS") }) } }).document;
    const undone = applyEdit(other, undo).document;
    expect(Object.keys(undone.training!.courses)).toEqual(["2"]);
  });
});

describe(".ppen", () => {
  it("skrivs sist i O-Tid:s namnrymd och läses tillbaka; Purple Pens element är orörda", () => {
    const { b, course, controls } = lineCourse();
    const plain = writePpen(b.document);
    b.edit({ type: "PUT_TRAINING", courses: { [course]: training({ filter: presetFilter("CONTOURS") }) },
      attackPoints: { t9: { id: "t9", from: controls[1]!, to: controls[2]!, at: { x: 17, y: 7 } } }, attackStyle: { sizeRatio: 0.6, style: "DASHED" } });
    const xml = writePpen(b.document);
    expect(xml).toMatch(/<otid:training xmlns:otid="https:\/\/o-tid.se\/ns\/ppen-training\/1" schema-version="1">\{/);
    expect(xml.indexOf("<otid:training")).toBeGreaterThan(xml.lastIndexOf("<course-control"));
    // Utan elementet är filen som förut (Purple Pen ser inget annat).
    expect(xml.replace(/\s*<otid:training[\s\S]*?<\/otid:training>/, "")).toBe(plain);
    const read = readPpen(xml);
    expect(read.warnings).toEqual([]);
    expect(read.document.training).toEqual(b.document.training);
    expect(writePpen(read.document)).toBe(xml);
  });

  it("en trasig eller okänd träning sparas orörd med varning", () => {
    const { b } = lineCourse();
    const xml = writePpen(b.document).replace("</course-scribe-event>",
      `<otid:training xmlns:otid="https://o-tid.se/ns/ppen-training/1" schema-version="2">{}</otid:training></course-scribe-event>`);
    const read = readPpen(xml);
    expect(read.document.training).toBeUndefined();
    expect(read.warnings.map(w => w.code)).toContain("TRAINING_UNREADABLE");
    expect(writePpen(read.document)).toContain(`schema-version="2"`);
  });

  it("delar för banor som inte finns skrivs inte", () => {
    const { b, course } = lineCourse();
    b.edit({ type: "PUT_TRAINING", courses: { [course]: training() } });
    const removed = applyEdit(b.document, { type: "DELETE_COURSE", course }).document;
    expect(readPpen(writePpen(removed)).document.training).toBeUndefined();
  });
});
