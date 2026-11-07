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
});

describe("circleArcs", () => {
  it("bågarna mellan avbrotten, hela ringen utan avbrott", () => {
    expect(circleArcs(undefined)).toEqual([[0, 360]]);
    expect(circleArcs([{ startDegrees: 80, endDegrees: 100 }])).toEqual([[100, 440]]);
  });
});
