/** Papperets QR-kod i PDF:en (ägaren 2026-11-16): vektorrutor i svart på vit botten, går att läsa tillbaka modul för modul. */
import { describe, expect, it } from "vitest";
import { applyEdit, BUILT_IN_PRINT_PROFILES, paperLinksFor, paperQrModules, printSheetGroups, readPpen, type CourseSettingDocument } from "@o-tid/course-setting";
import { writeSheetsPdf, type PdfMode } from "../src";
import { fixture, fontFiles, parsePdf } from "./helpers";

const links = paperLinksFor("https://otid.berring.se", "x2y3z4", true);

function documentWith(target: "RACE" | "BINGO"): { document: CourseSettingDocument; course: string } {
  let document = readPpen(new TextDecoder().decode(fixture("course-setting/kartfil.ppen"))).document;
  const course = [...document.courses].sort((a, b) => a.order - b.order)[0]!.id;
  document = applyEdit(document, { type: "SET_PAPER_LAYOUT", course, layout: { items: [
    { id: "qr", kind: "QR_CODE", at: { corner: "BOTTOM_RIGHT", x: 5, y: 5 }, relativeTo: "PAGE", sizeMm: 25, target }] } }).document;
  return { document, course };
}

/** Den fyllda vägen av rutor (`x y w h re … f`) efter svart fyllning, tillbaka till moduler rad för rad. */
function readModules(content: string): { color: string; size: number; dark: number[] } {
  const match = /([^\n]*)\n((?:[-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ re ){20,})f/.exec(content);
  if (!match) throw new Error("ingen QR-kod i PDF:en");
  const rects = [...match[2]!.matchAll(/([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) re/g)].map(row => row.slice(1, 5).map(Number) as [number, number, number, number]);
  const module = Math.min(...rects.map(r => r[3]));
  const left = Math.min(...rects.map(r => r[0])), top = Math.max(...rects.map(r => r[1] + r[3]));
  const size = Math.round((Math.max(...rects.map(r => r[0] + r[2])) - left) / module);
  const dark = new Array<number>(size * size).fill(0);
  for (const [x, y, w, h] of rects) {
    expect(h).toBeCloseTo(module, 2);
    const row = Math.round((top - y - h) / module), col = Math.round((x - left) / module);
    for (let i = 0; i < Math.round(w / module); i += 1) dark[row * size + col + i] = 1;
  }
  return { color: match[1]!.trim(), size, dark };
}

async function pdfOf(target: "RACE" | "BINGO", mode: PdfMode, profileId: string) {
  const { document, course } = documentWith(target);
  const sheets = printSheetGroups(document, { kind: "COURSE" }, [{ course }], { paperLinks: links }).flatMap(group => group.sheets);
  const profile = BUILT_IN_PRINT_PROFILES.find(item => item.id === profileId)!;
  return parsePdf((await writeSheetsPdf({ sheets, map: null, profile, mode, fonts: fontFiles() })).bytes);
}

describe("QR-kod i PDF:en", () => {
  it("modulerna står som vektorrutor och ger samma kod som adressen (felkorrigering M)", async () => {
    const pdf = await pdfOf("RACE", "OFFICE", "office");
    const content = pdf.pages[0]!.content;
    const read = readModules(content);
    const expected = paperQrModules(links.race!);
    expect(read.size).toBe(expected.size);
    expect(read.dark).toEqual([...expected.dark]);
    // Svart, på vit botten, och ingen rasterbild.
    expect(read.color).toBe("0 0 0 1 k");
    expect(content.lastIndexOf("0 0 0 0 k", content.indexOf(read.color + "\n"))).toBeGreaterThan(-1);
    expect(content).not.toMatch(/\/Ip\d+ Do/);
  });

  it("i tryck med dekorfärger: koden i svart (process K), inte i banans lila", async () => {
    const pdf = await pdfOf("BINGO", "PRESS", "as-file");
    const read = readModules(pdf.pages[0]!.content);
    expect(read.color).toBe("0 0 0 1 k");
    expect(read.dark).toEqual([...paperQrModules(links.bingo!).dark]);
  });
});
