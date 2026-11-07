/**
 * Städrundan 2026-11-07: PDF-jobbets kartbyten (ADR-0203) och bortvalda varianter (ADR-0198) i servern.
 * B1: delen i förfrågan ger ett ark per del (förut tappade klienten delen och hela banan skrevs två gånger).
 * B7: servern skriver aldrig ut en bortvald variant, också om klientens lista har den.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PrintJobRequest } from "@o-tid/contracts";
import { allCourseVariants, applyEdit, readPpen, type OverprintPrimitive, type Sheet } from "@o-tid/course-setting";
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
