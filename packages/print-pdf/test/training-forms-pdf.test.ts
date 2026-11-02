import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyEdit, BUILT_IN_PRINT_PROFILES, expandTrainingItems, presetFilter, printSheetGroups, readPpen, type CourseSettingDocument, type CourseSettingEdit,
  type SheetItem
} from "@o-tid/course-setting";
import { readMapFile } from "@o-tid/map-file";
import { writeSheetsPdf } from "../src";
import { fixture, fontFiles, parsePdf } from "./helpers";

/**
 * Formerna i PDF:en (ADR-0192 beslut 6–9) på fixturens påhittade karta: fönster med tonat utanför, stjärnans uddar, kepsens
 * gemensamma karta och A/B, linjeorienteringens löpar- och kontrollantkarta. Med `OTID_TRAINING_SHOTS_DIR` skrivs filerna dit.
 */
const fonts = fontFiles();
const base: CourseSettingDocument = readPpen(new TextDecoder().decode(fixture("course-setting/kartfil.ppen"))).document;
const ocd = readMapFile(fixture("maps/kartfil.ocd"), "kartfil.ocd");
const profile = BUILT_IN_PRINT_PROFILES.find(item => item.id === "as-file")!;
const out = process.env.OTID_TRAINING_SHOTS_DIR;

function edit(document: CourseSettingDocument, edits: readonly CourseSettingEdit[]): CourseSettingDocument {
  return edits.reduce((current, next) => applyEdit(current, next).document, document);
}

async function pdf(name: string, document: CourseSettingDocument, items: readonly SheetItem[]) {
  const sheets = printSheetGroups(document, { kind: "COURSE", header: true }, items, { mapBounds: ocd.bounds ?? undefined }).flatMap(group => group.sheets);
  const result = await writeSheetsPdf({ sheets, map: ocd, profile, mode: "PRESS", fonts, descriptionStandard: "2018", title: name });
  if (out) writeFileSync(join(out, `pdf-${name}.pdf`), result.bytes);
  return { sheets, result, parsed: await parsePdf(result.bytes) };
}

describe("träningsformerna i PDF:en (ADR-0192)", () => {
  it("fönster med tonat utanför: samma plåtar, tonen som lägre andel", async () => {
    const document = edit(base, [{ type: "PUT_TRAINING", courses: { "1": { outside: { kind: "TINT", lighten: 0.75 }, sections: [
      { id: "f", from: null, to: null, form: "WINDOW", window: { shape: "CIRCLE", radiusMeters: 60 }, filter: presetFilter("ALL"), marker: { kind: "NONE" } }] } } }]);
    const plain = await pdf("utan-traning", base, [{ course: "1" }]);
    const { result, parsed } = await pdf("fonster-tonat", document, [{ course: "1" }]);
    expect(result.plates).toEqual(plain.result.plates);
    // Kartans grön (76/0/91/0) finns både hel och tonad (25 %).
    const form = [...parsed.forms.values()][0]!;
    expect(form).toContain("0.76 0 0.91 0 k");
    expect(form).toContain("0.19 0 0.228 0 k");
  });

  it("stjärnan en karta per udd, kepsen gemensam och A/B, linjen för löparen och kontrollanten", async () => {
    // Stjärna: 31 i mitten, uddar 32, 33 och 34.
    const star = edit(base, [{ type: "ADD_COURSE", name: "Stjärna 31" },
      ...["3", "4", "5"].flatMap(spoke => [{ type: "INSERT_COURSE_CONTROL" as const, course: "3", control: "2" }, { type: "INSERT_COURSE_CONTROL" as const, course: "3", control: spoke }]),
      { type: "INSERT_COURSE_CONTROL", course: "3", control: "2" },
      { type: "PUT_TRAINING", courses: { "3": { outside: { kind: "FULL" }, sections: [], star: { center: "2", print: "PER_CONTROL" } } } }]);
    const spokes = expandTrainingItems(star, [{ course: "3" }]);
    expect(spokes).toHaveLength(3);
    expect((await pdf("stjarna-per-udd", star, spokes)).result.pages).toBe(3);

    const pairs = edit(base, [{ type: "PUT_TRAINING", courses: { "1": { outside: { kind: "FULL" }, sections: [],
      pairs: { pairs: [["2", "3"], ["4", "5"], ["6", "7"]], legs: false, print: "SEPARATE" } } } }]);
    expect((await pdf("keps-gemensam", pairs, [{ course: "1" }])).result.pages).toBe(1);
    expect((await pdf("keps-a-och-b", pairs, expandTrainingItems(pairs, [{ course: "1" }]))).result.pages).toBe(2);

    const line = edit(base, [{ type: "PUT_TRAINING", courses: { "1": { outside: { kind: "FULL" }, sections: [],
      line: { points: [{ x: 4, y: 8 }, { x: 20, y: 45 }, { x: 45, y: 58 }, { x: 78, y: 50 }, { x: 96, y: 32 }, { x: 80, y: 11 }, { x: 52, y: 20 }, { x: 12, y: 4 }] } } } }]);
    const both = expandTrainingItems(line, [{ course: "1" }], { controllerMaps: true });
    const { sheets } = await pdf("linje-lopare-och-kontrollant", line, both);
    expect(sheets).toHaveLength(2);
    expect(sheets[0]!.frames[0]!.figures.some(figure => figure.role === "CONTROL")).toBe(false);
    expect(sheets[1]!.frames[0]!.figures.some(figure => figure.role === "CONTROL")).toBe(true);
  });
});
