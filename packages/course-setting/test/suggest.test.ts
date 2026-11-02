/**
 * Förslag på kontrollbeskrivning (ADR-0180 beslut 13): varje regel provas på en liten syntetisk karta (1:15 000, mm med
 * y uppåt). Ägarens kartor provas i `suggest-owner.test.ts`.
 */
import type { MapObject, MapSymbol, ParsedMap, Point } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import {
  acceptSuggestion, featureRuleFor, lacksFeature, mapNorthDegrees, suggestAt, suggestForDocument, type DescriptionSuggestion
} from "../src";
import { normalizedCode } from "../src/suggest-symbols";
import { Builder } from "./build";

const code = (text: string) => ({ text, main: Number(text.split(".")[0]), sub: Number(text.split(".")[1] ?? 0) });
const dot = (color: number, diameter: number) => [{ kind: "dot" as const, color, center: { x: 0, y: 0 }, diameter }];
const point = (id: string, number: string, name: string, color = 0, diameter = 0.4): MapSymbol =>
  ({ id, kind: "POINT", code: code(number), name, hidden: false, elements: dot(color, diameter) });
const lineSymbol = (id: string, number: string, name: string, color = 0, width = 0.25, extra: Partial<MapSymbol> = {}): MapSymbol =>
  ({ id, kind: "LINE", code: code(number), name, hidden: false, strokes: [{ color, width }], ...extra } as MapSymbol);
const area = (id: string, number: string, name: string, fill: number): MapSymbol =>
  ({ id, kind: "AREA", code: code(number), name, hidden: false, fill, hatches: [] });

const SYMBOLS: MapSymbol[] = [
  point("stone", "204.0", "Sten"),
  point("stone-own", "999.0", "Stor sten"),
  point("knoll", "109.0", "Punkthöjd", 2, 0.75),
  point("tick", "101.1", "Lutningsstreck", 2, 0.1),
  point("pylon-free", "418.0", "Buske", 1),
  lineSymbol("path", "506.0", "Liten stig"),
  lineSymbol("stream", "305.0", "Bäck", 4, 0.18),
  lineSymbol("gully", "107.0", "Fåra", 2, 0.18),
  lineSymbol("fence", "516.0", "Staket", 0, 0.18),
  lineSymbol("ruined-fence", "517.0", "Raserat staket", 0, 0.18),
  lineSymbol("railway", "509.0", "Järnväg", 0, 0.4),
  lineSymbol("contour", "101.0", "Höjdkurva", 2, 0.14),
  lineSymbol("north", "601.0", "Nordlinje", 0, 0.1),
  lineSymbol("red", "305.3", "Röd linje", 5, 0.3),
  lineSymbol("mask", "508.10", "Vit mask", 3, 0.5),
  // Brant med taggar till höger om linjens riktning (y < 0), som OCAD:s ISOM 202.
  lineSymbol("cliff", "202.0", "Brant", 0, 0.25, { repeated: { elements: [{ kind: "line", color: 0, width: 0.12,
    path: [{ type: "M", x: 0, y: 0 }, { type: "L", x: 0, y: -0.5 }] }], spacing: 0.5 } } as Partial<MapSymbol>),
  lineSymbol("power", "510.0", "Kraftledning", 0, 0.14, { corner: { elements: dot(0, 0.3), stretch: false } } as Partial<MapSymbol>),
  area("marsh", "308.0", "Sankmark", 4),
  area("deep-marsh", "307.0", "Opasserbar sankmark", 4),
  area("building", "521.0", "Byggnad", 0),
  area("open", "401.0", "Öppen mark", 6)
];
const color = (id: number, r: number, g: number, b: number) => ({ id, name: String(id), rank: id, cmyk: { c: 0, m: 0, y: 0, k: 1 }, rgb: { r, g, b }, opacity: 1 });

function mapOf(objects: MapObject[]): ParsedMap {
  return {
    format: "OCD", version: "test", scale: 15000, georeference: null, warnings: [], bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 },
    colors: [color(0, 0, 0, 0), color(1, 0, 0.7, 0), color(2, 0.7, 0.35, 0), color(3, 1, 1, 1), color(4, 0, 0.5, 1), color(5, 0.9, 0.1, 0.1),
      color(6, 1, 0.8, 0.3)],
    symbols: new Map(SYMBOLS.map(symbol => [symbol.id, symbol])), objects
  };
}
const line = (symbol: string, ...points: Point[]): MapObject =>
  ({ kind: "line", symbol, path: points.map((p, i) => ({ type: i === 0 ? "M" : "L", x: p.x, y: p.y })) as never });
