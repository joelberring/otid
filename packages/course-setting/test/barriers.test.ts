import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkDocument, readPpen, routeBarriers } from "../src";
import { lineCourse } from "./build";

const square = (x: number, y: number, size: number) => [{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }];

describe("spärrar för vägvalen och kontrollerna (steg 64)", () => {
  it("ger förbjudna områden, gränser, förbjuden väg och passager för banan", () => {
    const { b, course } = lineCourse(3);
    const other = b.course("B");
    b.edit({ type: "ADD_SPECIAL", special: { kind: "out-of-bounds", points: square(0, 20, 10) } });
    b.edit({ type: "ADD_SPECIAL", special: { kind: "dangerous-area", points: square(20, 20, 10), courses: [other] } });
    b.edit({ type: "ADD_SPECIAL", special: { kind: "boundary", points: [{ x: 0, y: 40 }, { x: 30, y: 40 }] } });
    b.edit({ type: "ADD_SPECIAL", special: { kind: "forbidden-route", points: [{ x: 50, y: 40 }] } });
    b.edit({ type: "ADD_SPECIAL", special: { kind: "optional-crossing-point", points: [{ x: 15, y: 40 }], orientation: 90 } });
    b.edit({ type: "ADD_SPECIAL", special: { kind: "white-out", points: square(60, 20, 10) } });
    const barriers = routeBarriers(b.document, course);
    expect(barriers.areas).toEqual([square(0, 20, 10)]);
    expect(barriers.lines).toHaveLength(3);
    // Gränsen 0,7 mm på papperet; ISOM-förvalet "RelativeTo15000" på en 1:10 000-karta ger 1,5 × i kartans mm.
    expect(barriers.lines[0]!.widthMm).toBeCloseTo(0.7 * 1.5, 6);
    expect(barriers.openings).toHaveLength(1);
    // Vriden 90°: passagen (mellan bågarna, längs figurens y-axel) går längs kartans x.
    const [a, c] = barriers.openings[0]!.points;
    expect(Math.abs(a!.y - c!.y)).toBeLessThan(1e-9);
    expect(Math.abs(a!.x - c!.x)).toBeCloseTo(3 * 1.5, 6);
    expect(routeBarriers(b.document, other).areas).toHaveLength(2);
    expect(routeBarriers(b.document, undefined).areas).toEqual([square(0, 20, 10)]);
  });

  it("varnar när en sträcka går genom ett förbjudet område eller över en gräns", () => {
    const { b, course } = lineCourse(3);
    const area = b.edit({ type: "ADD_SPECIAL", special: { kind: "out-of-bounds", points: [{ x: 25, y: -5 }, { x: 35, y: -5 }, { x: 30, y: 5 }] } });
    const checks = checkDocument(b.document).filter(check => check.kind === "LEG_THROUGH_FORBIDDEN");
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ course, special: area });
    const line = b.edit({ type: "ADD_SPECIAL", special: { kind: "boundary", points: [{ x: 10, y: -10 }, { x: 10, y: 10 }] } });
    expect(checkDocument(b.document).filter(check => check.kind === "LEG_THROUGH_FORBIDDEN").map(check => check.kind === "LEG_THROUGH_FORBIDDEN" && check.special))
      .toEqual(expect.arrayContaining([area, line]));
  });
});

const ppenPath = process.env.OTID_REAL_PPEN;
describe.skipIf(!(ppenPath && existsSync(ppenPath)))("ägarens SBN26_2.ppen (OTID_REAL_PPEN)", () => {
  it("ger förbjudna områden och passager som spärrar för alla banor", () => {
    const { document } = readPpen(readFileSync(ppenPath!, "utf8"));
    for (const course of document.courses) {
      const barriers = routeBarriers(document, course.id);
      expect(barriers.areas.length, course.name).toBe(document.specialObjects.filter(s => s.kind === "out-of-bounds").length);
      expect(barriers.openings.length, course.name).toBe(document.specialObjects.filter(s => s.kind === "optional-crossing-point").length);
    }
  });
});
