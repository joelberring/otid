import { describe, expect, it } from "vitest";
import { BUILT_IN_PRINT_PROFILES, layoutCoursePage, readPpen, sheetOfPage } from "@o-tid/course-setting";
import type { ParsedMap } from "@o-tid/map-file";
import { writeSheetsPdf } from "../src";
import { fixture, fontFiles, parsePdf } from "./helpers";

const fonts = fontFiles();
const document = readPpen(new TextDecoder().decode(fixture("course-setting/kartfil.ppen"))).document;
const profile = BUILT_IN_PRINT_PROFILES.find(item => item.id === "as-file")!;

describe("PdfCanvas.strokeText för textkonturer (fix #5)", () => {
  it("skriver textkontur (1 Tr ... 0 Tr) med konturens färg och linjebredd i PDF", async () => {
    const map: ParsedMap = {
      format: "OCD",
      version: "OCAD 2018.8",
      scale: 15000,
      georeference: null,
      bounds: { minX: 0, minY: 0, maxX: 40, maxY: 40 },
      warnings: [],
      colors: [
        { id: 1, name: "Svart", rank: 0, cmyk: { c: 0, m: 0, y: 0, k: 1 }, rgb: { r: 0, g: 0, b: 0 }, opacity: 1 },
        { id: 2, name: "Vit", rank: 1, cmyk: { c: 0, m: 0, y: 0, k: 0 }, rgb: { r: 1, g: 1, b: 1 }, opacity: 1 }
      ],
      symbols: new Map([[
        "102003",
        {
          id: "102003",
          code: { text: "102.3", main: 102, sub: 3 },
          name: "Höjdangivelse",
          hidden: false,
          kind: "TEXT",
          color: 1,
          size: 3,
          fontFamily: "Arial",
          bold: false,
          italic: false,
          align: "center",
          baseline: "middle",
          framing: { color: 2, width: 0.4 }
        }
      ]]),
      objects: [
        { kind: "text", symbol: "102003", at: { x: 20, y: 20 }, angle: 0, text: "45" }
      ]
    };
    const course = [...document.courses].sort((a, b) => a.order - b.order)[0]!;
    const sheets = layoutCoursePage(document, { course: course.id, mapBounds: map.bounds!, header: false }).map(sheetOfPage);
    const result = await writeSheetsPdf({ sheets, map, profile, mode: "PRESS", fonts, descriptionStandard: "2018", title: "Test", now: new Date("2026-11-02T10:00:00Z") });
    const pdf = await parsePdf(result.bytes);
    const form = [...pdf.forms.values()][0]!;
    // Konturen i färg 2 (vit 0 0 0 0 K) ritas med textläge 1 Tr (endast stroke) följt av 0 Tr, innan fyllningen (0 0 0 1 k).
    expect(form).toContain("0 0 0 0 K");
    expect(form).toMatch(/BT 1 Tr \/F\d+ 1 Tf .+ Tj 0 Tr ET/);
    expect(form).toContain("0 0 0 1 k");
    expect(form.indexOf("1 Tr")).toBeLessThan(form.indexOf("0 0 0 1 k"));
  });
});
