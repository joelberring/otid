import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDict, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  BUILT_IN_PRINT_PROFILES, BUILT_IN_SHEET_LAYOUTS, layoutCoursePage, sheetLayoutSheets, readPpen, sheetOfPage, type CourseSettingDocument, type SheetLayout,
  type PrintProfile, type Sheet
} from "@o-tid/course-setting";
import { readMapFile, type ParsedMap } from "@o-tid/map-file";
import { PDF_CAPABILITIES, plateName, writeSheetsPdf, type PdfMode } from "../src";
import { fixture, fontFiles, parsePdf, spaceFor } from "./helpers";
import { evaluateType4 } from "./postscript";
import { SPOT_OMAP } from "./spot-map";

const fonts = fontFiles();
const document: CourseSettingDocument = readPpen(new TextDecoder().decode(fixture("course-setting/kartfil.ppen"))).document;
const ocd = readMapFile(fixture("maps/kartfil.ocd"), "kartfil.ocd");
const spotMap = readMapFile(new TextEncoder().encode(SPOT_OMAP), "spot.omap");
const profile = (id: string) => BUILT_IN_PRINT_PROFILES.find(item => item.id === id)!;
const courses = [...document.courses].sort((a, b) => a.order - b.order);

function pages(map: ParsedMap): Sheet[] {
  return courses.flatMap(course => layoutCoursePage(document, { course: course.id, mapBounds: map.bounds ?? undefined, header: true }).map(sheetOfPage));
}

async function write(map: ParsedMap | null, mode: PdfMode, chosen: PrintProfile = profile(mode === "OFFICE" ? "office" : "as-file"), sheets = pages(map ?? ocd)) {
  const result = await writeSheetsPdf({ sheets, map, profile: chosen, mode, fonts, descriptionStandard: "2018", title: "Test", now: new Date("2026-11-02T10:00:00Z") });
  return { result, pdf: await parsePdf(result.bytes) };
}

/** Andelen per plåt i en DeviceN-färg, räknad genom PDF:ens typ 4-funktion till CMYK. */
const cmykOf = (code: string, tints: number[]) => evaluateType4(code, tints).map(value => Math.round(value * 1000) / 1000);

