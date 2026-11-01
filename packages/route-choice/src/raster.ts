/**
 * Steg 60 (ADR-0179 beslut 8): rutnätet för en sträcka. Rad 0 är överst (största y), som korridorens mask.
 *
 * Varje cell får en klass: ej passerbart överst (utom där en genomgång/passage öppnar), sedan vägar och stigar som ett
 * snabbt lager ovanpå marken (den snabbaste av stig och mark gäller), och för marken den långsammaste ytan som täcker
 * cellen. Vatten och opasserbar sankmark spärrar men kan korsas av vägar och broar. Ytor fylls med cellens mittpunkt
 * (jämn–udda, så hål respekteras). Linjer läggs in med sin bredd och alltid med alla celler som mittlinjen passerar
 * (4-sammanhängande), så att en ej passerbar linje aldrig läcker diagonalt. Höjdkurvorna blir ett eget lager, och
 * linjer som går att passera men kostar (202 brant, staket …) ett till. Ur höjdkurvorna räknas också lutningen per cell
 * (`steep`, en gång per rutnät): kurvlängd per ytenhet gånger ekvidistansen, se `slopeField`.
 */
import type { Point } from "@o-tid/map-file";
import { FORM_LINE_WEIGHT, RUNNABLE_CLASSES, SLOPE_RADIUS_METERS, slopeExcess, type RunnableClass } from "./defaults";
import type { Feature, PreparedModel } from "./cost-model";

/** Klassindex i rutnätet: 0–4 = `RUNNABLE_CLASSES`, 5 = spärrad. */
export const BLOCKED = 5;
export const NO_TRACK = 255;
const NONE = NO_TRACK;

export interface Grid {
  /** Vänstra kanten och övre kanten i kartans mm. */
  readonly x0: number;
  readonly yTop: number;
  readonly cellMm: number;
  readonly cellMeters: number;
  readonly width: number;
  readonly height: number;
  /** Markens klass per cell (index i `RUNNABLE_CLASSES`, eller `BLOCKED`). */
  readonly ground: Uint8Array;
  /** Vägens eller stigens klass per cell, eller `NO_TRACK`. */
  readonly track: Uint8Array;
  /** Höjdkurvor: 2 = höjd- eller stödkurva, 1 = hjälpkurva, 0 = ingen. */
  readonly contour: Uint8Array;
  /**
   * Linjer som kostar per passage (meter plan väg, 0 = ingen). Ett steg kostar halva skillnaden mellan cellerna, så en
   * passage (in och ut) kostar hela värdet. 0 där en väg eller stig går.
   */
  readonly barrier: Uint8Array;
  /** Lutningens tillägg på tiden per meter i marken, utan styrkan (`slopeExcess` av den skattade lutningen). */
  readonly steep: Float32Array;
}

/** Tak för antalet celler; större rutnät får grövre celler. */
export const MAX_CELLS = 4_000_000;
/** Kartor i skala mindre än 1:7 500 räknas som sprint (0,5 m celler), annars 2 m. */
export const SPRINT_SCALE_LIMIT = 7500;
export const MIN_MARGIN_METERS = 300;

export interface GridFrame { readonly x0: number; readonly yTop: number; readonly cellMm: number; readonly cellMeters: number; readonly width: number; readonly height: number }

/**
 * Rutnätets läge och storlek för en sträcka: sträckans ruta plus marginal (minst 300 m och 20 % av sträckan), gånger
 * `marginFactor` när analysen behöver mer plats (vägen saknas eller går längs ramen).
 */
export function legFrame(from: Point, to: Point, scale: number, maxCells = MAX_CELLS, marginFactor = 1): GridFrame {
  const mmPerMeter = 1000 / scale;
  const legMeters = Math.hypot(to.x - from.x, to.y - from.y) / mmPerMeter;
  const margin = Math.max(MIN_MARGIN_METERS, 0.2 * legMeters) * marginFactor * mmPerMeter;
  return boxFrame({ minX: Math.min(from.x, to.x) - margin, maxX: Math.max(from.x, to.x) + margin,
    minY: Math.min(from.y, to.y) - margin, maxY: Math.max(from.y, to.y) + margin }, scale, maxCells);
}