const at = (symbol: string, x: number, y: number): MapObject => ({ kind: "point", symbol, at: { x, y }, angle: 0 });
const polygon = (symbol: string, ...points: Point[]): MapObject =>
  ({ kind: "area", symbol, angle: 0, rings: [[...points, points[0]!].map((p, i) => ({ type: i === 0 ? "M" : "L", x: p.x, y: p.y }))] as never });
const square = (symbol: string, x: number, y: number, side: number) =>
  polygon(symbol, { x, y }, { x: x + side, y }, { x: x + side, y: y + side }, { x, y: y + side });
const circleLine = (symbol: string, cx: number, cy: number, r: number): MapObject =>
  line(symbol, ...Array.from({ length: 25 }, (_, i) => ({ x: cx + r * Math.cos(i * Math.PI / 12), y: cy + r * Math.sin(i * Math.PI / 12) })));

const O = { x: 0, y: 0 };
const best = (objects: MapObject[], where: Point = O, options = {}) => suggestAt(mapOf(objects), where, options)[0];
const refs = (suggestion: DescriptionSuggestion | undefined) =>
  Object.fromEntries((suggestion?.boxes ?? []).map(box => [box.box, box.ref]));

describe("tabellen ISOM 2017-2 / ISSprOM 2019-2 → IOF 2018 kolumn D", () => {
  it("matchar på hela numret och huvudnumret, OCAD:s tre decimaler och undernummer", () => {
    expect(normalizedCode("104.0")).toBe("104");
    expect(normalizedCode("105.100")).toBe("105.1");
    expect(featureRuleFor(code("206.1"), "", "point", false)?.rule.d).toBe("2.4");
    expect(featureRuleFor(code("105.100"), "", "line", false)?.rule.d).toBe("1.6");
    expect(featureRuleFor(code("204.0"), "Sten", "point", false)).toMatchObject({ rule: { d: "2.4" }, by: "NUMBER" });
    expect(featureRuleFor(code("509.1"), "", "line", true)?.rule.d).toBe("5.26");
  });
  it("prövar namnet när numret inte passar geometrin eller saknas, aldrig för höjdkurvor", () => {
    expect(featureRuleFor(code("410.2"), "Häck", "line", false)).toMatchObject({ rule: { d: "4.6" }, by: "NAME" });
    expect(featureRuleFor(code("999.0"), "Stor sten", "point", false)).toMatchObject({ rule: { d: "2.4" }, by: "NAME" });
    expect(featureRuleFor(code("101.1"), "Sten", "point", false)).toBeUndefined();
    expect(featureRuleFor(code("998.0"), "Höjdkurva", "line", false)).toBeUndefined();
  });
  it("låter namnet välja bland numrets alternativ (512 Bro/tunnel)", () => {
    expect(featureRuleFor(code("512.1"), "Tunnel (minimimått)", "point", false)?.rule).toMatchObject({ d: "5.7", alternatives: ["5.4"] });
    expect(featureRuleFor(code("512.0"), "Bro/tunnel", "line", false)?.rule.d).toBe("5.4");
  });
});

describe("punktobjekt", () => {
  it("sten i centrum: D sten utan läge, hög säkerhet, förklaring med avstånd", () => {
    const suggestion = best([at("stone", 0.05, 0)]);
    expect(refs(suggestion)).toEqual({ D: "2.4" });
    expect(suggestion?.level).toBe("HIGH");
    expect(suggestion?.reason).toBe("Sten (ISOM 204) under 1 m från centrum");
    expect(suggestion?.features[0]).toMatchObject({ code: "204.0", geometry: "point", matchedBy: "NUMBER" });
  });
  it("kontrollen norr om stenen: norra sidan; punkthöjd: foten", () => {
    expect(refs(best([at("stone", 0, -0.6)]))).toEqual({ D: "2.4", G: "11.1N" });
    expect(refs(best([at("knoll", 0.75, 0)]))).toEqual({ D: "1.10", G: "11.14W" });
  });
  it("väderstrecket räknas från kartans nordlinjer (601) eller angiven norr", () => {
    const north = [line("north", { x: -50, y: -50 }, { x: -50 + 100 * Math.cos(1.4), y: -50 + 100 * Math.sin(1.4) })];
    expect(mapNorthDegrees(mapOf(north))).toBeCloseTo(1.4 * 180 / Math.PI, 3);
    expect(mapNorthDegrees(mapOf([]))).toBe(90);
    // Norr åt +x: kontrollen öster om stenen i papperet ligger på stenens norra sida.
    expect(refs(best([at("stone", -0.6, 0)], O, { northDegrees: 0 }))).toEqual({ D: "2.4", G: "11.1N" });
  });
  it("namnet som reserv ger lägre säkerhet och säger det", () => {
    const own = best([at("stone-own", 0, 0)]);
    const isom = best([at("stone", 0, 0)]);
    expect(refs(own)).toEqual({ D: "2.4" });
    expect(own!.confidence).toBeLessThan(isom!.confidence);
    expect(own?.reason).toContain("kartsymbol 999, efter namnet");
  });
  it("flera stenar i ringen: C säger vilken (den norra), mellan två: G mellan", () => {
    expect(refs(best([at("stone", 0, 0), at("stone", 0, -1.2)]))).toEqual({ C: "0.1N", D: "2.4" });
    expect(refs(best([at("stone", -0.5, 0), at("stone", 0.5, 0)]))).toEqual({ D: "2.4", G: "11.15single" });
  });
});

