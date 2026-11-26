import { describe, expect, it } from "vitest";
import {
  applyEdit, BUILT_IN_PRINT_PROFILES, emptyDocument, layoutCoursePage, officePrintProfile, sheetOfPage,
  type CourseSettingDocument, type CourseSettingEdit, type PrintProfile, type Sheet
} from "@o-tid/course-setting";
import { readMapFile, type ParsedMap } from "@o-tid/map-file";
import { colorsOverCourse, plateName, writeSheetsPdf } from "../src";
import { Content, ColorSpaces } from "../src/content";
import { Fonts } from "../src/fonts";
import { isWhiteInk } from "../src/paint";
import { PdfCanvas } from "../src/pdf-canvas";
import { HALO_OMAP } from "./halo-map";
import { fontFiles, parsePdf } from "./helpers";
import { SPOT_OMAP } from "./spot-map";

const fonts = fontFiles();
const asFile = BUILT_IN_PRINT_PROFILES.find(item => item.id === "as-file")!;
const mapOwn = BUILT_IN_PRINT_PROFILES.find(item => item.id === "map-own")!;
const blForest = BUILT_IN_PRINT_PROFILES.find(item => item.id === "bl-forest-2026-11-02")!;
const spotMap = readMapFile(new TextEncoder().encode(SPOT_OMAP), "spot.omap");
const haloMap = readMapFile(new TextEncoder().encode(HALO_OMAP), "halo.omap");

function simpleSheet(map: ParsedMap, extra?: (edit: (c: CourseSettingEdit) => string) => void): Sheet[] {
  let doc: CourseSettingDocument = emptyDocument({ title: "Test", mapScale: map.scale });
  const edit = (change: CourseSettingEdit) => { const r = applyEdit(doc, change); doc = r.document; return r.created ?? ""; };
  const start = edit({ type: "ADD_CONTROL", kind: "START", at: { x: 10, y: 10 } });
  const c1 = edit({ type: "ADD_CONTROL", kind: "NORMAL", at: { x: 30, y: 30 }, code: "31" });
  const finish = edit({ type: "ADD_CONTROL", kind: "FINISH", at: { x: 50, y: 10 } });
  const course = edit({ type: "ADD_COURSE", name: "A" });
  for (const id of [start, c1, finish]) edit({ type: "INSERT_COURSE_CONTROL", course, control: id });
  extra?.(edit);
  return layoutCoursePage(doc, { course, mapBounds: map.bounds ?? { minX: 0, minY: 0, maxX: 60, maxY: 60 } }).map(sheetOfPage);
}