/** Rutnät över rutan (kartans mm) med cellstorleken för skalan, grövre om det skulle bli fler än `maxCells` celler. */
export function boxFrame(box: { minX: number; minY: number; maxX: number; maxY: number }, scale: number, maxCells = MAX_CELLS): GridFrame {
  const mmPerMeter = 1000 / scale;
  const { minX, minY, maxX, maxY } = box;
  let cellMeters = scale < SPRINT_SCALE_LIMIT ? 0.5 : 2;
  let cellMm = cellMeters * mmPerMeter;
  let width = Math.ceil((maxX - minX) / cellMm), height = Math.ceil((maxY - minY) / cellMm);
  if (width * height > maxCells) {
    cellMeters *= Math.sqrt((width * height) / maxCells) * 1.001;
    cellMm = cellMeters * mmPerMeter;
    width = Math.ceil((maxX - minX) / cellMm);
    height = Math.ceil((maxY - minY) / cellMm);
  }
  return { x0: minX, yTop: maxY, cellMm, cellMeters, width, height };
}

export function cellOf(frame: GridFrame, p: Point): { col: number; row: number } {
  return { col: Math.floor((p.x - frame.x0) / frame.cellMm), row: Math.floor((frame.yTop - p.y) / frame.cellMm) };
}

export function cellCenter(frame: GridFrame, index: number): Point {
  const col = index % frame.width, row = (index - col) / frame.width;
  return { x: frame.x0 + (col + 0.5) * frame.cellMm, y: frame.yTop - (row + 0.5) * frame.cellMm };
}

type Visit = (index: number) => void;

/** Fyller polygonen (alla ringar, jämn–udda) med cellernas mittpunkter. */
export function fillPolygon(frame: GridFrame, rings: readonly (readonly Point[])[], visit: Visit): void {
  let minY = Infinity, maxY = -Infinity;
  for (const ring of rings) for (const p of ring) { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  const rowFrom = Math.max(0, Math.ceil((frame.yTop - maxY) / frame.cellMm - 0.5));
  const rowTo = Math.min(frame.height - 1, Math.floor((frame.yTop - minY) / frame.cellMm - 0.5));
  if (rowTo < rowFrom) return;
  const crossings: number[][] = Array.from({ length: rowTo - rowFrom + 1 }, () => []);
  for (const ring of rings) {
    for (let index = 0; index < ring.length; index += 1) {
      const p = ring[index]!, q = ring[(index + 1) % ring.length]!;
      if (p.y === q.y) continue;
      const low = Math.min(p.y, q.y), high = Math.max(p.y, q.y);
      // En rad för mycket åt varje håll: avrundningen får inte tappa en rad, villkoret nedan avgör.
      const first = Math.max(rowFrom, Math.ceil((frame.yTop - high) / frame.cellMm - 0.5) - 1);
      const last = Math.min(rowTo, Math.floor((frame.yTop - low) / frame.cellMm - 0.5) + 1);
      for (let row = first; row <= last; row += 1) {
        const y = frame.yTop - (row + 0.5) * frame.cellMm;
        if (y < low || y >= high) continue;
        crossings[row - rowFrom]!.push(p.x + ((y - p.y) * (q.x - p.x)) / (q.y - p.y));
      }
    }
  }
  for (let offset = 0; offset < crossings.length; offset += 1) {
    const xs = crossings[offset]!;
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    const base = (rowFrom + offset) * frame.width;
    for (let pair = 0; pair + 1 < xs.length; pair += 2) {
      const colFrom = Math.max(0, Math.ceil((xs[pair]! - frame.x0) / frame.cellMm - 0.5));
      const colTo = Math.min(frame.width - 1, Math.ceil((xs[pair + 1]! - frame.x0) / frame.cellMm - 0.5) - 1);
      for (let col = colFrom; col <= colTo; col += 1) visit(base + col);
    }
  }
}

/** Alla celler som sträckan a–b passerar (stegvis i x eller y, så att resultatet är 4-sammanhängande). */
function traverse(frame: GridFrame, a: Point, b: Point, visit: Visit): void {
  const ax = (a.x - frame.x0) / frame.cellMm, ay = (frame.yTop - a.y) / frame.cellMm;
  const bx = (b.x - frame.x0) / frame.cellMm, by = (frame.yTop - b.y) / frame.cellMm;
  let col = Math.floor(ax), row = Math.floor(ay);
  const endCol = Math.floor(bx), endRow = Math.floor(by);
  const dx = bx - ax, dy = by - ay;
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity, tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? col + 1 - ax : ax - col) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? row + 1 - ay : ay - row) * tDeltaY : Infinity;
  const put = () => { if (col >= 0 && row >= 0 && col < frame.width && row < frame.height) visit(row * frame.width + col); };
  put();
  for (let guard = Math.abs(endCol - col) + Math.abs(endRow - row) + 2; guard > 0 && (col !== endCol || row !== endRow); guard -= 1) {
    if (tMaxX <= tMaxY) { col += stepX; tMaxX += tDeltaX; } else { row += stepY; tMaxY += tDeltaY; }
    put();
  }
}

