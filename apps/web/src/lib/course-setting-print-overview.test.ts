import { applyEdit, emptyDocument, printSheetGroups, type CourseSettingDocument, type CourseSettingEdit } from "@o-tid/course-setting";
import { describe, expect, it } from "vitest";
import { courseOutsideFrame, paperText, sheetCards } from "./course-setting-print-overview";

function documentWithCourse(): { document: CourseSettingDocument; course: string } {
  let document = emptyDocument({ title: "Översikt", mapScale: 10000 });
  const edit = (change: CourseSettingEdit) => { const result = applyEdit(document, change); document = result.document; return result.created ?? ""; };
  const start = edit({ type: "ADD_CONTROL", kind: "START", at: { x: 10, y: 10 } });
  const control = edit({ type: "ADD_CONTROL", kind: "NORMAL", at: { x: 40, y: 30 }, code: "31" });
  const finish = edit({ type: "ADD_CONTROL", kind: "FINISH", at: { x: 70, y: 10 } });
  const course = edit({ type: "ADD_COURSE", name: "A" });
  for (const id of [start, control, finish]) edit({ type: "INSERT_COURSE_CONTROL", course, control: id });
  return { document, course };
}

describe("översiktens kort (ADR-0211 beslut 7)", () => {
  it("papperets namn och riktning", () => {
    expect(paperText({ widthMm: 297, heightMm: 210, landscape: true, marginMm: 7 })).toBe("A4 liggande");
    expect(paperText({ widthMm: 297, heightMm: 420, landscape: false, marginMm: 7 })).toBe("A3 stående");
    expect(paperText({ widthMm: 100, heightMm: 150, landscape: false, marginMm: 0 })).toBe("100 × 150 mm");
  });

  it("banan utanför ramen märks", () => {
    const figures = [{ kind: "circle", role: "CONTROL", color: "COURSE", center: { x: 1, y: 50 }, diameter: 6, lineWidth: 0.35 }] as never;
    expect(courseOutsideFrame(figures, { minX: 0, minY: 0, maxX: 100, maxY: 100 })).toBe(true);
    expect(courseOutsideFrame(figures, { minX: -10, minY: -10, maxX: 100, maxY: 100 })).toBe(false);
  });

  it("ett kort per ark med skala och mallens namn; ändrad för banan när banan har egna element", () => {
    const { document: base, course } = documentWithCourse();
    let document = applyEdit(base, { type: "PUT_PAPER_TEMPLATE", template: { schemaVersion: 1, id: "t1", name: "Natt A4", items: [] } }).document;
    document = applyEdit(document, { type: "SET_PAPER_LAYOUT", course, layout: { template: "t1" } }).document;
    const sheets = printSheetGroups(document, { kind: "COURSE" }, [{ course }]).flatMap(group => group.sheets).map((sheet, index) => ({ key: `k${index}`, sheet, label: "A" }));
    const [card] = sheetCards(document, sheets);
    expect(card).toMatchObject({ course, scale: 10000, paperTemplate: "Natt A4", changed: false });
    document = applyEdit(document, { type: "SET_PAPER_LAYOUT", course, layout: { template: "t1", items: [
      { id: "x", kind: "TEXT", at: { corner: "TOP_LEFT", x: 1, y: 1 }, text: "Hej", sizeMm: 4, widthMm: 30 }] } }).document;
    const changed = printSheetGroups(document, { kind: "COURSE" }, [{ course }]).flatMap(group => group.sheets).map((sheet, index) => ({ key: `k${index}`, sheet, label: "A" }));
    expect(sheetCards(document, changed)[0]!.changed).toBe(true);
  });
});
