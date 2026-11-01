/** Ringklipp (ADR-0180 beslut 10): överlapp, detaljer över kartan, bakning och .ppen fram och tillbaka. */
import type { MapObject, MapSymbol, ParsedMap, Point } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import {
  applyEdit, bakeDetailGaps, DETAIL_GAP_LIMITS, detailCircleCenters, detailCircleGaps, layoutOverprint, OVERLAP_CUT_LIMITS, readPpen,
  writePpen, type CircleArc, type CourseSettingDocument, type OverprintPrimitive
} from "../src";
import { totalDegrees } from "../src/arcs";
import { Builder, lineCourse } from "./build";

type Circle = Extract<OverprintPrimitive, { kind: "circle" }>;
const circles = (p: readonly OverprintPrimitive[]) => p.filter((x): x is Circle => x.kind === "circle");
const width = (arc: CircleArc) => arc.endDegrees - arc.startDegrees;
const middle = (arc: CircleArc) => (((arc.startDegrees + arc.endDegrees) / 2) % 360 + 360) % 360;
const gapDegrees = (circle: Circle) => totalDegrees(circle.gaps ?? []);
const toRad = (degrees: number) => degrees * Math.PI / 180;

// --- En liten syntetisk karta -------------------------------------------------------------------------------------
const code = (text: string) => ({ text, main: Number(text.split(".")[0]), sub: Number(text.split(".")[1] ?? 0) });
const SYMBOLS: MapSymbol[] = [
  { id: "path", kind: "LINE", code: code("506.0"), name: "Liten stig", hidden: false, strokes: [{ color: 0, width: 0.25 }] },
  { id: "bush", kind: "POINT", code: code("418.0"), name: "Buske", hidden: false, elements: [{ kind: "dot", color: 1, center: { x: 0, y: 0 }, diameter: 0.4 }] },
  { id: "stone", kind: "POINT", code: code("204.0"), name: "Sten", hidden: false, elements: [{ kind: "dot", color: 0, center: { x: 0, y: 0 }, diameter: 0.4 }] },
  { id: "contour", kind: "LINE", code: code("101.0"), name: "Höjdkurva", hidden: false, strokes: [{ color: 2, width: 0.14 }] },
  { id: "mask", kind: "LINE", code: code("508.10"), name: "Vit mask", hidden: false, strokes: [{ color: 3, width: 0.5 }] }
];
const color = (id: number, r: number, g: number, b: number) =>
  ({ id, name: String(id), rank: id, cmyk: { c: 0, m: 0, y: 0, k: 1 }, rgb: { r, g, b }, opacity: 1 });

function syntheticMap(objects: MapObject[]): ParsedMap {
  return {
    format: "OCD", version: "test", scale: 15000, georeference: null, warnings: [], bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 },
    colors: [color(0, 0, 0, 0), color(1, 0, 0.8, 0), color(2, 0.7, 0.3, 0), color(3, 1, 1, 1)],
    symbols: new Map(SYMBOLS.map(symbol => [symbol.id, symbol])), objects
  };
}
const line = (symbol: string, ...points: Point[]): MapObject =>
  ({ kind: "line", symbol, path: points.map((p, i) => ({ type: i === 0 ? "M" : "L", x: p.x, y: p.y })) as never });
const point = (symbol: string, at: Point): MapObject => ({ kind: "point", symbol, at, angle: 0 });
const ring = (id = "c", at: Point = { x: 0, y: 0 }, blockedDegrees?: number[]) =>
  ({ id, at, radiusMm: 2.5, lineWidthMm: 0.35, ...(blockedDegrees ? { blockedDegrees } : {}) });

/** Gapets bredd för ett objekt som korsar vinkelrätt: halva bredden + marginalen på båda sidor, som vinkel på ringen. */
const perpendicularDegrees = (half: number) => 2 * (half + DETAIL_GAP_LIMITS.marginMm) / 2.5 * 180 / Math.PI;