describe("Etapp 1B: paint.ts (isWhiteInk, plateName, spot/PROCESS/PRESS, registrationPaint, coursePaint)", () => {
  it("isWhiteInk identifierar CMYK-vitt, 0 %-spot och spot med vitt CMYK-alternativ", () => {
    expect(isWhiteInk({ kind: "CMYK", cmyk: { c: 0, m: 0, y: 0, k: 0 } })).toBe(true);
    expect(isWhiteInk({ kind: "CMYK", cmyk: { c: 0.02, m: 0.01, y: 0, k: 0 } })).toBe(true);
    expect(isWhiteInk({ kind: "CMYK", cmyk: { c: 0.05, m: 0, y: 0, k: 0 } })).toBe(false);
    expect(isWhiteInk({ kind: "SPOT", names: ["PMS361_Green"], alternates: [{ c: 0.76, m: 0, y: 0.91, k: 0 }], tints: [0] })).toBe(true);
    expect(isWhiteInk({ kind: "SPOT", names: ["Vit"], alternates: [{ c: 0, m: 0, y: 0, k: 0 }], tints: [1] })).toBe(true);
    expect(isWhiteInk({ kind: "SPOT", names: ["PMS299"], alternates: [{ c: 0.87, m: 0.185, y: 0, k: 0 }], tints: [1] })).toBe(false);
  });

  it("plateName spärrar reserverade PDF-namnen All och None", () => {
    expect(plateName("All")).toBe("Spot_All");
    expect(plateName("all")).toBe("Spot_All");
    expect(plateName("None")).toBe("Spot_None");
    expect(plateName("NONE")).toBe("Spot_None");
    expect(plateName("Process Black")).toBe("Black");
    expect(plateName("  ")).toBe("Spot");
  });

  it("vitt med spot.overprint: true tvingas alltid till knockout i både PROCESS och PRESS", async () => {
    const map: ParsedMap = {
      format: "OMAP", version: "9", scale: 10000, georeference: null, bounds: { minX: 0, minY: 0, maxX: 60, maxY: 60 }, warnings: [],
      colors: [
        { id: 1, name: "Vit mask", rank: 0, cmyk: { c: 0, m: 0, y: 0, k: 0 }, rgb: { r: 1, g: 1, b: 1 }, opacity: 1,
          spot: { name: "Vit", overprint: true, separations: [{ name: "Vit", factor: 1, cmyk: { c: 0, m: 0, y: 0, k: 0 } }] } },
        { id: 2, name: "Svart", rank: 1, cmyk: { c: 0, m: 0, y: 0, k: 1 }, rgb: { r: 0, g: 0, b: 0 }, opacity: 1,
          spot: { name: "Process Black", overprint: true, separations: [{ name: "Process Black", factor: 1, cmyk: { c: 0, m: 0, y: 0, k: 1 } }] } }
      ],
      symbols: new Map([
        ["1", { id: "1", code: { text: "401.1", main: 401, sub: 1 }, name: "Vit", hidden: false, kind: "AREA", fill: 1, hatches: [] }],
        ["2", { id: "2", code: { text: "505.0", main: 505, sub: 0 }, name: "Stig", hidden: false, kind: "LINE", strokes: [{ color: 2, width: 0.35 }] }]
      ]),
      objects: [
        { kind: "line", symbol: "2", path: [{ type: "M", x: 5, y: 5 }, { type: "L", x: 55, y: 55 }] },
        { kind: "area", symbol: "1", angle: 0, rings: [[{ type: "M", x: 10, y: 10 }, { type: "L", x: 25, y: 10 }, { type: "L", x: 25, y: 25 }, { type: "L", x: 10, y: 25 }]] }
      ]
    };
    const sheets = simpleSheet(map);
    for (const mode of ["PROCESS", "PRESS"] as const) {
      const result = await writeSheetsPdf({ sheets, map, profile: asFile, mode, fonts });
      const pdf = await parsePdf(result.bytes);
      const form = [...pdf.forms.values()][0]!;
      const whiteToken = mode === "PROCESS" ? "0 0 0 0 k" : "cs 1 scn";
      const at = form.lastIndexOf(whiteToken);
      expect(at).toBeGreaterThan(-1);
      const gop = form.lastIndexOf("/GOP gs", at);
      const gko = form.lastIndexOf("/GKO gs", at);
      expect(gop === -1 || gko > gop).toBe(true);
    }
  });

  it("PROCESS läcker aldrig /Separation-plåtar även när profilen har setting.spot; coursePaint respekterar processColors; registrationPaint ger BLACK på BL/processColors", async () => {
    const profile: PrintProfile = {
      ...asFile, id: "proc-test", processColors: true,
      // course.process är medvetet utelämnat för att testa processColors-spärren.
      course: { cmyk: { c: 35, m: 95, y: 0, k: 0 }, spotName: "Purple", overprint: false },
      mapColors: [{ match: { names: ["Gul"] }, spot: { name: "EgenGul", overprint: true } }]
    };
    const sheets = simpleSheet(spotMap).map(sheet => ({ ...sheet, cutMarks: [{ x1: 0, y1: 5, x2: 5, y2: 5 }] }));
    const result = await writeSheetsPdf({ sheets, map: spotMap, profile, mode: "PRESS", fonts });
    const pdf = await parsePdf(result.bytes);
    expect(result.plates).toEqual([]);
    expect(pdf.colorSpaces.size).toBe(0);
    // Skärmärken ritas i process-svart (0 0 0 1 K), aldrig /All.
    expect(pdf.pages[0]!.content).toContain("0 0 0 1 K");
    expect(Buffer.from(result.bytes).toString("latin1")).not.toContain("/All");

    // Även på BL-profil med reference: inga /All-skärmärken.
    const blRes = await writeSheetsPdf({ sheets, map: spotMap, profile: blForest, mode: "PRESS", fonts });
    expect(Buffer.from(blRes.bytes).toString("latin1")).not.toContain("/All");
  });

  it("PRESS: spot: null stänger av filens dekorfärg/övertryck; setting.spot med lighten styr tints på o-ljusat alternate; setting.cmyk bevarar filens övertryck", async () => {
    const profile: PrintProfile = {
      ...asFile, id: "press-rules",
      mapColors: [
        // Stäng av filens dekorfärg på Blå 100% (PMS299_Blue) → CMYK knockout.
        { match: { names: ["Blå 100%"] }, spot: null },
        // Egen dekorfärg på Gul + lighten 30 % → alternate = o-ljusad 0/27/79/0, tints = 0.7.
        { match: { names: ["Gul"] }, spot: { name: "EgenGul", overprint: true }, lighten: 30 },
        // Ändrad CMYK på Svart 100% (som har overprint: true i filen) → bevarar övertryck!
        { match: { names: ["Svart 100%"] }, cmyk: { c: 0, m: 0, y: 0, k: 90 } }
      ]
    };
    const result = await writeSheetsPdf({ sheets: simpleSheet(spotMap), map: spotMap, profile, mode: "PRESS", fonts });
    const pdf = await parsePdf(result.bytes);
    expect(result.plates).not.toContain("PMS299_Blue");
    expect(result.plates).toContain("EgenGul");
    const gulSpace = [...pdf.colorSpaces].find(([, s]) => s.names[0] === "EgenGul")!;
    // O-ljusat CMYK-alternativ (0, 0.27, 0.79, 0), och 0.7 som tint i strömmen!
    expect(gulSpace[1].c1).toEqual([0, 0.27, 0.79, 0]);
    const form = [...pdf.forms.values()][0]!;
    expect(form).toContain(`/${gulSpace[0]} cs 0.7 scn`);
    // Blå 100% skrivs som CMYK utan övertryck.
    const blueAt = form.indexOf("0.87 0.185 0 0 k");
    expect(blueAt).toBeGreaterThan(-1);
    expect(form.lastIndexOf("/GOP gs", blueAt) === -1 || form.lastIndexOf("/GKO gs", blueAt) > form.lastIndexOf("/GOP gs", blueAt)).toBe(true);
    // Svart 100% (ändrad till 90 % K) behåller filens övertryck.
    const blackAt = form.indexOf("0 0 0 0.9 K");
    expect(blackAt).toBeGreaterThan(-1);
    expect(form.lastIndexOf("/GOP gs", blackAt)).toBeGreaterThan(form.lastIndexOf("/GKO gs", blackAt));
  });
});

