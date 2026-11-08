/** ADR-0217: layouter, ark (bana × layout), justeringar per skala och projektionen till utskriften. */
import { describe, expect, it } from "vitest";
import {
  applyEdit, classLayoutOf, editTouches, keepPaperOnImport, layoutAdjustments, layoutDocument, MAIN_LAYOUT, objectPatch, printSheetGroups, readPpen,
  writePpen, type CourseSettingDocument, type CourseSettingEdit, type OverprintPrimitive, type PrintLayout
} from "../src";
import { lineCourse } from "./build";

const A3_LANDSCAPE = { width: 1169, height: 1654, margins: 28, landscape: true };
const A4 = { width: 827, height: 1169, margins: 28, landscape: false };
const ELIT: PrintLayout = { id: "elit", name: "Elit A3", scale: 15000, page: A3_LANDSCAPE };
const OLD: PrintLayout = { id: "aldre", name: "Äldre A4", scale: 7500, page: A4 };

function setup() {
  const { b, course, controls } = lineCourse(3);
  b.edit({ type: "UPDATE_COURSE", course, changes: { printScale: 10000 } });
  b.edit({ type: "ADD_LAYOUT", layout: ELIT });
  b.edit({ type: "ADD_LAYOUT", layout: OLD });
  return { b, course, controls };
}

const apply = (document: CourseSettingDocument, ...edits: CourseSettingEdit[]) => edits.reduce((doc, edit) => applyEdit(doc, edit).document, document);
const numbers = (figures: readonly OverprintPrimitive[]) => figures.filter((item): item is Extract<OverprintPrimitive, { kind: "text" }> => item.kind === "text" && item.role === "NUMBER");
const firstFrame = (document: CourseSettingDocument, course: string, layout?: string) =>
  printSheetGroups(document, { kind: "COURSE" }, [{ course, ...(layout ? { layout } : {}) }])[0]!.sheets[0]!.frames[0]!;

