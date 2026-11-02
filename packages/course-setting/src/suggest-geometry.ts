/**
 * Förslag på kontrollbeskrivning (ADR-0180 beslut 13): kartans detaljer som enkla figurer i ett rutnät, en gång per
 * `ParsedMap` och standard (sparas i en WeakMap), och geometrin som reglerna i `suggest.ts` frågar efter. Kartans mm,
 * y uppåt.
 */
import { flattenPath, type MapColor, type MapObject, type MapSymbol, type ParsedMap, type Point, type PointElement } from "@o-tid/map-file";
import { FEATURE_KIND, featureRuleFor, type FeatureKind, type FeatureLookup } from "./suggest-symbols";

export type Geometry = "point" | "line" | "area";

export interface Box { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }

export interface Feature {
  readonly index: number;
  readonly symbol: MapSymbol;
  readonly lookup: FeatureLookup;
  readonly kind: FeatureKind;
  readonly geometry: Geometry;
  /** Punktobjektets läge. */
  readonly at?: Point | undefined;
  /** Linjens delar eller ytans ringar (ytterkant och hål, jämn–udda). */
  readonly lines: readonly (readonly Point[])[];
  readonly box: Box;
  /** Hur långt symbolen når från punkten eller linjen (mm), utan taggar. */
  readonly extent: number;
  /** Branter och skärningar: taggarnas sida i linjens riktning (+1 vänster, −1 höger), 0 = utan taggar. */
  readonly tagSide: number;
  /** Linjen har en symbol i hörnen (kraftledningens stolpar). */
  readonly corners: boolean;
}

/** En sluten höjdkurva (101–103) och om den är en grop (lutningsstreck inuti). */
export interface ContourLoop { readonly ring: readonly Point[]; readonly box: Box; readonly depression: boolean; readonly symbol: MapSymbol }

export interface PreparedMap {
  readonly features: readonly Feature[];
  readonly loops: readonly ContourLoop[];
  readonly grid: ReadonlyMap<number, readonly number[]>;
  /** Stora objekt (fler än `BIG_CELLS` rutor) prövas alltid med sin ruta. */
  readonly big: readonly number[];
  readonly loopGrid: ReadonlyMap<number, readonly number[]>;
}

const CELL_MM = 4;
const BIG_CELLS = 64;
/** Slutna höjdkurvor större än så här (mm) är inte en höjd vid kontrollen. */
const MAX_LOOP_MM = 6;
const key = (cx: number, cy: number) => cx * 1_000_003 + cy;
const cache = new WeakMap<ParsedMap, Map<string, PreparedMap>>();

const whiteish = (color: MapColor | undefined) => !color || color.opacity <= 0.05 || (color.rgb.r > 0.97 && color.rgb.g > 0.97 && color.rgb.b > 0.97);
/** Banans färger (rött, lila) i kartfilen: klubbens markeringar, inte terräng. */
const overprintish = (color: MapColor) => color.rgb.r > 0.6 && color.rgb.g < 0.2 && (color.rgb.b < 0.3 || color.rgb.b > 0.5);

function symbolColors(symbol: MapSymbol): number[] {
  const elements = (list: readonly PointElement[] | undefined) => (list ?? []).map(element => element.color);
  switch (symbol.kind) {
    case "POINT": return elements(symbol.elements);
    case "LINE": return [...symbol.strokes.map(stroke => stroke.color), ...elements(symbol.repeated?.elements), ...elements(symbol.corner?.elements)];
    case "AREA": return [...(symbol.fill !== undefined ? [symbol.fill] : []), ...symbol.hatches.map(hatch => hatch.color), ...elements(symbol.pattern?.elements),
      ...(symbol.border ?? []).map(stroke => stroke.color)];
    default: return [];
  }
}

/** Synlig terrängsymbol: någon färg som inte är vit, och inte bara banans röda eller lila. */
function visibleTerrain(symbol: MapSymbol, colors: ReadonlyMap<number, MapColor>): boolean {
  const used = symbolColors(symbol).map(id => colors.get(id)).filter((color): color is MapColor => !whiteish(color));
  return used.length > 0 && !used.every(overprintish);
}