describe("Etapp 1B: UTF-8-kodade svenska dekorfärgsnamn (ISO 32000-1 §7.3.5)", () => {
  it("kodar åäö och tankstreck – som giltig UTF-8 #XX (aldrig Latin-1 #F6 eller 4-hex #2013)", async () => {
    const profile: PrintProfile = {
      ...asFile, id: "svenska-platar",
      course: { cmyk: { c: 20, m: 100, y: 0, k: 0 }, spotName: "Blå", overprint: true },
      mapColors: [
        { match: { names: ["Grön 50%"] }, spot: { name: "Grön 100%", overprint: true } },
        { match: { names: ["Svart 100%"] }, spot: { name: "Svart – 100%", overprint: true } }
      ]
    };
    const result = await writeSheetsPdf({ sheets: simpleSheet(spotMap), map: spotMap, profile, mode: "PRESS", fonts });
    const raw = Buffer.from(result.bytes).toString("latin1");
    expect(raw).toContain("/Bl#C3#A5");
    expect(raw).toContain("/Gr#C3#B6n#20100#25");
    expect(raw).toContain("/Svart#20#E2#80#93#20100#25");
    expect(raw).not.toContain("#F6");
    expect(raw).not.toContain("#2013");
    // Även round-trip via parsePdf återger exakta UTF-8-namnen.
    const pdf = await parsePdf(result.bytes);
    const allNames = [...pdf.colorSpaces.values()].flatMap(s => s.names);
    expect(allNames).toContain("Blå");
    expect(allNames).toContain("Grön 100%");
    expect(allNames).toContain("Svart – 100%");
  });
});