describe("PDF för tryck (steg 65)", () => {
  it("tryckeri: banan i egen dekorfärg Purple med övertryck, kartan som vektorer i CMYK", async () => {
    const { result, pdf } = await write(ocd, "PRESS");
    expect(result.pages).toBe(courses.length);
    expect(pdf.pages).toHaveLength(courses.length);
    expect(Buffer.from(result.bytes.subarray(0, 8)).toString("latin1")).toBe("%PDF-1.7");
    // Purple Pens lila 20/100/0/0 som alternativ i DeviceCMYK.
    const purple = spaceFor(pdf, "Purple")!;
    expect(pdf.colorSpaces.get(purple)).toMatchObject({ kind: "Separation", names: ["Purple"], functionType: 2, c1: [0.2, 1, 0, 0] });
    expect(pdf.extGStates.get("GOP")).toMatchObject({ OP: "true", op: "true", OPM: "1" });
    expect(pdf.extGStates.get("GKO")).toMatchObject({ OP: "false", op: "false" });
    expect(result.plates).toEqual(["Purple"]);
    expect(result.overprint).toBe(true);
    for (const page of pdf.pages) {
      // Ringarna och linjerna i dekorfärgen med övertryck påslaget före.
      const stroke = page.content.indexOf(`/${purple} CS 1 SCN`);
      expect(stroke).toBeGreaterThan(-1);
      expect(page.content.lastIndexOf("/GOP gs", stroke)).toBeGreaterThan(-1);
      expect(page.content).toMatch(/\/Fm\d+ Do/);
    }
    // Kartan: en Form XObject per utsnitt med kartfilens CMYK (grön 76/0/91/0, blå 100/0/0/0) som vektorer.
    expect(pdf.forms.size).toBe(result.mapForms);
    const form = [...pdf.forms.values()][0]!;
    expect(form).toContain("0.76 0 0.91 0 k");
    expect(form).toContain("1 0 0 0 k");
    expect(form).toMatch(/ c\n/);
    expect(form).not.toMatch(/\/Image|BI\b/);
    // Typsnitten är inbäddade delmängder av Roboto.
    expect(pdf.fonts.length).toBeGreaterThan(0);
    for (const font of pdf.fonts) {
      expect(font.base).toMatch(/^[A-Z]{6}\+Roboto/);
      expect(font.embedded).toBe(true);
    }
    expect(PDF_CAPABILITIES).toEqual({ pdfX: false, icc: false, trueOverprint: true });
    // Inget påstående om PDF/X eller ICC.
    expect(Buffer.from(result.bytes).toString("latin1")).not.toMatch(/OutputIntent|GTS_PDFX|ICCBased/);
  });

  it("kartans dekorfärger: Separation och DeviceN med filens CMYK, övertryck och knockout som i kartfilen", async () => {
    const { result, pdf } = await write(spotMap, "PRESS", profile("as-file"), pages(spotMap));
    expect(new Set(result.plates)).toEqual(new Set(["Black", "PMS299_Blue", "PMS361_Green", "Purple"]));
    // "Process Black" hamnar på processplåten Black.
    expect(plateName("Process Black")).toBe("Black");
    expect(spaceFor(pdf, "Black")).toBeDefined();
    expect(pdf.colorSpaces.get(spaceFor(pdf, "PMS299_Blue")!)).toMatchObject({ c1: [0.87, 0.185, 0, 0] });
    expect(pdf.colorSpaces.get(spaceFor(pdf, "PMS361_Green")!)).toMatchObject({ c1: [0.76, 0, 0.91, 0] });
    // Grön 100 % + svart 50 %: två plåtar, och typ 4-funktionen ger summan i CMYK.
    const [deviceN, both] = [...pdf.colorSpaces].find(([, space]) => space.kind === "DeviceN")!;
    expect(both.names).toEqual(["PMS361_Green", "Black"]);
    expect(both.functionType).toBe(4);
    expect(cmykOf(both.code!, [1, 0.5])).toEqual([0.76, 0, 0.91, 0.5]);
    expect(cmykOf(both.code!, [1, 1])).toEqual([0.76, 0, 0.91, 1]);
    expect(cmykOf(both.code!, [0, 0])).toEqual([0, 0, 0, 0]);
    const form = [...pdf.forms.values()][0]!;
    // Med övertryck (bara sina plåtar) respektive knockout (slår ut allt under), som i filen.
    const op = (pattern: string) => { const at = form.indexOf(pattern); expect(at).toBeGreaterThan(-1); return form.lastIndexOf("/GOP gs", at) > form.lastIndexOf("/GKO gs", at); };
    expect(op(`/${deviceN} cs 1 0.5 scn`)).toBe(true);
    expect(op(`/${spaceFor(pdf, "PMS361_Green")} cs 0.5 scn`)).toBe(false);
    expect(op(`/${spaceFor(pdf, "Black")} CS 1 SCN`)).toBe(true);
    // Vit för grön: plåten med 0 % och knockout.
    expect(op(`/${spaceFor(pdf, "PMS361_Green")} cs 0 scn`)).toBe(false);
    // Processfärgen utan dekorfärg (gul) skrivs i CMYK.
    expect(form).toContain("0 0.27 0.79 0 k");
  });

  it("tryckeri med kartan i CMYK: kartfärgernas egna CMYK med filens övertryck (OPM 1), banan som dekorfärg", async () => {
    const { result, pdf } = await write(spotMap, "PROCESS", profile("as-file"), pages(spotMap));
    expect(result.plates).toEqual(["Purple"]);
    const form = [...pdf.forms.values()][0]!;
    expect(form).not.toMatch(/\/CS\d+ cs/);
    const at = form.indexOf("0.76 0 0.91 0.5 k");
    expect(at).toBeGreaterThan(-1);
    expect(form.lastIndexOf("/GOP gs", at)).toBeGreaterThan(form.lastIndexOf("/GKO gs", at));
    expect(result.notes.join(" ")).toContain("skrivs som CMYK");
  });

  it("kontorsskrivare: bara CMYK, inga dekorfärger och inget övertryck, profilens ljusare grönt", async () => {
    const { result, pdf } = await write(ocd, "OFFICE");
    expect(pdf.colorSpaces.size).toBe(0);
    expect(result.plates).toEqual([]);
    expect(result.overprint).toBe(false);
    for (const page of pdf.pages) expect(page.content).not.toContain("/GOP gs");
    const form = [...pdf.forms.values()][0]!;
    expect(form).not.toContain("/GOP gs");
    // Grön 76/0/91/0 30 % ljusare = 53,2/0/63,7/0; banans lila i CMYK.
    expect(form).toContain("0.532 0 0.637 0 k");
    expect(pdf.pages[0]!.content).toContain("0.2 1 0 0 K");
  });

  it("profilen: dold färg ritas inte, ny CMYK och kartfärg som egen dekorfärg", async () => {
    const custom: PrintProfile = { ...profile("as-file"), id: "egen", name: "Egen", course: { cmyk: { c: 35, m: 85, y: 0, k: 0 }, spotName: "Violett", overprint: true },
      mapColors: [{ match: { names: ["Gul"] }, hidden: true }, { match: { names: ["Brun"] }, cmyk: { c: 0, m: 50, y: 100, k: 0 } },
        { match: { names: ["Blå"] }, spot: { name: "PMS 299", overprint: true } }] };
    const { pdf } = await write(ocd, "PRESS", custom);
    const form = [...pdf.forms.values()][0]!;
    expect(form).not.toContain("0 0.27 0.79 0 k");
    expect(form).toContain("0 0.5 1 0 K");
    expect(pdf.colorSpaces.get(spaceFor(pdf, "PMS 299")!)).toMatchObject({ c1: [1, 0, 0, 0] });
    expect(pdf.colorSpaces.get(spaceFor(pdf, "Violett")!)).toMatchObject({ c1: [0.35, 0.85, 0, 0] });
    expect(spaceFor(pdf, "Purple")).toBeUndefined();
  });

  it("utan övertryck för banan: knockout", async () => {
    const chosen = { ...profile("as-file"), course: { ...profile("as-file").course, overprint: false } };
    const { pdf } = await write(null, "PRESS", chosen);
    const purple = spaceFor(pdf, "Purple")!;
    const content = pdf.pages[0]!.content;
    expect(content).not.toContain("/GOP gs");
    expect(content).toContain(`/${purple} CS 1 SCN`);
  });

  it("en karta per löpare dubbelsidigt: baksidan efter varje karta i samma format, utsnittet skrivs en gång, vändning på långsidan", async () => {
    const template = BUILT_IN_SHEET_LAYOUTS.find(item => item.id === "a4-one")!;
    const runners = ["Anna", "Bertil", "Cecilia"].map((name, index) => ({ course: courses[0]!.id,
      runner: { kind: "RUNNER" as const, name, club: "OK", className: "D21", startTime: `18:0${index}`, startNumber: 10 + index } }));
    const sheets = runners.flatMap(item => sheetLayoutSheets(document, template, [item], { duplexBacks: true, mapBounds: ocd.bounds ?? undefined }));
    const { result, pdf } = await write(ocd, "PRESS", profile("as-file"), sheets);
    expect(result.pages).toBe(6);
    expect(result.mapForms).toBe(1);
    pdf.pages.forEach((page, index) => {
      expect(page.size).toEqual(pdf.pages[0]!.size);
      if (index % 2 === 0) expect(page.content).toMatch(/\/Fm0 Do/);
      else { expect(page.content).not.toMatch(/Do/); expect(page.content).toContain("Tj"); }
    });
    const preferences = pdf.document.catalog.lookup(PDFName.of("ViewerPreferences"), PDFDict);
    expect(preferences.get(PDFName.of("Duplex"))?.toString()).toBe("/DuplexFlipLongEdge");
  });

  it("layoutmall: skärmarker i registerfärgen, logotyp och remsa", async () => {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const base = BUILT_IN_SHEET_LAYOUTS.find(item => item.id === "a4-four")!;
    const template: SheetLayout = { ...base, id: "t", images: [{ x: 10, y: 280, width: 20, height: 10, mediaType: "image/png", data: png }],
      strips: [{ edge: "bottom", depthMm: 10, text: "{bana}", sizeMm: 5 }] };
    const sheets = sheetLayoutSheets(document, template, courses.map(course => ({ course: course.id })), { mapBounds: ocd.bounds ?? undefined });
    const { pdf } = await write(ocd, "PRESS", profile("as-file"), sheets);
    const all = [...pdf.colorSpaces].find(([, space]) => space.names[0] === "All");
    expect(all?.[1]).toMatchObject({ kind: "Separation", c1: [1, 1, 1, 1] });
    const content = pdf.pages[0]!.content;
    expect(content).toContain(`/${all![0]} CS 1 SCN`);
    expect(content).toMatch(/\/Im0 Do/);
    expect(content).toContain("0 0 0 0 k");
    // Fyra ramar på A4: lika många utsnitt som olika banor (samma bana skrivs en gång).
    expect(content.match(/\/Fm\d+ Do/g)?.length).toBe(Math.min(4, courses.length));
  });

  // Ghostscripts separationer (tiffsep) när gs finns i miljön: lilan på egen plåt och kartans svart orörd under banan.
  it.skipIf(!hasGhostscript())("separationerna i Ghostscript: lilan på egen plåt", async () => {
    const { result } = await write(ocd, "PRESS");
    const directory = mkdtempSync(join(tmpdir(), "otid-sep-"));
    try {
      writeFileSync(join(directory, "test.pdf"), result.bytes);
      execFileSync("gs", ["-q", "-dNOPAUSE", "-dBATCH", "-dSAFER", "-sDEVICE=tiffsep", "-r20", "-dFirstPage=1", "-dLastPage=1",
        `-sOutputFile=${join(directory, "sep.tif")}`, join(directory, "test.pdf")]);
      const files = readdirSync(directory);
      expect(files).toContain("sep(Purple).tif");
      // Plåten har tryck (inte bara vitt): tiffsep skriver 8 bitar där 0 = inget bläck.
      const plate = readFileSync(join(directory, "sep(Purple).tif"));
      expect(plate.some((value, index) => index > 200 && value > 128)).toBe(true);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

function hasGhostscript(): boolean {
  try { execFileSync("gs", ["--version"], { stdio: "ignore" }); return true; } catch { return false; }
}


