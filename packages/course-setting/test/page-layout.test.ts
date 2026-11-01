import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyEdit, layoutCoursePage, printVariants, readPpen, toPage, type CoursePage } from "../src";
import { lineCourse } from "./build";

const A4 = { width: 827, height: 1169 };

describe("utskriftslayouten (steg 64)", () => {
  it("1:15 000-karta i 1:10 000: kartans mm blir 1,5 mm på papperet och sidan har y nedåt", () => {
    const { b, course } = lineCourse(3, { mapScale: 15000 });
    b.edit({ type: "UPDATE_COURSE", course, changes: { printScale: 10000 } });
    const rect = { minX: -50, minY: -40, maxX: 100, maxY: 60 };
    b.edit({ type: "SET_PRINT_AREA", course, area: { automatic: false, restrictToPageSize: false, rect, page: { ...A4, margins: 28, landscape: true } } });
    const [page, ...rest] = layoutCoursePage(b.document, { course });
    expect(rest).toEqual([]);
    expect(page!.printScale).toBe(10000);
    expect(page!.transform.scale).toBeCloseTo(1.5, 12);
    expect(page!.paper.widthMm).toBeCloseTo(1169 * 0.254, 9);
    expect(page!.paper.landscape).toBe(true);
    // Ytan (150 × 100 mm i kartan = 225 × 150 mm) ryms och centreras inom marginalerna.
    expect(page!.clip.width).toBeCloseTo(225, 9);
    expect(page!.clip.height).toBeCloseTo(150, 9);
    expect(page!.clip.x).toBeCloseTo((1169 * 0.254 - 225) / 2, 9);
    const topLeft = toPage(page!, { x: rect.minX, y: rect.maxY });
    expect(topLeft.x).toBeCloseTo(page!.clip.x, 9);
    expect(topLeft.y).toBeCloseTo(page!.clip.y, 9);
    const bottomRight = toPage(page!, { x: rect.maxX, y: rect.minY });
    expect(bottomRight.x).toBeCloseTo(page!.clip.x + page!.clip.width, 9);
    expect(bottomRight.y).toBeCloseTo(page!.clip.y + page!.clip.height, 9);
    // Ringarna är 5,35 mm på papperet (ISOM 2017, scale-sizes RelativeTo15000 i 1:15 000 ger samma mått i kartan).
    const ring = page!.figures.find(figure => figure.kind === "circle" && figure.role === "CONTROL")!;
    expect(ring.kind === "circle" && (ring.diameter + ring.lineWidth)).toBeCloseTo(5.35, 6);
  });

  it("fast storlek: ytan blir papperets storlek kring samma mitt", () => {
    const { b, course } = lineCourse(2);
    b.edit({ type: "SET_PRINT_AREA", course, area: { automatic: false, restrictToPageSize: true, rect: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      page: { ...A4, margins: 0, landscape: false } } });
    const [page] = layoutCoursePage(b.document, { course });
    expect(page!.mapArea.minX + page!.mapArea.maxX).toBeCloseTo(10, 9);
    expect(page!.mapArea.maxX - page!.mapArea.minX).toBeCloseTo(827 * 0.254, 2);
    expect(page!.clip.x).toBeCloseTo(0, 2);
    expect(page!.clip.y).toBeCloseTo(0, 2);
  });

  it("automatisk tryckyta täcker banan och sedan kartan", () => {
    const { b, course } = lineCourse(4);
    const map = { minX: -100, minY: -150, maxX: 300, maxY: 150 };
    const [page] = layoutCoursePage(b.document, { course, mapBounds: map });
    // Kartan är 400 × 300 mm: papperet blir det minsta som rymmer den (liggande, för att kartan är bredare än hög).
    expect(page!.paper.landscape).toBe(true);
    const area = page!.mapArea;
    expect(area.minX).toBeLessThanOrEqual(-21);
    expect(area.maxX).toBeGreaterThanOrEqual(81);
    const a4 = layoutCoursePage(b.document, { course, mapBounds: map, printArea: { automatic: true, restrictToPageSize: true,
      page: { ...A4, margins: 28, landscape: true } } })[0]!;
    // A4 liggande med 7 mm marginal: 282,7 × 196,8 mm; banan (−21…81) ligger mitt i, kartan fyller resten.
    expect(a4.mapArea.maxX - a4.mapArea.minX).toBeCloseTo(1169 * 0.254 - 2 * 28 * 0.254, 2);
    expect(a4.mapArea.minX).toBeGreaterThanOrEqual(map.minX);
  });

  it("en stor yta utan fast storlek delas på flera sidor som överlappar", () => {
    const { b, course } = lineCourse(2);
    b.edit({ type: "SET_PRINT_AREA", course, area: { automatic: false, restrictToPageSize: false, rect: { minX: 0, minY: 0, maxX: 500, maxY: 100 },
      page: { ...A4, margins: 0, landscape: false } } });
    const pages = layoutCoursePage(b.document, { course });
    expect(pages.length).toBe(3);
    expect(pages.map(p => p.sheet)).toEqual([1, 2, 3]);
    expect(pages[0]!.mapArea.minX).toBe(0);
    expect(pages[2]!.mapArea.maxX).toBeCloseTo(500, 6);
    expect(pages[0]!.mapArea.maxX).toBeGreaterThan(pages[1]!.mapArea.minX);
  });

  it("rubriken och varianterna", () => {
    const { b, course, controls } = lineCourse(3);
    b.edit({ type: "ADD_SPLIT", course, at: b.cc(course, controls[0]!), kind: "FORK", branches: 2 });
    expect(printVariants(b.document, course, true).length).toBeGreaterThan(1);
    expect(printVariants(b.document, course, false)).toEqual([""]);
    const variant = printVariants(b.document, course, true)[0]!;
    const [page] = layoutCoursePage(b.document, { course, variant, header: true });
    expect(page!.title).toBe(`A – ${variant}`);
    expect(page!.texts[0]!.text).toContain("Test");
    expect(page!.texts[0]!.text).toContain("1:10 000");
    expect(page!.clip.y).toBeGreaterThanOrEqual(7);
    const all = layoutCoursePage(b.document, { course: "ALL_CONTROLS" })[0]!;
    expect(all.title).toBe("Alla kontroller");
  });

  it("layouten är bara data (JSON utan funktioner)", () => {
    const { b, course } = lineCourse(2);
    b.edit({ type: "ADD_SPECIAL", special: { kind: "descriptions", points: [{ x: 0, y: 30 }, { x: 4, y: 30 }] } });
    const pages = layoutCoursePage(b.document, { course });
    expect(JSON.parse(JSON.stringify(pages))).toEqual(pages);
  });

  it("tryckytan i förhandsvisningen ersätter den sparade utan att dokumentet ändras", () => {
    const { b, course } = lineCourse(2);
    const before = b.document;
    const page = layoutCoursePage(b.document, { course, printArea: { automatic: false, restrictToPageSize: true, rect: { minX: 0, minY: 0, maxX: 1, maxY: 1 } } });
    expect(page.length).toBe(1);
    expect(b.document).toBe(before);
    expect(() => applyEdit(b.document, { type: "SET_PRINT_AREA", course, area: { automatic: false, restrictToPageSize: false, rect: { minX: 1, minY: 0, maxX: 0, maxY: 1 } } })).toThrow();
  });
});

