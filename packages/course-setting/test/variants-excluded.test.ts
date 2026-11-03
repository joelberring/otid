import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  allCourseVariants, applyEdit, carryExcludedVariants, CourseSettingEditError, courseSummaries, courseVariants, printVariants, readPpen,
  writeIofCourseData, writePpen, type CourseSettingDocument
} from "../src";

/** ADR-0197: bortvalda varianter i dokumentet, sammanfattningen, IOF XML, utskriften och .ppen. */
const xml = readFileSync(fileURLToPath(new URL("../../../fixtures/course-setting/gaffling-urval.ppen", import.meta.url)), "utf8");
const base = readPpen(xml).document;
const natt = base.courses.find(course => course.name === "Natt")!.id;

function exclude(document: CourseSettingDocument, codes: readonly string[]): CourseSettingDocument {
  const all = allCourseVariants(document, natt);
  const rows = codes.map(code => ({ code, controls: [...all.find(row => row.code === code)!.controlCodes] }));
  return applyEdit(document, { type: "UPDATE_COURSE", course: natt, changes: { excludedVariants: rows } }).document;
}

describe("bortvalda varianter (ADR-0197)", () => {
  it("fixturen ger åtta varianter, ACE kortast och BDF längst", () => {
    const all = allCourseVariants(base, natt);
    expect(all.map(row => row.code)).toEqual(["ACE", "ACF", "ADE", "ADF", "BCE", "BCF", "BDE", "BDF"]);
    const lengths = Object.fromEntries(all.map(row => [row.code, row.lengthMeters]));
    expect(Math.min(...Object.values(lengths))).toBe(lengths.ACE);
    expect(Math.max(...Object.values(lengths))).toBe(lengths.BDF);
  });

  it("de bortvalda räknas inte i sammanfattningen, varianterna, IOF XML eller utskriften", () => {
    const document = exclude(base, ["BDF", "BCF", "ADF", "BDE"]);
    expect(courseVariants(document, natt).map(row => row.code)).toEqual(["ACE", "ACF", "ADE", "BCE"]);
    expect(allCourseVariants(document, natt).filter(row => row.excluded).map(row => row.code)).toEqual(["ADF", "BCF", "BDE", "BDF"]);
    const summary = courseSummaries(document).find(row => row.course === natt)!;
    expect(summary.variants).toHaveLength(4);
    expect(summary.excludedCount).toBe(4);
    const kept = courseVariants(document, natt).map(row => row.lengthMeters);
    expect(summary.lengthRangeMeters).toEqual({ min: Math.min(...kept), max: Math.max(...kept) });
    const iof = writeIofCourseData(document);
    expect(iof).toContain("<Name>Natt ACE</Name>");
    expect(iof).toContain("<Name>Natt BCE</Name>");
    expect(iof).not.toContain("Natt BDF");
    expect(iof).not.toContain("Natt ADF");
    expect(printVariants(document, natt, true)).toEqual(["ACE", "ACF", "ADE", "BCE"]);
  });

  it("ett bortval gäller bara när koden och kontrollerna stämmer; ändras banan kommer varianten tillbaka", () => {
    const document = applyEdit(base, { type: "UPDATE_COURSE", course: natt, changes: {
      excludedVariants: [{ code: "BDF", controls: ["31", "42", "32", "44", "33", "99", "34"] }] } }).document;
    expect(courseVariants(document, natt)).toHaveLength(8);
    expect(courseSummaries(document).find(row => row.course === natt)!.excludedCount).toBe(0);
  });

  it("minst en variant ska användas; null tar bort bortvalen; poängbana nekas", () => {
    expect(() => exclude(base, ["ACE", "ACF", "ADE", "ADF", "BCE", "BCF", "BDE", "BDF"])).toThrow(CourseSettingEditError);
    const document = exclude(base, ["BDF"]);
    const cleared = applyEdit(document, { type: "UPDATE_COURSE", course: natt, changes: { excludedVariants: null } }).document;
    expect(cleared.courses.find(course => course.id === natt)!.excludedVariants).toBeUndefined();
    const kort = base.courses.find(course => course.name === "Kort")!.id;
    expect(() => applyEdit(base, { type: "UPDATE_COURSE", course: kort, changes: { kind: "SCORE", excludedVariants: [{ code: "A", controls: [] }] } }))
      .toThrow(CourseSettingEditError);
  });

  it(".ppen: bortvalen skrivs i O-Tid:s namnrymd och läses tillbaka; Purple Pens del är oförändrad", () => {
    const document = exclude(base, ["BDF", "BCF"]);
    const written = writePpen(document);
    expect(written).toContain('<otid:variants xmlns:otid="https://o-tid.se/ns/ppen-variants/1" schema-version="1">');
    const read = readPpen(written);
    expect(read.warnings).toEqual([]);
    expect(read.document.courses.find(course => course.id === natt)!.excludedVariants).toEqual(document.courses.find(course => course.id === natt)!.excludedVariants);
    expect(writePpen(base)).not.toContain("otid:variants");
    // Utan elementet är filen samma som utan bortval.
    expect(written.replace(/\s*<otid:variants[^]*?<\/otid:variants>/, "")).toBe(writePpen(base));
  });

  it("en fil från Purple Pen (utan elementet) får bortvalen från banläggningen när varianterna finns kvar", () => {
    const current = exclude(base, ["BDF", "BCF"]);
    const fromPurplePen = readPpen(writePpen(base)).document;
    const carried = carryExcludedVariants(current, fromPurplePen);
    expect(courseVariants(carried, natt).map(row => row.code)).toEqual(["ACE", "ACF", "ADE", "ADF", "BCE", "BDE"]);
    // Kontroll 46 har fått en ny kod i Purple Pen: varianterna med F finns inte längre och bortvalen följer inte med.
    const changedXml = writePpen(base).replace("<code>46</code>", "<code>47</code>");
    const changed = carryExcludedVariants(current, readPpen(changedXml).document);
    expect(courseVariants(changed, natt)).toHaveLength(8);
    // En fil som har egna bortval behåller dem.
    const own = exclude(base, ["ADF"]);
    expect(courseVariants(carryExcludedVariants(current, own), natt)).toHaveLength(7);
  });

  it("ångra: UPDATE_COURSE ändrar bara banans bortval", () => {
    const document = exclude(base, ["BDF"]);
    expect(document.courses.find(course => course.id === natt)!.name).toBe("Natt");
    const back = applyEdit(document, { type: "PUT_OBJECTS", courses: { [natt]: base.courses.find(course => course.id === natt)! } }).document;
    expect(courseVariants(back, natt)).toHaveLength(8);
  });
});