function reach(element: PointElement): number {
  const r = (p: Point) => Math.hypot(p.x, p.y);
  switch (element.kind) {
    case "circle": return r(element.center) + element.diameter / 2 + element.lineWidth / 2;
    case "dot": return r(element.center) + element.diameter / 2;
    case "line": return Math.max(0, ...flattenPath(element.path).flat().map(r)) + element.width / 2;
    case "area": return Math.max(0, ...element.rings.flatMap(ring => flattenPath(ring).flat()).map(r));
  }
}

function extentOf(symbol: MapSymbol): number {
  if (symbol.kind === "POINT") return Math.max(0.1, ...symbol.elements.map(reach));
  if (symbol.kind === "LINE") return Math.max(0.05, ...symbol.strokes.map(stroke => Math.abs(stroke.offset ?? 0) + stroke.width / 2));
  return 0;
}

/** Taggarnas sida: +1 om de upprepade elementen ligger till vänster om linjen (y > 0), −1 till höger, 0 utan taggar. */
function tagSideOf(symbol: MapSymbol): number {
  if (symbol.kind !== "LINE" || !symbol.repeated) return 0;
  let sum = 0;
  for (const element of symbol.repeated.elements) {
    const points = element.kind === "line" ? flattenPath(element.path).flat() : element.kind === "area" ? element.rings.flatMap(ring => flattenPath(ring).flat())
      : [element.center];
    for (const point of points) sum += point.y;
  }
  return Math.abs(sum) < 1e-6 ? 0 : Math.sign(sum);
}

export function boxOf(lines: readonly (readonly Point[])[]): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const line of lines) for (const p of line) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

const geometryOf = (object: MapObject): Geometry | undefined => object.kind === "text" ? undefined : object.kind;

function insert(grid: Map<number, number[]>, big: number[], box: Box, index: number): void {
  const x0 = Math.floor(box.minX / CELL_MM), x1 = Math.floor(box.maxX / CELL_MM);
  const y0 = Math.floor(box.minY / CELL_MM), y1 = Math.floor(box.maxY / CELL_MM);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > BIG_CELLS) { big.push(index); return; }
  for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
    const list = grid.get(key(cx, cy));
    if (list) list.push(index); else grid.set(key(cx, cy), [index]);
  }
}

/** Sluten linje; en hjälpkurva ritas ofta med en liten lucka (högst `gap` mm) där den börjar och slutar. */
const closedLine = (line: readonly Point[], gap = 0.05) => line.length > 3 && Math.hypot(line[0]!.x - line[line.length - 1]!.x, line[0]!.y - line[line.length - 1]!.y) < gap;
/** Hjälpkurvans lucka som fortfarande räknas som en sluten slinga (mm). */
const LOOP_GAP_MM = 0.4;

/** Kartans detaljer för förslagen; byggs första gången och sparas per karta och standard (sprint eller inte). */
export function prepareMap(map: ParsedMap, sprint: boolean): PreparedMap {
  const signature = sprint ? "sprint" : "isom";
  const known = cache.get(map)?.get(signature);
  if (known) return known;
  const colors = new Map(map.colors.map(color => [color.id, color]));
  const lookups = new Map<string, FeatureLookup | null>();
  const features: Feature[] = [];
  const grid = new Map<number, number[]>();
  const big: number[] = [];
  const loops: ContourLoop[] = [];
  const ticks: Point[] = [];
  for (const object of map.objects) {
    const geometry = geometryOf(object);
    const symbol = map.symbols.get(object.symbol);
    if (!geometry || !symbol || symbol.hidden) continue;
    if (symbol.code.main >= 101 && symbol.code.main <= 103) {
      // Höjdkurvorna: slutna små slingor (höjd eller grop) och lutningsstrecken (punkter) som visar gropar.
      if (object.kind === "point") ticks.push(object.at);
      else if (object.kind === "line") {
        for (const line of flattenPath(object.path)) {
          if (!closedLine(line, LOOP_GAP_MM)) continue;
          const box = boxOf([line]);
          if (Math.max(box.maxX - box.minX, box.maxY - box.minY) <= MAX_LOOP_MM) loops.push({ ring: [...line, line[0]!], box, depression: false, symbol });
        }
      }
      continue;
    }
    const lookupKey = `${object.symbol}|${geometry}`;
    let lookup = lookups.get(lookupKey);
    if (lookup === undefined) {
      lookup = visibleTerrain(symbol, colors) ? featureRuleFor(symbol.code, symbol.name, geometry, sprint) ?? null : null;
      lookups.set(lookupKey, lookup);
    }
    if (!lookup) continue;
    const lines = object.kind === "point" || object.kind === "text" ? [] : object.kind === "line" ? flattenPath(object.path)
      : object.rings.flatMap(ring => flattenPath(ring));
    const at = object.kind === "point" ? object.at : undefined;
    const box = at ? { minX: at.x, minY: at.y, maxX: at.x, maxY: at.y } : boxOf(lines);
    if (!Number.isFinite(box.minX)) continue;
    const index = features.length;
    features.push({ index, symbol, lookup, kind: FEATURE_KIND[lookup.rule.d] ?? "OBJECT", geometry, at, lines, box, extent: extentOf(symbol),
      tagSide: tagSideOf(symbol), corners: symbol.kind === "LINE" && symbol.corner !== undefined });
    insert(grid, big, box, index);
  }
  // En slinga med lutningsstreck inuti är en grop.
  const loopGrid = new Map<number, number[]>();
  const marked = loops.map(loop => ({ ...loop, depression: ticks.some(tick => inBox(tick, loop.box) && insideRings(tick, [loop.ring])) }));
  marked.forEach((loop, index) => insert(loopGrid, [], loop.box, index));
  const prepared: PreparedMap = { features, loops: marked, grid, big, loopGrid };
  if (!cache.has(map)) cache.set(map, new Map());
  cache.get(map)!.set(signature, prepared);
  return prepared;
}

