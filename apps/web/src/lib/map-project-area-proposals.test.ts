import { describe, expect, it } from "vitest";
import type { MapObject, MapSymbol, Path } from "@o-tid/map-file";
import { objectBox } from "@o-tid/map-revision";
import { candidateAt, interiorPoint, proposeAreas, PROPOSE_MAX_CANDIDATES } from "./map-project-area-proposals";
import type { FillInput } from "./map-project-fill-area";

/** Sprintkartan i 1:4 000: 1 mm = 4 m, så 20 m² är 1,25 mm² och glapptoleransen 2 m är 0,5 mm. */
const symbol = (id: string, main: number, kind: "LINE" | "AREA", sub = 0) =>
  [id, { id, code: { main, sub, text: sub ? `${main}.${sub}` : String(main) }, name: id, hidden: false, kind } as unknown as MapSymbol] as const;
const symbols = new Map([symbol("kant", 501, "LINE", 1), symbol("belagt", 501, "AREA"), symbol("tomt", 520, "AREA"), symbol("hus", 521, "AREA"),
  symbol("staket", 516, "LINE"), symbol("gräs", 401, "AREA"), symbol("kurva", 101, "LINE")]);
const path = (...flat: number[]): Path => Array.from({ length: flat.length / 2 }, (_, at) => ({ type: at === 0 ? "M" as const : "L" as const, x: flat[at * 2]!, y: flat[at * 2 + 1]! }));
const line = (id: string, ...flat: number[]): MapObject => ({ kind: "line", symbol: id, path: path(...flat) });
const area = (id: string, x: number, y: number, width: number, height: number): MapObject =>
  ({ kind: "area", symbol: id, angle: 0, rings: [path(x, y, x + width, y, x + width, y + height, x, y + height)] });
const rect = (id: string, x: number, y: number, width: number, height: number) => line(id, x, y, x + width, y, x + width, y + height, x, y + height, x, y);
const input = (objects: MapObject[], scale = 4000): FillInput => ({ objects, boxes: objects.map(objectBox), symbols, scale });
const VIEW = { minX: -5, minY: -5, maxX: 45, maxY: 45 };
const propose = (objects: MapObject[], box = VIEW) => {
  const result = proposeAreas(input(objects), { box, hidden: [] });
  if (result.status !== "done") throw new Error(result.status);
  return result;
};

/**
 * En gata 1 × 30 mm (4 × 120 m) mellan två kantlinjer, och intill den en tomt 6 × 5 mm (24 × 20 m) med staket på tre sidor,
 * gatans kant på den fjärde och ett hus i mitten.
 */
const street = rect("kant", 0, 0, 1, 30);
const plot = [line("staket", 1, 10, 7, 10, 7, 15, 1, 15), area("hus", 3, 11.5, 2, 2)];

