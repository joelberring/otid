import { describe, expect, it } from "vitest";
import {
  applyEdit, RUNNER_BACK, BUILT_IN_PRINT_PROFILES, BUILT_IN_TEMPLATES, colorPreflight, CourseSettingEditError, fillPlaceholders, gridTemplate, layoutTemplateSheets,
  mapColorAdjust, parseLayoutTemplate, parsePrintProfile, readPpen, sourceMapColors, toPage, writePpen, type PrintProfile
} from "../src";
import { lineCourse } from "./build";

const color = (id: number, name: string, rank: number, cmyk: [number, number, number, number], overprint = false) =>
  ({ id, name, rank, cmyk: { c: cmyk[0] / 100, m: cmyk[1] / 100, y: cmyk[2] / 100, k: cmyk[3] / 100 }, ...(overprint ? { spot: { name: name, overprint } } : {}) });

describe("utskriftsprofilen (steg 64, ADR-0183)", () => {
  const forest = BUILT_IN_PRINT_PROFILES.find(profile => profile.id === "bl-forest-2026-08-27")!;

  it("avvisar okänd schemaVersion och går fram och tillbaka som JSON", () => {
    expect(parsePrintProfile(JSON.stringify(forest))).toEqual(forest);
    expect(() => parsePrintProfile(JSON.stringify({ ...forest, schemaVersion: 2 }))).toThrow(CourseSettingEditError);
    expect(() => parsePrintProfile("{")).toThrow(/inte JSON/);
  });

  it("rättar kartans färger utan att kartfilen ändras: dölj, CMYK, ljusare och dekorfärg", () => {
    const map = [color(1, "Svart", 0, [0, 0, 0, 100]), color(2, "Grön 100%", 5, [76, 0, 91, 0]), color(3, "Gul 100%", 6, [0, 27, 94, 0])];
    const office = BUILT_IN_PRINT_PROFILES.find(profile => profile.id === "office")!;
    expect(mapColorAdjust(office, map)).toEqual({ 2: { lighten: 0.3 }, 3: { lighten: 0.15 } });
    const own: PrintProfile = { ...office, id: "egen", mapColors: [{ match: { ocadIds: [1] }, hidden: true }, { match: { names: ["grön 100%"] }, cmyk: { c: 60, m: 0, y: 80, k: 0 },
      spot: { name: "PMS 361", overprint: true } }] };
    expect(mapColorAdjust(own, map)).toEqual({ 1: { hidden: true }, 2: { cmyk: { c: 0.6, m: 0, y: 0.8, k: 0 }, spot: { name: "PMS 361", overprint: true } } });
    expect(map[1]!.cmyk.c).toBe(0.76);
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
    b.edit({ type: "PUT_LAYOUT_TEMPLATE", template: { ...BUILT_IN_TEMPLATES[1]!, id: "mina", name: "Mina" } });
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
    const template = BUILT_IN_TEMPLATES.find(item => item.id === "a4-four")!;
    const items = [{ course }, { course: other }, { course }, { course: other }, { course }];
    const sheets = layoutTemplateSheets(b.document, template, items, { mode: "FILL" });
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
    expect(layoutTemplateSheets(b.document, template, [{ course }], { mode: "REPEAT" })[0]!.frames.map(row => row.course)).toEqual([course, course, course, course]);
  });

  it("platshållare, logotyp, beskrivning, remsan och baksidan per löpare", () => {
    const { b, course } = lineCourse(3);
    const runner = { kind: "RUNNER" as const, name: "Anna Andersson", club: "OK Ravinen", className: "D21", startTime: "18:32", startNumber: 112 };
    const strip = BUILT_IN_TEMPLATES.find(item => item.id === "a4-strip")!;
    const template = { ...strip, texts: [{ x: 10, y: 15, text: "{tävling} {datum}", sizeMm: 5 }],
      images: [{ x: 170, y: 8, width: 30, height: 12, mediaType: "image/png", data: "iVBORw0KGgo=" }],
      descriptions: [{ frame: 0, x: 150, y: 30, boxMm: 5 }] };
    const sheets = layoutTemplateSheets(b.document, template, [{ course, runner }, { course, runner: { kind: "RESERVE" as const, name: null, className: "D21",
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
    expect(parseLayoutTemplate(JSON.stringify(template))).toEqual(template);
    expect(() => parseLayoutTemplate(JSON.stringify({ ...template, schemaVersion: 9 }))).toThrow(/schemaVersion/);
    expect(() => parseLayoutTemplate(JSON.stringify({ ...template, frames: [{ x: 0, y: 0, width: -1, height: 2 }] }))).toThrow(/rektangel/);
  });
});
