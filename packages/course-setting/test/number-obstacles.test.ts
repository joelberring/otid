/** ADR-0211 beslut 4: numren undviker hus, mörka ytor och svarta linjer; placerade nummer flyttas inte men får en notis. */
import { flattenPath, type MapObject, type MapSymbol, type ParsedMap, type Point } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import {
  applyEdit, areaCover, checkDocument, computeNumberObstacles, layoutOverprint, linesCrossing, NUMBER_OBSTACLE_COST,
  NUMBER_OBSTACLE_REACH_MM, numberObstaclePoints, obstacleCost, type NumberObstacles, type ObstaclePoint, type OverprintPrimitive
} from "../src";
import { Builder, lineCourse } from "./build";

const code = (text: string) => ({ text, main: Number(text.split(".")[0]), sub: Number(text.split(".")[1] ?? 0) });
const SYMBOLS: MapSymbol[] = [
  { id: "house", kind: "AREA", code: code("521.0"), name: "Byggnad", hidden: false, fill: 0, hatches: [] },
  { id: "field", kind: "AREA", code: code("401.0"), name: "Öppen mark", hidden: false, fill: 1, hatches: [] },
  { id: "path", kind: "LINE", code: code("505.0"), name: "Stig", hidden: false, strokes: [{ color: 2, width: 0.35 }] }
];
const color = (id: number, r: number, g: number, b: number) => ({ id, name: String(id), rank: id, cmyk: { c: 0, m: 0, y: 0, k: 1 }, rgb: { r, g, b }, opacity: 1 });
const square = (x0: number, y0: number, x1: number, y1: number) =>
  [{ type: "M", x: x0, y: y0 }, { type: "L", x: x1, y: y0 }, { type: "L", x: x1, y: y1 }, { type: "L", x: x0, y: y1 }, { type: "L", x: x0, y: y0 }] as never;
const area = (symbol: string, ...corners: [number, number, number, number]): MapObject => ({ kind: "area", symbol, rings: [square(...corners)], angle: 0 });
const line = (symbol: string, ...points: Point[]): MapObject => ({ kind: "line", symbol, path: points.map((p, i) => ({ type: i === 0 ? "M" : "L", x: p.x, y: p.y })) as never });
const map = (objects: MapObject[]): ParsedMap => ({
  format: "OCD", version: "test", scale: 10000, georeference: null, warnings: [], bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 },
  // Grå byggnad (mörk nog), gul mark (ljus), svart stig.
  colors: [color(0, 0.35, 0.35, 0.35), color(1, 1, 0.75, 0.2), color(2, 0, 0, 0)], symbols: new Map(SYMBOLS.map(symbol => [symbol.id, symbol])), objects
});
type Text = Extract<OverprintPrimitive, { kind: "text" }>;
const numberOf = (figures: readonly OverprintPrimitive[], ref: string) => figures.find((item): item is Text => item.kind === "text" && item.role === "NUMBER" && item.ref === ref)!;

