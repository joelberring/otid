import { describe, expect, it } from "vitest";
import type { MapObject, MapSymbol, Path } from "@o-tid/map-file";
import { objectBox } from "@o-tid/map-revision";
import { mergeFaceRings } from "@o-tid/map-revision/faces";
import { fillFinder, fillObject, type FillInput, type FillQuery } from "./map-project-fill-area";

/** Kartan i 1:4 000: 1 mm = 4 m, toleransen 2 m = 0,5 mm och fönstret 150 m = 37,5 mm åt varje håll. */
const SCALE = 4000;
const symbol = (id: string, main: number, hidden = false) => [id, { id, code: { main, text: String(main) }, name: id, hidden, kind: "LINE" } as unknown as MapSymbol] as const;
const symbols = new Map([symbol("kant", 501), symbol("hus", 521), symbol("staket", 518), symbol("kurva", 101), symbol("nord", 601), symbol("dold", 518, true)]);
const path = (...flat: number[]): Path => Array.from({ length: flat.length / 2 }, (_, at) => ({ type: at === 0 ? "M" as const : "L" as const, x: flat[at * 2]!, y: flat[at * 2 + 1]! }));
const line = (id: string, ...flat: number[]): MapObject => ({ kind: "line", symbol: id, path: path(...flat) });
const house = (x: number, y: number, size: number): MapObject => ({ kind: "area", symbol: "hus", angle: 0, rings: [path(x, y, x + size, y, x + size, y + size, x, y + size)] });
const input = (objects: MapObject[]): FillInput => ({ objects, boxes: objects.map(objectBox), symbols, scale: SCALE });
const ask = (objects: MapObject[], x: number, y: number, hidden: string[] = [], diagnose = true, more: Pick<FillQuery, "gapM" | "exact"> = {}) =>
  fillFinder()(input(objects), { point: { x, y }, hidden, diagnose, ...more });

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

  it("ägaren 2026-11-22: ett klick fyller också stora ytor, t.ex. havet runt en ö inom kartans ram", () => {
    // En ram 2 × 2 km (500 × 500 mm i 1:4 000) med en ö 40 × 40 m mitt i, och höjdkurvor som inte är gränser.
    const frame = [line("kant", -250, -250, 250, -250), line("kant", 250, -250, 250, 250), line("kant", 250, 250, -250, 250), line("kant", -250, 250, -250, -250)];
    const island = [line("kant", 0, 0, 10, 0), line("kant", 10, 0, 10, 10), line("kant", 10, 10, 0, 10), line("kant", 0, 10, 0, 0)];
    const objects = [...frame, ...island, line("kurva", -200, -200, 200, 200)];
    const sea = ask(objects, -100, 100);
    expect(sea.status).toBe("found");
    if (sea.status !== "found") return;
    expect(sea.rings).toHaveLength(2);
    expect(sea.areaM2).toBeCloseTo(2000 * 2000 - 1600, 0);
    // Pekaren som bara hovrar räknar inte de stora fönstren.
    expect(ask(objects, -100, 100, [], false).status).toBe("open");
  });

  it("sluter glapp upp till 2 m i terrängen och säger hur många", () => {
    // Staketet slutar 0,4 mm (1,6 m) före kanten.
    const result = ask([...block, line("staket", 7, 0, 7, 9.6)], 8, 5);
    expect(result).toMatchObject({ status: "found", closed: 1 });
    expect(result.status === "found" && result.areaM2).toBeCloseTo(3 * 10 * 16, 6);
  });

  it("en öppning större än toleransen: inte sluten i exakt läge, och öppningen pekas ut", () => {
    // Kvarteret har en öppning på 1 mm (4 m) i överkanten.
    const open = [line("kant", 0, 0, 10, 0), line("kant", 10, 0, 10, 10), line("kant", 10, 10, 5, 10), line("kant", 4, 10, 0, 10), line("kant", 0, 10, 0, 0)];
    // Med Glapp 4 m (förvalet) överbryggas den.
    expect(ask(open, 5, 5)).toMatchObject({ status: "found", areaM2: 1600, closed: 0, bridges: [{ kind: "bridge", lengthsM: [4] }] });
    const result = ask(open, 5, 5, [], true, { exact: true });
    expect(result.status).toBe("open");
    if (result.status !== "open") return;
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]!.map(point => [point.x, point.y]).sort()).toEqual([[4, 10], [5, 10]]);
    // Pekaren som bara hovrar letar inte efter öppningen.
    expect(ask(open, 5, 5, [], false, { exact: true })).toEqual({ status: "open", gaps: [] });
    // Glapp 2 m är detsamma som exakt.
    expect(ask(open, 5, 5, [], false, { gapM: 2 })).toEqual({ status: "open", gaps: [] });
  });

  it("magisk fyll: hörn som inte möts sluts upp till Glapp och bitarna följer med till förhandsvisningen", () => {
    // Överkanten slutar 0,75 mm (3 m) och högerkanten 0,5 mm (2 m) före hörnet.
    const corner = [line("kant", 9.25, 10, 0, 10, 0, 0, 10, 0, 10, 9.5), house(4, 4, 2)];
    const result = ask(corner, 1, 1, [], false);
    expect(result).toMatchObject({ status: "found", areaM2: 1600 - 64, closed: 0 });
    if (result.status !== "found") return;
    expect(result.bridges).toHaveLength(1);
    expect(result.bridges[0]!.kind).toBe("corner");
    expect(result.bridges[0]!.lengthsM.map(length => Math.round(length * 10) / 10)).toEqual([3, 2]);
    expect(result.bridges[0]!.pieces.map(([, to]) => [to.x, to.y])).toEqual([[10, 10], [10, 10]]);
    // Alt+klick: bara exakt, och öppningen pekas ut.
    const exact = ask(corner, 1, 1, [], true, { exact: true });
    expect(exact.status).toBe("open");
    expect(exact.status === "open" && exact.gaps.length).toBeGreaterThan(0);
    // Glapp 2,5 m räcker inte för den 3 m långa biten.
    expect(ask(corner, 1, 1, [], false, { gapM: 2.5 })).toEqual({ status: "open", gaps: [] });
  });

  it("en ruta som redan är sluten vid 2 m ändras inte av steg 2", () => {
    // En mellanvägg som slutar 0,8 mm (3,2 m) före överkanten hänger fritt i kvarteret: hela kvarteret fylls som i dag.
    const stub = [...block, line("staket", 8, 0, 8, 9.2)];
    expect(ask(stub, 1, 1)).toMatchObject({ status: "found", areaM2: 1600 - 64, bridges: [] });
    expect(ask(stub, 9, 5)).toMatchObject({ status: "found", areaM2: 1600 - 64, bridges: [] });
  });

  it("20 %-regeln: en liten ruta som bara sluts med långa bryggor fylls inte", () => {
    // Rutan 1,5 × 1,5 mm (6 × 6 m) med öppningar på 0,875 mm (3,5 m) i över- och underkanten: 7 m av 24 m.
    const leaky = [line("kant", 0.25, 1.5, 0, 1.5, 0, 0, 0.25, 0), line("kant", 1.125, 0, 1.5, 0, 1.5, 1.5, 1.125, 1.5)];
    expect(ask(leaky, 0.75, 0.75, [], false)).toEqual({ status: "open", gaps: [] });
    // Med bara den övre öppningen (15 %) fylls den.
    const one = [line("kant", 0.25, 1.5, 0, 1.5, 0, 0, 1.5, 0, 1.5, 1.5, 1.125, 1.5)];
    expect(ask(one, 0.75, 0.75, [], false)).toMatchObject({ status: "found", areaM2: 36 });
  });

  it("reserven: där steg 2 vägrar (20 %-regeln) ger klicket en ungefärlig yta, men inte förbi en öppning större än Glapp", () => {
    const leaky = [line("kant", 0.25, 1.5, 0, 1.5, 0, 0, 0.25, 0), line("kant", 1.125, 0, 1.5, 0, 1.5, 1.5, 1.125, 1.5)];
    const result = ask(leaky, 0.75, 0.75);
    expect(result).toMatchObject({ status: "found", approx: true, closed: 0, bridges: [] });
    expect(result.status === "found" && result.areaM2).toBeGreaterThan(34);
    expect(result.status === "found" && result.areaM2).toBeLessThan(38);
    // Kanten ligger på linjerna (hörnen är linjernas egna punkter).
    expect(result.status === "found" && result.rings[0]).toContainEqual({ x: 1.5, y: 1.5 });
    // Öppningar på 5 m (Glapp 4 m): ytan rinner ut, inget läggs in.
    const wide = [line("kant", 0.25, 1.5, 0, 1.5, 0, 0, 0.25, 0), line("kant", 1.5, 0, 1.75, 0, 1.75, 1.5, 1.5, 1.5)];
    expect(ask(wide, 0.875, 0.75).status).toBe("open");
    // Alt+klick (exakt) använder inte reserven.
    expect(ask(leaky, 0.75, 0.75, [], true, { exact: true }).status).toBe("open");
  });

  it("dra över flera rutor: grannrutorna ur samma fönster slås ihop till en yta med huset som hål", () => {
    // Kvarteret delat av ett staket i x = 7; huset ligger i den vänstra rutan.
    const objects = [...block, line("staket", 7, 0, 7, 10)];
    const find = fillFinder();
    const left = find(input(objects), { point: { x: 1, y: 1 }, hidden: [], diagnose: false });
    const right = find(input(objects), { point: { x: 8, y: 5 }, hidden: [], diagnose: false });
    if (left.status !== "found" || right.status !== "found") throw new Error("inte slutna");
    const merged = mergeFaceRings([left.rings, right.rings]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toHaveLength(2);
    expect(merged[0]![0]).toHaveLength(4);
  });

  it("en ruta som redan täcks av en yta säger vilken", () => {
    const result = ask(block, 5, 5);
    expect(result).toMatchObject({ status: "found", covered: { index: 4, symbol: "hus" } });
    expect(ask(block, 1, 1)).toMatchObject({ status: "found", covered: undefined });
  });

  it("utan gräns inom fönstret: inte sluten och ingen öppning att peka på", () => {
    expect(ask([line("kant", 0, 0, 10, 0)], 5, 5)).toEqual({ status: "open", gaps: [] });
    // En ruta som är större än det första fönstret (150 m) fylls med de större fönstren (ägaren 2026-11-22) …
    expect(ask([line("kant", -50, -50, 50, -50, 50, 50, -50, 50, -50, -50)], 0, 0)).toMatchObject({ status: "found", areaM2: 400 * 400 });
    // … men en som är större än det största (5 km åt varje håll) når dess kant.
    expect(ask([line("kant", -1500, -1500, 1500, -1500, 1500, 1500, -1500, 1500, -1500, -1500)], 0, 0)).toEqual({ status: "open", gaps: [] });
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

  it("magisk fyll i ett tätt kvarter med öppna hörn: steg 2 räknas en gång och förhandsvisningen är snabb", () => {
    // Kvarter 4 × 4 mm (16 m) med 1 mm (4 m) gator över 100 × 100 mm; i varje kvarter slutar två kanter 0,6 mm (2,4 m) före
    // hörnet uppe till höger, och varje kvarter har ett hus och ett staket.
    const objects: MapObject[] = [];
    for (let col = 0; col < 20; col += 1) for (let row = 0; row < 20; row += 1) {
      const x0 = col * 5, y0 = row * 5, x1 = x0 + 4, y1 = y0 + 4;
      objects.push(line("kant", ...Array.from({ length: 9 }, (_, step) => [x1 - 0.6 - step * (3.4 / 8), y1]).flat(), ...Array.from({ length: 9 }, (_, step) => [x0, y1 - step * 0.5]).flat(),
        ...Array.from({ length: 9 }, (_, step) => [x0 + step * 0.5, y0]).flat(), ...Array.from({ length: 9 }, (_, step) => [x1, y0 + step * (3.4 / 8)]).flat()));
      objects.push(house(x0 + 0.5, y0 + 0.5, 1.5), line("staket", x0 + 3, y0, x0 + 3, y0 + 2));
    }
    const find = fillFinder(), map = input(objects);
    const started = performance.now();
    const result = find(map, { point: { x: 50.2, y: 52.5 }, hidden: [], diagnose: false });
    const first = performance.now() - started;
    expect(result).toMatchObject({ status: "found", bridges: [{ kind: "corner" }] });
    // 16 × 16 m minus huset 6 × 6 m.
    expect(result.status === "found" && result.areaM2).toBeCloseTo(256 - 36, 6);
    expect(first).toBeLessThan(1000);
    // Pekaren som rör sig över andra kvarter i samma fönster slår bara upp ytan (steg 2 är redan räknat).
    const again = performance.now();
    for (let step = 0; step < 100; step += 1) {
      const answer = find(map, { point: { x: 45.2 + (step % 10), y: 47.5 + Math.floor(step / 10) / 2 }, hidden: [], diagnose: false });
      expect(answer.status).not.toBeUndefined();
    }
    const each = (performance.now() - again) / 100;
    expect(each).toBeLessThan(5);
    // Exakt läge i samma fönster: inte sluten.
    expect(find(map, { point: { x: 50.2, y: 52.5 }, hidden: [], diagnose: false, exact: true })).toEqual({ status: "open", gaps: [] });
    console.info(`Magisk fyll: första frågan (steg 1 och 2) ${first.toFixed(0)} ms, sedan ${each.toFixed(2)} ms per fråga`);
  });
});
