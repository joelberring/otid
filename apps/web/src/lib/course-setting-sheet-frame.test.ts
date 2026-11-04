import { describe, expect, it } from "vitest";
import { PAPER_SIZES } from "@o-tid/course-setting";
import { movedFrameArea, pageOfSheet, paperNameOf, resizedFrameArea } from "./course-setting-sheet-frame";

// A4 liggande med 7 mm marginal; kartan i 1:10 000 utskriven i 1:10 000 (1 mm på papperet = 1 mm på kartan).
const sheet = { paper: { widthMm: 296.926, heightMm: 210.058, landscape: true, marginMm: 7.112 } };
const frame = { mapArea: { minX: 0, minY: 0, maxX: 282, maxY: 195 }, transform: { scale: 1, translateX: 7, translateY: 202 } };

describe("arkets papper och kartramen (ADR-0211 tillägg)", () => {
  it("läser papperet ur arket när tryckytan saknar det", () => {
    const page = pageOfSheet({ automatic: true, restrictToPageSize: true }, sheet);
    expect(page).toEqual({ ...PAPER_SIZES.A4, margins: 28, landscape: true });
    expect(paperNameOf(page)).toBe("A4");
  });

  it("flyttar ramen över kartan: höger och nedåt på papperet blir öster och söder på kartan", () => {
    const page = pageOfSheet({ automatic: true, restrictToPageSize: true }, sheet);
    const moved = movedFrameArea({ automatic: true, restrictToPageSize: true }, page, frame, 10, 5);
    expect(moved).toMatchObject({ automatic: false, restrictToPageSize: true, page, rect: { minX: 10, maxX: 292, minY: -5, maxY: 190 } });
  });

  it("räknar flytten i kartans mm när utskriftsskalan skiljer sig från kartans", () => {
    // Utskrift i 1:15 000 av en karta i 1:10 000: 1 mm på papperet är 1,5 mm på kartan.
    const scaled = { ...frame, transform: { ...frame.transform, scale: 1 / 1.5 } };
    const moved = movedFrameArea({ automatic: false, restrictToPageSize: false, rect: frame.mapArea }, pageOfSheet({ automatic: true, restrictToPageSize: true }, sheet), scaled, -4, 0);
    expect(moved.rect).toEqual({ minX: -6, maxX: 276, minY: 0, maxY: 195 });
    expect(moved.restrictToPageSize).toBe(false);
  });

  it("ändrar ramens storlek från övre vänstra hörnet, inom det tryckbara papperet", () => {
    const page = pageOfSheet({ automatic: true, restrictToPageSize: true }, sheet);
    const smaller = resizedFrameArea({ automatic: true, restrictToPageSize: true }, page, frame, sheet, 150, 100);
    expect(smaller).toMatchObject({ automatic: false, restrictToPageSize: false, rect: { minX: 0, maxY: 195, maxX: 150, minY: 95 } });
    const larger = resizedFrameArea({ automatic: true, restrictToPageSize: true }, page, frame, sheet, 1000, 5);
    expect(larger.rect!.maxX - larger.rect!.minX).toBeCloseTo(296.926 - 2 * 7.112, 2);
    expect(larger.rect!.maxY - larger.rect!.minY).toBe(20);
  });
});