describe("hindren för numren", () => {
  it("samlar hus, mörka ytor och svarta linjer nära kontrollen, inte ljusa ytor", () => {
    const found = computeNumberObstacles(map([area("house", 2, 1, 8, 6), area("field", -50, -50, 50, 50), line("path", { x: -10, y: -3 }, { x: 10, y: -3 })]),
      [{ id: "c", at: { x: 0, y: 0 } }, { id: "far", at: { x: 90, y: 90 } }]);
    expect(found.c!.areas).toHaveLength(1);
    expect(found.c!.lines).toHaveLength(1);
    expect(found.far).toBeUndefined();
  });

  it("kostnaden: en ruta helt på ett hus kostar som hela ytkostnaden, varje svart linje genom rutan lägger till", () => {
    const obstacles = { areas: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]], lines: [[{ x: -5, y: 20 }, { x: 25, y: 20 }] as const] };
    expect(obstacleCost({ cx: 5, cy: 5, w: 4, h: 3 }, obstacles)).toBeCloseTo(NUMBER_OBSTACLE_COST.area, 6);
    expect(obstacleCost({ cx: 5, cy: 20, w: 4, h: 3 }, obstacles)).toBeCloseTo(NUMBER_OBSTACLE_COST.line, 6);
    expect(obstacleCost({ cx: 30, cy: 30, w: 4, h: 3 }, obstacles)).toBe(0);
    expect(obstacleCost({ cx: 10, cy: 5, w: 4, h: 3 }, obstacles)).toBeGreaterThan(0);
    expect(obstacleCost({ cx: 10, cy: 5, w: 4, h: 3 }, obstacles)).toBeLessThan(NUMBER_OBSTACLE_COST.area);
  });

  it("den automatiska placeringen flyttar numret från huset när det finns plats", () => {
    const { b, course, controls } = lineCourse(1, { mapScale: 10000 });
    const control = b.document.controls[controls[0]!]!;
    const ref = b.cc(course, controls[0]!);
    const before = numberOf(layoutOverprint(b.document, { course }), ref).at;
    // Ett hus precis där numret hamnar utan hinder.
    const house = area("house", before.x - 3, before.y - 3, before.x + 3, before.y + 3);
    const obstacles = computeNumberObstacles(map([house]), numberObstaclePoints(b.document));
    expect(obstacles[control.id]).toBeDefined();
    const after = numberOf(layoutOverprint(b.document, { course, numberObstacles: obstacles }), ref).at;
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(1);
    expect(checkDocument(b.document, { numberObstacles: obstacles }).some(check => check.kind === "NUMBER_ON_OBSTACLE")).toBe(false);
  });

  it("ett placerat nummer flyttas inte; Varningar får notisen", () => {
    const { b, course, controls } = lineCourse(1, { mapScale: 10000 });
    const control = b.document.controls[controls[0]!]!;
    const ref = b.cc(course, controls[0]!);
    const at = { x: control.at.x + 5, y: control.at.y + 5 };
    const placed = applyEdit(b.document, { type: "MOVE_NUMBER", course, courseControl: ref, at }).document;
    const obstacles = computeNumberObstacles(map([area("house", at.x - 4, at.y - 4, at.x + 4, at.y + 4)]), numberObstaclePoints(placed));
    expect(numberOf(layoutOverprint(placed, { course, numberObstacles: obstacles }), ref).at).toEqual(at);
    const notice = checkDocument(placed, { numberObstacles: obstacles }).find(check => check.kind === "NUMBER_ON_OBSTACLE");
    expect(notice).toMatchObject({ kind: "NUMBER_ON_OBSTACLE", control: control.id, text: "1" });
  });

  it("paritetstest: spatialt computeNumberObstacles + areaCover/linesCrossing/obstacleCost ger 100 % identiskt resultat mot brute-force", () => {
    const extraSymbols: MapSymbol[] = [
      ...SYMBOLS,
      { id: "ruin", kind: "AREA", code: code("526.0"), name: "Ruin", hidden: false, fill: 1, hatches: [] },
      { id: "dark-forest", kind: "AREA", code: code("410.0"), name: "Mörk yta", hidden: false, fill: 0, hatches: [] },
      { id: "hidden-house", kind: "AREA", code: code("521.0"), name: "Dold byggnad", hidden: true, fill: 0, hatches: [] },
      { id: "thin-black", kind: "LINE", code: code("505.1"), name: "Tunn linje", hidden: false, strokes: [{ color: 2, width: 0.05 }] },
      { id: "light-line", kind: "LINE", code: code("505.2"), name: "Ljus linje", hidden: false, strokes: [{ color: 1, width: 0.4 }] }
    ];
    // Deterministisk PRNG så testet alltid reproducerar exakt samma täta karta.
    let seed = 0x12345678;
    const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
    const objects: MapObject[] = [];
    // Små byggnader och mörka ytor utspridda över 200 × 200 mm.
    for (let i = 0; i < 250; i++) {
      const x = -100 + rand() * 195, y = -100 + rand() * 195;
      const w = 1 + rand() * 6, h = 1 + rand() * 6;
      const sym = i % 5 === 0 ? "dark-forest" : i % 7 === 0 ? "ruin" : i % 11 === 0 ? "field" : i % 13 === 0 ? "hidden-house" : "house";
      objects.push(area(sym, x, y, x + w, y + h));
    }
    // Konkav L-formad byggnad och en stor mörk yta som spänner över många rutnätsrutor (övar large-listan).
    objects.push({
      kind: "area", symbol: "house", angle: 0,
      rings: [[
        { type: "M", x: 10, y: 10 }, { type: "L", x: 24, y: 10 }, { type: "L", x: 24, y: 14 },
        { type: "L", x: 14, y: 14 }, { type: "L", x: 14, y: 24 }, { type: "L", x: 10, y: 24 }, { type: "L", x: 10, y: 10 }
      ] as never]
    });
    objects.push(area("dark-forest", -95, -95, 95, -80));
    // Objekt exakt på kartans ytterkant (prövar rand-clamping i rutnätet).
    objects.push(area("house", 100, 100, 100, 100));
    objects.push(line("path", { x: 100, y: 95 }, { x: 100, y: 100 }));
    // Täta svarta linjer (horisontella, vertikala, diagonala, långa och korta) + ignorerade linjer.
    for (let i = 0; i < 400; i++) {
      const pts: Point[] = [];
      let x = -100 + rand() * 200, y = -100 + rand() * 200;
      const steps = 2 + (i % 5);
      for (let s = 0; s < steps; s++) {
        pts.push({ x, y });
        x += (rand() - 0.5) * 18;
        y += (rand() - 0.5) * 18;
      }
      const sym = i % 9 === 0 ? "thin-black" : i % 11 === 0 ? "light-line" : "path";
      objects.push(line(sym, ...pts));
    }
    // Lång diagonal linje över hela kartan (övar large-listan för linjer) samt rena axelparallella sträckor.
    objects.push(line("path", { x: -100, y: -100 }, { x: 100, y: 100 }));
    objects.push(line("path", { x: 0, y: -50 }, { x: 0, y: 50 }));
    objects.push(line("path", { x: -50, y: 0 }, { x: 50, y: 0 }));

    const denseMap: ParsedMap = {
      format: "OCD", version: "test", scale: 10000, georeference: null, warnings: [],
      bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 },
      colors: [color(0, 0.35, 0.35, 0.35), color(1, 1, 0.75, 0.2), color(2, 0, 0, 0)],
      symbols: new Map(extraSymbols.map(symbol => [symbol.id, symbol])),
      objects
    };

    const controls: ObstaclePoint[] = [
      { id: "edge-hit", at: { x: 120, y: 120 } },
      { id: "far-out", at: { x: 500, y: 500 } },
      { id: "l-shape", at: { x: 15, y: 15 } },
      { id: "origin", at: { x: 0, y: 0 } }
    ];
    for (let i = 0; i < 60; i++) controls.push({ id: `c${i}`, at: { x: -110 + rand() * 220, y: -110 + rand() * 220 } });

    // Enkel referens-brute-force (exakt samma definition som före optimeringen).
    const refCompute = (source: ParsedMap, pts: readonly ObstaclePoint[], reachMm = NUMBER_OBSTACLE_REACH_MM): Record<string, NumberObstacles> => {
      const colors = new Map(source.colors.map(c => [c.id, c]));
      const lum = (c: { rgb: { r: number; g: number; b: number } } | undefined) => c ? 0.2126 * c.rgb.r + 0.7152 * c.rgb.g + 0.0722 * c.rgb.b : 1;
      const areas: { box: [number, number, number, number]; ring: Point[] }[] = [];
      const lines: [Point, Point][] = [];
      for (const obj of source.objects) {
        const sym = source.symbols.get(obj.symbol);
        if (!sym || sym.hidden) continue;
        if (obj.kind === "area" && sym.kind === "AREA") {
          const building = [521, 522, 526].includes(sym.code.main);
          const fill = colors.get(sym.fill ?? -1);
          if (!building && !(fill !== undefined && fill.opacity > 0.5 && lum(fill) < 0.45)) continue;
          const ring = flattenPath(obj.rings[0]!).flat();
          if (ring.length >= 3) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const p of ring) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
            areas.push({ box: [minX, minY, maxX, maxY], ring });
          }
        } else if (obj.kind === "line" && sym.kind === "LINE") {
          if (!sym.strokes.some(s => { const c = colors.get(s.color); return c !== undefined && c.opacity > 0.5 && lum(c) < 0.2 && s.width >= 0.1; })) continue;
          for (const part of flattenPath(obj.path)) for (let i = 1; i < part.length; i++) lines.push([part[i - 1]!, part[i]!]);
        }
      }
      const out: Record<string, NumberObstacles> = {};
      for (const ctrl of pts) {
        const near = (minX: number, minY: number, maxX: number, maxY: number) =>
          maxX >= ctrl.at.x - reachMm && minX <= ctrl.at.x + reachMm && maxY >= ctrl.at.y - reachMm && minY <= ctrl.at.y + reachMm;
        const a = areas.filter(item => near(...item.box)).map(item => item.ring);
        const l = lines.filter(([p, q]) => near(Math.min(p.x, q.x), Math.min(p.y, q.y), Math.max(p.x, q.x), Math.max(p.y, q.y)));
        if (a.length > 0 || l.length > 0) out[ctrl.id] = { areas: a, lines: l };
      }
      return out;
    };
    const refPointInRing = (p: Point, ring: readonly Point[]) => {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i]!, b = ring[j]!;
        if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      }
      return inside;
    };
    const refAreaCover = (box: { cx: number; cy: number; w: number; h: number }, obs: NumberObstacles | undefined) => {
      if (!obs || obs.areas.length === 0) return 0;
      let hit = 0, total = 0;
      for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) {
        const p = { x: box.cx - box.w / 2 + box.w * (i + 0.5) / 5, y: box.cy - box.h / 2 + box.h * (j + 0.5) / 3 };
        total++;
        if (obs.areas.some(ring => refPointInRing(p, ring))) hit++;
      }
      return hit / total;
    };
    const refSegHits = (a: Point, b: Point, box: { cx: number; cy: number; w: number; h: number }) => {
      const minX = box.cx - box.w / 2, maxX = box.cx + box.w / 2, minY = box.cy - box.h / 2, maxY = box.cy + box.h / 2;
      let t0 = 0, t1 = 1;
      const dx = b.x - a.x, dy = b.y - a.y;
      for (const [p, q] of [[-dx, a.x - minX], [dx, maxX - a.x], [-dy, a.y - minY], [dy, maxY - a.y]] as const) {
        if (p === 0) { if (q < 0) return false; continue; }
        const r = q / p;
        if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
      }
      return true;
    };
    const refLinesCrossing = (box: { cx: number; cy: number; w: number; h: number }, obs: NumberObstacles | undefined) =>
      obs ? obs.lines.filter(([a, b]) => refSegHits(a, b, box)).length : 0;
    const refCost = (box: { cx: number; cy: number; w: number; h: number }, obs: NumberObstacles | undefined) =>
      NUMBER_OBSTACLE_COST.area * refAreaCover(box, obs) + NUMBER_OBSTACLE_COST.line * refLinesCrossing(box, obs);

    for (const reach of [NUMBER_OBSTACLE_REACH_MM, 7.5, 0]) {
      const actual = computeNumberObstacles(denseMap, controls, reach);
      const expected = refCompute(denseMap, controls, reach);
      expect(actual).toEqual(expected);
      if (reach === NUMBER_OBSTACLE_REACH_MM) {
        expect(actual["edge-hit"]).toBeDefined();
        expect(actual["far-out"]).toBeUndefined();
        for (const ctrl of controls) {
          const obs = actual[ctrl.id];
          for (let step = 0; step < 8; step++) {
            const angle = (step * Math.PI) / 4;
            const box = { cx: ctrl.at.x + Math.cos(angle) * 5, cy: ctrl.at.y + Math.sin(angle) * 5, w: 3.12, h: 4 };
            expect(areaCover(box, obs)).toBe(refAreaCover(box, obs));
            expect(linesCrossing(box, obs)).toBe(refLinesCrossing(box, obs));
            expect(obstacleCost(box, obs)).toBe(refCost(box, obs));
          }
        }
      }
    }
  });

  it("numberObstacleChecks ger identiska CourseCheck[] både med och utan manuellt flyttade siffror över flera banor", () => {
    const b = new Builder({ mapScale: 10000 });
    const start = b.control("START", -20, 0);
    const c1 = b.control("NORMAL", 0, 0, "31");
    const c2 = b.control("NORMAL", 20, 0, "32");
    const c3 = b.control("NORMAL", 40, 0, "33");
    const finish = b.control("FINISH", 60, 0);

    const courseA = b.course("Bana A");
    for (const id of [start, c1, c2, finish]) b.insert(courseA, id);
    const courseB = b.course("Bana B");
    for (const id of [start, c2, c3, finish]) b.insert(courseB, id);
    const courseC = b.course("Bana C");
    for (const id of [start, c1, c3, finish]) b.insert(courseC, id);

    const atOnHouse = { x: 20, y: 6 };
    const atClear = { x: 40, y: -15 };
    const mapWithHouses = map([
      area("house", -4, 3, 4, 9),
      area("house", atOnHouse.x - 4, atOnHouse.y - 4, atOnHouse.x + 4, atOnHouse.y + 4)
    ]);

    // Utan manuellt flyttade siffror: noll NUMBER_ON_OBSTACLE på alla tre banorna.
    const obstaclesBefore = computeNumberObstacles(mapWithHouses, numberObstaclePoints(b.document));
    expect(checkDocument(b.document, { numberObstacles: obstaclesBefore }).filter(c => c.kind === "NUMBER_ON_OBSTACLE")).toEqual([]);

    // Flytta numret på Bana A (på huset) och på Bana B (fritt, långt från hus); lämna Bana C orörd.
    const ccA = Object.values(b.document.courseControls).find(cc => cc.control === c2 && cc.next !== undefined)!;
    const ccB = Object.values(b.document.courseControls).find(cc => cc.control === c3)!;
    let doc = applyEdit(b.document, { type: "MOVE_NUMBER", course: courseA, courseControl: ccA.id, at: atOnHouse }).document;
    doc = applyEdit(doc, { type: "MOVE_NUMBER", course: courseB, courseControl: ccB.id, at: atClear }).document;

    const obstaclesAfter = computeNumberObstacles(mapWithHouses, numberObstaclePoints(doc));
    const notices = checkDocument(doc, { numberObstacles: obstaclesAfter }).filter(c => c.kind === "NUMBER_ON_OBSTACLE");
    expect(notices).toEqual([{ kind: "NUMBER_ON_OBSTACLE", course: courseA, control: c2, text: "2" }]);

    // Flytta även ett nummer på Bana C över huset — båda banornas notiser kommer i banordning.
    const ccC = Object.values(doc.courseControls).find(cc => cc.control === c1 && cc.next !== undefined && cc.id !== Object.values(doc.courseControls).find(x => x.control === c1)?.id)!;
    const docBoth = applyEdit(doc, { type: "MOVE_NUMBER", course: courseC, courseControl: ccC.id, at: { x: 0, y: 6 } }).document;
    const noticesBoth = checkDocument(docBoth, { numberObstacles: obstaclesAfter }).filter(c => c.kind === "NUMBER_ON_OBSTACLE");
    expect(noticesBoth).toEqual([
      { kind: "NUMBER_ON_OBSTACLE", course: courseA, control: c2, text: "2" },
      { kind: "NUMBER_ON_OBSTACLE", course: courseC, control: c1, text: "1" }
    ]);
  });
});
