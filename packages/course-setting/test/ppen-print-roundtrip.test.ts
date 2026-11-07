/**
 * Städrundan 2026-11-07: .ppen fram och tillbaka för utskriften.
 * B6: en automatisk tryckyta skrivs som Purple Pen gör (rektangeln 0,0,0,0) och läses tillbaka utan rektangel; förut blev den
 * {0,0,0,0} och nästa ändring av tryckytan gav "Tryckytan är ingen rektangel".
 * B10: utan banans egen skala tappades hela `<options>` (stigning, längd, score-column); nu skrivs det med kartans skala.
 */
import { describe, expect, it } from "vitest";
import { applyEdit, emptyDocument, readPpen, writePpen, type CourseSettingDocument, type CourseSettingEdit } from "../src";

function documentWith(mapScale: number) {
  let document: CourseSettingDocument = emptyDocument({ title: "Rundtur", mapScale });
  const edit = (change: CourseSettingEdit) => { const result = applyEdit(document, change); document = result.document; return result.created ?? ""; };
  const ids = [edit({ type: "ADD_CONTROL", kind: "START", at: { x: 0, y: 0 } }), edit({ type: "ADD_CONTROL", kind: "NORMAL", at: { x: 30, y: 20 }, code: "31" }),
    edit({ type: "ADD_CONTROL", kind: "FINISH", at: { x: 60, y: 0 } })];
  const course = edit({ type: "ADD_COURSE", name: "A" });
  for (const id of ids) edit({ type: "INSERT_COURSE_CONTROL", course, control: id });
  return { document, course, edit: (change: CourseSettingEdit) => { edit(change); return document; } };
}

const roundTrip = (document: CourseSettingDocument) => readPpen(writePpen(document)).document;

describe("tryckytan i .ppen (B6)", () => {
  it("automatisk tryckyta: skrivs som Purple Pen (0,0,0,0), läses tillbaka identisk och kan ändras igen", () => {
    const { course, edit } = documentWith(10000);
    const page = { width: 827, height: 1169, margins: 28, landscape: true };
    edit({ type: "SET_PRINT_AREA", course, area: { automatic: true, restrictToPageSize: true, page } });
    let document = edit({ type: "SET_PRINT_AREA", course: "ALL_CONTROLS", area: { automatic: true, restrictToPageSize: false } });
    document = edit({ type: "SET_PRINT_AREA", course, part: 1, area: { automatic: true, restrictToPageSize: true } });
    const xml = writePpen(document);
    expect(xml).toMatch(/<print-area automatic="true" restrict-to-page-size="true" left="0" top="0" right="0" bottom="0" page-width="827"/);
    const back = roundTrip(document);
    const original = document.courses.find(row => row.id === course)!;
    const read = back.courses.find(row => row.id === course)!;
    expect(read.printArea).toEqual(original.printArea);
    expect(read.printArea!.rect).toBeUndefined();
    expect(read.partPrintAreas).toEqual(original.partPrintAreas);
    expect(back.event.printArea).toEqual(document.event.printArea);
    // Exporten av den inlästa filen är densamma.
    expect(writePpen(back)).toBe(xml);
    // Ändringen efter import (som "Använd mallen": samma yta med ett annat papper) går.
    const changed = applyEdit(back, { type: "SET_PRINT_AREA", course, area: { ...read.printArea!, page: { ...page, landscape: false } } }).document;
    expect(changed.courses.find(row => row.id === course)!.printArea).toEqual({ automatic: true, restrictToPageSize: true, page: { ...page, landscape: false } });
  });

  it("en fast tryckyta läses som förut, och en automatisk med {0,0,0,0} ur en äldre import kan ändras", () => {
    const { course, edit } = documentWith(10000);
    const rect = { minX: -5, minY: -10, maxX: 70, maxY: 40 };
    const document = edit({ type: "SET_PRINT_AREA", course, area: { automatic: false, restrictToPageSize: false, rect } });
    expect(roundTrip(document).courses.find(row => row.id === course)!.printArea).toEqual({ automatic: false, restrictToPageSize: false, rect });
    const old = applyEdit(document, { type: "SET_PRINT_AREA", course, area: { automatic: true, restrictToPageSize: true, rect: { minX: 0, minY: 0, maxX: 0, maxY: 0 } } }).document;
    expect(old.courses.find(row => row.id === course)!.printArea).toEqual({ automatic: true, restrictToPageSize: true });
    expect(() => applyEdit(document, { type: "SET_PRINT_AREA", course, area: { automatic: false, restrictToPageSize: true, rect: { minX: 0, minY: 0, maxX: 0, maxY: 0 } } }))
      .toThrow("Tryckytan är ingen rektangel");
  });
});

describe("banans <options> i .ppen (B10)", () => {
  it("utan banans skala: print-scale blir kartans (1:10 000), stigning och längd finns kvar", () => {
    const { course, edit } = documentWith(10000);
    const document = edit({ type: "UPDATE_COURSE", course, changes: { printScale: null, climbMeters: 85, lengthOverrideMeters: 4300 } });
    expect(document.courses.find(row => row.id === course)!.printScale).toBeUndefined();
    const xml = writePpen(document);
    const options = xml.match(/<course id="[^"]+"[^>]*>[\s\S]*?<options [^>]*\/>/)?.[0] ?? "";
    expect(options).toMatch(/print-scale="10000"/);
    expect(options).toMatch(/climb="85"/);
    expect(options).toMatch(/course-length="4300"/);
    const read = roundTrip(document).courses.find(row => row.id === course)!;
    expect(read).toMatchObject({ printScale: 10000, climbMeters: 85, lengthOverrideMeters: 4300 });
  });

  it("score-column och andra okända attribut i <options> följer med också utan banans skala", () => {
    const { course, edit } = documentWith(10000);
    let document = edit({ type: "UPDATE_COURSE", course, changes: { printScale: 7500, climbMeters: 40 } });
    document = readPpen(writePpen(document).replace(/<options /, '<options score-column="B" ')).document;
    document = applyEdit(document, { type: "UPDATE_COURSE", course, changes: { printScale: null } }).document;
    const xml = writePpen(document);
    expect(xml).toMatch(/<options [^>]*score-column="B"/);
    expect(xml).toMatch(/<options [^>]*print-scale="10000"/);
    expect(xml).toMatch(/<options [^>]*climb="40"/);
  });
});
