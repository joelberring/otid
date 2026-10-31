/** Små kartor för hand. Mått i meter i terrängen (skala 1:10 000 → 0,1 mm per meter). */
import { parseSymbolCode, type MapObject, type MapSymbol, type ParsedMap, type Path, type Point } from "@o-tid/map-file";

export const SCALE = 10_000;
export const MM = 1000 / SCALE;

export function m(x: number, y: number): Point {
  return { x: x * MM, y: y * MM };
}

function areaSymbol(code: string): MapSymbol {
  return { id: code, code: parseSymbolCode(code), name: code, hidden: false, kind: "AREA", hatches: [] };
}

function lineSymbol(code: string, width: number): MapSymbol {
  return { id: code, code: parseSymbolCode(code), name: code, hidden: false, kind: "LINE", strokes: [{ color: 0, width }] };
}

function pointSymbol(code: string): MapSymbol {
  return { id: code, code: parseSymbolCode(code), name: code, hidden: false, kind: "POINT", elements: [] };
}

export function ring(points: readonly Point[]): Path {
  return points.map((p, index) => ({ type: index === 0 ? "M" : "L", x: p.x, y: p.y } as const));
}

/** Rektangel i meter. */
export function rect(x0: number, y0: number, x1: number, y1: number): Path {
  return ring([m(x0, y0), m(x1, y0), m(x1, y1), m(x0, y1), m(x0, y0)]);
}

export class MapBuilder {
  readonly symbols = new Map<string, MapSymbol>();
  readonly objects: MapObject[] = [];

  area(code: string, ...rings: Path[]): this {
    if (!this.symbols.has(code)) this.symbols.set(code, areaSymbol(code));
    this.objects.push({ kind: "area", symbol: code, rings, angle: 0 });
    return this;
  }

  /** Linje genom punkter i meter; bredd i mm på kartan. */
  line(code: string, widthMm: number, ...points: [number, number][]): this {
    if (!this.symbols.has(code)) this.symbols.set(code, lineSymbol(code, widthMm));
    this.objects.push({ kind: "line", symbol: code, path: ring(points.map(([x, y]) => m(x, y))) });
    return this;
  }

  /** Linje med bézierkurva: från a via kontrollpunkterna till b (meter). */
  curve(code: string, widthMm: number, a: [number, number], c1: [number, number], c2: [number, number], b: [number, number]): this {
    if (!this.symbols.has(code)) this.symbols.set(code, lineSymbol(code, widthMm));
    const [p, q, r, s] = [m(...a), m(...c1), m(...c2), m(...b)];
    this.objects.push({ kind: "line", symbol: code, path: [{ type: "M", x: p.x, y: p.y }, { type: "C", x1: q.x, y1: q.y, x2: r.x, y2: r.y, x: s.x, y: s.y }] });
    return this;
  }

  point(code: string, x: number, y: number): this {
    if (!this.symbols.has(code)) this.symbols.set(code, pointSymbol(code));
    this.objects.push({ kind: "point", symbol: code, at: m(x, y), angle: 0 });
    return this;
  }

  build(scale = SCALE): ParsedMap {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const add = (x: number, y: number) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); };
    for (const object of this.objects) {
      if (object.kind === "area") for (const r of object.rings) for (const c of r) add(c.x, c.y);
      else if (object.kind === "line") for (const c of object.path) add(c.x, c.y);
      else add(object.at.x, object.at.y);
    }
    return {
      format: "OMAP", version: "test", colors: [], symbols: this.symbols, objects: this.objects, scale,
      georeference: null, bounds: Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null, warnings: []
    };
  }
}

/** Kartan börjar med öppen skog (405) över hela ytan. */
export function forest(size = 2000): MapBuilder {
  return new MapBuilder().area("405", rect(-size, -size, size, size));
}
