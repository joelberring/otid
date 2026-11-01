/**
 * Ringklipp över viktiga detaljer (ADR-0180 beslut 10). Ren funktion över kartfilen: för varje ring räknas bågarna där
 * ringens linje täcker ett viktigt linje- eller punktobjekt (tabellen i `detail-symbols.ts`). Gapet täcker objektets
 * bredd där det korsar ringen plus en marginal; korta bitar mellan gap tas bort; högst en fjärdedel av ringen klipps,
 * och då går de viktigaste objekten och de som korsar mest vinkelrätt först. Där en sträcka går ut ur ringen klipps inte.
 *
 * Kartan indexeras en gång i ett rutnät (sparas per `ParsedMap` och tabell), så att 100–200 ringar på en karta med
 * 10 000+ objekt går på några tiotal millisekunder.
 */
import { flattenPath, type MapColor, type MapSymbol, type ParsedMap, type Point, type PointElement } from "@o-tid/map-file";
import { arcContains, arcsFromSamples, mergeClose, totalDegrees, type Arc } from "./arcs";
import { DETAIL_GAP_LIMITS, DETAIL_PRIORITY_WEIGHT, detailClassFor, type DetailClass } from "./detail-symbols";

/** En ring att klippa: mittpunkt och radie till linjens mitt (kartans mm), linjens bredd. */
export interface DetailCircle {
  readonly id: string;
  readonly at: Point;
  readonly radiusMm: number;
  readonly lineWidthMm: number;
  /** Vinklar (grader moturs) där en sträcka går ut ur ringen; där görs inget gap. */
  readonly blockedDegrees?: readonly number[] | undefined;
}

export interface DetailGapOptions {
  /** Egen tabell som slås upp före standardtabellen (t.ex. { "418": "IGNORE", "530": "HIGH" }). */
  readonly symbols?: Readonly<Record<string, DetailClass>> | undefined;
  /** ISSprOM 2019-2: sprintens symboler läggs till (händelsens `overprintStandard`). */
  readonly sprint?: boolean | undefined;
  /** Högst så stor del av ringen (standard `DETAIL_GAP_LIMITS.maxFraction`). */
  readonly maxFraction?: number | undefined;
  /** Marginal på varje sida om objektet i mm (standard `DETAIL_GAP_LIMITS.marginMm`). */
  readonly marginMm?: number | undefined;
}

interface Feature { readonly weight: number; readonly halfWidth: number }

interface Prepared {
  readonly features: Feature[];
  /** Sträckor x1, y1, x2, y2 (en punkt har samma början och slut). */
  readonly segments: Float64Array;
  readonly segmentFeature: Int32Array;
  readonly grid: Map<number, number[]>;
  readonly maxHalfWidth: number;
}

const cache = new WeakMap<ParsedMap, Map<string, Prepared>>();
const cellKey = (cx: number, cy: number) => cx * 1_000_003 + cy;

const isWhite = (color: MapColor | undefined) => !color || (color.rgb.r > 0.97 && color.rgb.g > 0.97 && color.rgb.b > 0.97) || color.opacity <= 0.05;

/** Hur långt elementet når från symbolens mitt (punktsymbol) eller från linjen (upprepat element, `across` = |y|). */
function elementExtent(element: PointElement, colors: ReadonlyMap<number, MapColor>, across: boolean): number {
  if (isWhite(colors.get(element.color))) return 0;
  const reach = (p: Point) => across ? Math.abs(p.y) : Math.hypot(p.x, p.y);
  switch (element.kind) {
    case "circle": return reach(element.center) + element.diameter / 2 + element.lineWidth / 2;
    case "dot": return reach(element.center) + element.diameter / 2;
    case "line": return Math.max(0, ...flattenPath(element.path).flat().map(reach)) + element.width / 2;
    case "area": return Math.max(0, ...element.rings.flatMap(ring => flattenPath(ring).flat()).map(reach));
  }
}

/** Halva bredden som symbolen täcker (kartans mm); 0 = syns inte. */
function halfWidthOf(symbol: MapSymbol, colors: ReadonlyMap<number, MapColor>): number {
  if (symbol.kind === "POINT") return Math.max(0, ...symbol.elements.map(element => elementExtent(element, colors, false)));
  if (symbol.kind !== "LINE") return 0;
  let half = 0;
  for (const stroke of symbol.strokes) if (!isWhite(colors.get(stroke.color))) half = Math.max(half, Math.abs(stroke.offset ?? 0) + stroke.width / 2);
  for (const element of symbol.repeated?.elements ?? []) half = Math.max(half, elementExtent(element, colors, true));
  return half;
}

