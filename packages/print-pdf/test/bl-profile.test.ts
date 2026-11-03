import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  acceptSafe, applyEdit, BL_FOREST_2026_11_02, BUILT_IN_PRINT_PROFILES, emptyDocument, layoutCoursePage, proposeColorMatches, sheetOfPage, sourceMapColors,
  toPage, type CourseSettingDocument, type CourseSettingEdit, type PrintProfile, type Sheet
} from "@o-tid/course-setting";
import { colorUsage, readMapFile } from "@o-tid/map-file";
import { colorsOverCourse, writeSheetsPdf } from "../src";
import { BL_OMAP } from "./bl-map";
import { fontFiles, parsePdf } from "./helpers";

const fonts = fontFiles();
const map = readMapFile(new TextEncoder().encode(BL_OMAP), "bl.omap");
const forest = BUILT_IN_PRINT_PROFILES.find(item => item.id === "bl-forest-2026-11-02")!;

/** En bana med start, en kontroll i (50, 50) där höjdkurvan och stigen korsar, och mål. */
function courseDocument(): { document: CourseSettingDocument; course: string } {
  let document = emptyDocument({ title: "BL", mapScale: 10000 });
  const edit = (change: CourseSettingEdit) => { const result = applyEdit(document, change); document = result.document; return result.created ?? ""; };
  const start = edit({ type: "ADD_CONTROL", kind: "START", at: { x: 20, y: 20 } });
  const control = edit({ type: "ADD_CONTROL", kind: "NORMAL", at: { x: 50, y: 50 }, code: "31" });
  const finish = edit({ type: "ADD_CONTROL", kind: "FINISH", at: { x: 80, y: 20 } });
  const course = edit({ type: "ADD_COURSE", name: "A" });
  edit({ type: "INSERT_COURSE_CONTROL", course, control: start });
  edit({ type: "INSERT_COURSE_CONTROL", course, control });
  edit({ type: "INSERT_COURSE_CONTROL", course, control: finish });
  return { document, course };
}

/** Den godkända kopian: alla säkra förslag godtagna. */
function approved(): PrintProfile {
  const proposals = proposeColorMatches(BL_FOREST_2026_11_02, sourceMapColors(map.colors, colorUsage(map)));
  return { ...forest, id: "bl-godkand", basedOn: forest.id, colorDecisions: acceptSafe([], proposals) };
}

function sheets(): { sheets: Sheet[]; document: CourseSettingDocument } {
  const { document, course } = courseDocument();
  return { document, sheets: layoutCoursePage(document, { course, mapBounds: map.bounds ?? undefined }).map(sheetOfPage) };
}

