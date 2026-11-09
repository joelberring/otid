import type { Point } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import { LEG_CIRCLE_GAP_MM, OVERPRINT_SIZES, applyEdit, layoutOverprint, readPpen, writePpen, type OverprintPrimitive } from "../src";
import { Builder, lineCourse } from "./build";

type Circle = Extract<OverprintPrimitive, { kind: "circle" }>;
type Line = Extract<OverprintPrimitive, { kind: "polyline" }>;
type Text = Extract<OverprintPrimitive, { kind: "text" }>;
const circles = (p: readonly OverprintPrimitive[]) => p.filter((x): x is Circle => x.kind === "circle");
const lines = (p: readonly OverprintPrimitive[]) => p.filter((x): x is Line => x.kind === "polyline");
const texts = (p: readonly OverprintPrimitive[]) => p.filter((x): x is Text => x.kind === "text");
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Ändra `scale-sizes` i händelsens course-appearance. */
function withScaleSizes(xml: string, value: string): string {
  return xml.replace(/scale-sizes="\w+"/, `scale-sizes="${value}"`);
}

describe("layoutOverprint", () => {
  it("har ISOM 2017 och ISSprOM 2019 storlekar", () => {
    expect(OVERPRINT_SIZES.ISOM2017.controlOutside).toBe(5.35);
    expect(OVERPRINT_SIZES.ISSPROM2019.controlOutside).toBe(6.35);
  });

  it("ritar ring, mål, start och sträckor i kartans mm vid utskriftsskalan", () => {
    const { b, course, controls } = lineCourse(2, { mapScale: 15000 });
    b.edit({ type: "UPDATE_COURSE", course, changes: { printScale: 10000 } });
    // Utan skalning av storlekarna (ISOM 2000-sätt): 5 mm på papperet = 5 · 10000/15000 mm i kartan.
    const none = readPpen(withScaleSizes(writePpen(b.document), "None")).document;
    const p = layoutOverprint(none, { course });
    const ratio = 10000 / 15000;
    const control = circles(p).find(c => c.role === "CONTROL")!;
    expect(control.diameter).toBeCloseTo(5.0 * ratio, 6);
    expect(control.lineWidth).toBeCloseTo(0.35 * ratio, 6);
    const finish = circles(p).filter(c => c.role === "FINISH").map(c => c.diameter).sort((x, y) => x - y);
    expect(finish).toHaveLength(2);
    expect(finish[0]).toBeCloseTo(4.0 * ratio, 6);
    expect(finish[1]).toBeCloseTo(6.0 * ratio, 6);
    // ISOM 2017 med RelativeTo15000 (Purple Pens förval): som 1:15 000, alltså 5 mm i kartan.
    const p2017 = layoutOverprint(b.document, { course });
    expect(circles(p2017).find(c => c.role === "CONTROL")!.diameter).toBeCloseTo(5.0, 6);
    // Sträckan börjar och slutar ett mellanrum utanför ringens ytterkant (ADR-0211 beslut 2, ISOM 2017-2 705):
    // radien till linjens mitt 2,5 + halva linjen 0,175 + mellanrummet 0,35.
    const leg = lines(p2017).find(l => l.role === "LEG" && l.ref === `${controls[0]}-${controls[1]}`)!;
    expect(dist(leg.points[0]!, b.document.controls[controls[0]!]!.at)).toBeCloseTo(2.5 + 0.175 + LEG_CIRCLE_GAP_MM, 6);
    expect(dist(leg.points[leg.points.length - 1]!, b.document.controls[controls[1]!]!.at)).toBeCloseTo(2.5 + 0.175 + LEG_CIRCLE_GAP_MM, 6);
  });

  it("mellanrummet vid ringen, starten, målet och passagen följer inställningen och utskriftsskalan (ADR-0211 beslut 2)", () => {
    const { b, course, controls, start, finish } = lineCourse(2, { mapScale: 15000 });
    const ends = (document: typeof b.document) => {
      const legs = lines(layoutOverprint(document, { course })).filter(l => l.role === "LEG");
      const first = legs.find(l => l.ref === `${start}-${controls[0]}`)!, last = legs.find(l => l.ref === `${controls[1]}-${finish}`)!;
      return { start: dist(first.points[0]!, document.controls[start]!.at), control: dist(first.points.at(-1)!, document.controls[controls[0]!]!.at),
        finish: dist(last.points.at(-1)!, document.controls[finish]!.at) };
    };
    const sizes = OVERPRINT_SIZES.ISOM2017;
    const zero = ends(applyEdit(b.document, { type: "SET_EVENT", changes: { legCircleGapMm: 0 } }).document);
    // Mellanrummet 0: linjen slutar vid ytterkanten (ringen, målets yttre ring) och starttriangelns radie.
    expect(zero.control).toBeCloseTo(sizes.controlOutside / 2, 6);
    expect(zero.finish).toBeCloseTo(sizes.finishOutside / 2, 6);
    expect(zero.start).toBeCloseTo(sizes.startRadius, 6);
    const one = ends(applyEdit(b.document, { type: "SET_EVENT", changes: { legCircleGapMm: 1 } }).document);
    expect(one.control - zero.control).toBeCloseTo(1, 6);
    expect(one.finish - zero.finish).toBeCloseTo(1, 6);
    expect(one.start - zero.start).toBeCloseTo(1, 6);
    expect(() => applyEdit(b.document, { type: "SET_EVENT", changes: { legCircleGapMm: 5 } })).toThrow(/Mellanrummet/);
    // Utan skalning (None) i 1:10 000 på en 1:15 000-karta krymper mellanrummet med kvoten som allt annat.
    const none = readPpen(withScaleSizes(writePpen(b.document), "None")).document;
    const scaled = applyEdit(applyEdit(none, { type: "UPDATE_COURSE", course, changes: { printScale: 10000 } }).document,
      { type: "SET_EVENT", changes: { legCircleGapMm: 1 } }).document;
    const ratio = 10000 / 15000;
    const legs = lines(layoutOverprint(scaled, { course })).filter(l => l.role === "LEG");
    const leg = legs.find(l => l.ref === `${controls[0]}-${controls[1]}`)!;
    expect(dist(leg.points[0]!, scaled.controls[controls[0]!]!.at)).toBeCloseTo((sizes.controlOutside / 2 + 1) * ratio, 6);
  });

  it("ISSprOM 2019 relativt kartan", () => {
    const { b, course } = lineCourse(2, { mapScale: 4000, sprint: true });
    const control = circles(layoutOverprint(b.document, { course })).find(c => c.role === "CONTROL")!;
    expect(control.diameter).toBeCloseTo(6.0, 6);
  });

  it("starttriangeln pekar mot första kontrollen", () => {
    const { b, course, start } = lineCourse(2, { mapScale: 15000 });
    const triangle = lines(layoutOverprint(b.document, { course })).find(l => l.role === "START")!;
    const at = b.document.controls[start]!.at;
    // Spetsen åt +x (mot 31 i (0,0)), sidan 6 mm.
    expect(triangle.closed).toBe(true);
    expect(triangle.points[0]!.x - at.x).toBeCloseTo(3.464, 3);
    expect(triangle.points[0]!.y - at.y).toBeCloseTo(0, 6);
    expect(dist(triangle.points[1]!, triangle.points[2]!)).toBeCloseTo(6, 2);
  });

  it("numren ligger utanför ringarna och inte på sträckan", () => {
    const { b, course, controls } = lineCourse(3);
    const p = layoutOverprint(b.document, { course });
    const numbers = texts(p);
    expect(numbers.map(t => t.text)).toEqual(["1", "2", "3"]);
    for (const number of numbers) {
      const control = b.document.controls[b.document.courseControls[number.ref!]!.control]!;
      expect(dist(number.at, control.at)).toBeGreaterThan(2.5 + 1.8);
      // Sträckorna går längs y = 0; numret ska inte ligga på dem.
      expect(Math.abs(number.at.y)).toBeGreaterThan(number.heightMm / 2);
    }
    // Flyttat nummer ritas där banläggaren lade det.
    const moved = applyEdit(b.document, { type: "MOVE_NUMBER", course, courseControl: b.cc(course, controls[1]!), at: { x: 20, y: -7 } }).document;
    expect(texts(layoutOverprint(moved, { course })).find(t => t.text === "2")!.at).toEqual({ x: 20, y: -7 });
  });

  it("korsande sträckor får avbrott i den senare", () => {
    const { b, course, controls } = lineCourse(4);
    // 31 (0,0) → 32 (20,0) → 33 (40,0) → 34 (60,0); 33 flyttas så att 33→34 korsar 31→32.
    b.edit({ type: "MOVE_CONTROL", control: controls[2]!, at: { x: 10, y: 20 } });
    b.edit({ type: "MOVE_CONTROL", control: controls[3]!, at: { x: 10, y: -20 } });
    const legs = lines(layoutOverprint(b.document, { course })).filter(l => l.role === "LEG");
    expect(legs.filter(l => l.ref === `${controls[2]}-${controls[3]}`)).toHaveLength(2);
    expect(legs.filter(l => l.ref === `${controls[0]}-${controls[1]}`)).toHaveLength(1);
  });

  it("gafflad bana: varianten ritar en gren, utan variant alla", () => {
    const { b, course, controls } = lineCourse(2);
    const at = b.cc(course, controls[0]!);
    b.edit({ type: "ADD_SPLIT", course, at, kind: "FORK", branches: 2 });
    const [branchA, branchB] = b.document.courseControls[at]!.split!.branches;
    b.insert(course, b.control("NORMAL", 10, 15), branchA);
    b.insert(course, b.control("NORMAL", 10, -15), branchB);
    const all = circles(layoutOverprint(b.document, { course })).filter(c => c.role === "CONTROL");
    const onlyA = circles(layoutOverprint(b.document, { course, variant: "A" })).filter(c => c.role === "CONTROL");
    expect(all).toHaveLength(4);
    expect(onlyA).toHaveLength(3);
    expect(onlyA.some(c => c.center.y === 15)).toBe(true);
    expect(() => layoutOverprint(b.document, { course, variant: "X" })).toThrow();
  });

  it("gafflad bana: numren står där hela banan har dem, i varje variant", () => {
    // Ägaren 2026-11-09: numren hoppade mellan banläggningen (hela banan) och utskriften (en variant). Gren A går ut åt 30°,
    // där numret för gaffelkontrollen annars hamnar; i variant B är det läget fritt men numret ska ändå stå still.
    const { b, course, controls } = lineCourse(2);
    const at = b.cc(course, controls[0]!);
    b.edit({ type: "ADD_SPLIT", course, at, kind: "FORK", branches: 2 });
    const [branchA, branchB] = b.document.courseControls[at]!.split!.branches;
    b.insert(course, b.control("NORMAL", 17.32, 10), branchA);
    b.insert(course, b.control("NORMAL", 10, -15), branchB);
    const numberAt = (variant?: string) => new Map(texts(layoutOverprint(b.document, { course, ...(variant ? { variant } : {}) }))
      .filter(t => t.role === "NUMBER").map(t => [b.document.courseControls[t.ref!]!.control, t.at]));
    const whole = numberAt(), a = numberAt("A"), other = numberAt("B");
    expect(whole.get(controls[0]!)!.y).toBeLessThan(5);
    for (const [control, place] of [...a, ...other]) expect(place, control).toEqual(whole.get(control));
    // Valet "för varje variant för sig": variant B placerar numret efter sina egna sträckor (30° är fritt där).
    b.edit({ type: "SET_EVENT", changes: { numbersPerVariant: true } });
    expect(numberAt("B").get(controls[0]!)).not.toEqual(whole.get(controls[0]!));
    expect(numberAt().get(controls[0]!)).toEqual(whole.get(controls[0]!));
  });

  it("alla kontroller med koder", () => {
    const { b } = lineCourse(2, { mapScale: 15000 });
    const p = layoutOverprint(b.document, { course: "ALL_CONTROLS" });
    expect(texts(p).map(t => t.text).sort()).toEqual(["31", "32"]);
    // Siffrorna är 3 mm höga: em 4,18 mm som Purple Pen (Roboto Condensed).
    expect(texts(p)[0]!.heightMm).toBeCloseTo(4.18, 6);
  });

  it("ringavbrott och snitsling", () => {
    const { b, course, controls, finish } = lineCourse(1, { mapScale: 15000 });
    b.edit({ type: "SET_CIRCLE_GAPS", control: controls[0]!, gaps: [{ scale: 15000, startDegrees: 80, endDegrees: 100 }] });
    const xml = writePpen(b.document).replace("</course-scribe-event>",
      `  <leg id="5" start-control="${controls[0]}" end-control="${finish}"><flagging kind="all" /></leg>\n</course-scribe-event>`);
    const p = layoutOverprint(readPpen(xml).document, { course });
    expect(circles(p).find(c => c.role === "CONTROL")!.gaps).toEqual([{ startDegrees: 80, endDegrees: 100 }]);
    expect(lines(p).find(l => l.role === "FLAGGING")!.dash).toEqual([2, 0.5]);
  });
});

