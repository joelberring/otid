import { describe, expect, it } from "vitest";
import { mapMarking, markingFrame, wrapText } from "../src/base-map/marking";

const symbols = { frame: "f", logo: "l", text: "t", heading: "h" };
const input = (bounds: { minX: number; minY: number; maxX: number; maxY: number }) => ({ bounds, symbols, textSize: 1.2, logoSize: 8.8, heading: "Gjord med O-Tid",
  paragraphs: ["Kartan får användas fritt för eget bruk. ".repeat(6).trim(), "Inställningar: skala 1:15 000"] });

describe("kartans märkning: ramen", () => {
  it("väljer det minsta pappret som rymmer kartan, stående eller liggande, med ramen 10 mm från kanten", () => {
    // 150 × 200 mm ryms på A4 stående (190 × 277 mm innanför marginalen).
    const tall = markingFrame({ minX: 0, minY: 0, maxX: 150, maxY: 200 });
    expect(tall.paper).toEqual({ size: "A4", landscape: false });
    expect(tall.frame).toEqual({ minX: -20, minY: -38.5, maxX: 170, maxY: 238.5 });
    expect(markingFrame({ minX: 0, minY: 0, maxX: 250, maxY: 150 }).paper).toEqual({ size: "A4", landscape: true });
    // 200 mm brett går inte på A4 stående (190 − 6) men på A4 liggande; 280 mm kräver A3.
    expect(markingFrame({ minX: 0, minY: 0, maxX: 200, maxY: 100 }).paper).toEqual({ size: "A4", landscape: true });
    expect(markingFrame({ minX: 0, minY: 0, maxX: 280, maxY: 100 }).paper).toEqual({ size: "A3", landscape: true });
    expect(markingFrame({ minX: 0, minY: 0, maxX: 366, maxY: 276 }).paper).toEqual({ size: "A2", landscape: true });
  });
  it("lägger ramen runt kartan med marginal när den är större än A0", () => {
    const huge = markingFrame({ minX: 0, minY: 0, maxX: 2000, maxY: 1500 });
    expect(huge.paper).toBeUndefined();
    expect(huge.frame).toEqual({ minX: -13, minY: -13, maxX: 2013, maxY: 1513 });
  });
});

describe("kartans märkning: rutan", () => {
  it("bryter texten vid ordgränser", () => {
    expect(wrapText("ett två tre fyra", 8)).toEqual(["ett två", "tre fyra"]);
    expect(wrapText("superlångtord kort", 5)).toEqual(["superlångtord", "kort"]);
    expect(wrapText("  ", 10)).toEqual([]);
  });
  it("ger en sluten ram, loggan, rubriken och en text per rad, allt innanför ramen", () => {
    const marking = mapMarking(input({ minX: 0, minY: 0, maxX: 250, maxY: 150 }));
    const [frame, logo, heading, ...lines] = marking.objects;
    expect(frame).toMatchObject({ kind: "line", symbol: "f" });
    const path = (frame as unknown as { path: { x: number; y: number }[] }).path;
    expect(path).toHaveLength(5); expect(path[4]).toMatchObject({ x: path[0]!.x, y: path[0]!.y });
    expect(logo).toMatchObject({ kind: "point", symbol: "l" });
    expect(heading).toMatchObject({ kind: "text", symbol: "h", text: "Gjord med O-Tid" });
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.every(line => line.kind === "text" && line.symbol === "t" && line.text.length <= 100)).toBe(true);
    const ys = lines.map(line => (line as { at: { y: number } }).at.y);
    expect(ys).toEqual([...ys].sort((a, b) => b - a));
    for (const object of marking.objects.slice(1)) {
      const at = (object as { at: { x: number; y: number } }).at;
      expect(at.x).toBeGreaterThan(marking.box.minX); expect(at.x).toBeLessThan(marking.box.maxX);
      expect(at.y).toBeGreaterThan(marking.box.minY); expect(at.y).toBeLessThan(marking.box.maxY);
    }
    expect(marking.box.minX).toBeGreaterThanOrEqual(marking.frame.minX); expect(marking.box.maxY).toBeLessThanOrEqual(marking.frame.maxY);
  });
  it("lägger rutan nere till höger när hörnen är lika tomma, annars i det tommaste", () => {
    const bounds = { minX: 0, minY: 0, maxX: 250, maxY: 150 };
    const free = mapMarking(input(bounds));
    expect(free.box.maxX).toBeCloseTo(free.frame.maxX - 3, 6); expect(free.box.minY).toBeCloseTo(free.frame.minY + 3, 6);
    // Allt utom övre vänstra hörnet är upptaget.
    const crowded = mapMarking({ ...input(bounds), occupied: box => box.minX < 100 && box.maxY > 100 ? 0 : 5 });
    expect(crowded.box.minX).toBeCloseTo(crowded.frame.minX + 3, 6); expect(crowded.box.maxY).toBeCloseTo(crowded.frame.maxY - 3, 6);
  });
});
