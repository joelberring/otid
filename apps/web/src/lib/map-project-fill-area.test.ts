import { describe, expect, it } from "vitest";
import type { MapObject, MapSymbol, Path } from "@o-tid/map-file";
import { objectBox } from "@o-tid/map-revision";
import { fillFinder, fillObject, type FillInput } from "./map-project-fill-area";

/** Kartan i 1:4 000: 1 mm = 4 m, toleransen 2 m = 0,5 mm och fönstret 150 m = 37,5 mm åt varje håll. */
const SCALE = 4000;
const symbol = (id: string, main: number, hidden = false) => [id, { id, code: { main, text: String(main) }, name: id, hidden, kind: "LINE" } as unknown as MapSymbol] as const;
const symbols = new Map([symbol("kant", 501), symbol("hus", 521), symbol("staket", 518), symbol("kurva", 101), symbol("nord", 601), symbol("dold", 518, true)]);
const path = (...flat: number[]): Path => Array.from({ length: flat.length / 2 }, (_, at) => ({ type: at === 0 ? "M" as const : "L" as const, x: flat[at * 2]!, y: flat[at * 2 + 1]! }));
const line = (id: string, ...flat: number[]): MapObject => ({ kind: "line", symbol: id, path: path(...flat) });
const house = (x: number, y: number, size: number): MapObject => ({ kind: "area", symbol: "hus", angle: 0, rings: [path(x, y, x + size, y, x + size, y + size, x, y + size)] });
const input = (objects: MapObject[]): FillInput => ({ objects, boxes: objects.map(objectBox), symbols, scale: SCALE });
const ask = (objects: MapObject[], x: number, y: number, hidden: string[] = [], diagnose = true) => fillFinder()(input(objects), { point: { x, y }, hidden, diagnose });

/** Ett kvarter 10 × 10 mm (40 × 40 m) av fyra kantlinjer, med ett hus i mitten. */
const block = [line("kant", 0, 0, 10, 0), line("kant", 10, 0, 10, 10), line("kant", 10, 10, 0, 10), line("kant", 0, 10, 0, 0), house(4, 4, 2)];