describe("Etapp 1B: OFFICE isolerad CMYK-transparensgrupp, PRESS egna övertryck & dolda färger", () => {
  it("OFFICE med OVER-band: varje INK-band har /Group DeviceCMYK /I true med knockout inuti, placeras med /GOP, WHITE-band med /GKO, sidan har CMYK /Group", async () => {
    const profile = officePrintProfile(mapOwn);
    const result = await writeSheetsPdf({ sheets: simpleSheet(haloMap), map: haloMap, profile, mode: "OFFICE", fonts });
    const pdf = await parsePdf(result.bytes);
    expect(result.overprint).toBe(false);
    expect(pdf.pages[0]!.group).toMatchObject({ S: "/Transparency", CS: "/DeviceCMYK" });
    // Minst ett INK-band har isolerad CMYK-grupp och noll /GOP inuti (noll TAC-blödning!).
    const isolatedForms = [...pdf.formGroups.entries()].filter(([, g]) => g.S === "/Transparency" && g.CS === "/DeviceCMYK" && g.I === "true");
    expect(isolatedForms.length).toBeGreaterThanOrEqual(2);
    for (const [name] of isolatedForms) {
      expect(pdf.forms.get(name)).not.toContain("/GOP gs");
    }
    // Sidan placerar isolerade INK-band efter /GOP gs och icke-isolerade WHITE-band i knockout (efter /GKO eller utan /GOP).
    const pageContent = pdf.pages[0]!.content;
    for (const [name] of isolatedForms) {
      const placedAt = pageContent.indexOf(`/${name} Do`);
      expect(placedAt).toBeGreaterThan(-1);
      const qStart = pageContent.lastIndexOf("\nq\n", placedAt);
      expect(pageContent.slice(qStart, placedAt)).toContain("/GOP gs");
    }
    // Vit för röd ligger som ett eget band utan /Group och utan /GOP gs vid placering.
    const whiteBand = [...pdf.forms.entries()].find(([name, body]) => name !== "Fm0" && !pdf.formGroups.has(name) && body.includes("0 0 0 0 k"));
    expect(whiteBand).toBeDefined();
    const whitePlaced = pageContent.indexOf(`/${whiteBand![0]} Do`);
    const whiteQ = pageContent.lastIndexOf("\nq\n", whitePlaced);
    expect(pageContent.slice(whiteQ, whitePlaced)).not.toContain("/GOP gs");
  });

  it("PRESS med OVER: enpass UNDER → LOWER → OVER (inga dubblerade OVER-vektorer) med kartfilens egna övertrycksflaggor", async () => {
    const map: ParsedMap = {
      format: "OMAP", version: "9", scale: 10000, georeference: null, bounds: { minX: 0, minY: 0, maxX: 60, maxY: 60 }, warnings: [],
      colors: [
        { id: 1, name: "Svart 100%", rank: 0, cmyk: { c: 0, m: 0, y: 0, k: 1 }, rgb: { r: 0, g: 0, b: 0 }, opacity: 1, overprint: true,
          spot: { name: "Process Black", overprint: true, separations: [{ name: "Process Black", factor: 1, cmyk: { c: 0, m: 0, y: 0, k: 1 } }] } },
        { id: 2, name: "Blå 100% linje", rank: 1, cmyk: { c: 0.95, m: 0.3, y: 0, k: 0 }, rgb: { r: 0, g: 0.5, b: 1 }, opacity: 1,
          spot: { name: "PMS299_Blue", overprint: false, separations: [{ name: "PMS299_Blue", factor: 1, cmyk: { c: 0.95, m: 0.3, y: 0, k: 0 } }] } },
        { id: 3, name: "Gul 100%", rank: 2, cmyk: { c: 0, m: 0.27, y: 0.79, k: 0 }, rgb: { r: 1, g: 0.8, b: 0 }, opacity: 1 }
      ],
      symbols: new Map([
        ["1", { id: "1", code: { text: "505.0", main: 505, sub: 0 }, name: "Stig", hidden: false, kind: "LINE", strokes: [{ color: 1, width: 0.35 }] }],
        ["2", { id: "2", code: { text: "304.0", main: 304, sub: 0 }, name: "Bäck", hidden: false, kind: "LINE", strokes: [{ color: 2, width: 0.3 }] }],
        ["3", { id: "3", code: { text: "401.0", main: 401, sub: 0 }, name: "Öppen mark", hidden: false, kind: "AREA", fill: 3, hatches: [] }]
      ]),
      objects: [
        { kind: "area", symbol: "3", angle: 0, rings: [[{ type: "M", x: 0, y: 0 }, { type: "L", x: 60, y: 0 }, { type: "L", x: 60, y: 60 }, { type: "L", x: 0, y: 60 }]] },
        { kind: "line", symbol: "2", path: [{ type: "M", x: 5, y: 20 }, { type: "L", x: 55, y: 20 }] },
        { kind: "line", symbol: "1", path: [{ type: "M", x: 20, y: 5 }, { type: "L", x: 20, y: 55 }] }
      ]
    };
    const result = await writeSheetsPdf({ sheets: simpleSheet(map), map, profile: mapOwn, mode: "PRESS", fonts });
    const pdf = await parsePdf(result.bytes);
    const underForm = pdf.forms.get("Fm0")!;
    const overForm = pdf.forms.get("Fm1")!;
    const blueSpace = [...pdf.colorSpaces].find(([, s]) => s.names[0] === "PMS299_Blue")![0];
    const blackSpace = [...pdf.colorSpaces].find(([, s]) => s.names[0] === "Black")![0];
    // Ren enpass-ordning som OCAD: UNDER innehåller bara gult (inga dubblerade OVER-objekt).
    expect(underForm).toContain("0 0.27 0.79 0 k");
    expect(underForm).not.toContain(`/${blueSpace} CS 1 SCN`);
    expect(underForm).not.toContain(`/${blackSpace} CS 1 SCN`);
    expect(overForm).not.toContain("0 0.27 0.79 0 k");
    const blueAt = overForm.indexOf(`/${blueSpace} CS 1 SCN`);
    const blackAt = overForm.indexOf(`/${blackSpace} CS 1 SCN`);
    expect(blueAt).toBeGreaterThan(-1);
    expect(blackAt).toBeGreaterThan(-1);
    // Blå 100% (overprint: false i filen) ska vara knockout i OVER.
    expect(overForm.lastIndexOf("/GOP gs", blueAt) === -1 || overForm.lastIndexOf("/GKO gs", blueAt) > overForm.lastIndexOf("/GOP gs", blueAt)).toBe(true);
    // Svart 100% (overprint: true i filen) ska behålla övertryck i OVER.
    expect(overForm.lastIndexOf("/GOP gs", blackAt)).toBeGreaterThan(overForm.lastIndexOf("/GKO gs", blackAt));
  });

  it("ren CMYK-färg med OCAD o1 (color.overprint: true utan spot) bevarar övertryck i PRESS och PROCESS, men vitt tvingas alltid till knockout", async () => {
    const map: ParsedMap = {
      format: "OCD", version: "OCAD 2018.8", scale: 10000, georeference: null, bounds: { minX: 0, minY: 0, maxX: 60, maxY: 60 }, warnings: [],
      colors: [
        { id: 1, name: "Vit CMYK o1", rank: 0, cmyk: { c: 0, m: 0, y: 0, k: 0 }, rgb: { r: 1, g: 1, b: 1 }, opacity: 1, overprint: true },
        { id: 2, name: "Svart CMYK o1", rank: 1, cmyk: { c: 0, m: 0, y: 0, k: 1 }, rgb: { r: 0, g: 0, b: 0 }, opacity: 1, overprint: true },
        { id: 3, name: "Gul", rank: 2, cmyk: { c: 0, m: 0.27, y: 0.79, k: 0 }, rgb: { r: 1, g: 0.8, b: 0 }, opacity: 1 }
      ],
      symbols: new Map([
        ["1", { id: "1", code: { text: "401.1", main: 401, sub: 1 }, name: "Vit", hidden: false, kind: "AREA", fill: 1, hatches: [] }],
        ["2", { id: "2", code: { text: "505.0", main: 505, sub: 0 }, name: "Stig", hidden: false, kind: "LINE", strokes: [{ color: 2, width: 0.35 }] }],
        ["3", { id: "3", code: { text: "401.0", main: 401, sub: 0 }, name: "Öppen mark", hidden: false, kind: "AREA", fill: 3, hatches: [] }]
      ]),
      objects: [
        { kind: "area", symbol: "3", angle: 0, rings: [[{ type: "M", x: 0, y: 0 }, { type: "L", x: 60, y: 0 }, { type: "L", x: 60, y: 60 }, { type: "L", x: 0, y: 60 }]] },
        { kind: "line", symbol: "2", path: [{ type: "M", x: 5, y: 20 }, { type: "L", x: 55, y: 20 }] },
        { kind: "area", symbol: "1", angle: 0, rings: [[{ type: "M", x: 10, y: 10 }, { type: "L", x: 20, y: 10 }, { type: "L", x: 20, y: 20 }, { type: "L", x: 10, y: 20 }]] }
      ]
    };
    const sheets = simpleSheet(map);
    // I PRESS och PROCESS (utan OVER-split, courseLayer TOP): Svart CMYK o1 får /GOP gs, Vit CMYK o1 tvingas till knockout (/GKO).
    for (const mode of ["PRESS", "PROCESS"] as const) {
      const pdf = await parsePdf((await writeSheetsPdf({ sheets, map, profile: asFile, mode, fonts })).bytes);
      const form = [...pdf.forms.values()][0]!;
      const blackAt = form.indexOf("0 0 0 1 K");
      expect(blackAt).toBeGreaterThan(-1);
      expect(form.lastIndexOf("/GOP gs", blackAt)).toBeGreaterThan(form.lastIndexOf("/GKO gs", blackAt));
      const whiteAt = form.lastIndexOf("0 0 0 0 k");
      expect(whiteAt).toBeGreaterThan(blackAt);
      expect(form.lastIndexOf("/GKO gs", whiteAt)).toBeGreaterThan(form.lastIndexOf("/GOP gs", whiteAt));
    }
    // Med spot: null i profilen stängs även ren CMYK o1 av till knockout.
    const disabled: PrintProfile = { ...asFile, id: "no-op", mapColors: [{ match: { names: ["Svart CMYK o1"] }, spot: null }] };
    const offPdf = await parsePdf((await writeSheetsPdf({ sheets, map, profile: disabled, mode: "PRESS", fonts })).bytes);
    expect([...offPdf.forms.values()][0]!).not.toContain("/GOP gs");
    // I OFFICE är det alltid knockout utan övertryck.
    const officePdf = await parsePdf((await writeSheetsPdf({ sheets, map, profile: asFile, mode: "OFFICE", fonts })).bytes);
    expect([...officePdf.forms.values()][0]!).not.toContain("/GOP gs");
  });

  it("dolda färger utelämnas ur colorsOverCourse, notes och ritning (inga tomma q/Q/W* n)", async () => {
    const map: ParsedMap = {
      format: "OMAP", version: "9", scale: 10000, georeference: null, bounds: { minX: 0, minY: 0, maxX: 60, maxY: 60 }, warnings: [],
      colors: [
        { id: 1, name: "Svart 100%", rank: 0, cmyk: { c: 0, m: 0, y: 0, k: 1 }, rgb: { r: 0, g: 0, b: 0 }, opacity: 1 },
        { id: 2, name: "Dold randning", rank: 1, cmyk: { c: 0, m: 0.56, y: 1, k: 0.18 }, rgb: { r: 0.7, g: 0.3, b: 0 }, opacity: 1 }
      ],
      symbols: new Map([
        ["1", { id: "1", code: { text: "505.0", main: 505, sub: 0 }, name: "Stig", hidden: false, kind: "LINE", strokes: [{ color: 1, width: 0.35 }] }],
        ["2", { id: "2", code: { text: "408.0", main: 408, sub: 0 }, name: "Randning", hidden: false, kind: "AREA", hatches: [{ color: 2, width: 0.2, spacing: 1, angle: 45 }] }]
      ]),
      objects: [
        { kind: "line", symbol: "1", path: [{ type: "M", x: 5, y: 5 }, { type: "L", x: 55, y: 55 }] },
        { kind: "area", symbol: "2", angle: 0, rings: [[{ type: "M", x: 0, y: 0 }, { type: "L", x: 60, y: 0 }, { type: "L", x: 60, y: 60 }, { type: "L", x: 0, y: 60 }]] }
      ]
    };
    const profile: PrintProfile = { ...mapOwn, id: "hide-hatch", mapColors: [{ match: { names: ["Dold randning"] }, hidden: true }] };
    expect([...(colorsOverCourse(map, profile) ?? [])]).toEqual([1]);
    const result = await writeSheetsPdf({ sheets: simpleSheet(map), map, profile, mode: "OFFICE", fonts });
    expect(result.notes.join(" ")).not.toContain("Dold randning");
    const pdf = await parsePdf(result.bytes);
    // Ingen hatch-klippning (W* n) skrevs för den dolda randningen.
    expect(pdf.forms.get("Fm0")).not.toContain("W* n");
  });
});