describe("PDF med BL-profilen", () => {
  it("förslaget för testkartan är säkert för alla fem färgerna", () => {
    const profile = approved();
    expect(profile.colorDecisions?.map(item => [item.name, item.row])).toEqual(expect.arrayContaining([["Brun 100%", "brown-contours"], ["Svart", "black"],
      ["Blå 100%", "blue-line-point"], ["Blå 50%", "blue-50"], ["Gul 100%", "yellow-100"]]));
    expect([...colorsOverCourse(map, profile)!].sort()).toEqual(map.colors.filter(color => ["Brun 100%", "Svart", "Blå 100%"].includes(color.name)).map(color => color.id).sort());
  });

  it("banans violett 35/95/0/0 och kartans färger med BL:s CMYK, utan dekorfärger; banan mellan kartans två utsnitt", async () => {
    const { sheets: list } = sheets();
    const result = await writeSheetsPdf({ sheets: list, map, profile: approved(), mode: "PRESS", fonts, title: "BL" });
    const pdf = await parsePdf(result.bytes);
    expect(result.plates).toEqual([]);
    expect(pdf.colorSpaces.size).toBe(0);
    const content = pdf.pages[0]!.content;
    // Banan som processfärg (stroke K) med BL:s violett.
    expect(content).toContain("0.35 0.95 0 0 K");
    expect(content).not.toMatch(/0\.2 1 0 0 K/);
    // Två utsnitt: färgerna under banan först, banan, sedan färgerna över.
    const under = content.indexOf("/Fm0 Do"), ring = content.indexOf("0.35 0.95 0 0 K"), over = content.indexOf("/Fm1 Do");
    expect(under).toBeGreaterThan(-1);
    expect(ring).toBeGreaterThan(under);
    expect(over).toBeGreaterThan(ring);
    const forms = [...pdf.forms.values()];
    // Under: BL:s gul 100 % (0/27/94/0) och blå 50 %; över: BL:s brun (0/75/100/33), svart och blå linje 100/0/0/0.
    expect(forms[0]).toContain("0 0.27 0.94 0 k");
    expect(forms[0]).toContain("0.5 0 0 0 k");
    expect(forms[0]).not.toContain("0 0.75 1 0.33 K");
    expect(forms[1]).toContain("0 0.75 1 0.33 K");
    expect(forms[1]).toContain("1 0 0 0 K");
    expect(forms[1]).not.toContain("0 0.27 0.94 0 k");
    expect(result.overCourse).toHaveLength(3);
    expect(result.notes.join(" ")).toMatch(/vill ha CMYK/);
    expect(result.notes.join(" ")).toMatch(/under 3 kartfärger/);
    // Färgerna över banan med övertryck (/GOP), färgerna under utan.
    expect(forms[1]).toMatch(/\/GOP gs/);
    expect(forms[0]).not.toMatch(/\/GOP gs/);
  });

  it("valet i profilen: banan överst som förr (ett utsnitt, banan sist)", async () => {
    const { sheets: list } = sheets();
    const result = await writeSheetsPdf({ sheets: list, map, profile: { ...approved(), courseLayer: "TOP" }, mode: "PRESS", fonts, title: "BL" });
    const content = (await parsePdf(result.bytes)).pages[0]!.content;
    expect(content.match(/\/Fm\d+ Do/g)).toEqual(["/Fm0 Do"]);
    expect(content.indexOf("0.35 0.95 0 0 K")).toBeGreaterThan(content.indexOf("/Fm0 Do"));
    expect(result.overCourse).toEqual([]);
  });

  // Ordningen i trycket: Ghostscript renderar sidan i CMYK (bitcmyk, 8 bitar per plåt). Där höjdkurvan korsar ringen ligger
  // BL:s brun 0/75/100/33 över violetten 35/95/0/0 med övertryck (ADR-0211 beslut 3): violettens cyan finns kvar under det
  // bruna och brunets gula plåt ligger på; med banan överst (utan övertryck) slår violetten ut brunt.
  it.skipIf(!hasGhostscript())("Ghostscript: höjdkurvan ligger över ringen med övertryck med BL-profilen, under den med banan överst", async () => {
    const { sheets: list } = sheets();
    const frame = list[0]!.frames[0]!;
    const ring = list[0]!.frames[0]!.figures.find(figure => figure.kind === "circle" && figure.role === "CONTROL");
    expect(ring?.kind).toBe("circle");
    const radius = ring!.kind === "circle" ? ring!.diameter / 2 : 0;
    // Punkten på ringen där höjdkurvan (y = 50) korsar: (50 + r, 50) i kartan.
    const at = toPage(frame, { x: 50 + radius, y: 50 });
    const sample = async (profile: PrintProfile) => {
      const result = await writeSheetsPdf({ sheets: list, map, profile, mode: "PRESS", fonts, title: "BL" });
      return cmykAt(result.bytes, list[0]!.paper.widthMm, at);
    };
    const bl = await sample(approved());
    const top = await sample({ ...approved(), courseLayer: "TOP" });
    expect(bl.c).toBeGreaterThan(0.3);
    expect(bl.y).toBeGreaterThan(0.9);
    expect(bl.k).toBeGreaterThan(0.25);
    expect(top.c).toBeGreaterThan(0.3);
    expect(top.m).toBeGreaterThan(0.9);
    expect(top.y).toBeLessThan(0.05);
  });
});

function hasGhostscript(): boolean {
  try { execFileSync("gs", ["--version"], { stdio: "ignore" }); return true; } catch { return false; }
}

/** CMYK (0–1) i sidans punkt (mm från övre vänstra hörnet), renderat av Ghostscript i 288 dpi. */
function cmykAt(bytes: Uint8Array, widthMm: number, at: { x: number; y: number }): { c: number; m: number; y: number; k: number } {
  const directory = mkdtempSync(join(tmpdir(), "otid-bl-"));
  try {
    const dpi = 288;
    writeFileSync(join(directory, "bl.pdf"), bytes);
    execFileSync("gs", ["-q", "-dNOPAUSE", "-dBATCH", "-dSAFER", "-sDEVICE=bitcmyk", "-dGrayValues=256", `-r${dpi}`, "-dFirstPage=1", "-dLastPage=1",
      `-sOutputFile=${join(directory, "bl.cmyk")}`, join(directory, "bl.pdf")]);
    const raw = readFileSync(join(directory, "bl.cmyk"));
    // Ghostscript avrundar sidans bredd till hela bildpunkter.
    const width = Math.round(widthMm / 25.4 * dpi);
    const x = Math.round(at.x / 25.4 * dpi), y = Math.round(at.y / 25.4 * dpi);
    const index = (y * width + x) * 4;
    return { c: raw[index]! / 255, m: raw[index + 1]! / 255, y: raw[index + 2]! / 255, k: raw[index + 3]! / 255 };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
