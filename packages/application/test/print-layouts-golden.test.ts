/**
 * ADR-0217 (Layout som egen flik): ett dokument utan layouter ger samma ark och samma PDF som före layouterna. Hasharna
 * räknades på koden före ändringen (grenen `b3-layoutflik`, första commit) och får inte ändras av layoutarbetet.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyEdit, BUILT_IN_TEMPLATES, printDetailGaps, printNumberObstacles, printSheetGroups, readPpen, type CourseSettingDocument } from "@o-tid/course-setting";
import { readMapFile } from "@o-tid/map-file";
import { FONT_FILE_NAMES, FONT_VARIANTS, type FontFiles } from "@o-tid/print-pdf";
import { renderPrintJob } from "../src/course-setting-print-render";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => new Uint8Array(readFileSync(new URL(path, root)));
const fonts = () => Object.fromEntries(FONT_VARIANTS.map(variant =>
  [variant, read(`packages/print-pdf/fonts/${FONT_FILE_NAMES[variant]}`)])) as unknown as FontFiles;
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const MAP_BOUNDS = { minX: 0, minY: 0, maxX: 120, maxY: 100 };

function documentOf(file: string): CourseSettingDocument {
  const document = readPpen(new TextDecoder().decode(read(`fixtures/course-setting/${file}`))).document;
  return applyEdit(document, { type: "SET_EVENT", changes: { circleCutting: { overlap: true, details: true } } }).document;
}

const ordered = (document: CourseSettingDocument) => [...document.courses].sort((a, b) => a.order - b.order).map(course => course.id);

function sheetsHash(file: string): string {
  const document = documentOf(file);
  const map = readMapFile(read("fixtures/maps/kartfil.omap"), "kartfil.omap");
  const options = { mapBounds: MAP_BOUNDS, detailGaps: printDetailGaps(document, map), numberObstacles: printNumberObstacles(document, map), date: "2026-12-09" };
  const items = ordered(document).map(course => ({ course }));
  const all = [
    printSheetGroups(document, { kind: "COURSE", header: true }, [...items, { course: "ALL_CONTROLS" }], options),
    printSheetGroups(document, { kind: "COURSE", duplex: true }, items.map(item => ({ ...item, part: 0 })), options),
    printSheetGroups(document, { kind: "TEMPLATE", template: BUILT_IN_TEMPLATES[1]! }, items, options),
    printSheetGroups(document, { kind: "TEMPLATE", template: BUILT_IN_TEMPLATES[4]!, perRunner: true, duplex: true },
      items.map(item => ({ ...item, runner: { kind: "RUNNER" as const, name: "Löpare", className: "H21", startTime: "18:32", startNumber: 7 } })), options)
  ];
  return sha(JSON.stringify(all));
}

async function pdfHash(file: string): Promise<string> {
  const document = documentOf(file);
  const result = await renderPrintJob({ document, map: { bytes: read("fixtures/maps/kartfil.omap"), fileName: "kartfil.omap", bounds: MAP_BOUNDS },
    fonts: fonts(), maxPages: 50, title: "Golden", now: new Date("2026-11-07T12:00:00Z"),
    request: { formatVersion: 1, requestId: "00000000-0000-4000-8000-000000000001", kind: "OFFICE", profileId: "office",
      layout: { kind: "PAGES", header: true }, perRunner: false, duplex: false, items: ordered(document).map(course => ({ course })), warningsConfirmed: true } });
  return sha(result.bytes);
}

describe("gamla dokument utan layouter (ADR-0217 beslut 9)", () => {
  it("arken är desamma som före layouterna", () => {
    expect(sheetsHash("kartfil.ppen")).toBe("8bfbcae7db693f649d3bd9f2267665630e615b31c3c8eecba81924c11fb4db9a");
    expect(sheetsHash("kartbyte.ppen")).toBe("d52d82f0c756eadf3c64c407c963e945cf07f4454d5d759c35cba1e9ffaba026");
  });

  it("PDF:en är byte för byte densamma som före layouterna", async () => {
    expect(await pdfHash("kartfil.ppen")).toBe("8a33ae3e9739bbc7121178577203396a09c65b5f2da30ad04c3ce94d9eb7285c");
    expect(await pdfHash("kartbyte.ppen")).toBe("de1c501c368d050e569efc1c7fbce902fb5a49e3b6464522c7c31502c8e005ec");
  });
});
