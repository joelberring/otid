import { describe, expect, it } from "vitest";
import { BUILT_IN_SHEET_LAYOUTS, circleArcs, layoutCoursePage, printSheetGroups, sheetOfPage } from "../src";
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
});

describe("circleArcs", () => {
  it("bågarna mellan avbrotten, hela ringen utan avbrott", () => {
    expect(circleArcs(undefined)).toEqual([[0, 360]]);
    expect(circleArcs([{ startDegrees: 80, endDegrees: 100 }])).toEqual([[100, 440]]);
  });
});
