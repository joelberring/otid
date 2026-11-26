/**
 * Städrundan 2026-11-07: PDF-jobbets kartbyten (ADR-0203) och bortvalda varianter (ADR-0198) i servern.
 * B1: delen i förfrågan ger ett ark per del (förut tappade klienten delen och hela banan skrevs två gånger).
 * B7: servern skriver aldrig ut en bortvald variant, också om klientens lista har den.
 */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { PrintJobRequest } from "@o-tid/contracts";
import {
  acceptSafe, allCourseVariants, applyEdit, BL_FOREST_2026_11_02, BUILT_IN_PRINT_PROFILES, emptyDocument, officePrintProfile, proposeColorMatches,
  readPpen, sourceMapColors, type OverprintPrimitive, type PrintProfile, type Sheet
} from "@o-tid/course-setting";
import { colorUsage, readMapFile } from "@o-tid/map-file";
import { FONT_FILE_NAMES, FONT_VARIANTS, type FontFiles } from "@o-tid/print-pdf";
import { printJobSheets, PrintJobError, renderPrintJob } from "../src/course-setting-print-render";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const fonts = () => Object.fromEntries(FONT_VARIANTS.map(variant =>
  [variant, new Uint8Array(readFileSync(new URL(`packages/print-pdf/fonts/${FONT_FILE_NAMES[variant]}`, root)))])) as unknown as FontFiles;

const request = (items: PrintJobRequest["items"], duplex = false): PrintJobRequest => ({ formatVersion: 1, requestId: crypto.randomUUID(), kind: "OFFICE",
  profileId: "office", layout: { kind: "PAGES", header: false }, perRunner: false, duplex, items, warningsConfirmed: true });

/** Kontrollernas mittpunkter (ringarna) i delens banpåtryck, utan överlappet från föregående del. */
const circles = (sheet: Sheet) => sheet.frames[0]!.figures
  .filter((figure): figure is Extract<OverprintPrimitive, { kind: "circle" }> => figure.kind === "circle" && figure.role === "CONTROL")
  .map(figure => `${figure.center.x.toFixed(2)},${figure.center.y.toFixed(2)}`);
const starts = (sheet: Sheet) => sheet.frames[0]!.figures.filter(figure => figure.role === "START" || figure.role === "MAP_EXCHANGE");

describe("PDF-jobbet: kartbytets delar (ADR-0203)", () => {
  const document = readPpen(read("fixtures/purplepen/controller/mapexchange1.ppen")).document;

  it("två delar ger två olika ark: del 1 slutar vid bytet, del 2 börjar där; dubbelsidigt lägger del 2 på baksidan", () => {
    const sheets = printJobSheets(document, request([{ course: "2", part: 0 }, { course: "2", part: 1 }], true), undefined);
    expect(sheets).toHaveLength(2);
    expect(sheets.map(sheet => [sheet.frames[0]!.part, sheet.back === true])).toEqual([[0, false], [1, true]]);
    expect(sheets[0]!.frames[0]!.title).toMatch(/del 1$/);
    expect(sheets[1]!.frames[0]!.title).toMatch(/del 2$/);
    const first = circles(sheets[0]!), second = circles(sheets[1]!);
    expect(first).not.toEqual(second);
    // Kartbytet (kontrollen 76) står sist i del 1 och först (som delens start) i del 2.
    const exchange = Object.values(document.controls).find(control => control.code === "76")!;
    const at = `${exchange.at.x.toFixed(2)},${exchange.at.y.toFixed(2)}`;
    expect(first.at(-1)).toBe(at);
    const begin = starts(sheets[1]!).find((figure): figure is Extract<OverprintPrimitive, { kind: "circle" }> => figure.kind === "circle")!;
    expect(`${begin.center.x.toFixed(2)},${begin.center.y.toFixed(2)}`).toBe(at);
    expect(second).not.toContain(at);
    // Hela banan utan del är en tredje, annan sida.
    const whole = printJobSheets(document, request([{ course: "2" }]), undefined);
    expect(whole).toHaveLength(1);
    expect(circles(whole[0]!).length).toBeGreaterThan(Math.max(first.length, second.length));
  });
});