/** Linjen med halva bredden `radius` mm: alla celler vars mitt ligger inom radien, plus mittlinjens celler. */
export function strokeLine(frame: GridFrame, points: readonly Point[], radius: number, visit: Visit): void {
  if (points.length === 0) return;
  const r = Math.max(0, radius);
  const wide = r > frame.cellMm * 0.5;
  if (points.length === 1) {
    const p = points[0]!;
    traverse(frame, p, p, visit);
    if (wide) disc(frame, p, p, r, visit);
    return;
  }
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!, b = points[index]!;
    traverse(frame, a, b, visit);
    if (wide) disc(frame, a, b, r, visit);
  }
}

/**
 * Celler vars mitt ligger inom `r` mm från sträckan a–b (en kapsel). Kapseln är konvex, så varje rad är ett intervall:
 * unionen av rektangeln längs sträckan och de två ändcirklarna. Kostar bara de celler som täcks, inte hela rutan.
 */
function disc(frame: GridFrame, a: Point, b: Point, r: number, visit: Visit): void {
  const rowFrom = Math.max(0, Math.floor((frame.yTop - Math.max(a.y, b.y) - r) / frame.cellMm));
  const rowTo = Math.min(frame.height - 1, Math.floor((frame.yTop - Math.min(a.y, b.y) + r) / frame.cellMm));
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
  const nx = length > 0 ? -dy / length : 0, ny = length > 0 ? dx / length : 0;
  const nDotA = nx * a.x + ny * a.y, dDotA = dx * a.x + dy * a.y, lengthSquared = length * length;
  for (let row = rowFrom; row <= rowTo; row += 1) {
    const y = frame.yTop - (row + 0.5) * frame.cellMm;
    let low = Infinity, high = -Infinity;
    for (const end of [a, b]) {
      const ey = y - end.y;
      if (Math.abs(ey) <= r) { const half = Math.sqrt(r * r - ey * ey); low = Math.min(low, end.x - half); high = Math.max(high, end.x + half); }
    }
    if (length > 0) {
      // Rektangeln: fyra halvplan c0 + c1·x ≤ 0.
      let from = -Infinity, to = Infinity;
      const clip = (c0: number, c1: number) => {
        if (Math.abs(c1) < 1e-12) { if (c0 > 0) { from = Infinity; to = -Infinity; } return; }
        const x = -c0 / c1;
        if (c1 > 0) to = Math.min(to, x); else from = Math.max(from, x);
      };
      clip(ny * y - nDotA - r, nx);
      clip(-ny * y + nDotA - r, -nx);
      clip(-dy * y + dDotA, -dx);
      clip(dy * y - dDotA - lengthSquared, dx);
      if (from <= to) { low = Math.min(low, from); high = Math.max(high, to); }
    }
    if (low > high) continue;
    const colFrom = Math.max(0, Math.ceil((low - frame.x0) / frame.cellMm - 0.5));
    const colTo = Math.min(frame.width - 1, Math.floor((high - frame.x0) / frame.cellMm - 0.5));
    const base = row * frame.width;
    for (let col = colFrom; col <= colTo; col += 1) visit(base + col);
  }
}

function intersects(frame: GridFrame, feature: Feature): boolean {
  const box = feature.box;
  return box.maxX >= frame.x0 && box.minX <= frame.x0 + frame.width * frame.cellMm &&
    box.minY <= frame.yTop && box.maxY >= frame.yTop - frame.height * frame.cellMm;
}

function paint(frame: GridFrame, feature: Feature, visit: Visit): void {
  for (const polygon of feature.polygons) fillPolygon(frame, polygon, visit);
  for (const line of feature.lines) strokeLine(frame, line, feature.radius, visit);
}

/**
 * Höjdkurvor rastreras minst 1,5 cell breda, så att varje steg mellan grannar (även diagonalt) måste gå in i kurvan och
 * passagen kan räknas.
 */
function paintContour(frame: GridFrame, feature: Feature, visit: Visit): void {
  for (const line of feature.lines) strokeLine(frame, line, Math.max(feature.radius, frame.cellMm * 0.75), visit);
}

/**
 * Kurvlängden (meter, gånger `weight`) läggs i cellen där varje bit av linjen ligger, bitar högst en cell långa: en tunn
 * rastrering som mäter längden lika i alla riktningar.
 */
