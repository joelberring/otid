import { describe, expect, it } from "vitest";
import {
  applyEdit, BUILT_IN_SHEET_LAYOUTS, circleArcs, layoutCoursePage, layoutOverprint, printSheetGroups, sheetLayoutSheets, sheetOfPage,
  type SheetItem
} from "../src";
import { lineCourse } from "./build";

/** Översynen 2026-11-02: arkvalet och ringens bågar finns på ett ställe för förhandsvisningen och PDF:en. */
describe("printSheetGroups", () => {
  it("en sida per bana som layoutCoursePage, grupperad per bana med sidorna", () => {
    const { b, course } = lineCourse(3);
    const items = [{ course }, { course: "ALL_CONTROLS" }];
    const groups = printSheetGroups(b.document, { kind: "COURSE", header: true }, items);
    expect(groups.map(group => group.item)).toEqual([0, 1]);
    expect(groups[0]!.sheets).toEqual(layoutCoursePage(b.document, { course, header: true }).map(sheetOfPage));
    expect(groups[0]!.pages!.length).toBe(groups[0]!.sheets.length);
  });

  it("en bana som inte går: onError med banans plats, de andra kommer med; utan onError kastas felet", () => {
    const { b, course } = lineCourse(2);
    const items = [{ course: "finns-inte" }, { course }];
    const failed: (number | undefined)[] = [];
    const groups = printSheetGroups(b.document, { kind: "COURSE" }, items, { onError: ({ item }) => failed.push(item) });
    expect(failed).toEqual([0]);
    expect(groups.map(group => group.item)).toEqual([1]);
    expect(() => printSheetGroups(b.document, { kind: "COURSE" }, items)).toThrow();
  });

  it("mallen: alla banor i ramarna (en grupp) eller en löpare per ark", () => {
    const { b, course } = lineCourse(2);
    const template = BUILT_IN_SHEET_LAYOUTS[0]!;
    const all = printSheetGroups(b.document, { kind: "TEMPLATE", template }, [{ course }, { course }]);
    expect(all).toHaveLength(1);
    expect(all[0]!.item).toBeUndefined();
    const perRunner = printSheetGroups(b.document, { kind: "TEMPLATE", template, perRunner: true }, [{ course }, { course }]);
    expect(perRunner.map(group => group.item)).toEqual([0, 1]);
  });

  it("en karta per löpare på banans eget papper: liggande bana blir liggande, med samma papper som banans utskrift", () => {
    const { b, course } = lineCourse(2);
    const landscape = { ...b.document, courses: b.document.courses.map(row => row.id === course ? { ...row, printArea: { automatic: true,
      restrictToPageSize: true, page: { width: 827, height: 1169, margins: 0, landscape: true } } } : row) };
    const strip = BUILT_IN_SHEET_LAYOUTS.find(row => row.id === "a4-strip")!;
    const own = printSheetGroups(landscape, { kind: "TEMPLATE", template: strip, perRunner: true, ownPage: true }, [{ course }]);
    const paper = own[0]!.sheets[0]!.paper;
    expect(paper.widthMm).toBeGreaterThan(paper.heightMm);
    expect(paper).toEqual(layoutCoursePage(landscape, { course }).map(sheetOfPage)[0]!.paper);
    // Utan `ownPage` gäller mallens A4 stående (som förut, när mallen är vald).
    const fixed = printSheetGroups(landscape, { kind: "TEMPLATE", template: strip, perRunner: true }, [{ course }]);
    expect(fixed[0]!.sheets[0]!.paper.heightMm).toBeGreaterThan(fixed[0]!.sheets[0]!.paper.widthMm);
  });

  it("upprepade löparark delar cachad layout med identisk utdata och bevarade löpartexter", () => {
    const { b, course, controls } = lineCourse(3);
    const at = b.cc(course, controls[0]!);
    b.edit({ type: "ADD_SPLIT", course, at, kind: "FORK", branches: 2 });
    const [branchA, branchB] = b.document.courseControls[at]!.split!.branches;
    b.insert(course, b.control("NORMAL", 10, 15), branchA);
    b.insert(course, b.control("NORMAL", 10, -15), branchB);

    const strip = BUILT_IN_SHEET_LAYOUTS.find(row => row.id === "a4-strip")!;
    const runners: SheetItem[] = Array.from({ length: 12 }, (_, index) => ({
      course,
      variant: index % 2 === 0 ? "A" : "B",
      runner: { kind: "RUNNER", name: `Löpare ${index + 1}`, club: "OK Test", className: "H21", startTime: `10:${String(index).padStart(2, "0")}`, startNumber: index + 1 }
    }));

    const groups = printSheetGroups(b.document, { kind: "TEMPLATE", template: strip, perRunner: true, duplex: true }, runners);
    expect(groups).toHaveLength(12);
    const firstA = groups[0]!.sheets[0]!.frames[0]!.figures;
    const firstB = groups[1]!.sheets[0]!.frames[0]!.figures;
    expect(firstA).not.toBe(firstB);
    expect(firstA).toBe(layoutOverprint(b.document, { course, variant: "A" }));
    expect(firstB).toBe(layoutOverprint(b.document, { course, variant: "B" }));
    for (let i = 0; i < runners.length; i++) {
      const sheet = groups[i]!.sheets[0]!;
      expect(sheet.frames[0]!.figures).toBe(i % 2 === 0 ? firstA : firstB);
      expect(sheet.texts.some(t => t.text.includes(`Löpare ${i + 1}`))).toBe(true);
    }

    // Även sheetLayoutSheets i FILL-läge återanvänder samma cachade figurer för samma variant.
    const filled = sheetLayoutSheets(b.document, strip, runners);
    expect(filled).toHaveLength(12);
    expect(filled[0]!.frames[0]!.figures).toBe(firstA);
    expect(filled[2]!.frames[0]!.figures).toBe(firstA);
    expect(filled[1]!.frames[0]!.figures).toBe(firstB);
    expect(filled[3]!.frames[0]!.figures).toBe(firstB);

    // Varvade layouter (MAIN / egen layout) i printSheetGroups återanvänder projektion och layout-memo.
    const withLayout = applyEdit(b.document, {
      type: "ADD_LAYOUT",
      layout: { id: "sprint", name: "1:7 500", scale: 7500, page: { width: 827, height: 1169, margins: 28, landscape: false } }
    }).document;
    const interleaved: SheetItem[] = [
      { course, variant: "A", layout: "MAIN" },
      { course, variant: "A", layout: "sprint" },
      { course, variant: "A", layout: "MAIN" },
      { course, variant: "A", layout: "sprint" }
    ];
    const mixed = printSheetGroups(withLayout, { kind: "COURSE" }, interleaved);
    expect(mixed[0]!.sheets[0]!.frames[0]!.figures).toBe(mixed[2]!.sheets[0]!.frames[0]!.figures);
    expect(mixed[1]!.sheets[0]!.frames[0]!.figures).toBe(mixed[3]!.sheets[0]!.frames[0]!.figures);
    expect(mixed[0]!.sheets[0]!.frames[0]!.figures).not.toBe(mixed[1]!.sheets[0]!.frames[0]!.figures);
  });
});

describe("circleArcs", () => {
  it("bågarna mellan avbrotten, hela ringen utan avbrott", () => {
    expect(circleArcs(undefined)).toEqual([[0, 360]]);
    expect(circleArcs([{ startDegrees: 80, endDegrees: 100 }])).toEqual([[100, 440]]);
  });
});