describe("Etapp 1B: klippbuggar, COMBINED-texter, genomskinlig 714/OVERLAP och PdfCanvas", () => {
  it("överlappande whiteAreas får en separat W* n per polygon och omarkerade specialobjekt klipps inte av markingPath", async () => {
    const baseSheets = simpleSheet(spotMap, edit => {
      edit({ type: "ADD_SPECIAL", special: { kind: "out-of-bounds", courses: [], points: [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }] } });
      edit({ type: "ADD_SPECIAL", special: { kind: "out-of-bounds", courses: [], points: [{ x: 25, y: 25 }, { x: 35, y: 25 }, { x: 35, y: 35 }, { x: 25, y: 35 }] } });
    });
    const frame = baseSheets[0]!.frames[0]!;
    const specialRefs = [...new Set(frame.figures.filter(f => f.role === "SPECIAL" && f.ref).map(f => f.ref!))];
    expect(specialRefs.length).toBe(2);
    const clip = frame.clip;
    const sheets: Sheet[] = [{
      ...baseSheets[0]!,
      frames: [{
        ...frame,
        // Två överlappande vita ytor: måste ge två separata `W* n`, inte sammanslagna.
        whiteAreas: [
          [{ x: clip.x, y: clip.y }, { x: clip.x + 20, y: clip.y }, { x: clip.x + 20, y: clip.y + 20 }, { x: clip.x, y: clip.y + 20 }],
          [{ x: clip.x + 10, y: clip.y + 10 }, { x: clip.x + 30, y: clip.y + 10 }, { x: clip.x + 30, y: clip.y + 30 }, { x: clip.x + 10, y: clip.y + 30 }]
        ],
        // Bara det första specialobjektet är markerat för markingClip.
        markingClip: {
          refs: [specialRefs[0]!],
          polygon: [{ x: clip.x + 2, y: clip.y + 2 }, { x: clip.x + 40, y: clip.y + 2 }, { x: clip.x + 40, y: clip.y + 40 }, { x: clip.x + 2, y: clip.y + 40 }]
        }
      }]
    }];
    const result = await writeSheetsPdf({ sheets, map: spotMap, profile: mapOwn, mode: "PRESS", fonts });
    const content = (await parsePdf(result.bytes)).pages[0]!.content;
    // I OVER-placeringen ska båda vita ytorna ge varsin separat `re ... h W* n`.
    const overIdx = content.indexOf("/Fm1 Do");
    const overClipBlock = content.slice(content.lastIndexOf("\nq\n", overIdx), overIdx);
    expect(overClipBlock.match(/W\* n/g)).toHaveLength(2);
    // Det omarkerade specialobjektet ska inte få markingClip (`h W n` inuti sin egen q/Q-grupp) utan bara de två `W* n`.
    const upperSection = content.slice(overIdx);
    const markingClipMatches = upperSection.match(/l h W n/g) ?? [];
    expect(markingClipMatches).toHaveLength(1);
  });

  it("neededFonts bäddar in typsnitt från TEXT-delar i COMBINED-symboler", async () => {
    const map: ParsedMap = {
      format: "OMAP", version: "9", scale: 10000, georeference: null, bounds: { minX: 0, minY: 0, maxX: 40, maxY: 40 }, warnings: [],
      colors: [{ id: 1, name: "Svart", rank: 0, cmyk: { c: 0, m: 0, y: 0, k: 1 }, rgb: { r: 0, g: 0, b: 0 }, opacity: 1 }],
      symbols: new Map([
        ["t1", { id: "t1", code: { text: "900.1", main: 900, sub: 1 }, name: "Kursiv fet text", hidden: false, kind: "TEXT", color: 1, size: 4, fontFamily: "Arial", bold: true, italic: true }],
        ["c1", { id: "c1", code: { text: "900.0", main: 900, sub: 0 }, name: "Kombinerad", hidden: false, kind: "COMBINED", parts: ["t1"] }]
      ]),
      objects: [{ kind: "text", symbol: "c1", at: { x: 20, y: 20 }, angle: 0, text: "Hej" }]
    };
    const result = await writeSheetsPdf({ sheets: simpleSheet(map), map, profile: asFile, mode: "OFFICE", fonts });
    const pdf = await parsePdf(result.bytes);
    expect(pdf.fonts.some(f => /BoldItalic/.test(f.base))).toBe(true);
  });

  it("714 tillfällig byggnad (tint 0.5) blir genomskinlig via /GOP (Darken i OFFICE, OPM 1 i BL/PROCESS)", async () => {
    const sheets = simpleSheet(spotMap, edit => {
      edit({ type: "ADD_SPECIAL", special: { kind: "temporary-construction", courses: [], points: [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 40 }, { x: 10, y: 40 }] } });
    });
    // OFFICE med courseLayer TOP (så bara 714 utlöser /GOP /Darken och sidans /Group).
    const officeTop: PrintProfile = { ...asFile, course: { ...asFile.course, overprint: false }, courseLayer: "TOP" };
    const officeRes = await writeSheetsPdf({ sheets, map: spotMap, profile: officeTop, mode: "OFFICE", fonts });
    const officePdf = await parsePdf(officeRes.bytes);
    expect(officePdf.pages[0]!.content).toContain("/GOP gs\n0.1 0.5 0 0 k");
    expect(officePdf.pages[0]!.group).toMatchObject({ S: "/Transparency", CS: "/DeviceCMYK" });
    expect(officeRes.overprint).toBe(false);

    // BL/PROCESS (course.overprint === false): 714 använder /GOP (/OP true /OPM 1), ingen transparens.
    const blRes = await writeSheetsPdf({ sheets, map: spotMap, profile: { ...blForest, courseLayer: "TOP" }, mode: "PRESS", fonts });
    const blPdf = await parsePdf(blRes.bytes);
    expect(blPdf.pages[0]!.content).toContain("/GOP gs\n0.175 0.475 0 0 k");
    expect(blPdf.pages[0]!.group).toBeUndefined();
  });

  it("PdfCanvas bevarar kartfärgens egen opacity < 1, sluter hela cirklar med h och stödjer textBaseline bottom", async () => {
    const map: ParsedMap = {
      format: "OMAP", version: "9", scale: 10000, georeference: null, bounds: { minX: 0, minY: 0, maxX: 40, maxY: 40 }, warnings: [],
      colors: [{ id: 1, name: "Halvblå", rank: 0, cmyk: { c: 1, m: 0, y: 0, k: 0 }, rgb: { r: 0, g: 0.5, b: 1 }, opacity: 0.5 }],
      symbols: new Map([
        ["p1", { id: "p1", code: { text: "306.0", main: 306, sub: 0 }, name: "Ring", hidden: false, kind: "POINT",
          elements: [{ kind: "circle", color: 1, center: { x: 0, y: 0 }, diameter: 2, lineWidth: 0.2 }] }]
      ]),
      objects: [{ kind: "point", symbol: "p1", at: { x: 20, y: 20 }, angle: 0 }]
    };
    const result = await writeSheetsPdf({ sheets: simpleSheet(map), map, profile: asFile, mode: "OFFICE", fonts });
    const form = [...(await parsePdf(result.bytes)).forms.values()][0]!;
    // Halvblå med opacity 0.5 → 0.5 0 0 0 K (inte 1 0 0 0 K!), och hel cirkel sluts med h före S.
    expect(form).toContain("0.5 0 0 0 K");
    expect(form).not.toContain("1 0 0 0 K");
    expect(form).toMatch(/ c\nh\nS/);

    // textBaseline === "bottom" förskjuter baslinjen med font.descent * size (skiljer sig från alphabetic).
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const embedded = new Fonts(fonts);
    await embedded.embed(doc, ["regular"]);
    const content = new Content(new ColorSpaces());
    const canvas = new PdfCanvas({
      device: [1, 0, 0, -1, 0, 100], width: 100, height: 100, content, fonts: embedded,
      paintFor: () => ({ ink: { kind: "CMYK", cmyk: { c: 0, m: 0, y: 0, k: 1 } }, overprint: false })
    });
    canvas.beforeColor({ id: 1, name: "Svart", rank: 0, cmyk: { c: 0, m: 0, y: 0, k: 1 }, rgb: { r: 0, g: 0, b: 0 }, opacity: 1 });
    canvas.font = "10px Roboto";
    canvas.textBaseline = "alphabetic";
    canvas.fillText("A", 10, 50);
    canvas.textBaseline = "bottom";
    canvas.fillText("A", 10, 50);
    const ys = [...content.text().matchAll(/10 0 0 10 10 ([\d.]+) Tm/g)].map(m => Number(m[1]));
    expect(ys).toHaveLength(2);
    // descent är negativ (−0,244), så i PDF (y uppåt) hamnar bottom-textens baslinje högre (+2,44 pt) än alphabetic (50).
    expect(ys[0]).toBeCloseTo(50, 2);
    expect(ys[1]).toBeGreaterThan(52);
  });
});