describe("Fyll yta", () => {
  it("fyller rutan mellan linjerna, med huset som hål, och räknar ytan i terrängen", () => {
    const result = ask(block, 1, 1);
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.rings).toHaveLength(2);
    expect(result.rings[0]).toHaveLength(4);
    // 40 × 40 m minus huset 8 × 8 m.
    expect(result.areaM2).toBeCloseTo(1600 - 64, 6);
    const object = fillObject("gräs", result.rings);
    expect(object.kind === "area" && object.rings.map(ring => ring.length)).toEqual([5, 5]);
    expect(object.kind === "area" && object.rings[0]![0]).toMatchObject({ type: "M" });
    // Klicket i huset ger husets ruta.
    const inHouse = ask(block, 5, 5);
    expect(inHouse.status === "found" && inHouse.areaM2).toBeCloseTo(64, 6);
  });

  it("sluter glapp upp till 2 m i terrängen och säger hur många", () => {
    // Staketet slutar 0,4 mm (1,6 m) före kanten.
    const result = ask([...block, line("staket", 7, 0, 7, 9.6)], 8, 5);
    expect(result).toMatchObject({ status: "found", closed: 1 });
    expect(result.status === "found" && result.areaM2).toBeCloseTo(3 * 10 * 16, 6);
  });

  it("en öppning större än toleransen: inte sluten, och öppningen pekas ut", () => {
    // Kvarteret har en öppning på 1 mm (4 m) i överkanten.
    const open = [line("kant", 0, 0, 10, 0), line("kant", 10, 0, 10, 10), line("kant", 10, 10, 5, 10), line("kant", 4, 10, 0, 10), line("kant", 0, 10, 0, 0)];
    const result = ask(open, 5, 5);
    expect(result.status).toBe("open");
    if (result.status !== "open") return;
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]!.map(point => [point.x, point.y]).sort()).toEqual([[4, 10], [5, 10]]);
    // Pekaren som bara hovrar letar inte efter öppningen.
    expect(ask(open, 5, 5, [], false)).toEqual({ status: "open", gaps: [] });
  });

  it("utan gräns inom fönstret: inte sluten och ingen öppning att peka på", () => {
    expect(ask([line("kant", 0, 0, 10, 0)], 5, 5)).toEqual({ status: "open", gaps: [] });
    // En ruta som är större än fönstret når dess kant.
    expect(ask([line("kant", -50, -50, 50, -50, 50, 50, -50, 50, -50, -50)], 0, 0)).toEqual({ status: "open", gaps: [] });
  });

  it("höjdkurvor, nordlinjer och släckta symboler är inga gränser", () => {
    const crossing = [...block, line("kurva", -5, 2, 15, 2), line("nord", 2, -5, 2, 15), line("dold", -5, 8, 15, 8)];
    expect(ask(crossing, 1, 1)).toMatchObject({ status: "found", areaM2: 1600 - 64 });
    // Ett staket delar rutan, men inte när dess lager är släckt.
    const fenced = [...block, line("staket", 3, 0, 3, 10)];
    expect(ask(fenced, 1, 1)).toMatchObject({ status: "found", areaM2: 3 * 10 * 16 });
    expect(ask(fenced, 1, 1, ["staket"])).toMatchObject({ status: "found", areaM2: 1600 - 64 });
  });

  it("minns fönstret mellan frågorna och räknar om när kartan ändrats", () => {
    const find = fillFinder(), first = input(block);
    expect(find(first, { point: { x: 1, y: 1 }, hidden: [], diagnose: false })).toMatchObject({ status: "found", areaM2: 1600 - 64 });
    expect(find(first, { point: { x: 5, y: 5 }, hidden: [], diagnose: false })).toMatchObject({ status: "found", areaM2: 64 });
    expect(find(input([...block, line("staket", 3, 0, 3, 10)]), { point: { x: 1, y: 1 }, hidden: [], diagnose: false })).toMatchObject({ status: "found", areaM2: 480 });
  });

  it("ett typiskt fönster i en tät sprintkarta (några tusen sträckor) går fort", () => {
    // Kvarter 5 × 5 mm (20 m) över 100 × 100 mm, vart och ett med ett hus och ett staket: 400 kvarter, omkring 6 000 sträckor
    // i kartan och knappt 4 000 i fönstret.
    const objects: MapObject[] = [];
    for (let at = 0; at <= 20; at += 1) {
      objects.push(line("kant", ...Array.from({ length: 41 }, (_, step) => [step * 2.5, at * 5]).flat()));
      objects.push(line("kant", ...Array.from({ length: 41 }, (_, step) => [at * 5, step * 2.5]).flat()));
    }
    for (let col = 0; col < 20; col += 1) for (let row = 0; row < 20; row += 1) {
      objects.push(house(col * 5 + 1, row * 5 + 1, 2), line("staket", col * 5 + 4, row * 5, col * 5 + 4, row * 5 + 4.7));
    }
    const find = fillFinder(), map = input(objects);
    const started = performance.now();
    const result = find(map, { point: { x: 50.5, y: 50.5 }, hidden: [], diagnose: true });
    const first = performance.now() - started;
    // Rutan väster om staketet (4 × 5 mm) minus huset: 16 × 20 − 8 × 8 m.
    expect(result).toMatchObject({ status: "found", closed: 1 });
    expect(result.status === "found" && result.areaM2).toBeCloseTo(320 - 64, 6);
    expect(first).toBeLessThan(500);
    // Pekaren som rör sig i samma fönster slår bara upp ytan.
    const again = performance.now();
    for (let step = 0; step < 100; step += 1) find(map, { point: { x: 45 + step / 10, y: 52.5 }, hidden: [], diagnose: false });
    expect((performance.now() - again) / 100).toBeLessThan(5);
    console.info(`Fyll yta: första frågan ${first.toFixed(0)} ms, sedan ${((performance.now() - again) / 100).toFixed(2)} ms per fråga`);
  });
});