const inBox = (p: Point, box: Box, margin = 0) => p.x >= box.minX - margin && p.x <= box.maxX + margin && p.y >= box.minY - margin && p.y <= box.maxY + margin;

/** Detaljerna vars ruta når inom `radius` från punkten. */
export function featuresNear(prepared: PreparedMap, at: Point, radius: number): Feature[] {
  const seen = new Set<number>();
  const out: Feature[] = [];
  const add = (index: number) => {
    if (seen.has(index)) return;
    seen.add(index);
    const feature = prepared.features[index]!;
    if (inBox(at, feature.box, radius)) out.push(feature);
  };
  for (let cx = Math.floor((at.x - radius) / CELL_MM); cx <= Math.floor((at.x + radius) / CELL_MM); cx++) {
    for (let cy = Math.floor((at.y - radius) / CELL_MM); cy <= Math.floor((at.y + radius) / CELL_MM); cy++) {
      for (const index of prepared.grid.get(key(cx, cy)) ?? []) add(index);
    }
  }
  for (const index of prepared.big) add(index);
  return out;
}

/** Slutna höjdkurvor nära punkten. */
export function loopsNear(prepared: PreparedMap, at: Point, radius: number): ContourLoop[] {
  const seen = new Set<number>();
  const out: ContourLoop[] = [];
  for (let cx = Math.floor((at.x - radius) / CELL_MM); cx <= Math.floor((at.x + radius) / CELL_MM); cx++) {
    for (let cy = Math.floor((at.y - radius) / CELL_MM); cy <= Math.floor((at.y + radius) / CELL_MM); cy++) {
      for (const index of prepared.loopGrid.get(key(cx, cy)) ?? []) {
        if (seen.has(index)) continue;
        seen.add(index);
        const loop = prepared.loops[index]!;
        if (inBox(at, loop.box, radius)) out.push(loop);
      }
    }
  }
  return out;
}

