/**
 * Trappor ur ritade trappsteg (ägaren 2026-11-23, Stockholms baskarta i en sprintkarta): stegen blir en trappsymbol per trappa
 * i rätt längd och bredd, sidolinjer och ensamma steg ritas inte. Kartan 1:4 000: 1 m = 0,25 mm.
 */
import { describe, expect, it } from "vitest";
import { checkNorm, lineMinimum, stairLines, stairsFromSteps, stairWidthOfName, type StairInput } from "../src";

const M = 0.25;
const p = (x: number, y: number) => ({ x: x * M, y: y * M });
const open = (layer: string, ...points: { x: number; y: number }[]): StairInput => ({ points, closed: false, layer });
/** Ett rakt trapplopp: `count` steg `width` m breda med `tread` m mellan, uppför längs y från (x, y). */
const flight = (layer: string, x: number, y: number, count: number, width = 2, tread = 0.3) =>
  Array.from({ length: count }, (_, step) => open(layer, p(x, y + step * tread), p(x + width, y + step * tread)));
const length = (path: readonly { x: number; y: number }[]) => path.reduce((sum, point, at) => at === 0 ? 0 : sum + Math.hypot(point.x - path[at - 1]!.x, point.y - path[at - 1]!.y), 0);

describe("trappor ur trappsteg", () => {
  it("rak trappa med sidolinjer: en mittlinje i gångriktningen, bredden = stegens längd, sidolinjerna ritas inte", () => {
    const lines = [...flight("STEG", 0, 0, 10), open("STEG", p(0, -0.2), p(0, 3)), open("STEG", p(2, -0.2), p(2, 3))];
    const result = stairsFromSteps(lines, 4000);
    expect(result.stairs).toHaveLength(1);
    const stair = result.stairs[0]!;
    expect(stair).toMatchObject({ steps: 10, layer: "STEG" });
    expect(stair.width).toBeCloseTo(2 * M, 6);
    // Från första till sista steget (2,7 m) och ett halvt steg till åt båda håll: 3 m, längs x = 1 m; förlängd till normens
    // minsta längd (tre grafiska steg, 1,2 mm = 4,8 m).
    expect(stair.path).toHaveLength(2);
    expect(length(stair.path)).toBeCloseTo(lineMinimum("532", 4000).length!, 2);
    expect(stair.path[0]!.y + stair.path[1]!.y).toBeCloseTo(2.7 * M, 6);
    for (const point of stair.path) expect(point.x).toBeCloseTo(1 * M, 6);
    expect(result.kept).toEqual([]);
    expect(result.layers).toEqual([{ layer: "STEG", lines: 12, stairs: 1, steps: 10, dropped: 2 }]);
  });

  it("böjd trappa: mittlinjen följer stegens mittpunkter runt svängen", () => {
    // Tolv steg 1,5 m breda längs en kvartscirkel med radien 6 m (stegen pekar mot mitten).
    const lines = Array.from({ length: 12 }, (_, step) => {
      const angle = step / 11 * Math.PI / 2, c = Math.cos(angle), s = Math.sin(angle);
      return open("STEG", p(5.25 * c, 5.25 * s), p(6.75 * c, 6.75 * s));
    });
    const [stair, ...more] = stairsFromSteps(lines, 4000).stairs;
    expect(more).toEqual([]);
    expect(stair!.steps).toBe(12);
    expect(stair!.path.length).toBeGreaterThan(3);
    // Mittlinjen ligger nära cirkeln med radien 6 m.
    for (const point of stair!.path.slice(1, -1)) expect(Math.hypot(point.x, point.y) / M).toBeCloseTo(6, 0);
  });

  it("två trapplopp sida vid sida (ledstång emellan) blir två trappor, inte en bred", () => {
    const lines = [...flight("STEG", 0, 0, 8, 1.5), ...flight("STEG", 1.7, 0, 8, 1.5)];
    const result = stairsFromSteps(lines, 4000);
    expect(result.stairs).toHaveLength(2);
    // 1,5 m är smalare än normens 0,4 mm (1,6 m vid 1:4 000).
    for (const stair of result.stairs) expect(stair.width).toBe(0.4);
    expect(result.stairs.map(stair => Number((stair.path[0]!.x / M).toFixed(6))).sort()).toEqual([0.75, 2.45]);
  });

  it("ensamma steg och par i ett lager med trappor ritas inte; ett lager utan steg (mittlinjer) ritas som förut", () => {
    const lines = [...flight("STEG", 0, 0, 6), open("STEG", p(20, 0), p(22, 0)), ...flight("STEG", 40, 0, 2),
      open("OSM trappa", p(60, 0), p(60, 8)), open("OSM trappa", p(70, 0), p(72, 5)), { ...open("STEG", p(80, 0), p(82, 0), p(82, 1)), closed: true }];
    const result = stairsFromSteps(lines, 4000);
    expect(result.stairs).toHaveLength(1);
    expect(result.kept.map(line => line.layer)).toEqual(["OSM trappa", "OSM trappa"]);
    expect(result.layers).toEqual([{ layer: "STEG", lines: 10, stairs: 1, steps: 6, dropped: 4 },
      { layer: "OSM trappa", lines: 2, stairs: 0, steps: 0, dropped: 0 }]);
  });

  it("lopp med en kort vilplan emellan blir en trappa; en sväng på 90° blir två", () => {
    const landing = stairsFromSteps([...flight("STEG", 0, 0, 6), ...flight("STEG", 0, 3.5, 6)], 4000).stairs;
    expect(landing).toHaveLength(1);
    expect(landing[0]!.steps).toBe(12);
    const turned = [...flight("STEG", 0, 0, 6),
      ...Array.from({ length: 6 }, (_, step) => open("STEG", p(2.5 + step * 0.3, 1.5), p(2.5 + step * 0.3, 3.5)))];
    expect(stairsFromSteps(turned, 4000).stairs).toHaveLength(2);
  });

  it("normens minsta mått i sprint: en smal kort trappa blir 0,4 mm bred och tre grafiska steg lång i 1:4 000 och 1:3 000", () => {
    expect(lineMinimum("532", 4000)).toEqual({ length: 1.1, width: 0.4 });
    for (const scale of [4000, 3000]) {
      const metre = 1000 / scale;
      // Tre steg 0,8 m breda med 0,3 m mellan: 0,9 m lång i verkligheten.
      const lines = Array.from({ length: 3 }, (_, step) => open("STEG", { x: 0, y: step * 0.3 * metre }, { x: 0.8 * metre, y: step * 0.3 * metre }));
      const [stair] = stairsFromSteps(lines, scale).stairs;
      expect(stair!.width, String(scale)).toBe(0.4);
      expect(length(stair!.path), String(scale)).toBeGreaterThanOrEqual(1.1);
      // Normkontrollen flaggar inte trappan (och skulle flagga den verkliga längden).
      const object = { kind: "line" as const, symbol: "532", path: stair!.path.map((point, at) => ({ type: at === 0 ? "M" as const : "L" as const, ...point })) };
      expect(checkNorm([{ key: "n:1", code: "532", object }], scale).issues, String(scale)).toEqual([]);
      const real = { ...object, path: [{ type: "M" as const, x: 0, y: 0 }, { type: "L" as const, x: 0, y: 0.9 * metre }] };
      expect(checkNorm([{ key: "n:1", code: "532", object: real }], scale).issues.map(issue => issue.rule)).toEqual(["SHORT_LINE"]);
    }
    // En bredare och längre trappa behåller sina mått.
    const wide = stairsFromSteps(flight("STEG", 0, 0, 20, 3), 4000).stairs[0]!;
    expect(wide.width).toBeCloseTo(3 * M, 6);
    expect(length(wide.path)).toBeCloseTo(6 * M, 6);
  });

  it("varianten med närmast bredd väljs; en mycket bred trappa fylls med parallella linjer", () => {
    expect(stairWidthOfName("Stairway, 1.6 m")).toBe(0.4);
    expect(stairWidthOfName("Trappa, 2,8 m")).toBe(0.7);
    expect(stairWidthOfName("Trappa")).toBeUndefined();
    const symbols = [{ id: "narrow", widthMm: 0.4 }, { id: "wide", widthMm: 0.7 }];
    const stairOf = (width: number) => stairsFromSteps(flight("STEG", 0, 0, 8, width), 4000).stairs[0]!;
    expect(stairLines(stairOf(1.2), "x", symbols).map(line => line.symbol)).toEqual(["narrow"]);
    expect(stairLines(stairOf(2.4), "x", symbols).map(line => line.symbol)).toEqual(["wide"]);
    const wide = stairLines(stairOf(10), "x", symbols);
    expect(wide.map(line => line.symbol)).toEqual(["wide", "wide", "wide", "wide"]);
    // Ytterlinjerna ligger en halv variantbredd innanför trappans kanter (0 och 10 m).
    expect(wide.map(line => line.path[0]!.x / M).sort((a, b) => a - b).map(x => Number(x.toFixed(6)))).toEqual([1.4, 3.8, 6.2, 8.6]);
    // Utan bredd i namnen: den valda symbolen, en linje.
    expect(stairLines(stairOf(10), "x", [{ id: "x" }])).toHaveLength(1);
  });

  it("13 000 steg på under en sekund", () => {
    const lines = Array.from({ length: 1300 }, (_, at) => flight("STEG", (at % 40) * 10, Math.floor(at / 40) * 10, 10, 2)).flat();
    const start = performance.now();
    const result = stairsFromSteps(lines, 4000);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(result.stairs).toHaveLength(1300);
  });
});
