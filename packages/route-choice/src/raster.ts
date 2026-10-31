/**
 * Steg 60 (ADR-0179 beslut 8): rutnätet för en sträcka. Rad 0 är överst (största y), som korridorens mask.
 *
 * Varje cell får en klass: ej passerbart överst (utom där en genomgång/passage öppnar), sedan vägar och stigar som ett
 * snabbt lager ovanpå marken (den snabbaste av stig och mark gäller), och för marken den långsammaste ytan som täcker
 * cellen. Vatten och opasserbar sankmark spärrar men kan korsas av vägar och broar. Ytor fylls med cellens mittpunkt
 * (jämn–udda, så hål respekteras). Linjer läggs in med sin bredd och alltid med alla celler som mittlinjen passerar
 * (4-sammanhängande), så att en ej passerbar linje aldrig läcker diagonalt. Höjdkurvorna blir ett eget lager.
 */
import type { Point } from "@o-tid/map-file";
import { RUNNABLE_CLASSES, type RunnableClass } from "./defaults";
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
}

/** Tak för antalet celler; större rutnät får grövre celler. */
export const MAX_CELLS = 4_000_000;
/** Kartor i skala mindre än 1:7 500 räknas som sprint (0,5 m celler), annars 2 m. */
export const SPRINT_SCALE_LIMIT = 7500;
export const MIN_MARGIN_METERS = 300;

export interface GridFrame { readonly x0: number; readonly yTop: number; readonly cellMm: number; readonly cellMeters: number; readonly width: number; readonly height: number }

/** Rutnätets läge och storlek för en sträcka: sträckans ruta plus marginal (minst 300 m och 20 % av sträckan). */
export function legFrame(from: Point, to: Point, scale: number, maxCells = MAX_CELLS): GridFrame {
  const mmPerMeter = 1000 / scale;
  const legMeters = Math.hypot(to.x - from.x, to.y - from.y) / mmPerMeter;
  const margin = Math.max(MIN_MARGIN_METERS, 0.2 * legMeters) * mmPerMeter;
  const minX = Math.min(from.x, to.x) - margin, maxX = Math.max(from.x, to.x) + margin;
  const minY = Math.min(from.y, to.y) - margin, maxY = Math.max(from.y, to.y) + margin;
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
      const first = Math.max(rowFrom, Math.ceil((frame.yTop - high) / frame.cellMm - 0.5));
      const last = Math.min(rowTo, Math.floor((frame.yTop - low) / frame.cellMm - 0.5));
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

/** Celler vars mitt ligger inom `r` mm från sträckan a–b. */
function disc(frame: GridFrame, a: Point, b: Point, r: number, visit: Visit): void {
  const colFrom = Math.max(0, Math.floor((Math.min(a.x, b.x) - r - frame.x0) / frame.cellMm));
  const colTo = Math.min(frame.width - 1, Math.floor((Math.max(a.x, b.x) + r - frame.x0) / frame.cellMm));
  const rowFrom = Math.max(0, Math.floor((frame.yTop - Math.max(a.y, b.y) - r) / frame.cellMm));
  const rowTo = Math.min(frame.height - 1, Math.floor((frame.yTop - Math.min(a.y, b.y) + r) / frame.cellMm));
  const dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy, r2 = r * r;
  for (let row = rowFrom; row <= rowTo; row += 1) {
    const y = frame.yTop - (row + 0.5) * frame.cellMm;
    for (let col = colFrom; col <= colTo; col += 1) {
      const x = frame.x0 + (col + 0.5) * frame.cellMm;
      const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSquared)) : 0;
      const ex = x - (a.x + t * dx), ey = y - (a.y + t * dy);
      if (ex * ex + ey * ey <= r2) visit(row * frame.width + col);
    }
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

/** Genomgångar och passager öppnar minst 0,4 mm runt sig, så att hela staketets eller murens bredd öppnas. */
function paintCrossing(frame: GridFrame, feature: Feature, visit: Visit): void {
  for (const polygon of feature.polygons) fillPolygon(frame, polygon, visit);
  for (const line of feature.lines) strokeLine(frame, line, Math.max(feature.radius, 0.4), visit);
}

/** Rutnätet för ramen ur den förberedda modellen; farterna avgör vilken klass som är långsammast/snabbast. */
export function rasterize(model: PreparedModel, frame: GridFrame, speeds: Readonly<Record<RunnableClass, number>>): Grid {
  const cells = frame.width * frame.height;
  const area = new Uint8Array(cells).fill(NONE);
  const track = new Uint8Array(cells).fill(NONE);
  /** Bitar: 1 = spärr, 2 = vatten, 4 = genomgång. */
  const block = new Uint8Array(cells);
  const contour = new Uint8Array(cells);
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
        paint(frame, feature, index => { const old = track[index]!; if (old === NONE || speedOf[old]! < speed) track[index] = cls; });
        break;
      }
      case "BLOCK": paint(frame, feature, index => { block[index] = block[index]! | 1; }); break;
      case "WATER": paint(frame, feature, index => { block[index] = block[index]! | 2; }); break;
      case "CROSSING": paintCrossing(frame, feature, index => { block[index] = block[index]! | 4; }); break;
      case "CONTOUR": paintContour(frame, feature, index => { contour[index] = 2; }); break;
      case "FORM_LINE": paintContour(frame, feature, index => { if (contour[index] === 0) contour[index] = 1; }); break;
    }
  }
  const normal = RUNNABLE_CLASSES.indexOf("NORMAL");
  const ground = area;
  for (let index = 0; index < cells; index += 1) {
    const bits = block[index]!;
    const open = (bits & 4) !== 0;
    if ((bits & 1) !== 0 && !open) { ground[index] = BLOCKED; track[index] = NONE; continue; }
    // Vatten och opasserbar sankmark: bara vägar, broar och passager går över.
    if ((bits & 2) !== 0 && !open) ground[index] = BLOCKED;
    else if (ground[index] === NONE) ground[index] = normal;
  }
  return { ...frame, ground, track, contour };
}

/**
 * Tid per meter (relativt normal skog) per cell med farterna: den snabbaste av stig och mark, `Infinity` för spärrat.
 * Görs om för varje uppsättning farter (osäkerheten) utan att rastrera om.
 */
export function paceField(grid: Grid, speeds: Readonly<Record<RunnableClass, number>>): Float32Array {
  const pace = RUNNABLE_CLASSES.map(cls => 1 / speeds[cls]);
  const out = new Float32Array(grid.ground.length);
  for (let index = 0; index < out.length; index += 1) {
    const g = grid.ground[index]!, t = grid.track[index]!;
    const pg = g === BLOCKED ? Infinity : pace[g]!;
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
