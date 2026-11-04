/** ADR-0211 beslut 8: ramar, linjer och "Vitt på utskriften" i PDF:en som i förhandsvisningen. */
import { describe, expect, it } from "vitest";
import { applyEdit, BUILT_IN_PRINT_PROFILES, printSheetGroups, readPpen, type CourseSettingDocument } from "@o-tid/course-setting";
import { readMapFile } from "@o-tid/map-file";
import { writeSheetsPdf } from "../src";
import { fixture, fontFiles, parsePdf } from "./helpers";

const office = BUILT_IN_PRINT_PROFILES.find(item => item.id === "office")!;

function documentWith(layout: object): { document: CourseSettingDocument; course: string } {
  let document = readPpen(new TextDecoder().decode(fixture("course-setting/kartfil.ppen"))).document;
  const course = [...document.courses].sort((a, b) => a.order - b.order)[0]!.id;
  document = applyEdit(document, { type: "SET_PAPER_LAYOUT", course, layout: layout as never }).document;
  return { document, course };
}

describe("ramar, linjer och vita ytor i PDF:en", () => {
  it("ramen med färg och rundade hörn, linjen och fyllningen", async () => {
    const { document, course } = documentWith({ items: [
      { id: "ram", kind: "RECT", at: { corner: "TOP_LEFT", x: 5, y: 5 }, relativeTo: "PAGE", widthMm: 60, heightMm: 20, strokeMm: 0.5, color: "#ff0000", radiusMm: 3 },
      { id: "falt", kind: "RECT", at: { corner: "TOP_LEFT", x: 70, y: 5 }, relativeTo: "PAGE", widthMm: 20, heightMm: 10, strokeMm: 0, color: "#000000", fill: "#0000ff" },
      { id: "linje", kind: "LINE", at: { corner: "TOP_LEFT", x: 5, y: 30 }, relativeTo: "PAGE", widthMm: 80, heightMm: 0, strokeMm: 0.3, color: "#000000" }
    ] });
    const sheets = printSheetGroups(document, { kind: "COURSE" }, [{ course }]).flatMap(group => group.sheets);
    expect(sheets[0]!.paperItems?.map(item => item.kind)).toEqual(["RECT", "RECT", "LINE"]);
    const pdf = await parsePdf((await writeSheetsPdf({ sheets, map: null, profile: office, mode: "OFFICE", fonts: fontFiles() })).bytes);
    const content = pdf.pages[0]!.content;
    // Röd linje (CMYK 0/1/1/0) med bézierhörn, blå fyllning (1/1/0/0), svart linje som m … l S.
    expect(content).toContain("0 1 1 0 K");
    expect(content).toMatch(/ c [^\n]* c [^\n]* c [^\n]* c h S/);
    expect(content).toContain("1 1 0 0 k");
    expect(content).toMatch(/0 0 0 1 K\n[^\n]*\n?[\d. ]+ m [\d. ]+ l S/);
  });

  it("vitt på utskriften: vit yta efter kartan och före banan; banan står hel, markeringen syns inte i ytan", async () => {
    const map = readMapFile(fixture("maps/kartfil.omap"), "kartfil.omap");
    const { document: base, course } = documentWith({ whiteAreas: [{ shape: "RECT", rect: { x: 0, y: 0, width: 80, height: 60 } }] });
    const special = applyEdit(base, { type: "ADD_SPECIAL", special: { kind: "out-of-bounds", courses: [],
      points: [{ x: 0, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 90 }, { x: 0, y: 90 }] } });
    const document = special.document;
    const sheets = printSheetGroups(document, { kind: "COURSE" }, [{ course }], { mapBounds: map.bounds ?? undefined }).flatMap(group => group.sheets);
    const frame = sheets[0]!.frames[0]!;
    expect(frame.whiteAreas).toHaveLength(1);
    expect(frame.whiteAreas![0]![0]).toEqual({ x: frame.clip.x, y: frame.clip.y });
    // Banan klipps inte: alla kontroller står kvar.
    expect(frame.figures.filter(figure => figure.role === "CONTROL").length).toBeGreaterThan(0);
    const content = (await parsePdf((await writeSheetsPdf({ sheets, map, profile: office, mode: "OFFICE", fonts: fontFiles() })).bytes)).pages[0]!.content;
    const mapAt = content.indexOf("/Fm0 Do"), white = content.indexOf("0 0 0 0 k", mapAt), ring = content.search(/0\.2 1 0 0 K|0\.35 0\.85 0 0 K/);
    expect(mapAt).toBeGreaterThan(-1);
    expect(white).toBeGreaterThan(mapAt);
    expect(ring).toBeGreaterThan(white);
    // Samma mönster som E2E-testet letar efter: klippningen till ramen och den fyllda vita fyrhörningen.
    expect(content).toMatch(/ re W n\n(?:[^\n]*\n){0,2}[-\d. ]+ m [-\d. ]+ l [-\d. ]+ l [-\d. ]+ l h f/);
    // Markeringen ritas med en jämn–udda klippning som tar bort den vita ytan (W* n).
    expect(content).toMatch(/ W\* n/);
  });
});
