import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyEdit, BUILT_IN_PRINT_PROFILES, printSheetGroups, readPpen, type CourseSettingDocument } from "@o-tid/course-setting";
import { readMapFile } from "@o-tid/map-file";
import { writeSheetsPdf } from "../src";
import { fixture, fontFiles, parsePdf } from "./helpers";

/** Bingoorientering (ägaren 2026-11-15): en grupp utan kontroller med rutnätet och rutornas namn i banans lila. */
const base: CourseSettingDocument = readPpen(new TextDecoder().decode(fixture("course-setting/kartfil.ppen"))).document;
const ocd = readMapFile(fixture("maps/kartfil.ocd"), "kartfil.ocd");
const profile = BUILT_IN_PRINT_PROFILES.find(item => item.id === "as-file")!;

describe("PDF med bingons rutnät", () => {
  it("gruppens karta har rutnätet och namnen, kartan runt rutnätet", async () => {
    const bounds = ocd.bounds!;
    const cx = (bounds.minX + bounds.maxX) / 2, cy = (bounds.minY + bounds.maxY) / 2;
    let document = applyEdit(base, { type: "ADD_COURSE", name: "Gröna" }).document;
    const course = document.courses[document.courses.length - 1]!.id;
    document = applyEdit(document, { type: "PUT_TRAINING", courses: { [course]: { outside: { kind: "FULL" }, sections: [],
      bingo: { area: { minX: cx - 40, minY: cy - 30, maxX: cx + 40, maxY: cy + 30 }, cellMeters: 100 } } } }).document;
    const sheets = printSheetGroups(document, { kind: "COURSE", header: true }, [{ course }], { mapBounds: bounds }).flatMap(group => group.sheets);
    const result = await writeSheetsPdf({ sheets, map: ocd, profile, mode: "PRESS", fonts: fontFiles(), descriptionStandard: "2018", title: "Bingo",
      now: new Date("2026-11-15T10:00:00Z") });
    if (process.env.OTID_BINGO_PDF_OUT) writeFileSync(process.env.OTID_BINGO_PDF_OUT, result.bytes);
    const pdf = await parsePdf(result.bytes);
    expect(pdf.pages).toHaveLength(1);
    expect(result.bytes.length).toBeGreaterThan(1000);
  });
});