const ppenPath = process.env.OTID_REAL_PPEN;
describe.skipIf(!(ppenPath && existsSync(ppenPath)))("ägarens SBN26_2.ppen (OTID_REAL_PPEN)", () => {
  it("visar förbjudet område, vit bakgrund, valfri passage och beskrivningen på sina banor och i Alla kontroller", async () => {
    const { layoutOverprint } = await import("../src");
    const { document } = readPpen(readFileSync(ppenPath!, "utf8"));
    const kinds = (view: string) => new Set(layoutOverprint(document, { course: view }).filter(f => f.role === "SPECIAL")
      .map(f => document.specialObjects.find(s => s.id === f.ref)!.kind));
    expect([...kinds("ALL_CONTROLS")].sort()).toEqual(["optional-crossing-point", "out-of-bounds", "white-out"]);
    for (const special of document.specialObjects.filter(s => s.kind === "descriptions")) {
      for (const course of special.courses) expect(kinds(course).has("descriptions"), course).toBe(true);
    }
    for (const course of document.courses) {
      expect(kinds(course.id).has("out-of-bounds"), course.name).toBe(document.specialObjects.some(s => s.kind === "out-of-bounds"
        && (s.courses.length === 0 || s.courses.includes(course.id))));
    }
  });

  it("sidorna följer Purple Pens tryckyta: A4 liggande, 1:10 000 och samma utsnitt", () => {
    const { document } = readPpen(readFileSync(ppenPath!, "utf8"));
    for (const course of document.courses) {
      const area = course.printArea!;
      const pages: CoursePage[] = layoutCoursePage(document, { course: course.id });
      expect(pages.length, course.name).toBe(1);
      const page = pages[0]!;
      expect(page.printScale).toBe(course.printScale);
      expect(page.paper.landscape).toBe(area.page!.landscape);
      const rect = area.rect!;
      expect((page.mapArea.minX + page.mapArea.maxX) / 2).toBeCloseTo((rect.minX + rect.maxX) / 2, 3);
      expect((page.mapArea.minY + page.mapArea.maxY) / 2).toBeCloseTo((rect.minY + rect.maxY) / 2, 3);
      // Purple Pen sparade ytan i papperets storlek (fast storlek).
      expect(page.mapArea.maxX - page.mapArea.minX).toBeCloseTo(rect.maxX - rect.minX, 1);
      expect(page.mapArea.maxY - page.mapArea.minY).toBeCloseTo(rect.maxY - rect.minY, 1);
    }
  });
});
