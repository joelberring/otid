/**
 * Utläggningen i mm: mått, linjer (tjock var tredje rad), symboler, text och markerbara ytor; alla Purple Pens testfiler
 * och ägarens fil (OTID_REAL_PPEN) läggs ut utan fel.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  courseVariants, layoutDescription, readPpen, type CourseSettingDocument, type DescriptionKind, type DescriptionLayout,
  type DescriptionPrimitive
} from "../src";
import { descriptionSvg } from "./description-svg";
import { ppenFiles, readText, testFilesDir } from "./helpers";

const load = (name: string): CourseSettingDocument => readPpen(readText(join(testFilesDir, name))).document;
const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

type Line = Extract<DescriptionPrimitive, { kind: "line" }>;
const horizontal = (layout: DescriptionLayout) =>
  layout.primitives.filter((p): p is Line => p.kind === "line" && close(p.from.y, p.to.y) && p.to.x - p.from.x > 40);

describe("layoutDescription", () => {
  const document = load("descformatter/sampleevent1.coursescribe");
  const course4 = (kind: DescriptionKind, boxMm?: number) => layoutDescription(document, { course: "4", kind, language: "en", boxMm });

  it("har rätt storlek: åtta rutor (tretton med text) och en ruta per rad, plus halva tjocka linjen runt om", () => {
    const symbols = course4("SYMBOLS");
    expect(symbols.widthMm).toBeCloseTo(8 * 6 + 0.3, 9);
    expect(symbols.heightMm).toBeCloseTo(10 * 6 + 0.3, 9);
    expect(course4("SYMBOLS_AND_TEXT").widthMm).toBeCloseTo(13 * 6 + 0.3, 9);
    expect(course4("TEXT", 7).widthMm).toBeCloseTo(8 * 7 + 0.35, 9);
    for (const p of symbols.primitives) {
      const xs = p.kind === "line" ? [p.from.x, p.to.x] : p.kind === "hit" ? [p.x, p.x + p.width] : [p.at.x];
      for (const x of xs) {
        expect(x).toBeGreaterThanOrEqual(-1e-9);
        expect(x).toBeLessThanOrEqual(symbols.widthMm + 1e-9);
      }
    }
  });

  it("drar tjocka linjer runt, efter huvudet, efter start och efter var tredje kontroll", () => {
    // Rader: titel, huvud, start, 1, passage, 2, passerpunkt, 3, 4, mål.
    const layout = course4("SYMBOLS");
    const thickAt = new Set(horizontal(layout).filter(l => close(l.width, 0.3)).map(l => Math.round((l.from.y - 0.15) / 6)));
    const thinAt = new Set(horizontal(layout).filter(l => close(l.width, 0.15)).map(l => Math.round((l.from.y - 0.15) / 6)));
    expect([...thickAt].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 9, 10]);
    expect([...thinAt]).toEqual([8]);
  });

  it("ritar symboler i rutornas mitt och kontrollnummer, kod och mått som text", () => {
    const layout = course4("SYMBOLS");
    const start = layout.primitives.find(p => p.kind === "symbol" && p.symbol === "start");
    expect(start).toMatchObject({ at: { x: 0.15 + 3, y: 0.15 + 2 * 6 + 3 }, size: 6, ref: "1" });
    const texts = layout.primitives.filter(p => p.kind === "text").map(p => p.text);
    expect(texts).toEqual(expect.arrayContaining(["Sample Event 1", "SampleCourse4", "4.7 km", "175 m", "1", "191", "GO", "4", "1420 m"]));
    const finish = layout.primitives.find(p => p.kind === "symbol" && p.symbol === "14.2");
    expect(finish).toMatchObject({ at: { x: 0.15 + 24, y: 0.15 + 9 * 6 + 3 }, size: 6, ref: "6" });
  });

  it("ger markerbara ytor per kontrollrad och ruta C–H med kontrollens id", () => {
    const hits = course4("SYMBOLS").primitives.filter(p => p.kind === "hit");
    const control5 = hits.filter(h => h.ref === "5");
    expect(control5.map(h => h.box)).toEqual([undefined, "C", "D", "E", "F", "G", "H"]);
    expect(control5.find(h => h.box === "F")).toMatchObject({ x: 0.15 + 30, width: 6, height: 6 });
    expect(hits.find(h => h.ref === "6" && h.box === "all")).toMatchObject({ x: 0.15, width: 48 });
    expect(hits.find(h => h.ref === "18" && h.box === "before")).toBeUndefined(); // banans kontrolls textrad
    expect(course4("TEXT").primitives.filter(p => p.kind === "hit" && p.box !== undefined && p.box.length === 1 && p.box !== "C")).toHaveLength(0);
  });

  it("skriver textbeskrivningen i text och båda", () => {
    const text = course4("TEXT").primitives.filter(p => p.kind === "text").map(p => p.text);
    expect(text).toContain("Start: open bare rock");
    expect(course4("TEXT").primitives.some(p => p.kind === "symbol" && p.symbol === "2.8")).toBe(false);
    const both = course4("SYMBOLS_AND_TEXT").primitives;
    expect(both.some(p => p.kind === "symbol" && p.symbol === "2.8")).toBe(true);
    expect(both.filter(p => p.kind === "text").map(p => p.text)).toContain("Reentrant, 4m deep");
  });

  it("lägger ut alla kontroller och mått i F med snedstreck och gångertecken", () => {
    const layout = layoutDescription(document, { course: "ALL_CONTROLS", kind: "SYMBOLS", language: "sv" });
    const texts = layout.primitives.filter(p => p.kind === "text").map(p => p.text);
    expect(texts.slice(0, 3)).toEqual(["Sample Event 1", "Alla kontroller", "17 kontroller"]);
    expect(texts).toEqual(expect.arrayContaining(["0.5", "2.5", "6×7", "4×4", "5×6"]));
    expect(layout.heightMm).toBeCloseTo(26 * 6 + 0.3, 9);
  });

  it("gafflad bana: alla grenar utan nummer, eller en variant med namn och nummer", () => {
    const forked = load("variations.ppen");
    const course = forked.courses.find(c => courseVariants(forked, c.id).length > 1)!;
    const all = layoutDescription(forked, { course: course.id, kind: "SYMBOLS", language: "sv" });
    expect(all.primitives.filter(p => p.kind === "text").map(p => p.text)).toContain("Alla alternativ");
    const variant = courseVariants(forked, course.id)[0]!;
    const one = layoutDescription(forked, { course: course.id, variant: variant.code, kind: "SYMBOLS", language: "sv" });
    expect(one.primitives.filter(p => p.kind === "text").map(p => p.text)).toContain(`${course.name} ${variant.code}`);
    expect(() => layoutDescription(forked, { course: course.id, variant: "ZZZ", kind: "SYMBOLS", language: "sv" })).toThrow(/finns inte/);
  });

  it("kastar för okänd bana och fel rutstorlek", () => {
    expect(() => layoutDescription(document, { course: "99", kind: "SYMBOLS", language: "sv" })).toThrow(/finns inte/);
    expect(() => layoutDescription(document, { course: "4", kind: "SYMBOLS", language: "sv", boxMm: 0 })).toThrow(RangeError);
  });
});

/** Alla figurer går att rita: inga NaN, och varje symbol finns i standarden. */
function checkLayout(document: CourseSettingDocument, course: string, variant: string | undefined, name: string): number {
  let count = 0;
  for (const kind of ["SYMBOLS", "TEXT", "SYMBOLS_AND_TEXT"] as const) {
    const layout = layoutDescription(document, { course, variant, kind, language: "sv" });
    expect(JSON.stringify(layout), name).not.toContain("null");
    descriptionSvg(layout, document.event.descriptionStandard);
    count += layout.primitives.length;
  }
  return count;
}

