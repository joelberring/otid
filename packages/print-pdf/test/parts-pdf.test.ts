import { readFileSync } from "node:fs";
import { PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { applyEdit, BUILT_IN_PRINT_PROFILES, expandPartItems, printSheetGroups, readPpen } from "@o-tid/course-setting";
import { duplexEdge, writeSheetsPdf } from "../src";
import { fontFiles, parsePdf } from "./helpers";

/**
 * ADR-0203: en bana med kartbyte som PDF: en sida per del, dubbelsidigt med del 2 på baksidan (och en tom baksida vid udda
 * antal), PDF:en föreslår vändning på långsidan, och överlappet från föregående del skrivs i banans dekorfärg med lägre andel.
 */
const document = readPpen(readFileSync(new URL("../../../fixtures/purplepen/controller/mapexchange1.ppen", import.meta.url), "utf8")).document;
const press = BUILT_IN_PRINT_PROFILES.find(item => item.id === "as-file")!;

describe("kartbyten i PDF:en", () => {
  it("dubbelsidigt: del 1 fram, del 2 bak, tom baksida vid udda antal; överlappet tonat", async () => {
    const items = expandPartItems(document, [{ course: "2" }, { course: "1" }]);
    const sheets = printSheetGroups(document, { kind: "COURSE", duplex: true }, items).flatMap(group => group.sheets);
    expect(sheets.map(sheet => sheet.frames.length === 0 ? "tom" : `${sheet.frames[0]!.part ?? "-"}${sheet.back ? "b" : "f"}`)).toEqual(["0f", "1b", "-f", "tom"]);
    const result = await writeSheetsPdf({ sheets, map: null, profile: press, mode: "PRESS", fonts: fontFiles() });
    expect(result.pages).toBe(4);
    const pdf = await parsePdf(result.bytes);
    // Den tomma baksidan har inget banpåtryck.
    expect(pdf.pages[3]!.content).not.toMatch(/SCN|scn/);
    // Del 2: banans lila med full andel och överlappets 0,35 (Separation Purple).
    expect(pdf.pages[1]!.content).toMatch(/\/CS\d+ CS 1 SCN/);
    expect(pdf.pages[1]!.content).toMatch(/\/CS\d+ CS 0\.35 SCN/);
    expect(pdf.pages[0]!.content).not.toMatch(/\/CS\d+ CS 0\.35 SCN/);
    // Vändning på långsidan föreslås.
    const { PDFDocument } = await import("pdf-lib");
    const loaded = await PDFDocument.load(result.bytes);
    const preferences = loaded.catalog.lookup(PDFName.of("ViewerPreferences"));
    expect(String(preferences)).toContain("DuplexFlipLongEdge");
  });

  it("liggande delar vänds också på långsidan (ADR-0203 beslut 7); löparnas liggande baksidor på kortsidan (ADR-0213)", async () => {
    const page = { width: 827, height: 1169, margins: 28, landscape: true };
    let landscape = document;
    for (const part of [0, 1]) landscape = applyEdit(landscape, { type: "SET_PRINT_AREA", course: "2", part, area: { automatic: true, restrictToPageSize: true, page } }).document;
    const sheets = printSheetGroups(landscape, { kind: "COURSE", duplex: true }, expandPartItems(landscape, [{ course: "2" }])).flatMap(group => group.sheets);
    expect(sheets.every(sheet => sheet.paper.widthMm > sheet.paper.heightMm)).toBe(true);
    expect(sheets.filter(sheet => sheet.back)).toHaveLength(1);
    expect(duplexEdge(sheets)).toBe("LONG");
    const result = await writeSheetsPdf({ sheets, map: null, profile: press, mode: "PRESS", fonts: fontFiles() });
    const { PDFDocument } = await import("pdf-lib");
    expect(String((await PDFDocument.load(result.bytes)).catalog.lookup(PDFName.of("ViewerPreferences")))).toContain("DuplexFlipLongEdge");
    // Löparnas baksidor utan delar: alla liggande = kortsidan, annars långsidan; inga baksidor = inget förslag.
    const back = { back: true, paper: { widthMm: 297, heightMm: 210 }, frames: [] };
    expect(duplexEdge([back])).toBe("SHORT");
    expect(duplexEdge([back, { ...back, paper: { widthMm: 210, heightMm: 297 } }])).toBe("LONG");
    expect(duplexEdge([{ ...back, back: false }])).toBeUndefined();
  });
});