describe("Föreslå ytor", () => {
  it("gatan föreslås som belagd yta och tomten som tomtmark; huset är redan en yta", () => {
    const result = propose([street, ...plot]);
    expect(result).toMatchObject({ found: 2, filled: 1, small: 0 });
    const paved = result.candidates.find(candidate => candidate.symbol === "belagt")!;
    expect(paved).toMatchObject({ rule: "pavedNarrow", uncertain: undefined });
    expect(paved.areaM2).toBeCloseTo(4 * 120, 6);
    expect(paved.rings).toHaveLength(1);
    const yard = result.candidates.find(candidate => candidate.symbol === "tomt")!;
    expect(yard.rule).toBe("plot");
    // Tomten 24 × 20 m minus huset 8 × 8 m, med huset som hål.
    expect(yard.areaM2).toBeCloseTo(480 - 64, 6);
    expect(yard.rings).toHaveLength(2);
    // Etikettens punkt ligger i rutan och inte i huset.
    expect(candidateAt(result.candidates, yard.at)).toBe(result.candidates.indexOf(yard));
    expect(candidateAt(result.candidates, { x: 4, y: 12.5 })).toBe(-1);
    expect(candidateAt(result.candidates, { x: 0.5, y: 20 })).toBe(result.candidates.indexOf(paved));
  });

  it("rutor som redan täcks av ett ytobjekt är inga kandidater", () => {
    // Gatan är redan fylld med belagd yta, och tomten med tomtmark (som har huset som hål i sin ring).
    const filledPlot: MapObject = { kind: "area", symbol: "tomt", angle: 0, rings: [path(1, 10, 7, 10, 7, 15, 1, 15), path(3, 11.5, 5, 11.5, 5, 13.5, 3, 13.5)] };
    const result = propose([street, area("belagt", 0, 0, 1, 30), ...plot, filledPlot]);
    expect(result.candidates).toEqual([]);
    expect(result).toMatchObject({ found: 0, filled: 3 });
    // Bara gatan fylld: tomten är kvar som kandidat.
    expect(propose([street, area("belagt", 0, 0, 1, 30), ...plot]).candidates.map(candidate => candidate.symbol)).toEqual(["tomt"]);
    // En yta som ligger under hela rutan (gräs under en inhägnad) räknas också som fylld.
    expect(propose([street, ...plot, area("gräs", -2, -2, 20, 40)]).candidates).toEqual([]);
  });

  it("utan förslag: en bred ruta; osäker: sluten genom glappslutning eller större än 0,5 ha", () => {
    // Ett kvarter 10 × 10 mm (40 × 40 m) av kantlinjer är inte smalt.
    expect(propose([rect("kant", 0, 0, 10, 10)]).candidates).toMatchObject([{ symbol: undefined, uncertain: undefined, rule: "none" }]);
    // Gatans kant har ett glapp på 0,4 mm (1,6 m): rutan blir sluten men får inget förslag.
    const gap = propose([line("kant", 0, 0, 1, 0, 1, 30, 0, 30, 0, 0.4)]);
    expect(gap.candidates).toMatchObject([{ symbol: undefined, uncertain: "gaps" }]);
    // 20 × 20 mm är 80 × 80 m = 0,64 ha.
    expect(propose([rect("kant", 0, 0, 20, 20)]).candidates).toMatchObject([{ symbol: undefined, uncertain: "large" }]);
  });

  it("små rutor, öppna rutor och rutor som når utanför skärmen tas inte med; höjdkurvor och släckta lager är inga gränser", () => {
    // 1 × 1 mm är 16 m²: under minsta ytan.
    expect(propose([rect("kant", 0, 0, 1, 1)])).toMatchObject({ candidates: [], small: 1 });
    // En öppning på 1 mm (4 m) är större än toleransen.
    expect(propose([line("kant", 0, 0, 1, 0, 1, 30, 0, 30, 0, 1)]).candidates).toEqual([]);
    // Rutan sticker ut långt utanför skärmen (mer än marginalen 30 m = 7,5 mm).
    expect(propose([rect("kant", 0, 0, 1, 30)], { minX: -5, minY: -5, maxX: 5, maxY: 10 }).candidates).toEqual([]);
    // … men en ruta som bara sticker ut en bit kommer med.
    expect(propose([rect("kant", 0, 0, 1, 30)], { minX: -5, minY: -5, maxX: 5, maxY: 25 }).candidates).toHaveLength(1);
    // En höjdkurva tvärs över gatan delar den inte, och ett släckt staket inte heller.
    expect(propose([street, line("kurva", -1, 15, 2, 15)]).candidates).toHaveLength(1);
    const fenced = input([street, line("staket", 0, 15, 1, 15)]);
    expect(proposeAreas(fenced, { box: VIEW, hidden: [] })).toMatchObject({ found: 2 });
    expect(proposeAreas(fenced, { box: VIEW, hidden: ["staket"] })).toMatchObject({ found: 1 });
  });

  it("taket: de närmast skärmens mitt behålls och antalet som fanns redovisas", () => {
    // 21 × 21 rutor om 1,2 × 1,2 mm (23 m²) i ett rutnät.
    const grid: MapObject[] = [];
    for (let at = 0; at <= 21; at += 1) grid.push(line("staket", 0, at * 1.2, 25.2, at * 1.2), line("staket", at * 1.2, 0, at * 1.2, 25.2));
    const result = propose(grid, { minX: 0, minY: 0, maxX: 25.2, maxY: 25.2 });
    expect(result.found).toBe(441);
    expect(result.candidates).toHaveLength(PROPOSE_MAX_CANDIDATES);
    expect(candidateAt(result.candidates, { x: 12.6, y: 12.6 })).toBeGreaterThanOrEqual(0);
    expect(candidateAt(result.candidates, { x: 0.6, y: 0.6 })).toBe(-1);
  });

  it("bara på sprintkartor", () => {
    // En skogskarta: skalan 1:10 000 och skogsnormens väg (503) bland symbolerna.
    const forest = { ...input([street], 10000), symbols: new Map([...symbols, symbol("väg", 503, "LINE")]) };
    expect(proposeAreas(forest, { box: VIEW, hidden: [] })).toEqual({ status: "notSprint" });
  });

  it("en punkt inne i en yta med hål och i en L-formad yta", () => {
    const ring = (...flat: number[]) => Array.from({ length: flat.length / 2 }, (_, at) => ({ x: flat[at * 2]!, y: flat[at * 2 + 1]! }));
    // Hålet ligger mitt i: punkten hamnar i den bredaste biten bredvid.
    expect(interiorPoint([ring(0, 0, 10, 0, 10, 10, 0, 10), ring(4, 4, 4, 6, 9, 6, 9, 4)])).toEqual({ x: 2, y: 5 });
    // L-form: mitten av rutans omskrivna rektangel ligger utanför ytan.
    const corner = interiorPoint([ring(0, 0, 10, 0, 10, 2, 2, 2, 2, 10, 0, 10)])!;
    expect(corner).toEqual({ x: 1, y: 5 });
    expect(interiorPoint([ring(0, 0, 1, 1)])).toBeUndefined();
  });
});
