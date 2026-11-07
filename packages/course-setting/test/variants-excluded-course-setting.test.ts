import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  allCourseVariants, applyEdit, checkDocument, controlsInForbidden, courseLength, courseSummaries, detailCircleCenters, expandText, forbiddenLegs,
  layoutCoursePage, levelControls, levelLegPairs, paperTextValues, readPpen, routeBarriers, writeIofCourseData, type CourseSettingDocument
} from "../src";
import { lineCourse } from "./build";

/**
 * ADR-0198 tillägg 12: bortvalda varianter påverkar inget i banläggningen – inte spärrarna, nivåstödet eller längden.
 * Fixturen: start → 31 → A 41 / B 42 → 32 → C 43 / D 44 → 33 → E 45 / F 46 → 34 → mål (1:10 000).
 */
const xml = readFileSync(fileURLToPath(new URL("../../../fixtures/course-setting/gaffling-urval.ppen", import.meta.url)), "utf8");
const base = readPpen(xml).document;
const natt = base.courses.find(course => course.name === "Natt")!.id;
const control = (code: string) => Object.values(base.controls).find(point => point.code === code)!.id;
const square = (x: number, y: number, size: number) => [{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }];

function exclude(document: CourseSettingDocument, codes: readonly string[]): CourseSettingDocument {
  const all = allCourseVariants(document, natt);
  const rows = codes.map(code => ({ code, controls: [...all.find(row => row.code === code)!.controlCodes] }));
  return applyEdit(document, { type: "UPDATE_COURSE", course: natt, changes: { excludedVariants: rows } }).document;
}

/** Alla varianter med gren B (kontroll 42) bortvalda. */
const withoutB = (document: CourseSettingDocument) => exclude(document, ["BCE", "BCF", "BDE", "BDF"]);