describe("linjer", () => {
  const cliff = line("cliff", { x: -3, y: 0 }, { x: 3, y: 0 });
  it("brant: foten på taggarnas sida (söder om en brant ritad österut), annars uppe på", () => {
    expect(refs(best([cliff], { x: 0, y: -0.5 }))).toEqual({ D: "2.1", G: "11.14S" });
    expect(refs(best([cliff], { x: 0, y: 0.5 }))).toEqual({ D: "2.1", G: "11.11" });
  });
  it("fåra: vid änden", () => {
    expect(refs(best([line("gully", { x: 0, y: 0 }, { x: -3, y: 0 })], { x: 0.1, y: 0 }))).toEqual({ D: "1.7", G: "11.8E" });
  });
  it("en linje som fortsätter i ett annat objekt har ingen ände där", () => {
    const parts = [line("gully", { x: 0, y: 0 }, { x: -3, y: 0 }), line("gully", { x: 0, y: 0 }, { x: 3, y: 0 })];
    expect(refs(best(parts, { x: 0, y: 0 }))).toEqual({ D: "1.7" });
  });
  it("staket: hörnet på insidan och utsidan", () => {
    const fence = line("fence", { x: -3, y: 0 }, { x: 0, y: 0 }, { x: 0, y: -3 });
    expect(refs(best([fence], { x: -0.25, y: -0.25 }))).toEqual({ D: "5.9", G: "11.4NE" });
    expect(refs(best([fence], { x: 0.25, y: 0.25 }))).toEqual({ D: "5.9", G: "11.5NE" });
  });
  it("E ur symbolen: raserat staket", () => {
    expect(refs(best([line("ruined-fence", { x: -3, y: 0 }, { x: 3, y: 0 })]))).toEqual({ D: "5.9", E: "8.11" });
  });
  it("stigar som möts: förgrening och korsning; stig och bäck: korsning med bäcken i E", () => {
    const west = line("path", { x: -3, y: 0 }, { x: 0, y: 0 }), east = line("path", { x: 0, y: 0 }, { x: 3, y: 0 });
    const north = line("path", { x: 0, y: 0 }, { x: 0, y: 3 }), south = line("path", { x: 0, y: 0 }, { x: 0, y: -3 });
    expect(refs(best([west, east, north]))).toEqual({ D: "5.2", F: "10.2single" });
    expect(refs(best([west, east, north, south]))).toEqual({ D: "5.2", F: "10.1single" });
    expect(refs(best([west, east], { x: 0, y: 0 }))).toEqual({ D: "5.2" });
    const stream = line("stream", { x: 0, y: -3 }, { x: 0, y: 3 });
    const crossing = best([line("path", { x: -3, y: 0 }, { x: 3, y: 0 }), stream]);
    expect(refs(crossing)).toEqual({ D: "5.2", E: "3.4", F: "10.1" });
    expect(crossing?.features.map(feature => feature.code)).toEqual(["506.0", "305.0"]);
  });
  it("kraftledningens stolpe i en brytpunkt", () => {
    expect(refs(best([line("power", { x: -3, y: 1 }, { x: 0, y: 0 }, { x: 3, y: 1 })]))).toEqual({ D: "5.6" });
  });
  it("hittar aldrig på mått i F", () => {
    const all = suggestAt(mapOf([at("stone", 0, 0), at("knoll", 0.5, 0.5), line("path", { x: -3, y: 0.3 }, { x: 3, y: 0.3 })]), O);
    for (const suggestion of all) for (const box of suggestion.boxes) {
      expect(box.text).toBeUndefined();
      if (box.box === "F") expect(box.ref).toMatch(/^10\./);
    }
  });
});

