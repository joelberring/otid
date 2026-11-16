import { describe, expect, it } from "vitest";
import { newMapFile, readMapFile, type MapSymbol, type ParsedMap } from "../src";
import { DOT_COLOR_NAME, withDotsUnderOlive } from "../src/template-upgrade";

const KUNGSHATT = { easting: 664_000, northing: 6_577_000 };
const dotColors = (map: ParsedMap, code: number) => {
  const symbol = [...map.symbols.values()].find(item => item.kind === "AREA" && item.code.main === code) as Extract<MapSymbol, { kind: "AREA" }>;
  return symbol.pattern!.elements.map(element => map.colors.find(color => color.id === element.color)!);
};

describe("prickarna i 402 och 404 under olivgrönt i äldre kartor (ägaren 2026-11-16)", () => {
  it("nya kartor har färgen i mallen och läses som de är", () => {
    const map = readMapFile(newMapFile({ symbolSet: "ISOM2017-2", scale: 10000, refPoint: KUNGSHATT }));
    expect(map.colors.filter(color => color.name === DOT_COLOR_NAME)).toHaveLength(1);
    expect(withDotsUnderOlive(map)).toBe(map);
  });
  it("en karta där prickarna har färgen Vit får en egen färg mellan olivgrönt och grönt", () => {
    const fresh = readMapFile(newMapFile({ symbolSet: "ISOM2017-2", scale: 10000, refPoint: KUNGSHATT }));
    const white = fresh.colors.find(color => color.name === "Vit")!, dots = fresh.colors.find(color => color.name === DOT_COLOR_NAME)!;
    // Som en karta ur mallen före 2026-11-16: ingen egen prickfärg, prickarna i «Vit».
    const old: ParsedMap = { ...fresh, colors: fresh.colors.filter(color => color.id !== dots.id), symbols: new Map([...fresh.symbols].map(([id, symbol]) =>
      [id, symbol.kind === "AREA" && symbol.pattern ? { ...symbol, pattern: { ...symbol.pattern, elements: symbol.pattern.elements.map(element =>
        element.color === dots.id ? { ...element, color: white.id } : element) } } : symbol])) };
    expect(dotColors(old, 404)[0]!.name).toBe("Vit");
    const upgraded = withDotsUnderOlive(old);
    const color = dotColors(upgraded, 404)[0]!, olive = upgraded.colors.find(item => item.name === "Olivgrön")!, green = upgraded.colors.find(item => item.name === "Grön")!;
    expect(color.name).toBe(DOT_COLOR_NAME);
    expect(dotColors(upgraded, 402)[0]!.name).toBe(DOT_COLOR_NAME);
    expect(color.rank).toBeGreaterThan(olive.rank);
    expect(color.rank).toBeLessThan(green.rank);
    expect(withDotsUnderOlive(upgraded)).toBe(upgraded);
  });
});