function prepare(map: ParsedMap, options: DetailGapOptions): Prepared {
  const signature = JSON.stringify([options.symbols ?? null, options.sprint ?? false]);
  const known = cache.get(map)?.get(signature);
  if (known) return known;
  const colors = new Map(map.colors.map(color => [color.id, color]));
  const featureOfSymbol = new Map<string, number>();
  const features: Feature[] = [];
  const coords: number[] = [];
  const owners: number[] = [];
  for (const object of map.objects) {
    if (object.kind !== "line" && object.kind !== "point") continue;
    let index = featureOfSymbol.get(object.symbol);
    if (index === undefined) {
      index = -1;
      const symbol = map.symbols.get(object.symbol);
      const cls = symbol && !symbol.hidden ? detailClassFor(symbol.code, options.symbols, options.sprint ?? false) : undefined;
      const halfWidth = symbol && cls && cls !== "IGNORE" ? halfWidthOf(symbol, colors) : 0;
      if (cls && cls !== "IGNORE" && halfWidth > 0) {
        index = features.length;
        features.push({ weight: DETAIL_PRIORITY_WEIGHT[cls], halfWidth });
      }
      featureOfSymbol.set(object.symbol, index);
    }
    if (index < 0) continue;
    // Varje objekt räknas för sig (två stenar på ringen är två gap; en stig in och ut ur ringen två korsningar).
    const own = features.length;
    features.push(features[index]!);
    if (object.kind === "point") { coords.push(object.at.x, object.at.y, object.at.x, object.at.y); owners.push(own); continue; }
    for (const line of flattenPath(object.path)) {
      for (let i = 1; i < line.length; i++) {
        coords.push(line[i - 1]!.x, line[i - 1]!.y, line[i]!.x, line[i]!.y);
        owners.push(own);
      }
    }
  }
  const segments = Float64Array.from(coords);
  const segmentFeature = Int32Array.from(owners);
  const grid = new Map<number, number[]>();
  const cell = DETAIL_GAP_LIMITS.cellMm;
  for (let s = 0; s < segmentFeature.length; s++) {
    const x1 = segments[4 * s]!, y1 = segments[4 * s + 1]!, x2 = segments[4 * s + 2]!, y2 = segments[4 * s + 3]!;
    for (let cx = Math.floor(Math.min(x1, x2) / cell); cx <= Math.floor(Math.max(x1, x2) / cell); cx++) {
      for (let cy = Math.floor(Math.min(y1, y2) / cell); cy <= Math.floor(Math.max(y1, y2) / cell); cy++) {
        const key = cellKey(cx, cy);
        const list = grid.get(key);
        if (list) list.push(s); else grid.set(key, [s]);
      }
    }
  }
  const prepared = { features, segments, segmentFeature, grid, maxHalfWidth: Math.max(0, ...features.map(f => f.halfWidth)) };
  if (!cache.has(map)) cache.set(map, new Map());
  cache.get(map)!.set(signature, prepared);
  return prepared;
}

