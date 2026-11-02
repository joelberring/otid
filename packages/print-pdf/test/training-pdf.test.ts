import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyEdit, BUILT_IN_PRINT_PROFILES, presetFilter, printSheetGroups, readPpen, type CourseSettingDocument, type CourseTraining, type Sheet
} from "@o-tid/course-setting";
import { readMapFile } from "@o-tid/map-file";
import { writeSheetsPdf } from "../src";
import { fixture, fontFiles, parsePdf } from "./helpers";

/**
 * Träningsläget i PDF:en (ADR-0192 beslut 9): kartan i pass med klippning och filter i kartlagret, samma dekorfärger, banan
 * överst och inga vita fält över banpåtrycket. Kartfilen är fixturens påhittade karta.
 */
const fonts = fontFiles();
const base: CourseSettingDocument = readPpen(new TextDecoder().decode(fixture("course-setting/kartfil.ppen"))).document;
const ocd = readMapFile(fixture("maps/kartfil.ocd"), "kartfil.ocd");
const profile = BUILT_IN_PRINT_PROFILES.find(item => item.id === "as-file")!;

const corridorTraining: CourseTraining = {
  outside: { kind: "FILTER", filter: presetFilter("CONTOURS") },
  sections: [{ id: "k", from: null, to: null, form: "CORRIDOR", corridor: { shape: "ANGULAR", widthMeters: 80, smoothing: 0 }, filter: presetFilter("ALL"),
    marker: { kind: "NONE" } }]
};

function sheetsFor(document: CourseSettingDocument): Sheet[] {
  return printSheetGroups(document, { kind: "COURSE", header: true }, [{ course: "1" }], { mapBounds: ocd.bounds ?? undefined }).flatMap(group => group.sheets);
}

async function pdfOf(document: CourseSettingDocument) {
  const result = await writeSheetsPdf({ sheets: sheetsFor(document), map: ocd, profile, mode: "PRESS", fonts, descriptionStandard: "2018", title: "Träning",
    now: new Date("2026-11-02T10:00:00Z") });
  return { result, pdf: await parsePdf(result.bytes) };
}

describe("PDF med träningen (ADR-0192)", () => {
  it("korridor med bara kurvbild utanför: passen klipps i kartans utsnitt, dekorfärgerna och banan som utan träning", async () => {
    const plain = await pdfOf(base);
    const document = applyEdit(base, { type: "PUT_TRAINING", courses: { "1": corridorTraining },
      attackPoints: { t1: { id: "t1", from: "1", to: "2", at: { x: 0, y: 0 } } } }).document;
    const sheets = sheetsFor(document);
    expect(sheets[0]!.frames[0]!.mapPasses).toHaveLength(2);
    const { result, pdf } = await pdfOf(document);
    if (process.env.OTID_TRAINING_PDF_OUT) writeFileSync(process.env.OTID_TRAINING_PDF_OUT, result.bytes);
    expect(result.plates).toEqual(plain.result.plates);
    expect(result.overprint).toBe(plain.result.overprint);
    const form = [...pdf.forms.values()][0]!;
    // Två pass: inom korridoren (jämn–udda) och utanför (ram + korridor, jämn–udda); papperets vitt bara en gång.
    const clips = (text: string) => (text.match(/W\* n/g) ?? []).length;
    expect(clips(form) - clips([...plain.pdf.forms.values()][0]!)).toBe(2);
    expect((form.match(/ h f\n?/g) ?? []).length).toBe((([...plain.pdf.forms.values()][0]!).match(/ h f\n?/g) ?? []).length);
    // Utanför korridoren ritas inte vegetationen: färre ytor och linjer än två hela kartor.
    const paths = (text: string) => (text.match(/ (f|f\*|S)\n/g) ?? []).length;
    expect(paths(form)).toBeLessThan(2 * paths([...plain.pdf.forms.values()][0]!));
    // Banpåtrycket ligger efter kartan på sidan och har inga vita fält (knockout-ytor) över sig.
    const page = pdf.pages[0]!.content;
    expect(page.indexOf(" Do")).toBeLessThan(page.lastIndexOf(" SCN"));
    expect(page.split(/\/Fm\d+ Do/)[1]).not.toMatch(/0 0 0 0 k\n[^\n]* re f/);
  });

  it("kartbitar: en ram per sträcka på A4 med passen och banans figurer bara för sträckan", async () => {
    const document = applyEdit(base, { type: "PUT_TRAINING", courses: { "1": { ...corridorTraining, pieces: { sizeMm: 60, marginMeters: 40, order: "COURSE" } } } }).document;
    const sheets = printSheetGroups(document, { kind: "PIECES" }, [{ course: "1" }], { mapBounds: ocd.bounds ?? undefined }).flatMap(group => group.sheets);
    expect(sheets.length).toBeGreaterThan(0);
    const frames = sheets.flatMap(sheet => sheet.frames);
    for (const frame of frames) {
      expect(frame.clip.width).toBe(60);
      expect(frame.mapPasses).toBeDefined();
      const points = frame.figures.filter(figure => figure.role === "CONTROL" || figure.role === "START" || figure.role === "FINISH");
      expect(new Set(points.map(figure => figure.ref)).size).toBe(2);
    }
    const { result } = await writeSheetsPdf({ sheets, map: ocd, profile, mode: "PRESS", fonts, descriptionStandard: "2018", title: "Bitar" })
      .then(async out => ({ result: out, pdf: await parsePdf(out.bytes) }));
    if (process.env.OTID_TRAINING_PIECES_OUT) writeFileSync(process.env.OTID_TRAINING_PIECES_OUT, result.bytes);
    expect(result.pages).toBe(sheets.length);
    expect(result.mapForms).toBe(frames.length);
  });
});