describe("fasta avbrott i sträckan och mellanrummet vid ringen (ISOM 705, ADR-0211 beslut 2; städrundan 2026-11-07)", () => {
  /** Två kontroller på x-axeln (vanlig kontroll i 0,0 och nästa i 60,0) med ett fast avbrott 20–22 mm från kontrollens mitt. */
  function legPieces(gapMm: number) {
    const b = new Builder({ mapScale: 15000 });
    const start = b.control("START", -40, 0);
    const first = b.control("NORMAL", 0, 0, "31");
    const second = b.control("NORMAL", 60, 0, "32");
    const finish = b.control("FINISH", 60, 40);
    const course = b.course("A");
    for (const id of [start, first, second, finish]) b.insert(course, id);
    b.edit({ type: "SET_LEG_GAPS", from: first, to: second, gaps: [{ start: 20, length: 2 }] });
    b.edit({ type: "SET_EVENT", changes: { legCircleGapMm: gapMm } });
    const legs = lines(layoutOverprint(b.document, { course })).filter(line => line.role === "LEG" && line.points.every(p => Math.abs(p.y) < 1e-9 && p.x >= 0));
    return legs.map(line => [line.points[0]!.x, line.points[line.points.length - 1]!.x]).sort((x, y) => x[0]! - y[0]!);
  }

  it("avbrottet räknas från kontrollens mitt och står still på kartan när mellanrummet ändras; bara sträckans ändar flyttas", () => {
    const sizes = OVERPRINT_SIZES.ISOM2017;
    const outer = sizes.controlOutside / 2;
    for (const gap of [0, LEG_CIRCLE_GAP_MM, 2]) {
      const pieces = legPieces(gap);
      expect(pieces).toHaveLength(2);
      // Mellanrummet räknas från ringens ytterkant (5,35 mm ytterdiameter), inte från linjens mitt.
      expect(pieces[0]![0]).toBeCloseTo(outer + gap, 6);
      expect(pieces[1]![1]).toBeCloseTo(60 - outer - gap, 6);
      // Det fasta avbrottet: 20–22 mm från kontrollens mitt, oavsett mellanrummet.
      expect(pieces[0]![1]).toBeCloseTo(20, 6);
      expect(pieces[1]![0]).toBeCloseTo(22, 6);
    }
  });
});