const files = ppenFiles();

describe.skipIf(files.length === 0)("alla Purple Pens testfiler läggs ut", () => {
  it("varje bana, varianter och alla kontroller, i alla tre slagen", () => {
    let primitives = 0;
    for (const path of files) {
      if (relative(testFilesDir, path) === "sampleevent2.ppen") continue;
      const { document } = readPpen(readText(path));
      for (const course of ["ALL_CONTROLS", ...document.courses.map(c => c.id)]) {
        primitives += checkLayout(document, course, undefined, `${path} ${course}`);
      }
      for (const course of document.courses) {
        for (const variant of courseVariants(document, course.id).slice(0, 2)) {
          if (variant.code !== "") primitives += checkLayout(document, course.id, variant.code, `${path} ${course.name} ${variant.code}`);
        }
      }
    }
    expect(primitives).toBeGreaterThan(10000);
  }, 60_000);
});

const ownerPath = process.env.OTID_REAL_PPEN;
describe.skipIf(ownerPath === undefined || !existsSync(ownerPath))("ägarens .ppen (OTID_REAL_PPEN)", () => {
  it("läggs ut på svenska med 2018 års symboler, alla banor och varianter", () => {
    const { document } = readPpen(readFileSync(ownerPath!, "utf8"));
    expect(document.event.descriptionStandard).toBe("2018");
    for (const course of document.courses) {
      checkLayout(document, course.id, undefined, course.name);
      for (const variant of courseVariants(document, course.id)) {
        const layout = layoutDescription(document, { course: course.id, variant: variant.code, kind: "SYMBOLS", language: "sv" });
        const texts = layout.primitives.filter(p => p.kind === "text").map(p => p.text);
        // Huvud med namn och längd, en rad per kontroll med nummer och kod, mål.
        expect(texts, `${course.name} ${variant.code}`).toContain(variant.code === "" ? course.name : `${course.name} ${variant.code}`);
        expect(texts.some(text => /^\d+,\d km$/.test(text))).toBe(true);
        for (const code of variant.controlCodes) expect(texts).toContain(code);
        expect(layout.primitives.some(p => p.kind === "symbol" && p.symbol.startsWith("14."))).toBe(true);
      }
    }
    checkLayout(document, "ALL_CONTROLS", undefined, "alla");
  }, 60_000);
});
