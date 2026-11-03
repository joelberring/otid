import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyEdit, countCourseParts, courseParts, effectivePaper, expandPartItems, layoutCoursePage, layoutOverprint, printSheetGroups,
  readPpen, writePpen, type CourseSettingDocument, type CourseSettingEdit, type PaperItem
} from "../src";
import { formatDescription } from "../src/description-format";

/**
 * ADR-0203: banans delar vid kartbyten som Purple Pen. Purple Pens egna testfiler (mapexchange1.ppen): "Course 2" har ett
 * kartbyte vid kontroll 76 och en egen tryckyta för del 2 (`<print-area part="1">`), "Course 5" har tre kartbyten (ett eget
 * kartbyte 611 och två vid kontroller) och första hjälpen (specialobjekt 3) står bara på Course 2 del 2.
 */
const fixture = (name: string) => readFileSync(new URL(`../../../fixtures/purplepen/${name}`, import.meta.url), "utf8");
const read = (name = "controller/mapexchange1.ppen") => readPpen(fixture(name)).document;
const apply = (document: CourseSettingDocument, edit: CourseSettingEdit) => applyEdit(document, edit).document;
const codes = (document: CourseSettingDocument, ids: readonly string[]) => ids.map(id => document.controls[document.courseControls[id]!.control]!.code ?? document.controls[document.courseControls[id]!.control]!.kind);

describe("kartbyten: delarna (QueryEvent.CountCourseParts, GetCoursePartBounds)", () => {
  it("delar vid kartbytena; kartbytet sist i en del och först i nästa", () => {
    const document = read();
    expect(countCourseParts(document, "1")).toBe(1);
    expect(countCourseParts(document, "2")).toBe(2);
    expect(countCourseParts(document, "6")).toBe(4);
    expect(countCourseParts(document, "ALL_CONTROLS")).toBe(1);
    const parts = courseParts(document, "2");
    expect(codes(document, parts[0]!)).toEqual(["START", "74", "44", "53", "76"]);
    expect(parts[1]![0]).toBe(parts[0]!.at(-1));
    expect(codes(document, parts[1]!).at(-1)).toBe("FINISH");
  });

  it("samma gränser som Purple Pens QueryEventTests.GetCoursePartBounds och CourseViewTests (Course 5, mapexchange)", () => {
    const document = read("queryevent/mapexchange1.ppen");
    expect(courseParts(document, "6").map(part => [part[0], part.at(-1)])).toEqual([["601", "611"], ["611", "615"], ["615", "616"], ["616", "620"]]);
    // CourseViewTests: del 3 (Part=2) med `show-finish` har målet 620 som extra kontroll; numren 13–14 på delens kontroller.
    const view = read("courseview/mapexchange2.ppen");
    const part = layoutOverprint(view, { course: "6", part: 2, overlap: "NONE" });
    const finish = view.controls[view.courseControls["620"]!.control]!.at;
    expect(part.some(item => item.role === "FINISH" && item.kind === "circle" && Math.hypot(item.center.x - finish.x, item.center.y - finish.y) < 0.01)).toBe(true);
    expect(part.filter(item => item.kind === "text" && item.role === "NUMBER").map(item => item.kind === "text" ? item.text : "")).toEqual(["13", "14"]);
    expect(layoutOverprint(view, { course: "6", part: 1, overlap: "NONE" }).some(item => item.role === "FINISH")).toBe(false);
  });

  it(".ppen: delarnas tryckytor läses, ändras per del och skrivs tillbaka med part", () => {
    let document = read();
    expect(document.courses.find(row => row.id === "2")!.partPrintAreas!["1"]).toMatchObject({ rect: { minX: 0, maxX: 90, minY: 30, maxY: 80 } });
    document = apply(document, { type: "SET_PRINT_AREA", course: "2", part: 0, area: { automatic: false, restrictToPageSize: false,
      rect: { minX: -10, minY: -20, maxX: 40, maxY: 30 } } });
    const xml = writePpen(document);
    expect(xml).toMatch(/<print-area part="0" automatic="false"[^>]*left="-10"/);
    expect(xml).toMatch(/<print-area part="1"[^>]*left="0" top="80" right="90" bottom="30"/);
    const again = readPpen(xml).document.courses.find(row => row.id === "2")!;
    expect(Object.keys(again.partPrintAreas!).sort()).toEqual(["0", "1"]);
    // Null = som banans igen.
    document = apply(document, { type: "SET_PRINT_AREA", course: "2", part: 0, area: null });
    expect(writePpen(document)).not.toContain('<print-area part="0"');
    // Utan ändring skrivs filens element orörda.
    expect(writePpen(read())).toContain('<print-area part="1" left="0" top="80" right="90" bottom="30" />');
  });
});

