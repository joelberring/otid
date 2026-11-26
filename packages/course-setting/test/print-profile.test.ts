import { describe, expect, it } from "vitest";
import {
  applyEdit, RUNNER_BACK, BUILT_IN_PRINT_PROFILES, BUILT_IN_SHEET_LAYOUTS, colorPreflight, CourseSettingEditError, effectiveSourceMapColors, fillPlaceholders,
  gridTemplate, sheetLayoutSheets, mapColorAdjust, parseSheetLayout, parsePrintProfile, readPpen, sourceMapColors, toPage, validatePrintProfile, writePpen,
  type PrintProfile
} from "../src";
import { lineCourse } from "./build";

const color = (id: number, name: string, rank: number, cmyk: [number, number, number, number], overprint = false) =>
  ({ id, name, rank, cmyk: { c: cmyk[0] / 100, m: cmyk[1] / 100, y: cmyk[2] / 100, k: cmyk[3] / 100 }, ...(overprint ? { spot: { name: name, overprint } } : {}) });

describe("utskriftsprofilen (steg 64, ADR-0183)", () => {
  const forest = BUILT_IN_PRINT_PROFILES.find(profile => profile.id === "bl-forest-2026-08-27")!;

  it("avvisar okänd schemaVersion, för långt id (>64) och går fram och tillbaka som JSON (inkl. spot: null och lighten: 0)", () => {
    expect(parsePrintProfile(JSON.stringify(forest))).toEqual(forest);
    expect(() => parsePrintProfile(JSON.stringify({ ...forest, schemaVersion: 2 }))).toThrow(CourseSettingEditError);
    expect(() => parsePrintProfile("{")).toThrow(/inte JSON/);
    expect(() => validatePrintProfile({ ...forest, id: "a".repeat(65) })).toThrow(/64/);
    expect(validatePrintProfile({ ...forest, id: "a".repeat(64) }).id).toHaveLength(64);
    const withNullSpot: PrintProfile = { ...forest, id: "utan-spot", mapColors: [{ match: { ocadIds: [1] }, spot: null, lighten: 0 }] };
    expect(parsePrintProfile(JSON.stringify(withNullSpot))).toEqual(withNullSpot);
  });

  it("rättar kartans färger utan att kartfilen ändras: dölj, CMYK, ljusare, dekorfärg och sammanslagning med BL-beslut", () => {
    const map = [color(1, "Svart", 0, [0, 0, 0, 100]), color(2, "Grön 100%", 5, [76, 0, 91, 0]), color(3, "Gul 100%", 6, [0, 27, 94, 0])];
    const office = BUILT_IN_PRINT_PROFILES.find(profile => profile.id === "office")!;
    expect(office.courseLayer).toBe("REFERENCE");
    expect(mapColorAdjust(office, map)).toEqual({ 2: { lighten: 0.3 }, 3: { lighten: 0.15 } });
    const own: PrintProfile = { ...office, id: "egen", mapColors: [{ match: { ocadIds: [1] }, hidden: true }, { match: { names: ["grön 100%"] }, cmyk: { c: 60, m: 0, y: 80, k: 0 },
      spot: { name: "PMS 361", overprint: true } }] };
    expect(mapColorAdjust(own, map)).toEqual({ 1: { hidden: true }, 2: { cmyk: { c: 0.6, m: 0, y: 0.8, k: 0 }, spot: { name: "PMS 361", overprint: true } } });
    expect(map[1]!.cmyk.c).toBe(0.76);

    // BL-beslut bevaras när en rad bara ändrar lighten/spot; specifik rad med lighten: 0 upphäver mönsterregel; tom zombierad slår inte ut BL-beslut.
    const blForest = BUILT_IN_PRINT_PROFILES.find(profile => profile.id === "bl-forest-2026-11-02")!;
    const merged: PrintProfile = {
      ...blForest,
      id: "bl-kombo",
      colorDecisions: [
        { ocadId: 2, name: "Grön 100%", cmyk: { c: 80, m: 0, y: 100, k: 0 }, row: "green-100" },
        { ocadId: 3, name: "Gul 100%", cmyk: { c: 0, m: 25, y: 95, k: 0 }, row: "yellow-100" }
      ],
      mapColors: [
        ...office.mapColors,
        { match: { ocadIds: [2] }, lighten: 15, spot: null },
        { match: { ocadIds: [3] }, lighten: 0 }
      ]
    };
    expect(mapColorAdjust(merged, map)).toEqual({
      2: { cmyk: { c: 0.76, m: 0, y: 0.91, k: 0 }, lighten: 0.15, spot: null },
      3: { cmyk: { c: 0, m: 0.27, y: 0.94, k: 0 }, lighten: 0 }
    });
    const withZombie: PrintProfile = { ...blForest, id: "bl-zombie", colorDecisions: merged.colorDecisions, mapColors: [{ match: { ocadIds: [2] } }] };
    expect(mapColorAdjust(withZombie, map)[2]).toEqual({ cmyk: { c: 0.76, m: 0, y: 0.91, k: 0 } });
  });

  it("sourceMapColors och effectiveSourceMapColors bevarar ren CMYK-overprint (OCAD o1) och låter spot: null stänga av den", () => {
    const cmykOverprint = [
      { id: 1, name: "Svart CMYK o1", rank: 0, cmyk: { c: 0, m: 0, y: 0, k: 1 }, overprint: true },
      { id: 2, name: "Brun CMYK knockout", rank: 1, cmyk: { c: 0, m: 0.56, y: 1, k: 0.18 } }
    ];
    const src = sourceMapColors(cmykOverprint);
    expect(src.find(item => item.ocadId === 1)?.overprint).toBe(true);
    expect(src.find(item => item.ocadId === 2)?.overprint).toBe(false);
    const eff = effectiveSourceMapColors(cmykOverprint, undefined, { 1: { spot: null } });
    expect(eff.find(item => item.ocadId === 1)?.overprint).toBe(false);
    expect(effectiveSourceMapColors(cmykOverprint).find(item => item.ocadId === 1)?.overprint).toBe(true);
  });

  it("inbyggda kontorsprofilen ljusar bara gröna/gula ytor, aldrig Olivgrön, Mörkgrön, Punktobjekt, Grön+Svart eller Vit för grön/gul", () => {
    const office = BUILT_IN_PRINT_PROFILES.find(profile => profile.id === "office")!;
    const names = [
      "Grön 100% - Ytobjekt", "Grön 50% - Ytobjekt", "Grön 20% - Ytobjekt", "Grön 100% - Hindrande markvegetation",
      "Grön 60 %", "Grön 30 %", "Grön", "Gul 100% - Ytobjekt", "Gul 50 %", "Gul",
      "Olivgrön", "Mörkgrön", "Dark green", "Grön 100% - Punktobjekt", "Grön 100% + 50% Svart - Ytobjekt",
      "Gul 100% + Grön 50%", "Vit för Grön", "Vit för Gul", "Vit över grön", "Vit över gul"
    ];
    const adj = mapColorAdjust(office, names.map((name, index) => ({ id: index + 1, name })));
    const lightened = names.filter((_, index) => adj[index + 1]?.lighten !== undefined);
    expect(lightened).toEqual([
      "Grön 100% - Ytobjekt", "Grön 50% - Ytobjekt", "Grön 20% - Ytobjekt", "Grön 100% - Hindrande markvegetation",
      "Grön 60 %", "Grön 30 %", "Grön", "Gul 100% - Ytobjekt", "Gul 50 %", "Gul"
    ]);
  });

  it("effectiveSourceMapColors filtrerar dolda färger och uppdaterar CMYK och overprint efter adjust", () => {
    const map = [
      color(1, "Svart", 0, [0, 0, 0, 100], true),
      color(2, "Grön 100%", 1, [80, 0, 100, 0], true),
      color(3, "Gul 100%", 2, [0, 25, 95, 0], false)
    ];
    const effective = effectiveSourceMapColors(map, undefined, {
      1: { spot: null },
      2: { cmyk: { c: 0.76, m: 0, y: 0.91, k: 0 }, lighten: 0.5 },
      3: { hidden: true }
    });
    expect(effective).toEqual([
      { ocadId: 2, name: "Grön 100%", cmyk: { c: 38, m: 0, y: 45.5, k: 0 }, overprint: true, drawOrder: 0 },
      { ocadId: 1, name: "Svart", cmyk: { c: 0, m: 0, y: 0, k: 100 }, overprint: false, drawOrder: 1 }
    ]);
  });

  it("förhandskontrollen: träff, avvikande CMYK, behöver bekräftas, tvetydig och fel ordning", () => {
    const map = sourceMapColors([
      color(50, "Violett", 0, [35, 95, 0, 0]),
      color(10, "Svart", 1, [0, 0, 0, 100]),
      color(52, "Violett transparent", 3, [35, 95, 0, 0], true),
      color(11, "Grön 100%", 8, [70, 0, 91, 0]),
      color(12, "Grön 60 % ny", 9, [44, 0, 54, 0]),
      color(13, "Gul", 10, [0, 27, 94, 0]),
      color(14, "Gul igen", 11, [0, 27, 94, 0])
    ]);
    const report = colorPreflight(forest, map);
    const status = Object.fromEntries(report.results.map(result => [result.rule, result.status]));
    expect(status.black).toBe("MATCHED");
    expect(status["green-100"]).toBe("MATCHED");
    expect(status["green-60"]).toBe("NEEDS_CONFIRMATION");
    expect(status["yellow-100"]).toBe("AMBIGUOUS");
    expect(status["blue-area"]).toBe("NOT_PRESENT");
    expect(report.findings.some(finding => finding.severity === "WARNING" && finding.text.includes("Grön 100% ska ha CMYK 76/0/91/0"))).toBe(true);
    // Violett transparent ska ligga under svart; i kartan (rank 3 mot svartens 1) gör den det, så ingen varning för ordningen.
    expect(report.findings.some(finding => finding.rule === "violet-transparent" && finding.text.includes("ska ligga"))).toBe(false);
    expect(report.canPrint).toBe(false);
    const confirmed = colorPreflight(forest, map, undefined, new Set(["green-60"]));
    expect(confirmed.findings.find(finding => finding.rule === "green-60")?.severity).toBe("WARNING");
    // Rapporten ändrar ingenting.
    expect(map.find(row => row.name === "Violett")!.cmyk).toEqual({ c: 35, m: 95, y: 0, k: 0 });
    const strict = colorPreflight({ ...forest, rules: [], requirements: { pdfX: true, icc: false, trueOverprint: true } }, map);
    expect(strict.findings.filter(finding => finding.severity === "BLOCKING")).toHaveLength(2);
  });

  it("sparas i dokumentet, väljs och skrivs inte till .ppen", () => {
    const { b } = lineCourse(2);
    const office = BUILT_IN_PRINT_PROFILES.find(profile => profile.id === "office")!;
    expect(() => applyEdit(b.document, { type: "PUT_PRINT_PROFILE", profile: office })).toThrow(/inbyggd/);
    b.edit({ type: "PUT_PRINT_PROFILE", profile: { ...office, id: "kontoret", name: "Kontoret" } });
    b.edit({ type: "SET_EVENT", changes: { printProfileId: "kontoret" } });
    b.edit({ type: "PUT_LAYOUT_TEMPLATE", template: { ...BUILT_IN_SHEET_LAYOUTS[1]!, id: "mina", name: "Mina" } });
    expect(b.document.event.printProfiles?.map(profile => profile.id)).toEqual(["kontoret"]);
    expect(b.document.event.layoutTemplates?.map(template => template.id)).toEqual(["mina"]);
    expect(writePpen(b.document)).not.toContain("kontoret");
    b.edit({ type: "DELETE_PRINT_PROFILE", id: "kontoret" });
    expect(b.document.event.printProfileId).toBeUndefined();
    expect(readPpen(writePpen(b.document)).document.event.layoutTemplates).toBeUndefined();
  });
});