describe("bortvalda varianter i banläggningen (ADR-0198 tillägg 12)", () => {
  it("B5: en sträcka eller kontroll som bara finns i bortvalda varianter varnar inte för förbjudet område", () => {
    // Ytan ligger på sträckan 31–42 (bara i B-varianterna) och en annan runt 42.
    const legArea = applyEdit(base, { type: "ADD_SPECIAL", special: { kind: "out-of-bounds", points: square(8, 35, 6) } });
    const both = applyEdit(legArea.document, { type: "ADD_SPECIAL", special: { kind: "out-of-bounds", points: square(2, 52, 6) } });
    const document = both.document;
    expect(forbiddenLegs(document, natt)).toEqual([{ from: control("31"), to: control("42"), special: legArea.created }]);
    expect(controlsInForbidden(document, natt)).toEqual([{ control: control("42"), special: both.created }]);
    const pruned = withoutB(document);
    expect(forbiddenLegs(pruned, natt)).toEqual([]);
    expect(controlsInForbidden(pruned, natt)).toEqual([]);
    // Bara en del bortvald: sträckan finns kvar i BCE och varnar.
    expect(forbiddenLegs(exclude(document, ["BDF"]), natt)).toHaveLength(1);
  });

  it("B5: nivåstödet bedömer inte kontroller och sträckor som bara finns i bortvalda varianter", () => {
    expect(levelControls(base, natt).map(row => row.id)).toContain(control("42"));
    const pruned = withoutB(base);
    expect(levelControls(pruned, natt).map(row => row.id)).not.toContain(control("42"));
    const legs = levelLegPairs(pruned, natt);
    expect(legs.some(leg => leg.from === control("42") || leg.to === control("42"))).toBe(false);
    expect(legs).toContainEqual({ from: control("31"), to: control("41") });
    expect(levelControls(pruned, natt)).toHaveLength(levelControls(base, natt).length - 1);
  });

  it("längden: en bortvald längsta variant påverkar inte banans längd någonstans", () => {
    const lengths = Object.fromEntries(allCourseVariants(base, natt).map(row => [row.code, row.lengthMeters]));
    const document = exclude(base, ["BDF"]);
    const kept = Math.max(...Object.entries(lengths).filter(([code]) => code !== "BDF").map(([, meters]) => meters));
    const shortest = Math.min(...Object.values(lengths));
    // Fixturen: BDF är minst 300 m längre än den längsta som blir kvar, så det syns med 0,1 km.
    expect(lengths.BDF! - kept).toBeGreaterThan(300);
    const kmText = (meters: number) => (Math.round(meters / 100) / 10).toFixed(1).replace(".", ",");

    expect(courseLength(document, natt)).toEqual({ meters: kept, min: shortest, max: kept, fixed: false });
    expect(courseSummaries(document).find(row => row.course === natt)!.lengthMeters).toBe(kept);
    // Pappersramens {längd}, rubriken på utskriften och textmakrot $(CourseLength) räknade förut med alla varianter.
    expect(paperTextValues(document, { course: natt, printScale: 10000 })["längd"]).toBe(`${kmText(kept)} km`);
    const [page] = layoutCoursePage(document, { course: natt, header: true });
    expect(page!.texts[0]!.text).toContain(`${kmText(kept)} km`);
    expect(page!.texts[0]!.text).not.toContain(`${kmText(lengths.BDF!)} km`);
    expect(expandText({ document, course: natt, printScale: 10000 } as never, "$(CourseLength)")).toBe(`${kmText(shortest)}–${kmText(kept)}`);
  });

  it("längden: en vald variant ger sin egen längd och fast längd går före", () => {
    const lengths = Object.fromEntries(allCourseVariants(base, natt).map(row => [row.code, row.lengthMeters]));
    expect(courseLength(base, natt, { variant: "ACE" }).meters).toBe(lengths.ACE);
    expect(paperTextValues(base, { course: natt, variant: "ACE", printScale: 10000 })["längd"])
      .toBe(`${(Math.round(lengths.ACE! / 100) / 10).toFixed(1).replace(".", ",")} km`);
    // En okänd kod ger banans längd (förut alla grenar i följd).
    expect(courseLength(base, natt, { variant: "XYZ" }).meters).toBe(lengths.BDF);
    const fixed = applyEdit(exclude(base, ["BDF"]), { type: "UPDATE_COURSE", course: natt, changes: { lengthOverrideMeters: 4321 } }).document;
    expect(courseLength(fixed, natt)).toEqual({ meters: 4321, min: 4321, max: 4321, fixed: true });
    expect(courseLength(fixed, natt, { variant: "ACE" }).meters).toBe(4321);
    expect(expandText({ document: fixed, course: natt, printScale: 10000 } as never, "$(CourseLength)")).toBe("4,3");
  });
});

describe("B11: förbjuden väg (krysset) spärrar så stort som det ritas", () => {
  /** Sträckan går längs y = 0; krysset står `offset` mm från den. */
  function crossAt(offset: number, mapScale: number) {
    const { b, course } = lineCourse(2, { mapScale });
    b.edit({ type: "ADD_SPECIAL", special: { kind: "forbidden-route", points: [{ x: 10, y: offset }] } });
    // Kryssets halva höjd som det ritas i banans skala (armarna i `routeBarriers`).
    const half = Math.max(...routeBarriers(b.document, course).lines.flatMap(line => line.points.map(point => Math.abs(point.y - offset))));
    return { hits: forbiddenLegs(b.document, course).length, half };
  }

  it("skalas som banpåtrycket i stället för fasta 1,5 kartans mm", () => {
    // 1:10 000 med ISOM-förvalet "RelativeTo15000": figurerna 1,5 × i kartans mm, krysset 1,06 · 1,5 ≈ 1,59 mm från mitten.
    expect(crossAt(0, 10000).half).toBeCloseTo(1.06 * 1.5, 6);
    expect(crossAt(1.55, 10000).hits).toBe(1);
    expect(crossAt(1.65, 10000).hits).toBe(0);
    // 1:5 000 ("RelativeToMap"): 1,06 mm. Förut spärrade krysset 1,5 mm från mitten oavsett skala.
    expect(crossAt(0, 5000).half).toBeCloseTo(1.06, 6);
    expect(crossAt(1, 5000).hits).toBe(1);
    expect(crossAt(1.3, 5000).hits).toBe(0);
  });
});