describe("PDF-jobbet: bortvalda varianter (ADR-0198)", () => {
  const base = readPpen(read("fixtures/course-setting/gaffling-urval.ppen")).document;
  const natt = base.courses.find(course => course.name === "Natt")!.id;
  const all = allCourseVariants(base, natt);
  const document = applyEdit(base, { type: "UPDATE_COURSE", course: natt, changes: {
    excludedVariants: ["BDF"].map(code => ({ code, controls: [...all.find(row => row.code === code)!.controlCodes] })) } }).document;

  it("servern filtrerar bort en bortvald variant ur klientens lista", () => {
    const sheets = printJobSheets(document, request([{ course: natt, variant: "ACE" }, { course: natt, variant: "BDF" }]), undefined);
    expect(sheets.map(sheet => sheet.frames[0]!.variant)).toEqual(["ACE"]);
  });

  it("jobbet säger vad som togs bort, och bara bortvalda ger inget att skriva ut", async () => {
    const input = { document, map: null, fonts: fonts(), maxPages: 10, title: "Urval", now: new Date("2026-11-07T12:00:00Z") };
    const result = await renderPrintJob({ ...input, request: request([{ course: natt, variant: "ACE" }, { course: natt, variant: "BDF" }]) });
    expect(result.pages).toBe(1);
    expect(result.preflight).toContain("Bortvalda varianter skrivs inte ut: Natt – BDF.");
    await expect(renderPrintJob({ ...input, request: request([{ course: natt, variant: "BDF" }]) })).rejects.toThrow(PrintJobError);
  });
});

/** Användartestet 2026-11-12: PDF:ens kartor får tävlingens namn, inte .ppen-filens titel (samma regel som förhandsvisningen). */
describe("PDF-jobbet: rubriken på kartorna", () => {
  const document = readPpen(read("fixtures/course-setting/gaffling-urval.ppen")).document;
  const course = document.courses[0]!.id;
  const headed = (): PrintJobRequest => ({ ...request([{ course }]), layout: { kind: "PAGES", header: true } });

  it("tävlingens namn som förval, filens titel när den valts", () => {
    expect(document.event.title).toBe("Gafflingsurval på kartfilen");
    const sheets = JSON.stringify(printJobSheets(document, headed(), undefined, undefined, undefined, "Natt 2"));
    expect(sheets).toContain("Natt 2");
    expect(sheets).not.toContain("Gafflingsurval på kartfilen");
    const chosen = applyEdit(document, { type: "SET_EVENT", changes: { printFileTitle: true } }).document;
    expect(JSON.stringify(printJobSheets(chosen, headed(), undefined, undefined, undefined, "Natt 2"))).toContain("Gafflingsurval på kartfilen");
  });
});

function inflatePdfStreams(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes);
  const parts: string[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const start = buf.indexOf("stream\n", pos, "latin1");
    if (start < 0) break;
    const end = buf.indexOf("\nendstream", start + 7, "latin1");
    if (end < 0) break;
    try { parts.push(inflateSync(buf.subarray(start + 7, end)).toString("latin1")); } catch { /* icke-flate */ }
    pos = end + 10;
  }
  return parts.join("\n");
}

