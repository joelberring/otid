/** ADR-0211 beslut 3 och 11: förhandsvisningens lager är samma som PDF:ens (gloria under trädet, övre vitt slår ut). */
import { describe, expect, it } from "vitest";
import { BUILT_IN_PRINT_PROFILES, type PrintProfile } from "@o-tid/course-setting";
import type { ColorUsage, MapColor } from "@o-tid/map-file";
import { overBandImageKey, pressLayersFor } from "./course-setting-press-layers";

/** Kartfärg med rank (0 = överst) och CMYK i procent. */
const color = (id: number, name: string, rank: number, cmyk: [number, number, number, number]): MapColor =>
  ({ id, name, rank, cmyk: { c: cmyk[0] / 100, m: cmyk[1] / 100, y: cmyk[2] / 100, k: cmyk[3] / 100 }, rgb: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 1 });
const used = (codes: string[], kinds: ColorUsage["kinds"]): ColorUsage =>
  ({ objects: 4, kinds, codes, mains: codes.map(code => Number.parseInt(code, 10)), sample: { x: 10, y: 20 } });

const colors = [
  color(1, "Röd", 0, [0, 100, 0, 0]), color(2, "Vit för röd", 1, [0, 0, 0, 0]), color(3, "Grön 100% – Punktobjekt", 2, [76, 0, 91, 0]),
  color(4, "Vit över grön", 3, [0, 0, 0, 0]), color(5, "Svart 100%", 4, [0, 0, 0, 100]), color(6, "Brun 100%", 5, [0, 56, 100, 18]),
  color(7, "Gul 100%", 6, [0, 27, 79, 0])
];
const usage = new Map<number, ColorUsage>([[1, used(["709"], ["AREA"])], [2, used(["709"], ["AREA"])], [3, used(["417"], ["POINT"])],
  [4, used(["417"], ["POINT"])], [5, used(["505"], ["LINE"])], [6, used(["101"], ["LINE"])], [7, used(["401"], ["AREA"])]]);
const profile: PrintProfile = { ...BUILT_IN_PRINT_PROFILES[0]!, courseLayer: "REFERENCE" };

describe("förhandsvisningens lager (pressLayersFor)", () => {
  it("monoton snittpunkt och bandad OVER-ordning i exakt rank-ordning (övre vitt över svart/brunt och under rött)", () => {
    const layers = pressLayersFor(profile, colors, usage, 10000)!;
    expect(layers.norm).toBe("ISOM");
    expect(layers.under).toEqual([7]);
    expect(layers.overBands).toEqual([
      { kind: "INK", ids: [6, 5] },
      { kind: "WHITE", ids: [4] },
      { kind: "INK", ids: [3] },
      { kind: "WHITE", ids: [2] },
      { kind: "INK", ids: [1] }
    ]);
    expect(layers.overWhite).toEqual([4, 2]);
    expect(layers.overInk).toEqual([6, 5, 3, 1]);
    expect(overBandImageKey("k", 2)).toBe("k|OVER:2");
  });

  it("dolda färger utelämnas ur både overBands och under", () => {
    const hidden = { ...profile, mapColors: [{ match: { ocadIds: [2] }, hidden: true }, { match: { ocadIds: [7] }, hidden: true }] };
    const layers = pressLayersFor(hidden, colors, usage, 10000)!;
    expect(layers.over).not.toContain(2);
    expect(layers.under).not.toContain(7);
    expect(layers.overBands.map(band => band.ids)).toEqual([[6, 5], [4], [3, 1]]);
  });

  it("numren i undre lila i skog om inte \"Kontrollnummer och texter överst\" är valt", () => {
    expect(pressLayersFor(profile, colors, usage, 10000)!.numbersOnTop).toBe(false);
    expect(pressLayersFor({ ...profile, numbersOnTop: true }, colors, usage, 10000)!.numbersOnTop).toBe(true);
  });
});