function segmentDistance(px: number, py: number, s: Float64Array, i: number): number {
  const ax = s[4 * i]!, ay = s[4 * i + 1]!, bx = s[4 * i + 2]!, by = s[4 * i + 3]!;
  const dx = bx - ax, dy = by - ay;
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/**
 * Proven (index runt ringen) som sträckan kan nå: vinklarna till ändarna sedda från mitten, breddade med vinkeln som
 * `clear` upptar på ringens innerkant (`inner`). Går sträckan genom mitten provas hela varvet.
 */
function sampleRange(segments: Float64Array, s: number, at: Point, clear: number, inner: number, step: number, n: number): Iterable<number> {
  if (segmentDistance(at.x, at.y, segments, s) < 1e-6 || clear >= inner) return fullCircle(n);
  const a1 = Math.atan2(segments[4 * s + 1]! - at.y, segments[4 * s]! - at.x) * 180 / Math.PI;
  let a2 = Math.atan2(segments[4 * s + 3]! - at.y, segments[4 * s + 2]! - at.x) * 180 / Math.PI;
  if (a2 - a1 > 180) a2 -= 360;
  if (a1 - a2 > 180) a2 += 360;
  const widen = Math.asin(clear / inner) * 180 / Math.PI + step;
  const from = Math.floor((Math.min(a1, a2) - widen) / step), to = Math.ceil((Math.max(a1, a2) + widen) / step);
  const out: number[] = [];
  for (let k = from; k <= to && out.length < n; k++) out.push(((k % n) + n) % n);
  return out;
}

let fullCache: number[] = [];
function fullCircle(n: number): number[] {
  if (fullCache.length !== n) fullCache = Array.from({ length: n }, (_, i) => i);
  return fullCache;
}

interface Candidate extends Arc { readonly weight: number; readonly straightness: number }

/** Bågarna där varje objekt nära ringen täcks av ringens linje. */
function candidates(prepared: Prepared, circle: DetailCircle, margin: number): Candidate[] {
  const { at, radiusMm: r, lineWidthMm: lw } = circle;
  const reach = r + lw / 2 + prepared.maxHalfWidth + margin;
  const cell = DETAIL_GAP_LIMITS.cellMm;
  const byFeature = new Map<number, number[]>();
  const seen = new Set<number>();
  for (let cx = Math.floor((at.x - reach) / cell); cx <= Math.floor((at.x + reach) / cell); cx++) {
    for (let cy = Math.floor((at.y - reach) / cell); cy <= Math.floor((at.y + reach) / cell); cy++) {
      for (const s of prepared.grid.get(cellKey(cx, cy)) ?? []) {
        if (seen.has(s)) continue;
        seen.add(s);
        // Bara sträckor som når ringens linje (avståndet till mitten mellan r − bredd och r + bredd).
        const near = segmentDistance(at.x, at.y, prepared.segments, s);
        const feature = prepared.features[prepared.segmentFeature[s]!]!;
        const band = lw / 2 + feature.halfWidth + margin;
        if (near > r + band) continue;
        const ax = prepared.segments[4 * s]! - at.x, ay = prepared.segments[4 * s + 1]! - at.y;
        const bx = prepared.segments[4 * s + 2]! - at.x, by = prepared.segments[4 * s + 3]! - at.y;
        if (Math.max(Math.hypot(ax, ay), Math.hypot(bx, by)) < r - band) continue;
        const owner = prepared.segmentFeature[s]!;
        const list = byFeature.get(owner);
        if (list) list.push(s); else byFeature.set(owner, [s]);
      }
    }
  }
  const step = DETAIL_GAP_LIMITS.sampleDegrees;
  const n = Math.round(360 / step);
  const out: Candidate[] = [];
  // Ringens linje provas vid inner- och ytterkanten och mitten: gapet ska nå så långt att hela linjebredden går fri.
  const radii = [r - lw / 2, r, r + lw / 2];
  for (const [owner, segments] of byFeature) {
    const feature = prepared.features[owner]!;
    const clear = feature.halfWidth + margin;
    const blocked = new Uint8Array(n);
    for (const s of segments) {
      for (const i of sampleRange(prepared.segments, s, at, clear, r - lw / 2, step, n)) {
        if (blocked[i]) continue;
        const a = i * step * Math.PI / 180;
        const cos = Math.cos(a), sin = Math.sin(a);
        if (radii.some(radius => segmentDistance(at.x + radius * cos, at.y + radius * sin, prepared.segments, s) < clear)) blocked[i] = 1;
      }
    }
    // Ett vinkelrätt korsande objekt täcker 2 · (halva bredden + marginalen) av ringen; längre = snettare.
    const perpendicular = 2 * clear / r * 180 / Math.PI;
    for (const arc of arcsFromSamples(blocked, step)) {
      const length = arc.endDegrees - arc.startDegrees;
      const straightness = Math.min(1, perpendicular / Math.max(length, 1e-9));
      if (straightness < 1 / DETAIL_GAP_LIMITS.maxObliqueness) continue;
      out.push({ ...arc, weight: feature.weight, straightness });
    }
  }
  return out;
}

/** Välj gap inom budgeten: viktigast först, sedan mest vinkelrätt; korta bitar mellan gap tas bort; inte vid sträckorna. */
function choose(candidates: readonly Candidate[], circle: DetailCircle, maxFraction: number): Arc[] {
  const sorted = [...candidates].sort((a, b) => b.weight - a.weight || b.straightness - a.straightness ||
    (a.endDegrees - a.startDegrees) - (b.endDegrees - b.startDegrees) || a.startDegrees - b.startDegrees);
  const r = circle.radiusMm;
  const minPiece = DETAIL_GAP_LIMITS.minPieceLineWidths * circle.lineWidthMm / r * 180 / Math.PI;
  // Sträckans linje är lika bred som ringens; ett gap som når in i den gör ingen nytta.
  const legMargin = circle.lineWidthMm / r * 180 / Math.PI;
  const budget = 360 * maxFraction;
  let chosen: Arc[] = [];
  for (const candidate of sorted) {
    const next = mergeClose([...chosen, { startDegrees: candidate.startDegrees, endDegrees: candidate.endDegrees }], minPiece);
    if (totalDegrees(next) > budget + 1e-9) continue;
    if ((circle.blockedDegrees ?? []).some(angle => next.some(arc => arcContains(arc, angle, legMargin)))) continue;
    chosen = next;
  }
  return chosen;
}

/**
 * Gapen per ring där ringen täcker viktiga detaljer i kartan (grader moturs från x-axeln, start i [0, 360)). Ringar
 * utan gap finns inte med.
 */
export function computeDetailCircleGaps(map: ParsedMap, circles: readonly DetailCircle[], options: DetailGapOptions = {}): Record<string, Arc[]> {
  const prepared = prepare(map, options);
  const margin = options.marginMm ?? DETAIL_GAP_LIMITS.marginMm;
  const maxFraction = options.maxFraction ?? DETAIL_GAP_LIMITS.maxFraction;
  const out: Record<string, Arc[]> = {};
  for (const circle of circles) {
    if (!(circle.radiusMm > 0) || !Number.isFinite(circle.at.x) || !Number.isFinite(circle.at.y)) continue;
    const gaps = choose(candidates(prepared, circle, margin), circle, maxFraction);
    if (gaps.length > 0) out[circle.id] = gaps;
  }
  return out;
}
