import { describe, expect, it } from "vitest";
import { applyEdit, bingoCells, bingoColumnName, layoutCoursePage, layoutOverprint, readPpen, writePpen, type CourseTraining } from "../src";
import { Builder } from "./build";

const bingo = (area: { minX: number; minY: number; maxX: number; maxY: number }, cellMeters: number): CourseTraining =>
  ({ outside: { kind: "FULL" }, sections: [], bingo: { area, cellMeters } });

describe("bingoorientering: rutnätet", () => {
  it("kolumnernas bokstäver: A … Z, AA, AB", () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(bingoColumnName)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA"]);
  });

  it("rutorna räknas från övre vänstra hörnet, kartans norr uppåt, i rader", () => {
    // 1:10 000: 100 m = 10 mm. Området 30 × 20 mm ger 3 × 2 rutor.
    const cells = bingoCells({ area: { minX: 0, minY: 0, maxX: 30, maxY: 20 }, cellMeters: 100 }, 10_000);
    expect(cells.map(cell => cell.name)).toEqual(["A1", "B1", "C1", "A2", "B2", "C2"]);
    expect(cells[0]!.rect).toEqual({ minX: 0, minY: 10, maxX: 10, maxY: 20 });
    expect(cells[5]!.rect).toEqual({ minX: 20, minY: 0, maxX: 30, maxY: 10 });
  });

  it("kantrutor som till största delen ligger utanför området tas bort, de andra klipps", () => {
    // 1:7 500: 150 m = 20 mm. 45 mm bred: den tredje kolumnen har 5 av 20 mm (25 %) och tas bort; 52 mm hög: tredje raden 12 mm (60 %) blir kvar.
    const cells = bingoCells({ area: { minX: 0, minY: 0, maxX: 45, maxY: 52 }, cellMeters: 150 }, 7_500);
    expect(cells.map(cell => cell.name)).toEqual(["A1", "B1", "A2", "B2", "A3", "B3"]);
    expect(cells.find(cell => cell.name === "A3")!.rect).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 12 });
  });

  it("utan yta eller med för många rutor: inga rutor", () => {
    expect(bingoCells({ area: { minX: 0, minY: 0, maxX: 0, maxY: 10 }, cellMeters: 100 }, 10_000)).toEqual([]);
    expect(bingoCells({ area: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }, cellMeters: 20 }, 10_000)).toEqual([]);
  });

  it("banpåtrycket har rutnätet och namnen i banans lila; kartans utsnitt följer rutnätet", () => {
    const b = new Builder();
    const course = b.course("Grön");
    b.edit({ type: "PUT_TRAINING", courses: { [course]: bingo({ minX: 100, minY: 50, maxX: 130, maxY: 70 }, 100) } });
    const figures = layoutOverprint(b.document, { course });
    const texts = figures.filter(figure => figure.kind === "text").map(figure => figure.kind === "text" ? figure.text : "");
    expect(texts).toEqual(["A1", "B1", "C1", "A2", "B2", "C2"]);
    const lines = figures.filter(figure => figure.kind === "polyline" && figure.ref === "bingo");
    // 3 × 2 rutor: 3 × 3 vågräta och 4 × 2 lodräta kanter.
    expect(lines).toHaveLength(17);
    expect(figures.every(figure => figure.color === "COURSE")).toBe(true);
    const [page] = layoutCoursePage(b.document, { course });
    const centerX = (page!.mapArea.minX + page!.mapArea.maxX) / 2, centerY = (page!.mapArea.minY + page!.mapArea.maxY) / 2;
    expect(centerX).toBeCloseTo(115, 0);
    expect(centerY).toBeCloseTo(60, 0);
  });

  it("formen kontrolleras och följer med i .ppen", () => {
    const b = new Builder();
    const course = b.course("Grön");
    expect(() => applyEdit(b.document, { type: "PUT_TRAINING", courses: { [course]: bingo({ minX: 10, minY: 0, maxX: 0, maxY: 10 }, 100) } })).toThrow(/ingen yta/);
    expect(() => applyEdit(b.document, { type: "PUT_TRAINING", courses: { [course]: bingo({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 5) } })).toThrow(/Rutans storlek/);
    expect(() => applyEdit(b.document, { type: "PUT_TRAINING", courses: { [course]: { outside: { kind: "FULL" }, sections: [],
      bingo: { area: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, cellMeters: 100, ships: [9] } } } })).toThrow(/Skeppets längd/);
    b.edit({ type: "PUT_TRAINING", courses: { [course]: { outside: { kind: "FULL" }, sections: [],
      bingo: { area: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, cellMeters: 150, ownArea: true, ships: [2, 2, 1] } } } });
    const read = readPpen(writePpen(b.document));
    expect(read.document.training?.courses[course]?.bingo).toEqual({ area: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, cellMeters: 150, ownArea: true,
      ships: [2, 2, 1] });
  });
});