describe("kartbyten: banpåtrycket för en del (CourseView.CreateCourseView)", () => {
  it("del 2 börjar med kartbytet som start, numren fortsätter; ett eget kartbyte sist i en del ritas inte", () => {
    const document = read();
    const whole = layoutOverprint(document, { course: "6" });
    const first = layoutOverprint(document, { course: "6", part: 0, overlap: "NONE" });
    const second = layoutOverprint(document, { course: "6", part: 1, overlap: "NONE" });
    const numbers = (list: typeof whole) => list.filter(item => item.kind === "text" && item.role === "NUMBER").map(item => item.kind === "text" ? item.text : "");
    expect(numbers(first)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    // Del 2 (efter kartbytet 611): kontrollerna 37, 36, 39, 43 har nummer 10–13.
    expect(numbers(second)).toEqual(["10", "11", "12", "13"]);
    // Kartbytet 611 är ett eget kartbyte: sist i del 1 syns det inte, först i del 2 som start (triangel).
    const exchange = document.courseControls["611"]!.control;
    const at = document.controls[exchange]!.at;
    const near = (list: typeof whole) => list.filter(item => item.role === "MAP_EXCHANGE" && item.kind === "polyline"
      && item.points.some(p => Math.hypot(p.x - at.x, p.y - at.y) < 10));
    expect(near(first)).toHaveLength(0);
    expect(near(second).length).toBeGreaterThan(0);
    expect(numbers(whole).length).toBeGreaterThan(numbers(first).length + numbers(second).length);
  });

  it("överlappet: föregående dels sista sträcka (förval) eller hela delen, tonat och utan nummer", () => {
    const document = read();
    const none = layoutOverprint(document, { course: "2", part: 1, overlap: "NONE" });
    const lastLeg = layoutOverprint(document, { course: "2", part: 1 });
    const previous = layoutOverprint(document, { course: "2", part: 1, overlap: "PREVIOUS_PART" });
    const overlap = (list: typeof none) => list.filter(item => item.role === "OVERLAP");
    expect(overlap(none)).toHaveLength(0);
    expect(overlap(lastLeg).length).toBeGreaterThan(0);
    expect(overlap(previous).length).toBeGreaterThan(overlap(lastLeg).length);
    for (const item of overlap(previous)) expect(item.kind !== "image" && item.fade).toBe(0.35);
    // Inga nummer för föregående dels kontroller; samma nummer som utan överlapp.
    const numbers = (list: typeof none) => list.filter(item => item.role === "NUMBER").length;
    expect(numbers(previous)).toBe(numbers(none));
    // Del 1 har inget överlapp.
    expect(overlap(layoutOverprint(document, { course: "2", part: 0, overlap: "PREVIOUS_PART" }))).toHaveLength(0);
  });

  it("specialobjekt för en del (`<course course=\"2\" part=\"1\">`) syns bara på den delen och på hela banan", () => {
    const document = read();
    const firstAid = (part?: number) => layoutOverprint(document, { course: "2", ...(part !== undefined ? { part, overlap: "NONE" as const } : {}) })
      .some(item => item.role === "SPECIAL" && item.ref === "3");
    expect(firstAid()).toBe(true);
    expect(firstAid(0)).toBe(false);
    expect(firstAid(1)).toBe(true);
  });

  it("beskrivningen för en del: delens kontroller och namnet med delens nummer", () => {
    const document = read();
    const lines = formatDescription(document, { course: "2", part: 1, language: "en", createKey: false }).lines;
    const title = JSON.stringify(lines.slice(0, 3));
    expect(title).toContain("Course 2-2");
    const whole = formatDescription(document, { course: "2", language: "en", createKey: false }).lines;
    expect(lines.length).toBeLessThan(whole.length);
  });
});

describe("kartbyten: utskriften", () => {
  it("en karta per del med delens tryckyta och titel; dubbelsidigt ger del 2 på baksidan och en tom baksida vid udda antal", () => {
    const document = read();
    const items = expandPartItems(document, [{ course: "1" }, { course: "2" }, { course: "6" }, { course: "ALL_CONTROLS" }]);
    expect(items.map(item => `${item.course}:${item.part ?? "-"}`)).toEqual(["1:-", "2:0", "2:1", "6:0", "6:1", "6:2", "6:3", "ALL_CONTROLS:-"]);
    const page = layoutCoursePage(document, { course: "2", part: 1 })[0]!;
    expect(page.title).toBe("Course 2 – del 2");
    expect(page.part).toBe(1);
    // Del 2:s tryckyta (0–90 × 30–80) styr utsnittet: ytan ligger inom den (fast, inte automatisk).
    expect(page.mapArea.minX).toBeLessThanOrEqual(0);
    expect(page.description?.part).toBe(1);
    const sheets = printSheetGroups(document, { kind: "COURSE", duplex: true }, items).flatMap(group => group.sheets);
    // Course 1 (1 ark + tom baksida), Course 2 (fram, bak), Course 5 (fram, bak, fram, bak), Alla kontroller (+ tom baksida).
    expect(sheets.map(sheet => sheet.frames.length === 0 ? "tom" : `${sheet.frames[0]!.course}:${sheet.frames[0]!.part ?? "-"}${sheet.back ? "b" : "f"}`))
      .toEqual(["1:-f", "tom", "2:0f", "2:1b", "6:0f", "6:1b", "6:2f", "6:3b", "ALL_CONTROLS:-f", "tom"]);
    const single = printSheetGroups(document, { kind: "COURSE" }, items).flatMap(group => group.sheets);
    expect(single.some(sheet => sheet.back)).toBe(false);
    expect(single).toHaveLength(8);
  });

  it("papperet per del: ärver banans; \"Alla sidor\" står på alla delar; en dels egna element och klippning bara där", () => {
    let document = read();
    const title: PaperItem = { id: "t", kind: "TEXT", at: { corner: "TOP_LEFT", x: 1, y: 1 }, text: "{bana}", sizeMm: 4, widthMm: 50 };
    const arrow: PaperItem = { id: "n", kind: "NORTH_ARROW", at: { corner: "TOP_RIGHT", x: 1, y: 1 }, sizeMm: 10, pages: "ALL" };
    document = apply(document, { type: "SET_PAPER_LAYOUT", course: "2", layout: { items: [title, arrow] } });
    const ids = (part: number) => layoutCoursePage(document, { course: "2", part })[0]!.paperItems?.map(item => item.id) ?? [];
    expect(ids(0)).toEqual(["t", "n"]);
    expect(ids(1)).toEqual(["n"]);
    // Del 2 får en egen text och en klippning: bara del 2.
    const own: PaperItem = { ...title, id: "d2", text: "Del 2" };
    document = apply(document, { type: "SET_PAPER_LAYOUT", course: "2", part: 1, layout: { items: [title, arrow, own],
      clip: { shape: "RECT", rect: { x: 5, y: 5, width: 50, height: 50 }, outside: "WHITE" } } });
    expect(ids(1)).toEqual(["t", "n", "d2"]);
    expect(ids(0)).toEqual(["t", "n"]);
    expect(effectivePaper(document, "2", 1).clip).toBeDefined();
    expect(effectivePaper(document, "2", 0).clip).toBeUndefined();
    const frames = printSheetGroups(document, { kind: "COURSE" }, [{ course: "2", part: 0 }, { course: "2", part: 1 }]).map(group => group.sheets[0]!.frames[0]!);
    // Klippningen gäller kartan (passen) på del 2; banan står hel.
    expect(frames[0]!.mapPasses).toBeUndefined();
    expect(frames[1]!.mapPasses).toBeDefined();
    expect(document.event.paperLayouts!["2#1"]).toBeDefined();
    expect(() => apply(document, { type: "SET_PAPER_LAYOUT", course: "2", part: -1, layout: null })).toThrow(/Delen/);
  });
});