/** Jämn–udda: punkten ligger i ytan (ytterkant minus hål). */
export function insideRings(p: Point, rings: readonly (readonly Point[])[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!, b = ring[j]!;
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

/** Närmaste punkt på en av linjerna: avståndet, punkten, vilken linje och sträcka, och läget längs linjen (mm). */
export interface Nearest { readonly distance: number; readonly point: Point; readonly line: number; readonly segment: number; readonly along: number }

export function nearestOnLines(p: Point, lines: readonly (readonly Point[])[]): Nearest | undefined {
  let best: Nearest | undefined;
  lines.forEach((line, lineIndex) => {
    let walked = 0;
    if (line.length === 1) {
      const d = Math.hypot(p.x - line[0]!.x, p.y - line[0]!.y);
      if (!best || d < best.distance) best = { distance: d, point: line[0]!, line: lineIndex, segment: 0, along: 0 };
      return;
    }
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!, b = line[i]!;
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy, length = Math.sqrt(l2);
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
      const q = { x: a.x + t * dx, y: a.y + t * dy };
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (!best || d < best.distance) best = { distance: d, point: q, line: lineIndex, segment: i - 1, along: walked + t * length };
      walked += length;
    }
  });
  return best;
}

export function lineLength(line: readonly Point[]): number {
  let length = 0;
  for (let i = 1; i < line.length; i++) length += Math.hypot(line[i]!.x - line[i - 1]!.x, line[i]!.y - line[i - 1]!.y);
  return length;
}

/** Punkten `along` mm längs linjen (klämd till ändarna). */
export function pointAlong(line: readonly Point[], along: number): Point {
  if (along <= 0) return line[0]!;
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!, b = line[i]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (walked + length >= along && length > 0) {
      const t = (along - walked) / length;
      return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    }
    walked += length;
  }
  return line[line.length - 1]!;
}

const unit = (from: Point, to: Point): Point => {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  return length === 0 ? { x: 0, y: 0 } : { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
};

/**
 * Hörnet i linjen närmast läget `along`: den skarpaste böjen inom `window` mm åt båda hållen (vinkeln mellan riktningen
 * in och ut, mätt över `arm` mm, så att en utplattad kurva inte räknas som många små hörn). `turn` i grader, positiv =
 * vänstersväng; `outward` pekar ut från böjens insida.
 */
export function cornerNear(line: readonly Point[], along: number, window: number, arm: number):
  { readonly at: Point; readonly along: number; readonly turn: number; readonly outward: Point } | undefined {
  const total = lineLength(line);
  if (total < 2 * arm) return undefined;
  let walked = 0, best: { at: Point; along: number; turn: number; outward: Point } | undefined;
  for (let i = 0; i < line.length; i++) {
    if (i > 0) walked += Math.hypot(line[i]!.x - line[i - 1]!.x, line[i]!.y - line[i - 1]!.y);
    if (Math.abs(walked - along) > window || walked < arm * 0.5 || walked > total - arm * 0.5) continue;
    const v = line[i]!;
    const before = unit(pointAlong(line, walked - arm), v), after = unit(v, pointAlong(line, walked + arm));
    const turn = Math.atan2(before.x * after.y - before.y * after.x, before.x * after.x + before.y * after.y) * 180 / Math.PI;
    if (!best || Math.abs(turn) > Math.abs(best.turn)) {
      // Insidan av böjen ligger åt det håll linjen svänger; ut = bort från den (summan av armarna bakåt och framåt).
      const back = unit(v, pointAlong(line, walked - arm)), ahead = unit(v, pointAlong(line, walked + arm));
      const sum = { x: back.x + ahead.x, y: back.y + ahead.y };
      const length = Math.hypot(sum.x, sum.y) || 1;
      best = { at: v, along: walked, turn, outward: { x: -sum.x / length, y: -sum.y / length } };
    }
  }
  return best;
}

/** Linjens riktning vid läget (enhetsvektor framåt), mätt över `arm` mm. */
export function directionAt(line: readonly Point[], along: number, arm: number): Point {
  return unit(pointAlong(line, along - arm), pointAlong(line, along + arm));
}

export function centroidOf(lines: readonly (readonly Point[])[]): Point {
  let x = 0, y = 0, n = 0;
  for (const line of lines) for (const p of line) { x += p.x; y += p.y; n++; }
  return n === 0 ? { x: 0, y: 0 } : { x: x / n, y: y / n };
}

/** Delen av linjerna inom `radius` från punkten (för markeringen på kartan), högst `maxPoints` punkter per del. */
export function clipNear(lines: readonly (readonly Point[])[], at: Point, radius: number, maxPoints = 200): Point[][] {
  const out: Point[][] = [];
  for (const line of lines) {
    let current: Point[] | undefined;
    for (const p of line) {
      if (Math.hypot(p.x - at.x, p.y - at.y) <= radius) {
        if (!current) { current = []; out.push(current); }
        if (current.length < maxPoints) current.push({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 });
      } else current = undefined;
    }
  }
  return out.filter(line => line.length > 0);
}