describe("detailCircleGaps", () => {
  it("klipper där en stig korsar ringen, med stigens bredd och marginalen", () => {
    const gaps = detailCircleGaps(syntheticMap([line("path", { x: 0, y: -10 }, { x: 0, y: 10 })]), [ring()]).c!;
    expect(gaps).toHaveLength(2);
    expect(gaps.map(middle).sort((a, b) => a - b).map(Math.round)).toEqual([90, 270]);
    for (const gap of gaps) expect(width(gap)).toBeCloseTo(perpendicularDegrees(0.125), -0.5);
  });

  it("klipper där en sten ligger på ringen, men inte innanför eller utanför", () => {
    const map = syntheticMap([point("stone", { x: 2.5, y: 0 }), point("stone", { x: 0, y: 0 }), point("stone", { x: -5, y: 0 })]);
    const gaps = detailCircleGaps(map, [ring()]).c!;
    expect(gaps).toHaveLength(1);
    expect(middle(gaps[0]!) > 355 || middle(gaps[0]!) < 5).toBe(true);
    // Stenen (0,2 mm) täcks också av ringens halva linjebredd (0,175 mm) där den ligger snett mot ringen.
    expect(width(gaps[0]!)).toBeGreaterThanOrEqual(perpendicularDegrees(0.2) - 1);
    expect(width(gaps[0]!)).toBeLessThan(perpendicularDegrees(0.2) + 10);
  });

  it("klipper inte höjdkurvor, vita masker eller en stig som går längs ringen", () => {
    const along = Array.from({ length: 13 }, (_, i) => ({ x: 2.5 * Math.cos(toRad(i * 5)), y: 2.5 * Math.sin(toRad(i * 5)) }));
    const map = syntheticMap([line("contour", { x: -10, y: 0 }, { x: 10, y: 0 }), line("mask", { x: 0, y: -10 }, { x: 0, y: 10 }), line("path", ...along)]);
    expect(detailCircleGaps(map, [ring()])).toEqual({});
  });

  it("slår ihop gap med en kort bit ring emellan", () => {
    // Två stenar 0,8 mm isär på ringen: biten emellan är kortare än tre linjebredder.
    const a = toRad(-9), b = toRad(9);
    const map = syntheticMap([point("stone", { x: 2.5 * Math.cos(a), y: 2.5 * Math.sin(a) }), point("stone", { x: 2.5 * Math.cos(b), y: 2.5 * Math.sin(b) })]);
    const gaps = detailCircleGaps(map, [ring()]).c!;
    expect(gaps).toHaveLength(1);
  });

  it("klipper högst en fjärdedel, viktigast och mest vinkelrätt först", () => {
    // Tolv buskar (LOW) runt ringen och tre stigar (HIGH) genom mitten: stigarna går före.
    const objects: MapObject[] = [];
    for (let i = 0; i < 12; i++) objects.push(point("bush", { x: 2.5 * Math.cos(toRad(i * 30 + 15)), y: 2.5 * Math.sin(toRad(i * 30 + 15)) }));
    for (const angle of [0, 60, 120]) {
      const d = { x: 10 * Math.cos(toRad(angle)), y: 10 * Math.sin(toRad(angle)) };
      objects.push(line("path", { x: -d.x, y: -d.y }, d));
    }
    const gaps = detailCircleGaps(syntheticMap(objects), [ring()]).c!;
    expect(totalDegrees(gaps)).toBeLessThanOrEqual(360 * DETAIL_GAP_LIMITS.maxFraction + 1e-6);
    for (const angle of [0, 60, 120, 180, 240, 300]) {
      expect(gaps.some(gap => Math.abs(((middle(gap) - angle + 540) % 360) - 180) < 3), `stigen vid ${angle}°`).toBe(true);
    }
  });

  it("klipper inte där sträckan går ut ur ringen", () => {
    const map = syntheticMap([line("path", { x: -10, y: 0 }, { x: 10, y: 0 })]);
    const gaps = detailCircleGaps(map, [ring("c", { x: 0, y: 0 }, [0])]).c!;
    expect(gaps.map(middle).map(Math.round)).toEqual([180]);
  });

  it("går snabbt för 200 ringar på en karta med 10 000 objekt", () => {
    const objects: MapObject[] = [];
    for (let i = 0; i < 5000; i++) objects.push(point("stone", { x: (i * 37) % 200 - 100, y: (i * 91) % 200 - 100 }));
    for (let i = 0; i < 5000; i++) objects.push(line("path", { x: (i * 13) % 200 - 100, y: (i * 7) % 200 - 100 }, { x: (i * 13) % 200 - 95, y: (i * 7) % 200 - 98 }));
    const map = syntheticMap(objects);
    const rings = Array.from({ length: 200 }, (_, i) => ring(String(i), { x: (i * 53) % 190 - 95, y: (i * 29) % 190 - 95 }));
    const start = performance.now();
    detailCircleGaps(map, rings);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});

// --- Banpåtrycket ------------------------------------------------------------------------------------------------
function withCutting(document: CourseSettingDocument, overlap: boolean, details: boolean): CourseSettingDocument {
  return applyEdit(document, { type: "SET_EVENT", changes: { circleCutting: { overlap, details } } }).document;
}

/** Två kontroller (och mål) på avståndet `d` mm i 1:15 000, där ringarna är 5 mm (radie 2,5). */
function pair(d: number) {
  const b = new Builder({ mapScale: 15000 });
  const start = b.control("START", -30, 0);
  const one = b.control("NORMAL", 0, 0);
  const two = b.control("NORMAL", d, 0);
  const finish = b.control("FINISH", 40, 30);
  const course = b.course("A");
  for (const id of [start, one, two, finish]) b.insert(course, id);
  return { b, course, one, two, finish };
}
const ringOf = (p: readonly OverprintPrimitive[], document: CourseSettingDocument, control: string) =>
  circles(p).find(c => c.center === document.controls[control]!.at)!;

describe("överlappsklipp", () => {
  it("utan inställning som i dag (Purple Pens avbrott), också med detaljgap", () => {
    for (const d of [1, 2.2, 4, 4.8]) {
      const { b, course, one } = pair(d);
      const before = layoutOverprint(b.document, { course });
      expect(layoutOverprint(withCutting(b.document, false, false), { course, detailGaps: { [one]: [{ startDegrees: 100, endDegrees: 120 }] } })).toEqual(before);
    }
  });

  it("lite överlapp: bågen inne i den andra ringen tas bort på båda", () => {
    const { b, course, one, two } = pair(4.9);
    const doc = withCutting(b.document, true, false);
    const p = layoutOverprint(doc, { course });
    const a = ringOf(p, doc, one), c = ringOf(p, doc, two);
    // cos(halv) = d / 2r = 0,98 → halva bågen 11,5°.
    const half = Math.acos(4.9 / 5) * 180 / Math.PI;
    expect(a.gaps).toHaveLength(1);
    expect(width(a.gaps![0]!)).toBeCloseTo(2 * half, 6);
    expect(middle(a.gaps![0]!)).toBeCloseTo(0, 6);
    expect(middle(c.gaps![0]!)).toBeCloseTo(180, 6);
    // Purple Pen klipper inte alls här (över 0,9 av radiesumman).
    expect(ringOf(layoutOverprint(b.document, { course }), b.document, one).gaps).toBeUndefined();
  });

  it("mycket överlapp: båda klipps, ingen mer än hälften", () => {
    const { b, course, one, two } = pair(2.2);
    const doc = withCutting(b.document, true, false);
    const p = layoutOverprint(doc, { course });
    for (const id of [one, two]) {
      const degrees = gapDegrees(ringOf(p, doc, id));
      expect(degrees).toBeGreaterThan(100);
      expect(degrees).toBeLessThanOrEqual(180);
    }
  });

  it("kraftig överlappning: hela ringen behålls för den ena; samma punkt: båda hela", () => {
    const { b, course, one, two } = pair(1.2);
    expect(1.2).toBeLessThan(OVERLAP_CUT_LIMITS.strongFraction * 5);
    const doc = withCutting(b.document, true, false);
    const p = layoutOverprint(doc, { course });
    expect(ringOf(p, doc, one).gaps).toBeUndefined();
    expect(gapDegrees(ringOf(p, doc, two))).toBeGreaterThan(90);
    expect(gapDegrees(ringOf(p, doc, two))).toBeLessThanOrEqual(180);
    const same = pair(0);
    const sameDoc = withCutting(same.b.document, true, false);
    expect(circles(layoutOverprint(sameDoc, { course: same.course, printScale: 15000 })).filter(c => c.role === "CONTROL").every(c => !c.gaps)).toBe(true);
  });

  it("målets dubbelring: båda målringarna och kontrollens ring klipps", () => {
    const { b, course, finish } = pair(4.5);
    const near = b.control("NORMAL", 40, 25);
    b.insert(course, near, b.cc(course, Object.values(b.document.controls).find(c => c.code && c.at.x === 4.5)!.id));
    const doc = withCutting(b.document, true, false);
    const p = layoutOverprint(doc, { course });
    const finishCircles = circles(p).filter(c => c.role === "FINISH");
    expect(finishCircles).toHaveLength(2);
    // Den yttre ringen klipps där kontrollens ring går in; den inre ligger utanför kontrollens ring och klipps inte.
    const [outer, inner] = [...finishCircles].sort((x, y) => y.diameter - x.diameter);
    expect(outer!.gaps).toHaveLength(1);
    expect(middle(outer!.gaps![0]!)).toBeCloseTo(270, 0);
    expect(inner!.gaps).toBeUndefined();
    expect(ringOf(p, doc, near).gaps).toHaveLength(1);
    expect(middle(ringOf(p, doc, near).gaps![0]!)).toBeCloseTo(90, 0);
    // Närmare: också den inre ringen klipps, med ett mindre avbrott.
    const closer = withCutting(applyEdit(b.document, { type: "MOVE_CONTROL", control: near, at: { x: 40, y: 26 } }).document, true, false);
    const both = circles(layoutOverprint(closer, { course })).filter(c => c.role === "FINISH").sort((x, y) => y.diameter - x.diameter);
    expect(both.every(c => c.gaps?.length === 1)).toBe(true);
    expect(width(both[1]!.gaps![0]!)).not.toBeCloseTo(width(both[0]!.gaps![0]!), 1);
    void finish;
  });

  it("passage: ringen klipps där den korsar passagen, passagen klipps inte", () => {
    const { b, course, one } = pair(10);
    const crossing = b.control("CROSSING_POINT", 2.5, 0);
    b.insert(course, crossing, b.cc(course, one));
    const doc = withCutting(b.document, true, false);
    const p = layoutOverprint(doc, { course });
    const gaps = ringOf(p, doc, one).gaps!;
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.some(gap => middle(gap) < 30 || middle(gap) > 330)).toBe(true);
    expect(totalDegrees(gaps)).toBeLessThanOrEqual(180);
  });
});

describe("detaljgap i banpåtrycket", () => {
  const detail = { startDegrees: 80, endDegrees: 100 };
  it("används bara när inställningen är på, och inte där sträckan går ut", () => {
    const { b, course, controls } = lineCourse(2, { mapScale: 15000 });
    const id = controls[0]!;
    const gaps = { [id]: [detail, { startDegrees: -10, endDegrees: 10 }] };
    const off = layoutOverprint(b.document, { course, detailGaps: gaps });
    expect(ringOf(off, b.document, id).gaps).toBeUndefined();
    const on = withCutting(b.document, false, true);
    const p = ringOf(layoutOverprint(on, { course, detailGaps: gaps }), on, id).gaps!;
    // Sträckan till nästa kontroll går ut vid 0°: det gapet tas bort.
    expect(p).toEqual([detail]);
    // I "alla kontroller" finns inga sträckor.
    expect(ringOf(layoutOverprint(on, { course: "ALL_CONTROLS", detailGaps: gaps }), on, id).gaps).toHaveLength(2);
  });
});

describe("bakning och .ppen", () => {
  it("gör detaljgapen fasta, följer med till .ppen och kan göras igen utan ändring", () => {
    const { b, course, controls } = lineCourse(2, { mapScale: 15000 });
    const id = controls[1]!;
    const edits = bakeDetailGaps(b.document, { [id]: [{ startDegrees: 80, endDegrees: 100 }] });
    expect(edits).toEqual([{ type: "SET_CIRCLE_GAPS", control: id, gaps: [{ scale: 15000, startDegrees: 80, endDegrees: 100 }] }]);
    let doc = b.document;
    for (const edit of edits) doc = applyEdit(doc, edit).document;
    // Utan inställningar: gapen finns ändå (som Purple Pens egna avbrott).
    expect(ringOf(layoutOverprint(doc, { course }), doc, id).gaps).toEqual([{ startDegrees: 80, endDegrees: 100 }]);
    const again = readPpen(writePpen(doc)).document;
    expect(again.controls[id]!.circleGaps).toEqual(doc.controls[id]!.circleGaps);
    expect(writePpen(doc)).toContain("<circle-gaps scale=\"15000\">80:100</circle-gaps>");
    expect(bakeDetailGaps(doc, { [id]: [{ startDegrees: 80.001, endDegrees: 99.999 }] })).toEqual([]);
  });

  it("ringarna att räkna: kontroller och mål, med sträckornas vinklar", () => {
    const { b, controls, finish } = lineCourse(2, { mapScale: 15000 });
    const centers = detailCircleCenters(b.document);
    expect(centers.map(c => c.id).sort()).toEqual([...controls, finish].sort());
    const first = centers.find(c => c.id === controls[0])!;
    expect(first.radiusMm).toBeCloseTo(2.5, 6);
    expect(first.lineWidthMm).toBeCloseTo(0.35, 6);
    expect([...(first.blockedDegrees ?? [])].map(Math.round).sort((x, y) => x - y)).toEqual([0, 180]);
  });

  it("inställningen sparas i dokumentet men skrivs inte till .ppen", () => {
    const { b } = lineCourse(2, { mapScale: 15000 });
    const xml = writePpen(b.document);
    const doc = withCutting(b.document, true, true);
    expect(doc.event.circleCutting).toEqual({ overlap: true, details: true });
    expect(writePpen(doc)).toBe(xml);
    expect(readPpen(writePpen(doc)).document.event.circleCutting).toBeUndefined();
    expect(() => applyEdit(doc, { type: "SET_EVENT", changes: { circleCutting: { overlap: "ja" } as never } })).toThrow(/Ringklippen/);
  });
});
