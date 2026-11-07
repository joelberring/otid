import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readCourseLayout } from "@o-tid/iof-xml";
import { applyEdit, courseDataDocument, emptyDocument, printScaleOf, readPpen, writeIofCourseData, writePpen } from "../src";

/** ADR-0211 beslut 5: saknad skala för banan är kartans; en ny eller inläst bana får inget förval inskrivet. */
describe("banans skala: saknas = kartans skala", () => {
  it("en ny bana har ingen skala och följer kartans", () => {
    const { document, created } = applyEdit(emptyDocument({ title: "Test", mapScale: 10000 }), { type: "ADD_COURSE", name: "A" });
    const course = document.courses.find(row => row.id === created)!;
    expect(course.printScale).toBeUndefined();
    expect(printScaleOf(document, course.id)).toBe(10000);
    expect(printScaleOf({ ...document, event: { ...document.event, mapScale: 7500 } }, course.id)).toBe(7500);
  });

  it("en bana ur en banfil har ingen skala", () => {
    const ppen = readPpen(readFileSync(fileURLToPath(new URL("../../../fixtures/course-setting/gaffling-urval.ppen", import.meta.url)), "utf8")).document;
    const { document } = courseDataDocument(readCourseLayout(writeIofCourseData(ppen, { mapBounds: { minX: -10, minY: -10, maxX: 120, maxY: 100 } })), {});
    expect(document.courses.length).toBeGreaterThan(0);
    for (const course of document.courses) {
      expect(course.printScale).toBeUndefined();
      expect(printScaleOf(document, course.id)).toBe(document.event.mapScale);
    }
  });

  it(".ppen: en bana utan skala skrivs med kartans skala (Purple Pen läser saknad skala som 1:15 000), läses tillbaka utan skala", () => {
    const added = applyEdit(emptyDocument({ title: "Test", mapScale: 10000 }), { type: "ADD_COURSE", name: "A" });
    const document = applyEdit(added.document, { type: "UPDATE_COURSE", course: added.created!, changes: { climbMeters: 85 } }).document;
    const written = writePpen(document);
    expect(written).toMatch(/<options [^>]*print-scale="10000"/);
    expect(written).toMatch(/<options [^>]*climb="85"/);
    const read = readPpen(written).document;
    expect(read.courses[0]!.climbMeters).toBe(85);
    expect(read.courses[0]!.printScale).toBeUndefined();
    expect(read).toEqual(readPpen(writePpen(read)).document);
  });

  it(".ppen: print-scale lika med kartans läses som saknad, och Purple Pen får tillbaka exakt samma <options>", () => {
    const xml = readFileSync(fileURLToPath(new URL("../../../fixtures/course-setting/gaffling-urval.ppen", import.meta.url)), "utf8");
    const options = (text: string) => text.match(/<options [^>]*\/>/g);
    expect(options(xml)).toEqual(['<options print-scale="10000" description-kind="symbols" />', '<options print-scale="10000" description-kind="symbols" />']);
    const { document } = readPpen(xml);
    for (const course of document.courses) {
      expect(course.printScale).toBeUndefined();
      expect(printScaleOf(document, course.id)).toBe(10000);
    }
    expect(options(writePpen(document))).toEqual(options(xml));
    // En annan skala än kartans står kvar.
    const other = readPpen(xml.replace('<options print-scale="10000"', '<options print-scale="7500"')).document;
    expect(other.courses.map(course => course.printScale)).toEqual([7500, undefined]);
    expect(writePpen(other)).toContain('<options print-scale="7500" description-kind="symbols" />');
  });
});
