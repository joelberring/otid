import { PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { applyEdit, BUILT_IN_PRINT_PROFILES, BUILT_IN_SHEET_LAYOUTS, printSheetGroups, readPpen, type CourseSettingDocument, type RunnerInfo } from "@o-tid/course-setting";
import { writeSheetsPdf } from "../src";
import { fixture, fontFiles, parsePdf } from "./helpers";

/**
 * ADR-0213: en karta per löpare med baksidan i samma PDF för tre löpare: sex sidor fram, bak, fram, bak, fram, bak. Framsidan
 * har kartramen och banan, baksidan bara papperets texter (löparens uppgifter) på samma papper; PDF:en föreslår vändning på
 * långsidan för stående ark (kortsidan för liggande).
 */
describe("en karta per löpare med baksidan i samma PDF", () => {
  it("tre löpare: framsida och baksida i följd, baksidan med löparens texter", async () => {
    let document: CourseSettingDocument = readPpen(new TextDecoder().decode(fixture("course-setting/kartfil.ppen"))).document;
    const course = [...document.courses].sort((a, b) => a.order - b.order)[0]!.id;
    document = applyEdit(document, { type: "SET_PAPER_LAYOUT", course, layout: { items: [
      { id: "t", kind: "TEXT", at: { corner: "TOP_LEFT", x: 2, y: 2 }, text: "{namn} {startnummer}", sizeMm: 5, widthMm: 80, bold: true }] } }).document;
    const runner = (name: string, startNumber: number): RunnerInfo => ({ kind: "RUNNER", name, club: "OK Natt", className: "H21", startTime: "18:3" + startNumber,
      startNumber, entryId: `e${startNumber}` });
    const items = [runner("Ada Ek", 1), runner("Bo Lind", 2), runner("Cia Holm", 3)].map(item => ({ course, runner: item }));
    const template = BUILT_IN_SHEET_LAYOUTS.find(item => item.id === "a4-one")!;
    const sheets = printSheetGroups(document, { kind: "TEMPLATE", template, perRunner: true, duplex: true }, items).flatMap(group => group.sheets);
    expect(sheets.map(sheet => (sheet.back ? "b" : "f") + (sheet.frames[0]?.runner?.startNumber ?? ""))).toEqual(["f1", "b", "f2", "b", "f3", "b"]);
    const result = await writeSheetsPdf({ sheets, map: null, profile: BUILT_IN_PRINT_PROFILES.find(item => item.id === "office")!, mode: "OFFICE", fonts: fontFiles() });
    expect(result.pages).toBe(6);
    const pdf = await parsePdf(result.bytes);
    pdf.pages.forEach((page, index) => {
      expect(page.size).toEqual(pdf.pages[0]!.size);
      const texts = (page.content.match(/BT /g) ?? []).length;
      if (index % 2 === 0) {
        // Framsidan: kartramen (klippningen) och löparens text.
        expect(page.content, `sida ${index + 1}`).toMatch(/re W n/);
        expect(texts).toBeGreaterThanOrEqual(1);
      } else {
        // Baksidan: ingen karta, löparens uppgifter (startnummer, namn, klubb, klass och starttid).
        expect(page.content, `sida ${index + 1}`).not.toMatch(/re W n/);
        expect(texts).toBeGreaterThanOrEqual(4);
      }
    });
    const loaded = await PDFDocument.load(result.bytes);
    expect(String(loaded.catalog.lookup(PDFName.of("ViewerPreferences")))).toContain("DuplexFlipLongEdge");
  });
});