describe("PDF-jobbet: kontorsskrivare med BL-profil och passmärkesfärg (Etapp 1 regression)", () => {
  const regMapXml = `<?xml version="1.0" encoding="UTF-8"?>
<map xmlns="http://openorienteering.org/apps/mapper/xml/v2" version="9">
<georeferencing scale="10000"><projected_crs id="Local"/></georeferencing>
<colors count="3">
<color priority="0" name="Passmärkesfärg" c="1" m="1" y="1" k="1" opacity="1"><cmyk method="custom"/></color>
<color priority="1" name="Brun 100%" c="0.2" m="0.7" y="1" k="0" opacity="1"><cmyk method="custom"/></color>
<color priority="2" name="Gul 100%" c="0" m="0.25" y="0.95" k="0" opacity="1"><cmyk method="custom"/></color>
</colors>
<barrier version="6" required="0.6.0">
<symbols count="3" id="reg">
<symbol type="2" id="0" code="505.0" name="Passmärke"><line_symbol color="0" line_width="300" join_style="2" cap_style="0"/></symbol>
<symbol type="2" id="1" code="101.0" name="Höjdkurva"><line_symbol color="1" line_width="140" join_style="2" cap_style="0"/></symbol>
<symbol type="4" id="2" code="401.0" name="Öppen mark"><area_symbol inner_color="2" patterns="0"/></symbol>
</symbols>
<parts count="1" current="0"><part name="del"><objects count="3">
<object type="1" symbol="2"><coords count="5">0 0;60000 0;60000 -60000;0 -60000;0 0 18;</coords></object>
<object type="1" symbol="1"><coords count="2">0 -30000;60000 -30000;</coords></object>
<object type="1" symbol="0"><coords count="2">10000 -10000;20000 -10000;</coords></object>
</objects></part></parts>
</barrier></map>`;

  it("OFFICE med officePrintProfile(blForest) lyckas trots passmärkesfärg-objekt och bevarar godkända BL-beslut, medan PRESS stoppas", async () => {
    const mapBytes = new TextEncoder().encode(regMapXml);
    const parsedMap = readMapFile(mapBytes, "reg.omap");
    const blForest = BUILT_IN_PRINT_PROFILES.find(item => item.id === "bl-forest-2026-11-02")!;
    const proposals = proposeColorMatches(BL_FOREST_2026_11_02, sourceMapColors(parsedMap.colors, colorUsage(parsedMap)));
    const blApproved: PrintProfile = { ...blForest, id: "bl-godkand", basedOn: blForest.id, colorDecisions: acceptSafe([], proposals) };
    let doc = emptyDocument({ title: "BL Office", mapScale: 10000 });
    const start = applyEdit(doc, { type: "ADD_CONTROL", kind: "START", at: { x: 15, y: 15 } }); doc = start.document;
    const finish = applyEdit(doc, { type: "ADD_CONTROL", kind: "FINISH", at: { x: 45, y: 45 } }); doc = finish.document;
    const course = applyEdit(doc, { type: "ADD_COURSE", name: "A" }); doc = course.document;
    doc = applyEdit(doc, { type: "INSERT_COURSE_CONTROL", course: course.created!, control: start.created! }).document;
    doc = applyEdit(doc, { type: "INSERT_COURSE_CONTROL", course: course.created!, control: finish.created! }).document;
    const map = { bytes: mapBytes, fileName: "reg.omap", bounds: { minX: 0, minY: 0, maxX: 60, maxY: 60 } };

    // OFFICE ska inte stoppas av BL:s passmärkesfärg-spärr eller obekräftade varningar, och ska behålla BL:s CMYK.
    const officeResult = await renderPrintJob({
      document: doc, map, fonts: fonts(), maxPages: 10, title: "Office BL", now: new Date("2026-11-26T10:00:00Z"),
      request: { formatVersion: 1, requestId: crypto.randomUUID(), kind: "OFFICE", profileId: blApproved.id,
        profile: officePrintProfile(blApproved), layout: { kind: "PAGES", header: false }, perRunner: false, duplex: false,
        items: [{ course: course.created! }], warningsConfirmed: false }
    });
    expect(officeResult.pages).toBe(1);
    expect(officeResult.preflight).toEqual([]);
    const streams = inflatePdfStreams(officeResult.bytes);
    expect(streams).toContain("0 0.75 1 0.33 K");
    expect(streams).toContain("0 0.27 0.94 0 k");

    // PRESS med samma BL-profil ska däremot fortfarande stoppas av förhandskontrollen.
    await expect(renderPrintJob({
      document: doc, map, fonts: fonts(), maxPages: 10, title: "Press BL", now: new Date("2026-11-26T10:00:00Z"),
      request: { formatVersion: 1, requestId: crypto.randomUUID(), kind: "PRESS", profileId: blApproved.id,
        profile: blApproved, layout: { kind: "PAGES", header: false }, perRunner: false, duplex: false,
        items: [{ course: course.created! }], warningsConfirmed: true }
    })).rejects.toThrow(PrintJobError);
  });
});