describe("layoutmallen (paperspace, steg 64)", () => {
  it("fyra kartor per A4: fyll sidan i ordning, ramarnas transform och skärmarker", () => {
    const { b, course } = lineCourse(3);
    const other = b.course("B");
    const template = BUILT_IN_SHEET_LAYOUTS.find(item => item.id === "a4-four")!;
    const items = [{ course }, { course: other }, { course }, { course: other }, { course }];
    const sheets = sheetLayoutSheets(b.document, template, items, { mode: "FILL" });
    expect(sheets.map(sheet => sheet.frames.length)).toEqual([4, 1]);
    const frame = sheets[0]!.frames[0]!;
    // Ramen är kartans utsnitt i 1:10 000 (kartans mm = papperets mm).
    expect(frame.transform.scale).toBeCloseTo(1, 9);
    expect(frame.mapArea.maxX - frame.mapArea.minX).toBeCloseTo(frame.clip.width, 6);
    const corner = toPage(frame, { x: frame.mapArea.minX, y: frame.mapArea.maxY });
    expect(corner.x).toBeCloseTo(frame.clip.x, 9);
    expect(corner.y).toBeCloseTo(frame.clip.y, 9);
    expect(sheets[0]!.cutMarks.length).toBeGreaterThan(0);
    expect(sheets[0]!.texts.map(text => text.text.split(" ")[0])).toEqual(["A", "B", "A", "B"]);
    expect(sheets[0]!.texts[0]!.text).toMatch(/^A {2}\d+,\d km {2}1:10 000$/);
    // Upprepa: varje bana i alla ramar på sitt eget ark.
    expect(sheetLayoutSheets(b.document, template, [{ course }], { mode: "REPEAT" })[0]!.frames.map(row => row.course)).toEqual([course, course, course, course]);
  });

  it("platshållare, logotyp, beskrivning, remsan och baksidan per löpare", () => {
    const { b, course } = lineCourse(3);
    const runner = { kind: "RUNNER" as const, name: "Anna Andersson", club: "OK Ravinen", className: "D21", startTime: "18:32", startNumber: 112 };
    const strip = BUILT_IN_SHEET_LAYOUTS.find(item => item.id === "a4-strip")!;
    const template = { ...strip, texts: [{ x: 10, y: 15, text: "{tävling} {datum}", sizeMm: 5 }],
      images: [{ x: 170, y: 8, width: 30, height: 12, mediaType: "image/png", data: "iVBORw0KGgo=" }],
      descriptions: [{ frame: 0, x: 150, y: 30, boxMm: 5 }] };
    const sheets = sheetLayoutSheets(b.document, template, [{ course, runner }, { course, runner: { kind: "RESERVE" as const, name: null, className: "D21",
      startTime: null, startNumber: null } }], { mode: "FILL", date: "2026-12-09", duplexBacks: true });
    expect(sheets.map(sheet => sheet.back === true)).toEqual([false, true, false, true]);
    const front = sheets[0]!;
    expect(front.texts.map(text => text.text)).toEqual(["Test 2026-12-09", "Anna Andersson  D21  18:32  nr 112"]);
    expect(front.boxes).toEqual([{ x: 7, y: 297 - 7 - 14, width: 210 - 14, height: 14, border: true }]);
    expect(front.images).toHaveLength(1);
    expect(front.descriptions[0]!.layout.widthMm).toBeCloseTo(8 * 5 + 0.25, 6);
    // ADR-0213: baksidan är papperets element (förvalet som Kartor till startens baksida); tomma rader står inte.
    const backTexts = (index: number) => (sheets[index]!.paperItems ?? []).map(item => item.parts.flatMap(part => part.kind === "text" ? [part.text] : []).join("\n"));
    expect(backTexts(1)).toEqual(["112", "Anna Andersson", "OK Ravinen", "D21  18:32"]);
    expect(backTexts(3)).toEqual(["Reserv", "D21"]);
    expect(sheets[1]!.paperItems!.every(item => item.course === RUNNER_BACK && item.relativeTo === "PAGE")).toBe(true);
    expect(fillPlaceholders("{löpare}|{klass}|{okänd}", b.document, { course, printScale: 10000, runner: { ...runner, kind: "VACANT", name: null } }))
      .toBe("Ledig|D21|{okänd}");
  });

  it("avvisar okänd schemaVersion och fel delar", () => {
    const template = gridTemplate("x", "X", "A5", false, 1, 1);
    expect(parseSheetLayout(JSON.stringify(template))).toEqual(template);
    expect(() => parseSheetLayout(JSON.stringify({ ...template, schemaVersion: 9 }))).toThrow(/schemaVersion/);
    expect(() => parseSheetLayout(JSON.stringify({ ...template, frames: [{ x: 0, y: 0, width: -1, height: 2 }] }))).toThrow(/rektangel/);
  });
});
