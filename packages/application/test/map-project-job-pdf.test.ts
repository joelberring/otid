import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { missingNormSymbols, normSymbolAdditions } from "@o-tid/map-revision";
import { FONT_FILE_NAMES, FONT_VARIANTS, type FontFiles } from "@o-tid/print-pdf";
import { mapPdfPaper, runMapPdf } from "../src/map-project-job-pdf";
import { loadProjectMap } from "../src/map-project-job-run";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => new Uint8Array(readFileSync(new URL(path, root)));
const fonts = () => Object.fromEntries(FONT_VARIANTS.map(variant =>
  [variant, read(`packages/print-pdf/fonts/${FONT_FILE_NAMES[variant]}`)])) as unknown as FontFiles;

/** Packar upp alla FlateDecode-strömmar i en PDF (utan att dra in pdf-lib i application-paketet). */
function pdfStreamsText(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes);
  const parts: string[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const start = buf.indexOf("stream\n", pos, "latin1");
    if (start < 0) break;
    const dataStart = start + 7;
    const end = buf.indexOf("\nendstream", dataStart, "latin1");
    if (end < 0) break;
    try { parts.push(inflateSync(buf.subarray(dataStart, end)).toString("latin1")); } catch { /* icke-flate eller typsnitt */ }
    pos = end + 10;
  }
  return parts.join("\n");
}

describe("hela kartan som PDF: pappret (ägaren 2026-11-15)", () => {
  it("väljer det minsta A-pappret, liggande för breda kartor", () => {
    expect(mapPdfPaper(250, 150)).toMatchObject({ size: "A4", landscape: true, widthMm: 297, heightMm: 210 });
    expect(mapPdfPaper(150, 250)).toMatchObject({ size: "A4", landscape: false, widthMm: 210, heightMm: 297 });
    expect(mapPdfPaper(380, 260)).toMatchObject({ size: "A3", landscape: true });
  });
  it("ger ett eget papper med marginal när kartan är större än A0", () => {
    expect(mapPdfPaper(2000, 1500)).toMatchObject({ size: null, widthMm: 2020, heightMm: 1520 });
  });
});

