import { describe, expect, it } from "vitest";
import { validatePaperItem, type SheetPaperItem } from "@o-tid/course-setting";
import { newPaperItem, paperItemLabel, qrPlacement, resizedPaperItem } from "./course-setting-paper";

/** Papperets QR-kod (ägaren 2026-11-16): förvalet, platsen i ett fritt hörn och storleken på arket. */
describe("QR-koden i layouten", () => {
  const paper = { widthMm: 297, heightMm: 210, marginMm: 5 };

  it("ny kod: tävlingens sida, 25 mm, giltig", () => {
    const item = newPaperItem("QR_CODE", "p1");
    expect(item).toMatchObject({ kind: "QR_CODE", sizeMm: 25, target: "RACE" });
    expect(validatePaperItem(item)).toEqual(item);
    expect(paperItemLabel(item)).toBe("QR-kod");
  });

  it("står i ett hörn av papperet som är fritt från kartan, annars nere till höger i kartramen", () => {
    // Kartan till vänster: nere till höger på papperet är fritt.
    expect(qrPlacement({ paper, frame: { x: 5, y: 5, width: 200, height: 200 }, taken: [] }, 25, 28))
      .toEqual({ at: { corner: "BOTTOM_RIGHT", x: 5, y: 5 }, relativeTo: "PAGE" });
    // Nere till höger upptaget av ett element: nästa fria hörn (uppe till höger).
    expect(qrPlacement({ paper, frame: { x: 5, y: 5, width: 200, height: 200 }, taken: [{ x: 250, y: 170, width: 40, height: 30 }] }, 25, 28))
      .toEqual({ at: { corner: "TOP_RIGHT", x: 5, y: 5 }, relativeTo: "PAGE" });
    // Kartan täcker hela arket.
    expect(qrPlacement({ paper, frame: { x: 5, y: 5, width: 287, height: 200 }, taken: [] }, 25, 28)).toEqual({ at: { corner: "BOTTOM_RIGHT", x: 3, y: 3 } });
    expect(qrPlacement(undefined, 25, 28)).toEqual({ at: { corner: "BOTTOM_RIGHT", x: 3, y: 3 } });
  });

  it("ändrar storlek som en kvadrat (minst 15 mm), övre vänstra hörnet står kvar", () => {
    const item = newPaperItem("QR_CODE", "p1");
    const placed = { id: "p1", kind: "QR_CODE", course: "1", frame: 0, rect: { x: 100, y: 100, width: 25, height: 28 }, source: "OWN", relativeTo: "FRAME", parts: [] } as SheetPaperItem;
    const reference = { x: 0, y: 0, width: 200, height: 200 };
    const bigger = resizedPaperItem(item, placed, reference, 40, 43);
    expect(bigger).toMatchObject({ sizeMm: 40, at: { corner: "BOTTOM_RIGHT", x: 60, y: 57 } });
    expect(resizedPaperItem(item, placed, reference, 5, 5)).toMatchObject({ sizeMm: 15 });
  });
});
