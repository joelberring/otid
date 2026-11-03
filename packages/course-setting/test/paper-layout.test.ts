import { describe, expect, it } from "vitest";
import {
  anchorToPaper, applyEdit, editTouches, gridTemplate, layoutCoursePage, layoutOverprint, layoutTemplateSheets, paperAnchorOf, ppenWithPaperLayout,
  readPpen, toPage, writePpen, type CourseSettingDocument
} from "../src";
import { lineCourse } from "./build";

const A4 = { width: 827, height: 1169 };

/** Banan på en A4 med fast tryckyta, så att ramen och kartans läge är kända. */
function course(count = 3) {
  const built = lineCourse(count);
  built.b.edit({ type: "SET_PRINT_AREA", course: built.course, area: { automatic: false, restrictToPageSize: false,
    rect: { minX: -30, minY: -60, maxX: 20 * count + 10, maxY: 60 }, page: { ...A4, margins: 28, landscape: true } } });
  return built;
}
const page = (document: CourseSettingDocument, id: string) => layoutCoursePage(document, { course: id })[0]!;
const frameOf = (document: CourseSettingDocument) => (id: string) => page(document, id);

describe("papperet: kontrollbeskrivningen på kartan", () => {
  it("är på från början och läggs automatiskt i ett hörn av kartramen där den inte täcker banan", () => {
    const { b, course: id } = course();
    const first = page(b.document, id);
    const description = first.description!;
    expect(description).toMatchObject({ source: "AUTO", corner: "TOP_LEFT", overlaps: 0, course: id, frame: 0 });
    expect(description.x).toBeCloseTo(first.clip.x, 9);
    expect(description.y).toBeCloseTo(first.clip.y, 9);
    // Rutan 5 mm: åtta kolumner (bredd 8 · 5 mm plus linjen) och en rad per kontroll.
    expect(description.layout.widthMm).toBeCloseTo(8 * 5 + 0.2, 1);
    // Ingen beskrivning ritas i kartan (editorn är en ren arbetsyta).
    expect(layoutOverprint(b.document, { course: id }).some(figure => figure.kind === "description")).toBe(false);
    // Alla kontroller har ingen beskrivning om den inte slås på.
    expect(page(b.document, "ALL_CONTROLS").description).toBeUndefined();
  });

  it("varnar (overlaps) och väljer ett annat hörn när banan ligger i hörnet", () => {
    const { b, course: id } = course();
    // En kontroll i kartramens övre vänstra hörn: rutan går till nästa fria hörn.
    const corner = b.control("NORMAL", -25, 55);
    b.insert(id, corner);
    const description = page(b.document, id).description!;
    expect(description.corner).not.toBe("TOP_LEFT");
    expect(description.overlaps).toBe(0);
    // Utplacerad över banan: varningen räknar kontrollerna, numren och sträckorna under rutan.
    b.edit({ type: "SET_PAPER_LAYOUT", course: id, layout: { descriptions: { at: { corner: "TOP_LEFT", x: 0, y: 0 } } } });
    expect(page(b.document, id).description).toMatchObject({ source: "PLACED", corner: "TOP_LEFT" });
    expect(page(b.document, id).description!.overlaps).toBeGreaterThan(0);
  });

  it("utplacerad: förankrad i ramens hörn, med rutans storlek och spalter; av = ingen beskrivning", () => {
    const { b, course: id } = course(6);
    b.edit({ type: "SET_PAPER_LAYOUT", course: id, layout: { descriptions: { at: { corner: "BOTTOM_RIGHT", x: 3, y: 4 }, boxMm: 6, columns: 2 } } });
    const first = page(b.document, id);
    const description = first.description!;
    expect(description.source).toBe("PLACED");
    expect(description.x + description.layout.widthMm).toBeCloseTo(first.clip.x + first.clip.width - 3, 6);
    expect(description.y + description.layout.heightMm).toBeCloseTo(first.clip.y + first.clip.height - 4, 6);
    expect(description.layout.widthMm).toBeGreaterThan(2 * 8 * 6);
    // Platsen tillbaka ur rutan på papperet (dra i förhandsvisningen).
    expect(paperAnchorOf({ x: description.x, y: description.y, width: description.layout.widthMm, height: description.layout.heightMm }, first.clip))
      .toEqual({ corner: "BOTTOM_RIGHT", x: 3, y: 4 });
    expect(anchorToPaper({ corner: "TOP_LEFT", x: 2, y: 1 }, { width: 10, height: 10 }, first.clip)).toEqual({ x: first.clip.x + 2, y: first.clip.y + 1 });
    b.edit({ type: "SET_PAPER_LAYOUT", course: id, layout: { descriptions: { show: false } } });
    expect(page(b.document, id).description).toBeUndefined();
    b.edit({ type: "SET_PAPER_LAYOUT", course: id, layout: null });
    expect(b.document.event.paperLayouts).toBeUndefined();
    expect(page(b.document, id).description?.source).toBe("AUTO");
  });

  it("kontrollerar inställningen och märker ändringen per bana", () => {
    const { b, course: id } = course();
    const bad = (descriptions: object) => () => applyEdit(b.document, { type: "SET_PAPER_LAYOUT", course: id, layout: { descriptions } as never });
    expect(bad({ boxMm: 50 })).toThrow(/rutans storlek/);
    expect(bad({ columns: 9 })).toThrow(/spalterna/);
    expect(bad({ at: { corner: "MIDDLE", x: 0, y: 0 } })).toThrow(/platsen/);
    expect(() => applyEdit(b.document, { type: "SET_PAPER_LAYOUT", course: "saknas", layout: null })).toThrow(/finns inte/);
    expect(editTouches({ type: "SET_PAPER_LAYOUT", course: id, layout: null })).toEqual([`event:paperLayouts:${id}`]);
  });

  it(".ppen: Purple Pens beskrivning blir platsen på papperet, och en utplacerad skrivs tillbaka som specialobjekt", () => {
    const { b, course: id } = course();
    b.edit({ type: "ADD_SPECIAL", special: { kind: "descriptions", points: [{ x: 30, y: 50 }, { x: 34, y: 50 }], courses: [id] } });
    const first = page(b.document, id);
    const fromFile = first.description!;
    expect(fromFile.source).toBe("FILE");
    const corner = toPage(first, { x: 30, y: 50 });
    expect(fromFile.x).toBeCloseTo(corner.x, 9);
    expect(fromFile.y).toBeCloseTo(corner.y, 9);
    // Rutans sida ur filen: 4 mm i kartan är 4 mm på papperet i 1:10 000.
    expect(fromFile.layout.widthMm).toBeCloseTo(8 * 4 + 0.2, 1);
    // Utan egna inställningar skrivs filen som den lästes.
    expect(ppenWithPaperLayout(b.document, frameOf(b.document))).toBe(b.document);

    b.edit({ type: "SET_PAPER_LAYOUT", course: id, layout: { descriptions: { at: { corner: "TOP_RIGHT", x: 2, y: 2 }, boxMm: 6 } } });
    const placed = page(b.document, id).description!;
    const exported = ppenWithPaperLayout(b.document, frameOf(b.document));
    const specials = exported.specialObjects.filter(special => special.kind === "descriptions");
    expect(specials).toHaveLength(1);
    expect(specials[0]!.courses).toEqual([id]);
    // Tillbaka in i ett dokument utan papper: filens beskrivning hamnar på samma ställe på arket.
    const { document: again } = readPpen(writePpen(exported));
    const reread = page(again, id).description!;
    expect(reread.source).toBe("FILE");
    expect(reread.x).toBeCloseTo(placed.x, 2);
    expect(reread.y).toBeCloseTo(placed.y, 2);
    expect(reread.layout.widthMm).toBeCloseTo(placed.layout.widthMm, 2);

    // Avslagen: banan tas bort ur filens beskrivning.
    b.edit({ type: "SET_PAPER_LAYOUT", course: id, layout: { descriptions: { show: false } } });
    expect(ppenWithPaperLayout(b.document, frameOf(b.document)).specialObjects.some(special => special.kind === "descriptions")).toBe(false);
  });

  it("layoutmallen: en beskrivning per ram med ramens bana", () => {
    const { b, course: id } = course();
    const other = b.course("B");
    b.insert(other, Object.keys(b.document.controls).find(key => b.document.controls[key]!.kind === "NORMAL")!);
    const template = gridTemplate("two", "Två", "A4", true, 1, 2);
    const [sheet] = layoutTemplateSheets(b.document, template, [{ course: id }, { course: other }]);
    expect(sheet!.descriptions.map(item => [item.course, item.frame])).toEqual([[id, 0], [other, 1]]);
    for (const item of sheet!.descriptions) {
      const frame = sheet!.frames[item.frame]!;
      expect(item.x).toBeGreaterThanOrEqual(frame.clip.x - 1e-9);
      expect(item.x + item.layout.widthMm).toBeLessThanOrEqual(frame.clip.x + frame.clip.width + 1e-9);
    }
  });
});