describe("Etapp 1C: loadProjectMap stiländringar & runMapPdf med kartans egna färger", () => {
  const bytes = read("fixtures/maps/kartfil.omap");
  const now = new Date("2026-11-26T10:00:00Z");

  it("loadProjectMap applicerar sparade färger, symbolfärger, textsymboler och normsymboler i minnet", () => {
    const plain = loadProjectMap(bytes, "kartfil.omap", "0".repeat(64), []);
    const green = plain.base.colors.find(c => /grön/i.test(c.name))!;
    const black = plain.base.colors.find(c => /svart/i.test(c.name))!;
    const areaSym = [...plain.base.symbols.values()].find(s => s.kind === "AREA" && s.fill === green.id)!;
    const textSym = [...plain.base.symbols.values()].find(s => s.kind === "TEXT");
    const addable = normSymbolAdditions(plain.base, missingNormSymbols(plain.base.symbols).map(r => r.code))[0];
    expect(addable).toBeDefined();

    const styled = loadProjectMap(bytes, "kartfil.omap", "0".repeat(64), [], {
      colors: [{ id: green.id, cmyk: { c: 0.1, m: 0.8, y: 0.2, k: 0 } }],
      symbolColors: [{ symbol: areaSym.code.text, from: green.id, to: black.id }],
      ...(textSym ? { textSymbols: [{ id: textSym.id, fontFamily: "Verdana", size: 5.5, color: black.id, bold: true, italic: false, framing: null }] } : {}),
      normSymbols: { replace: [], add: [addable!.code] }
    });
    expect(styled.base.colors.find(c => c.id === green.id)!.cmyk).toEqual({ c: 0.1, m: 0.8, y: 0.2, k: 0 });
    const recolored = styled.base.symbols.get(areaSym.id);
    expect(recolored?.kind === "AREA" ? recolored.fill : undefined).toBe(black.id);
    if (textSym) {
      const updatedText = styled.base.symbols.get(textSym.id);
      expect(updatedText?.kind === "TEXT" ? updatedText.size : undefined).toBe(5.5);
    }
    expect(styled.symbolsByCode.has(addable!.code)).toBe(true);
  });

  it("runMapPdf använder kartans egna färger som standard (bleker inte grönt) och stöder lightenForOffice samt mode PRESS", async () => {
    const plain = loadProjectMap(bytes, "kartfil.omap", "0".repeat(64), []);
    const green = plain.base.colors.find(c => /grön/i.test(c.name))!;
    const ownCmyk = `${green.cmyk.c} ${green.cmyk.m} ${green.cmyk.y} ${green.cmyk.k} k`;

    // Standard: kartans egna färger (inte 30 % ljusare grönt) + sparad färgändring slår igenom i PDF:en.
    const defaultOut = await runMapPdf(plain, { title: "Egen karta" }, fonts(), now);
    expect("error" in defaultOut).toBe(false);
    if (!("error" in defaultOut)) {
      const formText = pdfStreamsText(defaultOut.pdf);
      expect(formText).toContain(ownCmyk);
      expect(defaultOut.result.notes.join(" ")).not.toMatch(/Banan ligger i färgordningen/);
    }

    // Projektets färgändring i loadProjectMap slår igenom direkt i MAP_PDF!
    const recolored = loadProjectMap(bytes, "kartfil.omap", "0".repeat(64), [], {
      colors: [{ id: green.id, cmyk: { c: 0.12, m: 0.34, y: 0.56, k: 0 } }]
    });
    const recoloredOut = await runMapPdf(recolored, { title: "Ändrad" }, fonts(), now);
    expect("error" in recoloredOut).toBe(false);
    if (!("error" in recoloredOut)) {
      expect(pdfStreamsText(recoloredOut.pdf)).toContain("0.12 0.34 0.56 0 k");
    }

    // lightenForOffice: true ljusar upp grönt med 30 %.
    const lightOut = await runMapPdf(plain, { title: "Kontor", lightenForOffice: true }, fonts(), now);
    expect("error" in lightOut).toBe(false);
    if (!("error" in lightOut)) {
      const formText = pdfStreamsText(lightOut.pdf);
      expect(formText).not.toContain(ownCmyk);
    }

    // mode: "PRESS" bevarar dekorfärgsplåtar från kartfilen.
    const spotOmap = `<?xml version="1.0" encoding="UTF-8"?>
<map xmlns="http://openorienteering.org/apps/mapper/xml/v2" version="9">
<georeferencing scale="10000"><projected_crs id="Local"/></georeferencing>
<colors count="1"><color priority="0" name="Grön" c="0.76" m="0" y="0.91" k="0" opacity="1"><spotcolors knockout="true"><namedcolor>PMS361_Green</namedcolor></spotcolors><cmyk method="custom"/></color></colors>
<barrier version="6" required="0.6.0">
<symbols count="1" id="s"><symbol type="4" id="0" code="406.0" name="Grön"><area_symbol inner_color="0" patterns="0"/></symbol></symbols>
<parts count="1" current="0"><part name="p"><objects count="1"><object type="1" symbol="0"><coords count="5">0 0;50000 0;50000 -50000;0 -50000;0 0 18;</coords></object></objects></part></parts>
</barrier></map>`;
    const loadedSpot = loadProjectMap(new TextEncoder().encode(spotOmap), "spot.omap", "1".repeat(64), []);
    const pressOut = await runMapPdf(loadedSpot, { title: "Tryck", mode: "PRESS" }, fonts(), now);
    expect("error" in pressOut).toBe(false);
    if (!("error" in pressOut)) {
      expect(Buffer.from(pressOut.pdf).toString("latin1")).toContain("/Separation /PMS361_Green /DeviceCMYK");
    }
  });
});
