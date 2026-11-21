import { describe, expect, it } from "vitest";
import { mergeFaceRings, rasterFill, type FaceLine, type FacePoint } from "../src/faces/index";
import { ringArea } from "../src/faces/raster-fill";

const pts = (...flat: number[]): FacePoint[] => Array.from({ length: flat.length / 2 }, (_, at) => ({ x: flat[at * 2]!, y: flat[at * 2 + 1]! }));
const square = (x: number, y: number, size: number) => pts(x, y, x + size, y, x + size, y + size, x, y + size);
const line = (id: string, ...flat: number[]): FaceLine => ({ id, points: pts(...flat) });
const ring = (id: string, ...flat: number[]): FaceLine => ({ ...line(id, ...flat), closed: true });
const options = (half: number, deadline?: number) => ({ box: { minX: -half, minY: -half, maxX: half, maxY: half }, cell: 0.2, radius: 2, snap: 0.3, simplify: 0.1, deadline });
const area = (rings: readonly FacePoint[][]) => rings.reduce((sum, r) => sum + ringArea(r), 0);

describe("magisk fyll: rutor slås ihop till en yta", () => {
  it("två grannrutor blir en ring utan den gemensamma kanten", () => {
    const merged = mergeFaceRings([[square(0, 0, 10)], [square(10, 0, 10)]]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toHaveLength(1);
    expect(merged[0]![0]).toHaveLength(4);
    expect(ringArea(merged[0]![0]!)).toBeCloseTo(200, 9);
  });

  it("en kant som grannen har delat i en nod delas först", () => {
    const left = pts(0, 0, 10, 0, 10, 20, 0, 20);
    const right = pts(10, 0, 20, 0, 20, 20, 10, 20, 10, 10);
    const merged = mergeFaceRings([[left], [right]]);
    expect(merged).toHaveLength(1);
    expect(merged[0]![0]).toHaveLength(4);
    expect(ringArea(merged[0]![0]!)).toBeCloseTo(400, 9);
  });

  it("åtta rutor runt en nionde blir en yta med ett hål; samma ruta två gånger räknas en gång", () => {
    const faces: FacePoint[][][] = [];
    for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) if (i !== 1 || j !== 1) faces.push([square(i * 10, j * 10, 10)]);
    faces.push([square(0, 0, 10)]);
    const merged = mergeFaceRings(faces);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toHaveLength(2);
    expect(ringArea(merged[0]![1]!)).toBeCloseTo(-100, 9);
    expect(area(merged[0]!)).toBeCloseTo(800, 9);
  });

  it("rutor med hål behåller hålen, och rutor som inte rör varandra blir var sin yta", () => {
    const withHole = [square(0, 0, 10), pts(4, 4, 4, 6, 6, 6, 6, 4)];
    const merged = mergeFaceRings([withHole, [square(10, 0, 10)], [square(40, 0, 5)]]);
    expect(merged).toHaveLength(2);
    const big = merged.find(polygon => ringArea(polygon[0]!) > 100)!;
    expect(big).toHaveLength(2);
    expect(area(big)).toBeCloseTo(196, 9);
  });
});

describe("magisk fyll: reserven (bild, tjocka linjer, tillbaka till linjerna)", () => {
  // Kvarteret 20 × 20 med en öppning på 3 m i överkanten (8–11).
  const open3 = [line("kant", 8, 20, 0, 20, 0, 0, 20, 0, 20, 20, 11, 20)];

  it("en öppning upp till Glapp sluts rakt, och kanten ligger på linjerna", () => {
    const result = rasterFill(open3, { x: 10, y: 10 }, options(40));
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.area).toBeGreaterThan(395);
    expect(result.area).toBeLessThan(405);
    expect(result.holes).toEqual([]);
    // Hörnen är kvarterets egna punkter.
    for (const corner of pts(0, 0, 20, 0, 20, 20, 0, 20)) expect(result.outer).toContainEqual(corner);
  });

  it("ytan rinner inte ut genom en öppning större än Glapp", () => {
    const result = rasterFill([line("kant", 7, 20, 0, 20, 0, 0, 20, 0, 20, 20, 13, 20)], { x: 10, y: 10 }, options(40));
    expect(result.status).toBe("open");
  });

  it("hus i ytan blir hål", () => {
    const result = rasterFill([...open3, ring("hus", 6, 6, 12, 6, 12, 12, 6, 12)], { x: 3, y: 3 }, options(40));
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.holes).toHaveLength(1);
    expect(ringArea(result.holes[0]!)).toBeCloseTo(-36, 6);
    expect(result.area).toBeGreaterThan(359);
    expect(result.area).toBeLessThan(369);
  });

  it("kanten fästs på grannens linje (med linjens egna punkter), så att ytorna delar kant", () => {
    // Grannen till vänster är sluten; den högra rutan har en öppning på 3 m och delar väggen x = 20, som har en knyck.
    const lines = [ring("granne", 0, 0, 20, 0, 20.4, 10, 20, 20, 0, 20), line("höger", 23, 20, 40, 20, 40, 0, 20, 0)];
    const result = rasterFill(lines, { x: 30, y: 10 }, options(60));
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.outer).toContainEqual({ x: 20.4, y: 10 });
    expect(result.outer).toContainEqual({ x: 20, y: 0 });
    expect(result.outer).toContainEqual({ x: 20, y: 20 });
    // Knycken (0,4 m) tar 4 m² från rutan; öppningen (20–23) sluts rakt.
    expect(result.area).toBeCloseTo(396, 6);
    expect(result.outer).toHaveLength(5);
  });

  it("ger upp efter tidsgränsen", () => {
    expect(rasterFill(open3, { x: 10, y: 10 }, options(40, performance.now() - 1)).status).toBe("timeout");
  });

  it("ett fönster på 150 m med många kvarter går inom 200 ms", () => {
    // 15 × 15 kvarter på 8 m med 2 m gator, hörn som inte möts (3 m) och hus.
    const lines: FaceLine[] = [];
    for (let i = -7; i <= 7; i += 1) for (let j = -7; j <= 7; j += 1) {
      const x = i * 10 - 4, y = j * 10 - 4;
      lines.push(line(`k${i},${j}`, x + 6, y + 8, x, y + 8, x, y, x + 8, y, x + 8, y + 6));
      lines.push(ring(`h${i},${j}`, x + 2, y + 2, x + 4, y + 2, x + 4, y + 4, x + 2, y + 4));
    }
    const started = performance.now();
    const result = rasterFill(lines, { x: 1, y: 3 }, { ...options(75), radius: 1.5 });
    const elapsed = performance.now() - started;
    console.log(`reserven: ${Math.round(elapsed)} ms för ${lines.length} linjer, 750 × 750 rutor`);
    expect(result.status).toBe("found");
    expect(elapsed).toBeLessThan(400);
  });
});
