import { describe, expect, it } from "vitest";
import type { MapObject, MapSymbol, Path } from "@o-tid/map-file";
import { objectBox } from "@o-tid/map-revision";
import { findUnfilled, insideRings, interiorPoint, type UnfilledQuery } from "./map-project-unfilled";

/** 1:4 000: 1 mm = 4 m. */
const SCALE = 4000;
const symbol = (id: string, main: number) => [id, { id, code: { main, text: String(main) }, name: id, hidden: false, kind: "LINE" } as unknown as MapSymbol] as const;
const symbols = new Map([symbol("kant", 501), symbol("gräs", 401), symbol("kurva", 101)]);
const path = (...flat: number[]): Path => Array.from({ length: flat.length / 2 }, (_, at) => ({ type: at === 0 ? "M" as const : "L" as const, x: flat[at * 2]!, y: flat[at * 2 + 1]! }));
const line = (id: string, ...flat: number[]): MapObject => ({ kind: "line", symbol: id, path: path(...flat) });
const area = (id: string, x: number, y: number, w: number, h: number): MapObject => ({ kind: "area", symbol: id, angle: 0, rings: [path(x, y, x + w, y, x + w, y + h, x, y + h)] });
const run = (objects: MapObject[], query: Partial<UnfilledQuery> = {}) => {
  const boxes = objects.map(objectBox);
  const bounds = boxes.reduce((all, box) => ({ minX: Math.min(all.minX, box.minX), minY: Math.min(all.minY, box.minY), maxX: Math.max(all.maxX, box.maxX), maxY: Math.max(all.maxY, box.maxY) }));
  return findUnfilled({ objects, boxes, symbols, scale: SCALE, bounds }, { box: { minX: -5, minY: -5, maxX: 35, maxY: 15 }, hidden: [], ...query });
};

/** Tre kvarter 10 × 10 mm i rad (0–30 × 0–10) av kantlinjer; det första är fyllt med gräs. */
const blocks = [line("kant", 0, 0, 30, 0), line("kant", 30, 0, 30, 10), line("kant", 30, 10, 0, 10), line("kant", 0, 10, 0, 0),
  line("kant", 10, 0, 10, 10), line("kant", 20, 0, 20, 10), area("gräs", 0, 0, 10, 10)];

describe("Visa ofyllda rutor (K8b V5)", () => {
  it("räknar rutorna som ingen yta täcker, inte de täckta", () => {
    const result = run(blocks);
    expect(result.status).toBe("done");
    if (result.status !== "done") return;
    expect(result.count).toBe(2);
    expect(result.cells.map(cell => Math.floor(cell.at.x / 10))).toEqual([1, 2]);
    expect(result.cells[0]!.areaM2).toBeCloseTo(1600, 3);
    // Fyll även den andra: en kvar.
    const more = run([...blocks, area("gräs", 10, 0, 10, 10)]);
    expect(more.status === "done" && more.count).toBe(1);
  });

  it("räknar inte utanför kartans område eller det som når kartans yttre kant", () => {
    // Utan kartområde: marken runt kvarteren (utanför objektens ruta) räknas inte, men en ruta som bara skärs av utsnittets
    // kant inne i kartan räknas; en höjdkurva är ingen gräns.
    const wider = run([...blocks, line("kurva", 12, 1, 28, 9)], { box: { minX: 12, minY: 2, maxX: 28, maxY: 8 } });
    expect(wider.status === "done" && wider.count).toBe(2);
    // Med kartområde: rutan utanför området räknas inte.
    const inside = run(blocks, { area: [[{ x: -1, y: -1 }, { x: 19, y: -1 }, { x: 19, y: 11 }, { x: -1, y: 11 }]] });
    expect(inside.status === "done" && inside.count).toBe(1);
  });

  it("ber om att zooma in när utsnittet är större än 600 m", () => {
    // 600 m = 150 mm i 1:4 000.
    expect(run(blocks, { box: { minX: 0, minY: 0, maxX: 160, maxY: 10 } })).toEqual({ status: "zoomIn" });
  });

  it("punkten inuti en ruta med hål ligger utanför hålet", () => {
    const rings = [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], [{ x: 2, y: 2 }, { x: 2, y: 8 }, { x: 8, y: 8 }, { x: 8, y: 2 }]];
    const at = interiorPoint(rings)!;
    expect(insideRings(rings, at)).toBe(true);
    expect(insideRings([rings[1]!], at)).toBe(false);
  });

  it("hinner med ett helt utsnitt på 600 m (900 kvarter, hälften fyllda)", () => {
    // 30 × 30 kvarter à 5 mm (20 m) över 150 mm, med ett hus i varje.
    const objects: MapObject[] = [];
    for (let i = 0; i <= 30; i += 1) { objects.push(line("kant", 0, i * 5, 150, i * 5)); objects.push(line("kant", i * 5, 0, i * 5, 150)); }
    for (let i = 0; i < 30; i += 1) for (let j = 0; j < 30; j += 1) {
      objects.push(area("kant", i * 5 + 2, j * 5 + 2, 1, 1));
      if ((i + j) % 2 === 0) objects.push({ kind: "area", symbol: "gräs", angle: 0, rings: [path(i * 5, j * 5, i * 5 + 5, j * 5, i * 5 + 5, j * 5 + 5, i * 5, j * 5 + 5), path(i * 5 + 2, j * 5 + 2, i * 5 + 2, j * 5 + 3, i * 5 + 3, j * 5 + 3, i * 5 + 3, j * 5 + 2)] });
    }
    const started = performance.now();
    const result = run(objects, { box: { minX: 0, minY: 0, maxX: 150, maxY: 150 } });
    const ms = performance.now() - started;
    // Hälften av kvarteren och alla husen (ytor med kantsymbol räknas som täckande, så husen är fyllda).
    expect(result.status === "done" && result.count).toBe(450);
    console.info(`Ofyllda rutor: ${objects.length} objekt, ${Math.round(ms)} ms`);
    expect(ms).toBeLessThan(5000);
  });
});
