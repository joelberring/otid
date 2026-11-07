import { describe, expect, it } from "vitest";
import type { MapBundleResponse } from "@o-tid/contracts";
import { applyEdit, layoutDocument, MAIN_LAYOUT, type CourseSettingDocument, type CourseSettingEdit } from "@o-tid/course-setting";
import { classRows, layoutMatrix, newLayout, sheetEdits } from "./course-setting-layouts";
import { testDocument } from "./course-setting-test-document";

/** ADR-0217: Layout-flikens överblick, klasstabell och ändringarna på ett ark i en annan layout. */
const apply = (document: CourseSettingDocument, ...edits: CourseSettingEdit[]) => edits.reduce((doc, edit) => applyEdit(doc, edit).document, document);
const A4 = { width: 827, height: 1169, margins: 28, landscape: false };
const setup = () => apply(testDocument(), { type: "ADD_LAYOUT", layout: { id: "aldre", name: "Äldre A4", scale: 7500, page: A4 } });

const bundles = {
  reserve: { kind: "COUNT", value: 1 },
  classes: [{ classId: "00000000-0000-4000-8000-000000000001", name: "H70", courseName: "Lång", variantCodes: [], startMode: "MINUTE" },
    { classId: "00000000-0000-4000-8000-000000000002", name: "H21", courseName: "Lång", variantCodes: [], startMode: "MINUTE" }],
  rows: [{ className: "H70", courseName: "Lång", variantCode: null }, { className: "H70", courseName: "Lång", variantCode: null },
    { className: "H21", courseName: "Lång", variantCode: null }]
} as unknown as Pick<MapBundleResponse, "classes" | "rows" | "reserve">;

describe("överblicken", () => {
  it("huvudlayouten har alla banor; en annan layout har ark för klassernas banor, med anmälda och reserver", () => {
    let document = setup();
    expect(layoutMatrix(document, bundles, "Huvudlayout").rows[0]!.cells.map(cell => [cell.layout, cell.exists])).toEqual([[MAIN_LAYOUT, true], ["aldre", false]]);
    document = apply(document, { type: "SET_CLASS_LAYOUTS", classes: { H70: "aldre" } });
    const [main, old] = layoutMatrix(document, bundles, "Huvudlayout").rows[0]!.cells;
    expect(main).toMatchObject({ exists: true, classes: ["H21"], entered: 1, reserves: 1, scale: 10000, status: "FITS" });
    expect(old).toMatchObject({ exists: true, classes: ["H70"], entered: 2, reserves: 1, scale: 7500, paper: "A4 stående", adjustments: 0 });
  });

  it("eget utsnitt och justeringar syns i rutan", () => {
    const document = apply(setup(), { type: "PUT_LAYOUT_SHEET", layout: "aldre", course: "k", sheet: {} },
      { type: "SET_PRINT_AREA", course: "k", printLayout: "aldre", area: { automatic: false, restrictToPageSize: true, rect: { minX: -20, minY: -20, maxX: 40, maxY: 30 } } },
      { type: "MOVE_NUMBER", course: "k", courseControl: "c2", at: { x: 12, y: 3 }, printLayout: "aldre" });
    const old = layoutMatrix(document, undefined, "Huvudlayout").rows[0]!.cells[1]!;
    expect(old).toMatchObject({ exists: true, status: "OWN_AREA", adjustments: 1 });
  });

  it("klasstabellen: en rad per klass med layouten", () => {
    const document = apply(setup(), { type: "SET_CLASS_LAYOUTS", classes: { H70: "aldre" } });
    expect(classRows(document, bundles)).toEqual([{ name: "H21", courseNames: ["Lång"], layout: MAIN_LAYOUT }, { name: "H70", courseNames: ["Lång"], layout: "aldre" }]);
  });
});

describe("ändringarna på arket", () => {
  it("papperet och ramen sparas på arket; ett nytt papper ändrar layouten; huvudlayouten oförändrad", () => {
    const document = setup();
    const projected = layoutDocument(document, "aldre");
    const area = { ...projected.courses[0]!.printArea!, page: { ...A4, landscape: true } };
    const edits = sheetEdits(document, "aldre", [{ type: "SET_PRINT_AREA", course: "k", area },
      { type: "SET_PAPER_LAYOUT", course: "k", layout: { items: [{ id: "t", kind: "TEXT", at: { corner: "TOP_LEFT", x: 1, y: 1 }, text: "Äldre", sizeMm: 4, widthMm: 20 }] } }]);
    expect(edits.map(edit => edit.type)).toEqual(["UPDATE_LAYOUT", "SET_PRINT_AREA", "SET_PAPER_LAYOUT"]);
    const after = apply(document, ...edits);
    expect(after.event.layouts![0]!.page.landscape).toBe(true);
    expect(after.event.layoutSheets!.aldre!.k!.paper?.items).toHaveLength(1);
    expect(after.courses[0]!.printArea).toBeUndefined();
    expect(after.event.paperLayouts).toBeUndefined();
    const same: CourseSettingEdit[] = [{ type: "SET_PRINT_AREA", course: "k", area: null }];
    expect(sheetEdits(document, MAIN_LAYOUT, same)).toEqual(same);
  });

  it("en ny layout har ett eget id, kartans skala och A4", () => {
    const document = setup();
    let n = 0;
    const layout = newLayout(document, "Elit", () => (n++ === 0 ? "aldre".slice(0) : "x1"));
    expect(layout).toMatchObject({ name: "Elit", scale: 10000, page: A4 });
    expect(layout.id).toMatch(/^l-/);
  });
});
