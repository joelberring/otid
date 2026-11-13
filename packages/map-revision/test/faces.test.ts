import { describe, expect, it } from "vitest";
import { faceAt, facesFromLines, type FaceLine, type FacePoint } from "../src/faces/index";

const line = (id: string, ...flat: number[]): FaceLine => ({ id, points: Array.from({ length: flat.length / 2 }, (_, at) => ({ x: flat[at * 2]!, y: flat[at * 2 + 1]! })) });
const ring = (id: string, ...flat: number[]): FaceLine => ({ ...line(id, ...flat), closed: true });
const square = (id: string, x: number, y: number, size: number) => ring(id, x, y, x + size, y, x + size, y + size, x, y + size);
const ringArea = (points: readonly FacePoint[]) => points.reduce((sum, point, index) => {
  const next = points[(index + 1) % points.length]!;
  return sum + point.x * next.y - next.x * point.y;
}, 0) / 2;
const total = (faces: readonly { area: number }[]) => faces.reduce((sum, face) => sum + face.area, 0);

describe("ytor ur linjer", () => {
  it("delar korsande linjer i skärningspunkterna: ett kors i en kvadrat ger fyra rutor", () => {
    const { faces } = facesFromLines([square("ram", 0, 0, 10), line("v", 5, -1, 5, 11), line("h", -1, 5, 11, 5)], { gapTolerance: 0 });
    expect(faces).toHaveLength(4);
    for (const face of faces) expect(face.area).toBeCloseTo(25, 9);
    expect(total(faces)).toBeCloseTo(100, 9);
    // Ytterkanten går moturs, och källorna är linjerna som bildar gränsen.
    expect(ringArea(faces[0]!.outer)).toBeGreaterThan(0);
    expect(faceAt(faces, { x: 2, y: 2 })!.sources).toEqual(["ram", "v", "h"]);
    // Gränsens längd per källa (i samma ordning som källorna): två ramsidor om 5 och en bit av varje korslinje.
    expect(faceAt(faces, { x: 2, y: 2 })!.lengths).toEqual([10, 5, 5]);
    expect(faceAt(faces, { x: 2, y: 2 })!.perimeter).toBeCloseTo(20, 9);
  });

  it("T-korsning: en linje som slutar på en annan delar ytan", () => {
    const { faces, looseEnds } = facesFromLines([square("ram", 0, 0, 10), line("t", 4, 0, 4, 10)], { gapTolerance: 0 });
    expect(looseEnds).toBe(0);
    expect(faces.map(face => face.area).sort((a, b) => a - b)).toEqual([40, 60]);
  });

  it("snäpper nästan sammanfallande punkter", () => {
    const { faces } = facesFromLines([line("a", 0, 0, 10, 0, 10, 10), line("b", 10.0004, 10.0003, 0, 10, 0.0003, -0.0004)], { gapTolerance: 0 });
    expect(faces).toHaveLength(1);
    expect(faces[0]!.area).toBeCloseTo(100, 1);
  });

  it("sluter ett glapp inom toleransen, rakt fram i ändens riktning, och märker biten som slutning", () => {
    // Mellanväggen slutar 1,5 före ramens överkant.
    const lines = [square("ram", 0, 0, 10), line("vägg", 4, 0, 4, 8.5)];
    expect(facesFromLines(lines, { gapTolerance: 1 }).faces.map(face => face.area)).toEqual([100]);
    const closed = facesFromLines(lines, { gapTolerance: 2 });
    expect(closed).toMatchObject({ looseEnds: 1, closedEnds: 1 });
    expect(closed.faces.map(face => face.area).sort((a, b) => a - b)).toEqual([40, 60]);
    // Det slutna glappet räknas till gränsens längd men inte till någon källa.
    const left = faceAt(closed.faces, { x: 2, y: 5 })!;
    expect(left.perimeter).toBeCloseTo(28, 9);
    expect(left.lengths.reduce((sum, length) => sum + length, 0)).toBeCloseTo(26.5, 9);
    for (const face of closed.faces) {
      expect(face.closures).toHaveLength(1);
      expect(face.closures[0]!.length).toBeCloseTo(1.5, 9);
      expect([face.closures[0]!.a.x, face.closures[0]!.b.x]).toEqual([4, 4]);
    }
  });

  it("drar kortaste biten när inget ligger rakt fram, också mellan två ändar", () => {
    // Två väggar mot varandra med ett snett glapp: ändarna (4;4) och (4,6;5,2) ligger 1,34 isär och pekar förbi varandra.
    const lines = [square("ram", 0, 0, 10), line("nedre", 4, 0, 4, 4), line("övre", 4.6, 10, 4.6, 5.2)];
    expect(facesFromLines(lines, { gapTolerance: 0.5 }).faces).toHaveLength(1);
    const closed = facesFromLines(lines, { gapTolerance: 2 });
    expect(closed.faces).toHaveLength(2);
    expect(total(closed.faces)).toBeCloseTo(100, 9);
  });

  it("sluter inte en kort stump mot linjen den själv sitter på", () => {
    const { faces, closedEnds } = facesFromLines([square("ram", 0, 0, 10), line("stump", 0, 5, 0.5, 5)], { gapTolerance: 2 });
    expect(closedEnds).toBe(0);
    expect(faces.map(face => face.area)).toEqual([100]);
  });

  it("en ö inuti en yta blir ett hål, och öns egna ytor finns kvar", () => {
    const { faces } = facesFromLines([square("tomt", 0, 0, 10), square("hus", 3, 3, 2), line("husvägg", 4, 3, 4, 5)], { gapTolerance: 0 });
    expect(faces).toHaveLength(3);
    const yard = faceAt(faces, { x: 1, y: 1 })!;
    expect(yard.area).toBeCloseTo(96, 9);
    expect(yard.holes).toHaveLength(1);
    expect(ringArea(yard.holes[0]!)).toBeCloseTo(-4, 9);
    expect(yard.sources).toEqual(["tomt", "hus"]);
    // Klicket i huset ger husets ruta, inte tomten.
    expect(faceAt(faces, { x: 3.5, y: 4 })!.area).toBeCloseTo(2, 9);
    expect(faceAt(faces, { x: 20, y: 20 })).toBeUndefined();
    expect(total(faces)).toBeCloseTo(100, 9);
  });

  it("ett hål i ett hål hamnar i den minsta omslutande ytan", () => {
    const { faces } = facesFromLines([square("a", 0, 0, 20), square("b", 5, 5, 10), square("c", 8, 8, 2)], { gapTolerance: 0 });
    expect(faces.map(face => face.area).sort((a, b) => a - b)).toEqual([4, 96, 300]);
    expect(faceAt(faces, { x: 6, y: 6 })!.sources).toEqual(["b", "c"]);
  });

  it("hängande kanter och broar ger ingen gräns", () => {
    // En lös linje i ytan, en linje ut ur ytan och en linje från ön till ramen (en bro).
    const { faces } = facesFromLines([square("ram", 0, 0, 10), line("lös", 1, 1, 2, 2, 1, 3), line("ut", 10, 5, 15, 5), square("ö", 6, 6, 2), line("bro", 8, 7, 10, 7)],
      { gapTolerance: 0 });
    expect(faces).toHaveLength(2);
    const outer = faceAt(faces, { x: 5, y: 2 })!;
    expect(outer.area).toBeCloseTo(96, 9);
    expect(outer.holes).toHaveLength(1);
    expect(outer.sources).toEqual(["ram", "ö"]);
  });

  it("sammanfallande linjer blir en kant med båda källorna", () => {
    // Två rutor som delar en sida, ritad en gång per ruta och dessutom som en egen linje ovanpå.
    const { faces } = facesFromLines([square("v", 0, 0, 10), square("h", 10, 0, 10), line("staket", 10, 2, 10, 8)], { gapTolerance: 0 });
    expect(faces.map(face => face.area)).toEqual([100, 100]);
    expect(faceAt(faces, { x: 5, y: 5 })!.sources).toEqual(["v", "h", "staket"]);
    // Delvis överlapp: en linje som ligger längs en bit av ramen delar inget.
    expect(facesFromLines([square("ram", 0, 0, 10), line("längs", 2, 0, 7, 0)], { gapTolerance: 0 }).faces.map(face => face.area)).toEqual([100]);
  });

  it("tomt och urartat: inga linjer, en punkt, en ensam sträcka", () => {
    expect(facesFromLines([], { gapTolerance: 2 }).faces).toEqual([]);
    expect(facesFromLines([line("p", 1, 1), line("s", 0, 0, 5, 5), line("noll", 2, 2, 2, 2)], { gapTolerance: 2 }).faces).toEqual([]);
  });

  it("tiotusen sträckor går på under ett par sekunder och ytorna summerar till figuren", () => {
    // Ett rutnät 50 × 50 där varje linje är ritad i 100 bitar (10 200 sträckor), plus glapp: varannan lodrät linje slutar 0,3 före överkanten.
    const lines: FaceLine[] = [];
    const steps = Array.from({ length: 101 }, (_, at) => at / 2);
    for (let at = 0; at <= 50; at += 1) {
      lines.push({ id: `h${at}`, points: steps.map(x => ({ x, y: at })) });
      lines.push({ id: `v${at}`, points: steps.filter(y => at % 2 === 0 || y < 50).map(y => ({ x: at, y })).concat(at % 2 ? [{ x: at, y: 49.7 }] : []) });
    }
    const started = performance.now();
    const result = facesFromLines(lines, { gapTolerance: 0.5 });
    const elapsed = performance.now() - started;
    expect(result.faces).toHaveLength(2500);
    expect(result).toMatchObject({ looseEnds: 25, closedEnds: 25 });
    expect(total(result.faces)).toBeCloseTo(2500, 6);
    expect(elapsed).toBeLessThan(2000);
  });

  it("femtiotusen korsande sträckor (slumpade) ger ytor som täcker hela ramen", () => {
    let seed = 7;
    const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const lines: FaceLine[] = [square("ram", 0, 0, 1000)];
    for (let at = 0; at < 2500; at += 1) {
      // Korta polylinjer med tjugo bitar, som gator och staket.
      let x = random() * 1000, y = random() * 1000, heading = random() * Math.PI * 2;
      const points = [{ x, y }];
      for (let step = 0; step < 20; step += 1) {
        heading += (random() - 0.5) * 0.6;
        x = Math.max(0, Math.min(1000, x + Math.cos(heading) * 4)); y = Math.max(0, Math.min(1000, y + Math.sin(heading) * 4));
        points.push({ x, y });
      }
      lines.push({ id: `l${at}`, points });
    }
    const started = performance.now();
    const { faces } = facesFromLines(lines, { gapTolerance: 2 });
    expect(performance.now() - started).toBeLessThan(5000);
    expect(faces.length).toBeGreaterThan(1000);
    expect(total(faces)).toBeCloseTo(1_000_000, 3);
  });
});
