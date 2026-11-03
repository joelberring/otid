import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { applyEdit, BUILT_IN_PRINT_PROFILES, layoutCoursePage, readPpen, sheetOfPage, type CourseSettingDocument } from "@o-tid/course-setting";
import { writeSheetsPdf } from "../src";
import { fixture, fontFiles, parsePdf } from "./helpers";

/** En liten PNG (2 × 1 bildpunkter, RGB) för papperets logotyp. */
function tinyPng(): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (bytes: Buffer) => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.from([0, 255, 0, 0, 0, 0, 255]);
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]));
}

const SHA = "b".repeat(64);

describe("papperet i PDF:en (ADR-0197)", () => {
  it("texter, skalstock, nordpil och bilden med täckning ritas som i förhandsvisningen", async () => {
    let document: CourseSettingDocument = readPpen(new TextDecoder().decode(fixture("course-setting/kartfil.ppen"))).document;
    const course = [...document.courses].sort((a, b) => a.order - b.order)[0]!;
    document = applyEdit(document, { type: "SET_PAPER_LAYOUT", course: course.id, layout: { items: [
      { id: "t", kind: "TEXT", at: { corner: "TOP_LEFT", x: 2, y: 2 }, text: "Bana {bana}", sizeMm: 5, widthMm: 60, bold: true, background: true },
      { id: "s", kind: "SCALE_BAR", at: { corner: "BOTTOM_LEFT", x: 2, y: 2 }, widthMm: 40 },
      { id: "n", kind: "NORTH_ARROW", at: { corner: "TOP_RIGHT", x: 2, y: 2 }, sizeMm: 10 },
      { id: "logo", kind: "IMAGE", at: { corner: "BOTTOM_RIGHT", x: 2, y: 2 }, image: SHA, mediaType: "image/png", aspect: 2, widthMm: 20, opacity: 0.4 }
    ] } }).document;
    const sheets = layoutCoursePage(document, { course: course.id }).map(sheetOfPage);
    expect(sheets[0]!.paperItems).toHaveLength(4);
    const result = await writeSheetsPdf({ sheets, map: null, profile: BUILT_IN_PRINT_PROFILES.find(item => item.id === "office")!, mode: "OFFICE",
      fonts: fontFiles(), paperImages: new Map([[SHA, { mediaType: "image/png", bytes: tinyPng() }]]) });
    const pdf = await parsePdf(result.bytes);
    const content = pdf.pages[0]!.content;
    // Bilden med täckningen 40 % (ExtGState ca/CA) och som XObject.
    expect(pdf.extGStates.get("GA40")).toMatchObject({ ca: "0.4", CA: "0.4" });
    expect(content).toMatch(/\/GA40 gs\n[^\n]* cm \/Ip0 Do/);
    // Texten och skalstockens etiketter (BT … ET), nordpilens yta (f).
    expect((content.match(/BT /g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(result.notes.some(note => /papperet/.test(note))).toBe(false);
    // Saknas bilden i lagret står det i notiserna och PDF:en skrivs ändå.
    const missing = await writeSheetsPdf({ sheets, map: null, profile: BUILT_IN_PRINT_PROFILES.find(item => item.id === "office")!, mode: "OFFICE", fonts: fontFiles() });
    expect(missing.notes).toContain("En bild på papperet finns inte i bildlagret och utelämnas.");
  });
});
