import { describe, expect, it } from "vitest";
import { mapMarking, paperFor, wrapText } from "../src/base-map/marking";

const symbols = { frame: "f", logo: "l", text: "t", heading: "h" };
const input = (bounds: { minX: number; minY: number; maxX: number; maxY: number }) => ({ bounds, symbols, textSize: 1.2, logoSize: 8.8, heading: "Gjord med O-Tid",
  paragraphs: ["Kartan får användas fritt för eget bruk. ".repeat(6).trim(), "Inställningar: skala 1:15 000"] });

describe("kartans märkning: ramen (ägaren 2026-11-15: närmare, alltid utanför kartan)", () => {
  it("väljer det minsta pappret som rymmer ramen, stående eller liggande", () => {
    expect(paperFor(150, 200)).toEqual({ size: "A4", landscape: false });
    expect(paperFor(250, 150)).toEqual({ size: "A4", landscape: true });
    expect(paperFor(280, 100)).toEqual({ size: "A3", landscape: true });
    expect(paperFor(2000, 1500)).toBeUndefined();
  });
  it("lägger ramen 5 mm utanför kartan, namnet överst och rutan nederst, inget av det på kartan", () => {
    const bounds = { minX: 0, minY: 0, maxX: 250, maxY: 150 };
    const marking = mapMarking({ ...input(bounds), title: "Tyresta test", titleSize: 4 });
    expect(marking.frame.minX).toBe(-5); expect(marking.frame.maxX).toBe(255);
    expect(marking.frame.maxY).toBeCloseTo(150 + 5 + 6.4, 6);
    expect(marking.box.maxY).toBeLessThan(bounds.minY - 4.9);
    const title = marking.objects.find(object => object.kind === "text" && object.text === "Tyresta test") as { at: { x: number; y: number } } | undefined;
    expect(title).toBeDefined();
    expect(title!.at.y).toBeGreaterThan(bounds.maxY); expect(title!.at.y).toBeLessThan(marking.frame.maxY);
    // Namnet står ungefär i mitten.
    expect(Math.abs(title!.at.x + 12 * 4 * 0.52 * 1.1 / 2 - 125)).toBeLessThan(1);
    expect(marking.paper).toEqual(paperFor(marking.frame.maxX - marking.frame.minX, marking.frame.maxY - marking.frame.minY));
  });
  it("utan namn ingen rad överst, och en smal karta får en ram som rymmer rutan", () => {
    const narrow = mapMarking(input({ minX: 0, minY: 0, maxX: 20, maxY: 100 }));
    expect(narrow.frame.maxY).toBe(105);
    expect(narrow.frame.maxX - narrow.frame.minX).toBeGreaterThanOrEqual(narrow.box.maxX - narrow.box.minX + 6);
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
});