function addLength(frame: GridFrame, line: readonly Point[], weight: number, length: Float32Array): void {
  const metersPerMm = frame.cellMeters / frame.cellMm;
  for (let index = 1; index < line.length; index += 1) {
    const a = line[index - 1]!, b = line[index]!;
    const mm = Math.hypot(b.x - a.x, b.y - a.y);
    if (mm === 0) continue;
    const pieces = Math.ceil(mm / frame.cellMm);
    const piece = mm / pieces * metersPerMm * weight;
    for (let k = 0; k < pieces; k += 1) {
      const t = (k + 0.5) / pieces;
      const col = Math.floor((a.x + (b.x - a.x) * t - frame.x0) / frame.cellMm);
      const row = Math.floor((frame.yTop - (a.y + (b.y - a.y) * t)) / frame.cellMm);
      if (col >= 0 && row >= 0 && col < frame.width && row < frame.height) length[row * frame.width + col]! += piece;
    }
  }
}

/**
 * Lutningen per cell ur kurvlängden: parallella kurvor med avståndet w meter har längden 1/w per kvadratmeter, och
 * lutningen är ekvidistansen / w. Längden summeras i en kvadrat med radien `SLOPE_RADIUS_METERS` (lådfilter med en
 * integralbild, så att kostnaden inte beror på radien) och delas med kvadratens yta inom rutnätet. Ut: `slopeExcess` av
 * lutningen, som tidstillägg utan styrkan.
 */
export function slopeField(frame: GridFrame, length: Float32Array, contourIntervalMeters: number): Float32Array {
  const w = frame.width, h = frame.height, stride = w + 1;
  const sum = new Float64Array(stride * (h + 1));
  for (let row = 0; row < h; row += 1) {
    let line = 0;
    const base = (row + 1) * stride, above = row * stride, cells = row * w;
    for (let col = 0; col < w; col += 1) {
      line += length[cells + col]!;
      sum[base + col + 1] = sum[above + col + 1]! + line;
    }
  }
  const r = Math.max(1, Math.round(SLOPE_RADIUS_METERS / frame.cellMeters));
  const cellArea = frame.cellMeters * frame.cellMeters;
  const out = new Float32Array(w * h);
  for (let row = 0; row < h; row += 1) {
    const top = Math.max(0, row - r), bottom = Math.min(h, row + r + 1);
    for (let col = 0; col < w; col += 1) {
      const left = Math.max(0, col - r), right = Math.min(w, col + r + 1);
      const total = sum[bottom * stride + right]! - sum[top * stride + right]! - sum[bottom * stride + left]! + sum[top * stride + left]!;
      if (total <= 0) continue;
      const grade = contourIntervalMeters * total / ((bottom - top) * (right - left) * cellArea);
      out[row * w + col] = slopeExcess(grade);
    }
  }
  return out;
}

/** Genomgångar och passager öppnar minst 0,4 mm runt sig, så att hela staketets eller murens bredd öppnas. */
function paintCrossing(frame: GridFrame, feature: Feature, visit: Visit): void {
  for (const polygon of feature.polygons) fillPolygon(frame, polygon, visit);
  for (const line of feature.lines) strokeLine(frame, line, Math.max(feature.radius, 0.4), visit);
}

/**
 * Rutnätet för ramen ur den förberedda modellen; farterna avgör vilken klass som är långsammast/snabbast.
 * `trackRadiusMm` breddar vägar och stigar (kalibreringen, där GPS-spåret sällan ligger exakt på stigen).
 */
