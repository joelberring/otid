/**
 * ADR-0211 beslut 1: ringklippen över kartdetaljer följer med till PDF:en. Förut fick `printSheetGroups` aldrig
 * detaljgapen (bara editorns Worker räknade dem), så ringarna skrevs hela på papperet fast editorn visade avbrott.
 */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { applyEdit, printDetailGaps, printSheetGroups, readPpen, type CourseSettingDocument, type OverprintPrimitive } from "@o-tid/course-setting";
import { readMapFile } from "@o-tid/map-file";
import { FONT_FILE_NAMES, FONT_VARIANTS, type FontFiles } from "@o-tid/print-pdf";
import { renderPrintJob } from "../src/course-setting-print-render";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => new Uint8Array(readFileSync(new URL(path, root)));
const fonts = () => Object.fromEntries(FONT_VARIANTS.map(variant =>
  [variant, read(`packages/print-pdf/fonts/${FONT_FILE_NAMES[variant]}`)])) as unknown as FontFiles;

/** Den syntetiska kartan med en stig (505) rakt igenom kontroll 36 (50, 18) uppifrån och ned. */
function mapBytes(): Uint8Array {
  const omap = new TextDecoder().decode(read("fixtures/maps/kartfil.omap"))
    .replace('<objects count="11">', '<objects count="12">')
    .replace("</objects></part>", '<object type="1" symbol="5"><coords count="2">50000 -8000;50000 -28000;</coords></object>\n</objects></part>');
  return new TextEncoder().encode(omap);
}

function documentWith(details: boolean): CourseSettingDocument {
  const document = readPpen(new TextDecoder().decode(read("fixtures/course-setting/kartfil.ppen"))).document;
  return applyEdit(document, { type: "SET_EVENT", changes: { circleCutting: { overlap: false, details } } }).document;
}

const circleOf = (figures: readonly OverprintPrimitive[], document: CourseSettingDocument, code: string) => {
  const control = Object.values(document.controls).find(item => item.code === code)!;
  return figures.find((item): item is Extract<OverprintPrimitive, { kind: "circle" }> =>
    item.kind === "circle" && Math.abs(item.center.x - control.at.x) < 1e-6 && Math.abs(item.center.y - control.at.y) < 1e-6)!;
};

/** Alla strömmar i PDF:en uppackade (sidans innehåll och utsnitten), utan PDF-bibliotek. */
function pageContent(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes);
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const start = raw.indexOf("stream", at, "latin1");
    if (start < 0) break;
    const body = start + (raw[start + 6] === 0x0d ? 8 : 7);
    const end = raw.indexOf("endstream", body, "latin1");
    if (end < 0) break;
    const chunk = raw.subarray(body, end);
    try { out.push(inflateSync(chunk).toString("latin1")); } catch { out.push(chunk.toString("latin1")); }
    at = end + 9;
  }
  return out.join("\n");
}

describe("ringklippen i utskriften (ADR-0211 beslut 1)", () => {
  it("printSheetGroups med detaljgapen ger avbrott i ringen där stigen korsar", () => {
    const map = readMapFile(mapBytes(), "kartfil.omap");
    const document = documentWith(true);
    const course = [...document.courses].sort((a, b) => a.order - b.order)[0]!.id;
    const gaps = printDetailGaps(document, map);
    expect(Object.keys(gaps ?? {}).length).toBeGreaterThan(0);
    const cut = printSheetGroups(document, { kind: "COURSE" }, [{ course }], { detailGaps: gaps })[0]!.sheets[0]!.frames[0]!;
    const whole = printSheetGroups(document, { kind: "COURSE" }, [{ course }])[0]!.sheets[0]!.frames[0]!;
    expect(circleOf(cut.figures, document, "36").gaps?.length ?? 0).toBe(2);
    expect(circleOf(whole.figures, document, "36").gaps ?? []).toEqual([]);
    // Av: inga detaljgap att räkna.
    expect(printDetailGaps(documentWith(false), map)).toBeUndefined();
  });

  it("PDF-jobbet räknar gapen på kartfilen och skriver ringen i bågar", async () => {
    const run = async (details: boolean, printScale?: number) => {
      const document = documentWith(details);
      const course = [...document.courses].sort((a, b) => a.order - b.order)[0]!.id;
      const result = await renderPrintJob({ document, map: { bytes: mapBytes(), fileName: "kartfil.omap", bounds: { minX: 0, minY: 0, maxX: 120, maxY: 100 } },
        fonts: fonts(), maxPages: 10, title: "Ringklipp", now: new Date("2026-11-03T12:00:00Z"),
        request: { formatVersion: 1, requestId: crypto.randomUUID(), kind: "OFFICE", profileId: "office", layout: { kind: "PAGES", header: false },
          perRunner: false, duplex: false, items: [{ course, ...(printScale ? { printScale } : {}) }], warningsConfirmed: true } });
      return pageContent(result.bytes);
    };
    // En hel ring stängs med "h" före "S"; en klippt ring är öppna bågar. Med klippen blir de hela ringarna färre.
    const closed = (content: string) => (content.match(/ h S\b/g) ?? []).length;
    const on = await run(true), off = await run(false);
    expect(closed(on)).toBe(closed(off) - 1);
    // En karta med egen skala (1:7 500 i stället för banans 1:10 000): ringen är större och får sina egna gap (städrundan 2026-11-07).
    expect(closed(await run(true, 7500))).toBe(closed(await run(false, 7500)) - 1);
  });
});
