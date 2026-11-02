/** Hjälp för träningslägets tester (ADR-0192): en påhittad karta och en bana i en rad. */
import type { MapObject, MapSymbol, ParsedMap, Point } from "@o-tid/map-file";
import { parseSymbolCode } from "@o-tid/map-file";
import type { CourseSettingDocument, CourseTraining } from "../src";
import { Builder } from "./build";

const symbol = (id: string, code: string, name: string): MapSymbol =>
  ({ id, kind: "LINE", code: parseSymbolCode(code), name, hidden: false, strokes: [{ color: 1, width: 0.2 }] });
const SYMBOLS = [symbol("s101", "101.0", "Höjdkurva"), symbol("s406", "406.0", "Skog: svår löpning"), symbol("s505", "505", "Stig"),
  symbol("s601", "601.1", "Nordlinje"), symbol("s520", "520", "Förbjudet område"), symbol("s999", "999", "Brun kurva, egen"),
  symbol("s0", "0", "Mystisk")];
const line = (sym: string, ...points: Point[]): MapObject =>
  ({ kind: "line", symbol: sym, path: points.map((p, i) => ({ type: i === 0 ? "M" : "L", x: p.x, y: p.y })) as never });

export function syntheticMap(): ParsedMap {
  return {
    format: "OMAP", version: "test", scale: 10000, georeference: null, warnings: [], bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 },
    colors: [{ id: 1, name: "Brun", rank: 1, cmyk: { c: 0, m: 0.5, y: 1, k: 0.2 }, rgb: { r: 0.7, g: 0.4, b: 0.1 }, opacity: 1 }],
    symbols: new Map(SYMBOLS.map(item => [item.id, item])),
    objects: [line("s101", { x: 0, y: 0 }, { x: 10, y: 0 }), line("s406", { x: 0, y: 1 }, { x: 10, y: 1 }), line("s406", { x: 0, y: 2 }, { x: 5, y: 2 }),
      line("s505", { x: 0, y: 3 }, { x: 10, y: 3 }), line("s999", { x: 0, y: 4 }, { x: 10, y: 4 })]
  };
}

/** Start, 31, 32, 33, mål (1:10 000: 10 mm = 100 m). */
export function lineCourse(): { b: Builder; course: string; controls: string[] } {
  const b = new Builder();
  const start = b.control("START", 0, 0);
  const c = [b.control("NORMAL", 10, 0, "31"), b.control("NORMAL", 20, 10, "32"), b.control("NORMAL", 30, 0, "33")];
  const finish = b.control("FINISH", 40, 0);
  const course = b.course("Träning");
  for (const id of c) b.insert(course, id);
  return { b, course, controls: [start, ...c, finish] };
}

export const ccOf = (document: CourseSettingDocument, control: string) => Object.values(document.courseControls).find(cc => cc.control === control)!.id;
export const training = (overrides: Partial<CourseTraining> = {}): CourseTraining => ({ outside: { kind: "FULL" }, sections: [], ...overrides });

/** Punkten i ytan (jämn–udda). */
export function inside(region: readonly (readonly Point[])[], p: Point): boolean {
  let hit = false;
  for (const ring of region) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}