export function rasterize(model: PreparedModel, frame: GridFrame, speeds: Readonly<Record<RunnableClass, number>>,
  options: { readonly trackRadiusMm?: number; readonly contourIntervalMeters?: number } = {}): Grid {
  const trackRadius = options.trackRadiusMm ?? 0;
  const cells = frame.width * frame.height;
  const area = new Uint8Array(cells).fill(NONE);
  const track = new Uint8Array(cells).fill(NONE);
  /** Bitar: 1 = spärr, 2 = vatten, 4 = genomgång. */
  const block = new Uint8Array(cells);
  const contour = new Uint8Array(cells);
  const barrier = new Uint8Array(cells);
  const length = new Float32Array(cells);
  const speedOf = RUNNABLE_CLASSES.map(cls => speeds[cls]);
  for (const feature of model.features) {
    if (!intersects(frame, feature)) continue;
    switch (feature.layer) {
      case "AREA": {
        const cls = RUNNABLE_CLASSES.indexOf(feature.cls), speed = speedOf[cls]!;
        paint(frame, feature, index => { const old = area[index]!; if (old === NONE || speedOf[old]! > speed) area[index] = cls; });
        break;
      }
      case "TRACK": {
        const cls = RUNNABLE_CLASSES.indexOf(feature.cls), speed = speedOf[cls]!;
        const visit = (index: number) => { const old = track[index]!; if (old === NONE || speedOf[old]! < speed) track[index] = cls; };
        for (const polygon of feature.polygons) fillPolygon(frame, polygon, visit);
        for (const line of feature.lines) strokeLine(frame, line, Math.max(feature.radius, trackRadius), visit);
        break;
      }
      case "BLOCK": paint(frame, feature, index => { block[index] = block[index]! | 1; }); break;
      case "WATER": paint(frame, feature, index => { block[index] = block[index]! | 2; }); break;
      case "CROSSING": paintCrossing(frame, feature, index => { block[index] = block[index]! | 4; }); break;
      case "CONTOUR":
        paintContour(frame, feature, index => { contour[index] = 2; });
        for (const line of feature.lines) addLength(frame, line, 1, length);
        break;
      case "FORM_LINE":
        paintContour(frame, feature, index => { if (contour[index] === 0) contour[index] = 1; });
        for (const line of feature.lines) addLength(frame, line, FORM_LINE_WEIGHT, length);
        break;
      case "BARRIER": {
        // Som höjdkurvorna minst 1,5 cell breda, så att ingen passage smiter förbi diagonalt.
        const value = Math.min(255, Math.round(feature.crossing ?? 0));
        const visit = (index: number) => { if (barrier[index]! < value) barrier[index] = value; };
        paintContour(frame, feature, visit);
        for (const polygon of feature.polygons) for (const ring of polygon) strokeLine(frame, ring, Math.max(feature.radius, frame.cellMm * 0.75), visit);
        break;
      }
    }
  }
  // Utanför kartans yta finns ingen karta: spärrat.
  const bounds = model.bounds;
  if (bounds) {
    for (let row = 0; row < frame.height; row += 1) {
      const y = frame.yTop - (row + 0.5) * frame.cellMm;
      const outsideRow = y < bounds.minY || y > bounds.maxY;
      for (let col = 0; col < frame.width; col += 1) {
        const x = frame.x0 + (col + 0.5) * frame.cellMm;
        if (outsideRow || x < bounds.minX || x > bounds.maxX) block[row * frame.width + col] = 1;
      }
    }
  }
  const normal = RUNNABLE_CLASSES.indexOf("NORMAL");
  const ground = area;
  for (let index = 0; index < cells; index += 1) {
    const bits = block[index]!;
    const open = (bits & 4) !== 0;
    if (track[index] !== NONE) barrier[index] = 0;
    if ((bits & 1) !== 0 && !open) { ground[index] = BLOCKED; track[index] = NONE; continue; }
    // Vatten och opasserbar sankmark: bara vägar, broar och passager går över.
    if ((bits & 2) !== 0 && !open) ground[index] = BLOCKED;
    else if (ground[index] === NONE) ground[index] = normal;
  }
  const steep = slopeField(frame, length, options.contourIntervalMeters ?? model.settings.contourIntervalMeters);
  return { ...frame, ground, track, contour, barrier, steep };
}

/**
 * Tid per meter (relativt normal skog) per cell med farterna: den snabbaste av stig och mark, `Infinity` för spärrat.
 * Marken (inte stigar och vägar) blir långsammare i brant terräng: tiden gånger 1 + `slopeFactor` × `steep`. Görs om
 * för varje uppsättning farter (osäkerheten) utan att rastrera om. Med `only` räknas bara de cellerna; resten blir
 * spärrade.
 */
export function paceField(grid: Grid, speeds: Readonly<Record<RunnableClass, number>>, slopeFactor: number, only?: Uint8Array): Float32Array {
  const pace = RUNNABLE_CLASSES.map(cls => 1 / speeds[cls]);
  const out = new Float32Array(grid.ground.length);
  const steep = grid.steep;
  for (let index = 0; index < out.length; index += 1) {
    if (only && only[index] !== 1) { out[index] = Infinity; continue; }
    const g = grid.ground[index]!, t = grid.track[index]!;
    const pg = g === BLOCKED ? Infinity : pace[g]! * (1 + slopeFactor * steep[index]!);
    const pt = t === NONE ? Infinity : pace[t]!;
    out[index] = pt < pg ? pt : pg;
  }
  return out;
}

/** Cellens klass med farterna (för bilder och kalibreringen): index i `RUNNABLE_CLASSES` eller `BLOCKED`. */
export function cellClass(grid: Grid, index: number, speeds: Readonly<Record<RunnableClass, number>>): number {
  const g = grid.ground[index]!, t = grid.track[index]!;
  if (t === NONE) return g;
  if (g === BLOCKED) return t;
  return speeds[RUNNABLE_CLASSES[t]!] >= speeds[RUNNABLE_CLASSES[g]!] ? t : g;
}