describe("ytor och höjdkurvor", () => {
  it("liten sankmark runt centrum: hela ytan, utan läge; opasserbar sankmark: djup", () => {
    expect(refs(best([square("marsh", -0.5, -0.5, 1)]))).toEqual({ D: "3.7" });
    expect(refs(best([square("deep-marsh", -0.5, -0.5, 1)]))).toEqual({ D: "3.7", E: "8.3" });
  });
  it("byggnad: hörnet på utsidan och sidan", () => {
    const building = square("building", -3, -3, 3);
    expect(refs(best([building], { x: 0.15, y: 0.15 }))).toEqual({ D: "5.11", G: "11.5NE" });
    expect(refs(best([building], { x: -1.5, y: 0.2 }))).toEqual({ D: "5.11", G: "11.1N" });
  });
  it("stor sankmark: kanten med riktning ut ur ytan", () => {
    expect(refs(best([square("marsh", -5, -5, 5)], { x: -2.5, y: 0.1 }))).toEqual({ D: "3.7", G: "11.2N" });
  });
  it("öppen marks inre hörn: skogshörn", () => {
    const open = polygon("open", { x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 5 }, { x: -5, y: 5 });
    const all = suggestAt(mapOf([open]), { x: 0.1, y: 0.1 });
    expect(all.map(refs)).toContainEqual({ D: "4.3" });
  });
  it("sluten höjdkurva runt centrum: höjd; med lutningsstreck inuti: grop", () => {
    expect(refs(best([circleLine("contour", 0, 0, 0.8)]))).toEqual({ D: "1.9" });
    expect(refs(best([circleLine("contour", 0, 0, 0.8), at("tick", 0.6, 0)]))).toEqual({ D: "1.12" });
  });
});

describe("det som inte är terräng och standarden", () => {
  it("bryr sig inte om banans röda och vita hjälpsymboler", () => {
    expect(suggestAt(mapOf([line("red", { x: -3, y: 0 }, { x: 3, y: 0 }), line("mask", { x: -3, y: 0 }, { x: 3, y: 0 })]), O)).toEqual([]);
  });
  it("järnväg finns bara i IOF 2018", () => {
    const railway = [line("railway", { x: -3, y: 0 }, { x: 3, y: 0 })];
    expect(refs(best(railway, O, { standard: "2018" }))).toEqual({ D: "5.26" });
    expect(suggestAt(mapOf(railway), O, { standard: "2004" })).toEqual([]);
  });
  it("högst tre förslag, bäst först, med säkerhet och förklaring", () => {
    const all = suggestAt(mapOf([at("stone", 0, 0), at("knoll", 0.6, 0), line("cliff", { x: -3, y: -0.6 }, { x: 3, y: -0.6 }), square("marsh", -0.5, 0.3, 1)]), O);
    expect(all.length).toBe(3);
    expect(refs(all[0])).toEqual({ D: "2.4" });
    for (let i = 1; i < all.length; i++) expect(all[i]!.confidence).toBeLessThanOrEqual(all[i - 1]!.confidence);
    for (const suggestion of all) { expect(suggestion.reason.length).toBeGreaterThan(5); expect(suggestion.features.length).toBeGreaterThan(0); }
  });
});

describe("godta", () => {
  it("ersätter C, D, E och G men behåller mått i F och H; F ersätts bara med korsning", () => {
    const current = [{ box: "C", ref: "0.1N" }, { box: "D", ref: "1.10" }, { box: "F", text: "1.5" }, { box: "H", ref: "12.1" }];
    expect(acceptSuggestion(current, { boxes: [{ box: "D", ref: "2.4" }, { box: "G", ref: "11.1N" }] }))
      .toEqual([{ box: "D", ref: "2.4" }, { box: "F", text: "1.5" }, { box: "G", ref: "11.1N" }, { box: "H", ref: "12.1" }]);
    expect(acceptSuggestion(current, { boxes: [{ box: "D", ref: "5.2" }, { box: "F", ref: "10.2single" }] }))
      .toEqual([{ box: "D", ref: "5.2" }, { box: "F", ref: "10.2single" }, { box: "H", ref: "12.1" }]);
    expect(lacksFeature([{ box: "F", text: "2" }])).toBe(true);
    expect(lacksFeature([{ box: "D", ref: "2.4" }])).toBe(false);
  });
  it("förslag för dokumentets vanliga kontroller", () => {
    const b = new Builder({ mapScale: 15000 });
    b.control("START", 0, 0);
    const stone = b.control("NORMAL", 10, 10, "31");
    const document = b.document;
    const result = suggestForDocument(mapOf([at("stone", 10, 10)]), document);
    expect(Object.keys(result)).toEqual([stone]);
    expect(refs(result[stone]![0])).toEqual({ D: "2.4" });
  });
});