describe("bortvalda varianter i kontrollerna, ringarna och IOF-exporten (städrundan 2026-11-07)", () => {
  it("en kontroll som bara finns i bortvalda varianter är oanvänd; en sträcka bara där ger ingen varning", () => {
    const unused = (document: CourseSettingDocument) => checkDocument(document).filter(check => check.kind === "UNUSED_CONTROL")
      .map(check => (check as { control: string }).control);
    expect(unused(base)).not.toContain(control("42"));
    expect(unused(withoutB(base))).toContain(control("42"));
    // Samma kontroll två gånger i rad (31 → 31) bara i B-grenen (42 byts mot 31 där): ingen varning när B är bortvald.
    const [branchB] = Object.entries(base.courseControls).find(([, row]) => row.control === control("42"))!;
    const twice: CourseSettingDocument = { ...base, courseControls: { ...base.courseControls,
      [branchB]: { ...base.courseControls[branchB]!, control: control("31") } } };
    const sameTwice = (document: CourseSettingDocument) => checkDocument(document).some(check => check.kind === "SAME_CONTROL_TWICE_IN_ROW");
    expect(sameTwice(twice)).toBe(true);
    expect(sameTwice(withoutB(twice))).toBe(false);
  });

  it("ringarna: en kontroll bara i bortvalda varianter får inte banans skala, och en sträcka bara där spärrar inget gap", () => {
    const scaled = applyEdit(base, { type: "UPDATE_COURSE", course: natt, changes: { printScale: 7500 } }).document;
    const circles = (document: CourseSettingDocument, code: string) => detailCircleCenters(document).filter(circle => circle.id.startsWith(`${control(code)}@`));
    // 42 syns i Natts skala (1:7 500) och i alla kontrollers (1:10 000): två ringar; sträckorna 31–42 och 42–32 spärrar gap.
    expect(circles(scaled, "42")).toHaveLength(2);
    expect(circles(scaled, "42")[0]!.blockedDegrees).toHaveLength(2);
    const pruned = withoutB(scaled);
    expect(circles(pruned, "42")).toHaveLength(1);
    expect(circles(pruned, "42")[0]!.blockedDegrees).toBeUndefined();
    // 31: sträckan mot 42 räknas inte längre (en färre vinkel i Natts ring).
    const at31 = (document: CourseSettingDocument) => circles(document, "31").find(circle => circle.blockedDegrees)!.blockedDegrees!.length;
    expect(at31(pruned)).toBe(at31(scaled) - 1);
  });

  it("IOF-exporten skriver längden med courseLength: variantens uppmätta, fast längd före", () => {
    const document = exclude(base, ["BDF"]);
    const xmlOut = writeIofCourseData(document);
    const lengthOf = (name: string) => Number(new RegExp(`<Name>${name}</Name>(?:\\s*<CourseFamily>[^<]*</CourseFamily>)?\\s*<Length>(\\d+)</Length>`).exec(xmlOut)?.[1]);
    for (const row of allCourseVariants(document, natt).filter(variant => !variant.excluded)) {
      expect(lengthOf(`Natt ${row.code}`)).toBe(Math.round(courseLength(document, natt, { variant: row.code }).meters / 100) * 100);
    }
    expect(xmlOut).not.toContain("<Name>Natt BDF</Name>");
    const fixed = applyEdit(document, { type: "UPDATE_COURSE", course: natt, changes: { lengthOverrideMeters: 4321 } }).document;
    expect(lengthOf("Natt ACE")).toBeGreaterThan(0);
    expect(new RegExp("<Name>Natt ACE</Name>\\s*<CourseFamily>Natt</CourseFamily>\\s*<Length>4300</Length>").test(writeIofCourseData(fixed))).toBe(true);
  });
});
