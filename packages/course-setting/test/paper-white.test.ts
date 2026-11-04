/** ADR-0211 beslut 8 och 5: "Vitt på utskriften", ramar och linjer, mallens papper och banans skala. */
import { describe, expect, it } from "vitest";
import {
  applyEdit, effectivePaper, layoutOverprint, paperTemplateFromCourse, printSheetGroups, readPpen, validatePaperItem, writePpen, type OverprintPrimitive
} from "../src";
import { lineCourse } from "./build";

const rect = (x: number, y: number, width: number, height: number) => ({ shape: "RECT" as const, rect: { x, y, width, height } });

describe("vitt på utskriften", () => {
  it("ytorna står på ramen i papperets mm; punktmarkeringar i ytan tas bort, banan står hel", () => {
    const { b, course } = lineCourse(2, { mapScale: 10000 });
    const water = b.edit({ type: "ADD_SPECIAL", special: { kind: "water", courses: [], points: [{ x: 10, y: 0 }] } });
    b.edit({ type: "SET_PAPER_LAYOUT", course, layout: { whiteAreas: [rect(0, 0, 2000, 2000)] } });
    const frame = printSheetGroups(b.document, { kind: "COURSE" }, [{ course }])[0]!.sheets[0]!.frames[0]!;
    expect(frame.whiteAreas).toHaveLength(1);
    expect(frame.whiteAreas![0]![0]).toEqual({ x: frame.clip.x, y: frame.clip.y });
    expect(layoutOverprint(b.document, { course }).some(figure => figure.role === "SPECIAL" && figure.ref === water)).toBe(true);
    expect(frame.figures.some(figure => figure.role === "SPECIAL" && figure.ref === water)).toBe(false);
    const all = layoutOverprint(b.document, { course });
    const count = (list: readonly OverprintPrimitive[]) => list.filter(figure => figure.role !== "SPECIAL").length;
    expect(count(frame.figures)).toBe(count(all));
  });

  it("mallen bär ytorna och papperet; banans tomma lista stänger av mallens", () => {
    const { b, course } = lineCourse(1);
    b.edit({ type: "SET_PRINT_AREA", course, area: { automatic: true, restrictToPageSize: true, page: { width: 1169, height: 827, margins: 20, landscape: true } } });
    b.edit({ type: "SET_PAPER_LAYOUT", course, layout: { whiteAreas: [rect(1, 2, 30, 40)] } });
    const template = paperTemplateFromCourse(b.document, course, "t1", "Natt A4");
    expect(template.whiteAreas).toEqual([rect(1, 2, 30, 40)]);
    expect(template.page).toEqual({ width: 1169, height: 827, margins: 20, landscape: true });
    b.edit({ type: "PUT_PAPER_TEMPLATE", template });
    b.edit({ type: "SET_PAPER_LAYOUT", course, layout: { template: "t1" } });
    expect(effectivePaper(b.document, course)).toMatchObject({ whiteAreas: [rect(1, 2, 30, 40)], whiteSource: "TEMPLATE" });
    b.edit({ type: "SET_PAPER_LAYOUT", course, layout: { template: "t1", whiteAreas: [] } });
    expect(effectivePaper(b.document, course).whiteAreas).toEqual([]);
  });

  it("ram och linje: gränserna och delarna", () => {
    const at = { corner: "TOP_LEFT" as const, x: 0, y: 0 };
    expect(validatePaperItem({ id: "r", kind: "RECT", at, widthMm: 20, heightMm: 10, strokeMm: 0.5, color: "#FF0000", radiusMm: 2 }))
      .toEqual({ id: "r", kind: "RECT", at, widthMm: 20, heightMm: 10, strokeMm: 0.5, color: "#ff0000", radiusMm: 2 });
    expect(() => validatePaperItem({ id: "r", kind: "RECT", at, widthMm: 20, heightMm: 10, strokeMm: 0, color: "#000000" })).toThrow(/linje eller en fyllning/);
    expect(() => validatePaperItem({ id: "l", kind: "LINE", at, widthMm: 20, heightMm: 0, strokeMm: 0.3, color: "red" })).toThrow(/#rrggbb/);
    expect(validatePaperItem({ id: "l", kind: "LINE", at, widthMm: 20, heightMm: 0, strokeMm: 0.3, color: "#000000", locked: true, hide: true }))
      .toMatchObject({ locked: true, hide: true });
  });
});

describe("banans skala (ADR-0211 beslut 5)", () => {
  it("skalan i banans egenskaper styr ringarna och följer med .ppen", () => {
    const { b, course } = lineCourse(1, { mapScale: 15000 });
    const ring = (doc: typeof b.document) => (layoutOverprint(doc, { course }).find(figure => figure.kind === "circle" && figure.role === "CONTROL") as { diameter: number }).diameter;
    const before = ring(b.document);
    const scaled = applyEdit(b.document, { type: "UPDATE_COURSE", course, changes: { printScale: 10000 } }).document;
    // Purple Pens förval relativt 1:15 000: ringen har samma mått i kartan, alltså 150 % på papperet i 1:10 000 (ISOM 2017-2).
    const onPaper = (diameter: number, printScale: number) => diameter * 15000 / printScale;
    expect(onPaper(ring(scaled), 10000)).toBeCloseTo(onPaper(before, 15000) * 1.5, 6);
    const back = readPpen(writePpen(scaled)).document;
    expect(back.courses.find(item => item.id === course)!.printScale).toBe(10000);
    expect(ring(back)).toBeCloseTo(ring(scaled), 6);
  });
});