describe("layouterna (ADR-0217)", () => {
  it("en bana i två layouter med olika skala ger två ark med layoutens skala och papper", () => {
    const { b, course } = setup();
    const groups = printSheetGroups(b.document, { kind: "COURSE" }, [{ course }, { course, layout: "elit" }, { course, layout: "aldre" }]);
    expect(groups.map(group => group.item)).toEqual([0, 1, 2]);
    const [main, elit, old] = groups.map(group => group.sheets[0]!);
    expect(main!.frames[0]!.printScale).toBe(10000);
    expect(elit!.frames[0]!.printScale).toBe(15000);
    expect(old!.frames[0]!.printScale).toBe(7500);
    // A3 liggande (420 × 297 mm) och A4 stående.
    expect(Math.round(elit!.paper.widthMm)).toBe(420);
    expect(elit!.paper.landscape).toBe(true);
    expect(Math.round(old!.paper.widthMm)).toBe(210);
    // Kartans mm per papperets mm följer layoutens skala (kartan 1:10 000).
    expect(main!.frames[0]!.transform.scale).toBeCloseTo(1, 6);
    expect(elit!.frames[0]!.transform.scale).toBeCloseTo(10000 / 15000, 6);
    expect(old!.frames[0]!.transform.scale).toBeCloseTo(10000 / 7500, 6);
  });

  it("utan layout eller med huvudlayouten är dokumentet och arken oförändrade", () => {
    const { b, course } = setup();
    expect(layoutDocument(b.document, undefined)).toBe(b.document);
    expect(layoutDocument(b.document, MAIN_LAYOUT)).toBe(b.document);
    expect(printSheetGroups(b.document, { kind: "COURSE" }, [{ course, layout: MAIN_LAYOUT }]))
      .toEqual(printSheetGroups(b.document, { kind: "COURSE" }, [{ course }]));
  });

  it("ett justerat nummer gäller bara layouten; resten följer banläggningen", () => {
    const { b, course, controls } = setup();
    const cc = b.cc(course, controls[1]!);
    const moved = apply(b.document, { type: "MOVE_NUMBER", course, courseControl: cc, at: { x: 25, y: 12 }, printLayout: "aldre" });
    const at = (layout?: string) => numbers(firstFrame(moved, course, layout).figures).find(item => item.ref === cc)!.at;
    expect(at("aldre")).toEqual({ x: 25, y: 12 });
    expect(at()).not.toEqual({ x: 25, y: 12 });
    expect(at("elit")).not.toEqual({ x: 25, y: 12 });
    // Banläggningen flyttar ett annat nummer: det följer med i layouten; det justerade står kvar.
    const other = b.cc(course, controls[0]!);
    const later = apply(moved, { type: "MOVE_NUMBER", course, courseControl: other, at: { x: 3, y: 9 } });
    expect(numbers(firstFrame(later, course, "aldre").figures).find(item => item.ref === other)!.at).toEqual({ x: 3, y: 9 });
    expect(numbers(firstFrame(later, course, "aldre").figures).find(item => item.ref === cc)!.at).toEqual({ x: 25, y: 12 });
    expect(layoutAdjustments(later, "aldre", course).numbers).toEqual([cc]);
    // Huvudlayoutens dokument har inga justeringar.
    expect(later.courseControls[cc]!.numberAt).toBeUndefined();
    // "Ta bort justeringar".
    const cleared = apply(later, { type: "CLEAR_LAYOUT_ADJUSTMENTS", layout: "aldre", course });
    expect(layoutAdjustments(cleared, "aldre", course).numbers).toEqual([]);
  });

  it("ringavbrott per layout: bara i den layouten, övriga följer banläggningen", () => {
    const { b, course, controls } = setup();
    const gapped = apply(b.document, { type: "SET_LAYOUT_CIRCLE_GAPS", layout: "aldre", control: controls[0]!, gaps: [{ startDegrees: 80, endDegrees: 100 }] });
    const ring = (layout?: string) => firstFrame(gapped, course, layout).figures.find(item => item.kind === "circle" && item.ref === b.cc(course, controls[0]!)) as
      Extract<OverprintPrimitive, { kind: "circle" }>;
    expect(ring("aldre").gaps?.length).toBeGreaterThan(0);
    expect(ring().gaps ?? []).toEqual([]);
    expect(ring("elit").gaps ?? []).toEqual([]);
    expect(layoutAdjustments(gapped, "aldre", course).circleGaps).toEqual([controls[0]]);
    expect(layoutAdjustments(gapped, "aldre", course)).toEqual({ numbers: [], circleGaps: [controls[0]], legGaps: [] });
  });

  it("arkets utsnitt och papper gäller bara arket; papperet ärver layoutens mall", () => {
    const { b, course } = setup();
    const template = { schemaVersion: 1 as const, id: "elitmall", name: "Elit", items: [{ id: "t1", kind: "TEXT" as const, at: { corner: "TOP_LEFT" as const, x: 2, y: 2 },
      text: "Elit {bana}", sizeMm: 5, widthMm: 50 }] };
    const doc = apply(b.document, { type: "PUT_PAPER_TEMPLATE", template },
      { type: "UPDATE_LAYOUT", layout: "elit", changes: { paperTemplate: "elitmall" } },
      { type: "SET_PRINT_AREA", course, area: { automatic: false, restrictToPageSize: true, rect: { minX: 100, minY: 100, maxX: 200, maxY: 180 } }, printLayout: "elit" });
    const elit = printSheetGroups(doc, { kind: "COURSE" }, [{ course, layout: "elit" }])[0]!.sheets[0]!;
    const main = printSheetGroups(doc, { kind: "COURSE" }, [{ course }])[0]!.sheets[0]!;
    expect(elit.paperItems?.map(item => item.id)).toEqual(["t1"]);
    expect(main.paperItems ?? []).toEqual([]);
    const area = elit.frames[0]!.mapArea;
    expect((area.minX + area.maxX) / 2).toBeCloseTo(150, 3);
    expect(doc.courses[0]!.printArea).toBeUndefined();
    // Arkets egna element: bara arket; "Återställ till mallen" (null) tar bort dem.
    const own = apply(doc, { type: "SET_PAPER_LAYOUT", course, printLayout: "elit", layout: { template: "elitmall",
      items: [{ id: "x", kind: "TEXT", at: { corner: "BOTTOM_LEFT", x: 2, y: 2 }, text: "Arket", sizeMm: 4, widthMm: 30 }] } });
    expect(printSheetGroups(own, { kind: "COURSE" }, [{ course, layout: "elit" }])[0]!.sheets[0]!.paperItems?.map(item => item.id)).toEqual(["t1", "x"]);
    const reset = apply(own, { type: "SET_PAPER_LAYOUT", course, printLayout: "elit", layout: null });
    expect(printSheetGroups(reset, { kind: "COURSE" }, [{ course, layout: "elit" }])[0]!.sheets[0]!.paperItems?.map(item => item.id)).toEqual(["t1"]);
    // Mallen tas bort: layouten står kvar utan mall.
    const removed = apply(own, { type: "DELETE_PAPER_TEMPLATE", id: "elitmall" });
    expect(removed.event.layouts!.find(item => item.id === "elit")!.paperTemplate).toBeUndefined();
    expect(removed.event.layoutSheets!.elit![course]!.paper?.template).toBeUndefined();
  });

  it("utan mall i layouten har ett ark utan eget papper huvudlayoutens (klippning, element, delar) tills arket ändras", () => {
    const { b, course } = setup();
    const clip = { shape: "POLYGON" as const, points: [{ x: 10, y: 10 }, { x: 120, y: 10 }, { x: 60, y: 90 }], outside: "WHITE" as const };
    const text = { id: "t", kind: "TEXT" as const, at: { corner: "TOP_LEFT" as const, x: 2, y: 2 }, text: "Huvud", sizeMm: 4, widthMm: 30 };
    const doc = apply(b.document, { type: "SET_PAPER_LAYOUT", course, layout: { clip, items: [text] } },
      { type: "SET_PAPER_LAYOUT", course, part: 1, layout: { items: [{ ...text, id: "d", text: "Del 2" }] } });
    const projected = layoutDocument(doc, "aldre");
    expect(projected.event.paperLayouts?.[course]).toMatchObject({ clip: { shape: "POLYGON" }, items: [{ id: "t" }] });
    expect(projected.event.paperLayouts?.[`${course}#1`]?.items?.map(item => item.id)).toEqual(["d"]);
    // Arket ändras (hörnet flyttat): arkets eget papper, huvudlayoutens orört; null = som huvudlayouten igen.
    const moved = { ...clip, points: [{ x: 15, y: 15 }, ...clip.points.slice(1)] };
    const own = apply(doc, { type: "SET_PAPER_LAYOUT", course, printLayout: "aldre", layout: { clip: moved, items: [text] } });
    expect(layoutDocument(own, "aldre").event.paperLayouts?.[course]?.clip).toEqual(moved);
    expect(own.event.paperLayouts?.[course]?.clip).toEqual(clip);
    expect(layoutDocument(apply(own, { type: "SET_PAPER_LAYOUT", course, printLayout: "aldre", layout: null }), "aldre").event.paperLayouts?.[course]?.clip).toEqual(clip);
    // Med en mall i layouten gäller mallen (som förut), inte huvudlayoutens papper.
    const template = { schemaVersion: 1 as const, id: "m", name: "Mall", items: [] };
    const withTemplate = apply(doc, { type: "PUT_PAPER_TEMPLATE", template }, { type: "UPDATE_LAYOUT", layout: "aldre", changes: { paperTemplate: "m" } });
    expect(layoutDocument(withTemplate, "aldre").event.paperLayouts?.[course]).toEqual({ template: "m" });
  });

  it("klassens layout: en layout per klass, huvudlayouten utan val; layouten tas bort med sina ark och val", () => {
    const { b, course } = setup();
    const doc = apply(b.document, { type: "SET_CLASS_LAYOUTS", classes: { H21: "elit", D21: "elit", H70: "aldre" } },
      { type: "PUT_LAYOUT_SHEET", layout: "elit", course, sheet: {} });
    expect(classLayoutOf(doc, "H21")).toBe("elit");
    expect(classLayoutOf(doc, "H20")).toBe(MAIN_LAYOUT);
    expect(classLayoutOf(doc, null)).toBe(MAIN_LAYOUT);
    const back = apply(doc, { type: "SET_CLASS_LAYOUTS", classes: { D21: null, H70: MAIN_LAYOUT } });
    expect(back.event.classLayouts).toEqual({ H21: "elit" });
    const deleted = apply(doc, { type: "DELETE_LAYOUT", layout: "elit" });
    expect(deleted.event.layoutSheets).toBeUndefined();
    expect(deleted.event.classLayouts).toEqual({ H70: "aldre" });
    expect(() => apply(doc, { type: "SET_CLASS_LAYOUTS", classes: { H21: "finns-inte" } })).toThrow();
  });

  it("huvudlayouten skrivs till .ppen; övriga layouter, ark och val följer med en ny inläsning", () => {
    const { b, course, controls } = setup();
    const doc = apply(b.document, { type: "SET_CLASS_LAYOUTS", classes: { H21: "elit" } },
      { type: "MOVE_NUMBER", course, courseControl: b.cc(course, controls[1]!), at: { x: 25, y: 12 }, printLayout: "elit" },
      { type: "UPDATE_LAYOUT", layout: MAIN_LAYOUT, changes: { name: "Huvud" } });
    const ppen = writePpen(doc);
    expect(ppen).not.toContain("Elit A3");
    expect(ppen).not.toContain("print-scale=\"15000\"");
    expect(writePpen(doc)).toBe(writePpen(apply(b.document, { type: "DELETE_LAYOUT", layout: "elit" }, { type: "DELETE_LAYOUT", layout: "aldre" })));
    const imported = readPpen(ppen).document;
    expect(imported.event.layouts).toBeUndefined();
    const kept = keepPaperOnImport(doc, imported);
    expect(kept.event.layouts).toEqual(doc.event.layouts);
    expect(kept.event.layoutSheets).toEqual(doc.event.layoutSheets);
    expect(kept.event.classLayouts).toEqual({ H21: "elit" });
    expect(kept.event.mainLayout).toEqual({ name: "Huvud" });
    // Arket för en bana som inte finns i den nya filen följer inte med.
    const without = keepPaperOnImport(doc, { ...imported, courses: [] });
    expect(without.event.layoutSheets).toBeUndefined();
    // Dokumentet som JSON (som i databasen) ger samma utskrift.
    const json = JSON.parse(JSON.stringify(doc)) as CourseSettingDocument;
    expect(printSheetGroups(json, { kind: "COURSE" }, [{ course, layout: "elit" }])).toEqual(printSheetGroups(doc, { kind: "COURSE" }, [{ course, layout: "elit" }]));
  });

  it("ångra (objectPatch) och kollaborationsnycklarna per ark, kontroll och klass", () => {
    const { b, course, controls } = setup();
    const cc = b.cc(course, controls[1]!);
    const edit: CourseSettingEdit = { type: "MOVE_NUMBER", course, courseControl: cc, at: { x: 1, y: 2 }, printLayout: "aldre" };
    expect(editTouches(edit)).toEqual([`event:layoutSheets:aldre:${course}:numbers:${cc}`]);
    expect(editTouches({ type: "MOVE_NUMBER", course, courseControl: cc, at: null })).toEqual([`courseControl:${cc}:numberAt`]);
    expect(editTouches({ type: "SET_PRINT_AREA", course, area: null, part: 1, printLayout: "elit" })).toEqual([`event:layoutSheets:elit:${course}:partPrintAreas:1`]);
    expect(editTouches({ type: "SET_PAPER_LAYOUT", course, layout: null, printLayout: "elit" })).toEqual([`event:layoutSheets:elit:${course}:paper`]);
    expect(editTouches({ type: "SET_LAYOUT_CIRCLE_GAPS", layout: "elit", control: controls[0]!, gaps: null })).toEqual([`event:layouts:elit:circleGaps:${controls[0]}`]);
    expect(editTouches({ type: "SET_CLASS_LAYOUTS", classes: { H21: "elit", D21: null } })).toEqual(["event:classLayouts:D21", "event:classLayouts:H21"]);
    expect(editTouches({ type: "UPDATE_LAYOUT", layout: MAIN_LAYOUT, changes: { name: "X" } })).toEqual(["event:mainLayout:name"]);
    const after = apply(b.document, edit);
    const undone = apply(after, objectPatch(after, b.document)!);
    expect(undone.event).toEqual(b.document.event);
  });

  it("huvudlayoutens skala och papper ändras inte i layouten; ogiltiga layouter avvisas", () => {
    const { b } = setup();
    expect(() => apply(b.document, { type: "UPDATE_LAYOUT", layout: MAIN_LAYOUT, changes: { scale: 5000 } })).toThrow();
    expect(() => apply(b.document, { type: "ADD_LAYOUT", layout: ELIT })).toThrow();
    expect(() => apply(b.document, { type: "ADD_LAYOUT", layout: { ...ELIT, id: "x", scale: 0 } })).toThrow();
    expect(() => apply(b.document, { type: "ADD_LAYOUT", layout: { ...ELIT, id: MAIN_LAYOUT } })).toThrow();
    const changed = apply(b.document, { type: "UPDATE_LAYOUT", layout: "elit", changes: { scale: 10000, name: "Elit A4" } });
    expect(changed.event.layouts!.find(item => item.id === "elit")).toMatchObject({ scale: 10000, name: "Elit A4", page: A3_LANDSCAPE });
  });

  it("sträckavbrott per layout: bara i den layouten; Ta bort justeringar tar dem", () => {
    const { b, course, controls } = setup();
    const [from, to] = [controls[0]!, controls[1]!];
    const doc = apply(b.document, { type: "SET_LAYOUT_LEG_GAPS", layout: "aldre", from, to, gaps: [{ start: 9, length: 2 }] });
    const leg = (layout?: string) => firstFrame(doc, course, layout).figures.filter(item => item.kind === "polyline" && item.role === "LEG" && item.ref === `${from}-${to}`);
    // Avbrottet delar sträckan i två linjer i layouten; i huvudlayouten är den hel.
    expect(leg("aldre").length).toBe(leg().length + 1);
    expect(layoutAdjustments(doc, "aldre", course).legGaps).toEqual([`${from}-${to}`]);
    expect(editTouches({ type: "SET_LAYOUT_LEG_GAPS", layout: "aldre", from, to, gaps: null })).toEqual([`event:layouts:aldre:legGaps:${from}-${to}`]);
    const cleared = apply(doc, { type: "CLEAR_LAYOUT_ADJUSTMENTS", layout: "aldre", course });
    expect(layoutAdjustments(cleared, "aldre", course).legGaps).toEqual([]);
    expect(() => apply(b.document, { type: "SET_LAYOUT_LEG_GAPS", layout: "aldre", from, to, gaps: [{ start: -1, length: 2 }] })).toThrow();
  });
});
