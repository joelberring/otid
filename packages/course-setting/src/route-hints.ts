import type { Point } from "@o-tid/map-file";
import { CourseSettingEditError, type CourseSettingDocument, type RouteHint } from "./types";

/**
 * Ägaren 2026-11-08: kontrollnumren ska inte ligga på de vägar löparna troligen tar. Vägvalsanalysen (webbläsarens Worker)
 * ger bästa vägen och tydliga alternativ per sträcka; bara delarna nära kontrollerna sparas i dokumentet (så att PDF:en på
 * servern placerar numren som förhandsvisningen). En väg gäller bara så länge båda kontrollerna står kvar där vägen räknades.
 */
export const ROUTE_HINT_LIMITS = { hints: 3000, lines: 5, points: 400, reachMm: 20 } as const;
/** Hur nära (mm) vägens ände måste vara en kontroll för att vägen ska gälla. */
const SAME_PLACE_MM = 0.05;
/** Förenklingen av vägarna (mm): fint nog för att se om en siffra står på vägen. */
const SIMPLIFY_MM = 0.15;

const round = (value: number) => Math.round(value * 100) / 100;
export const routeHintKey = (from: Point, to: Point) => `${from.x.toFixed(1)},${from.y.toFixed(1)}>${to.x.toFixed(1)},${to.y.toFixed(1)}`;

function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return [...points];
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    const a = points[start]!, b = points[end]!;
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    let worst = -1, distance = 0;
    for (let index = start + 1; index < end; index++) {
      const p = points[index]!;
      const d = length === 0 ? Math.hypot(p.x - a.x, p.y - a.y) : Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / length;
      if (d > distance) { distance = d; worst = index; }
    }
    if (worst >= 0 && distance > tolerance) { keep[worst] = true; stack.push([start, worst], [worst, end]); }
  }
  return points.filter((_, index) => keep[index]);
}

/** Vägarnas delar inom `reachMm` från start- eller slutkontrollen, förenklade. Undefined om inget finns nära. */
export function routeHintOf(routes: readonly (readonly Point[])[], reachMm: number = ROUTE_HINT_LIMITS.reachMm): RouteHint | undefined {
  const best = routes[0];
  if (!best || best.length < 2) return undefined;
  const from = best[0]!, to = best[best.length - 1]!;
  const near = (point: Point) => Math.hypot(point.x - from.x, point.y - from.y) <= reachMm || Math.hypot(point.x - to.x, point.y - to.y) <= reachMm;
  const lines: Point[][] = [];
  for (const route of routes.slice(0, ROUTE_HINT_LIMITS.lines)) {
    let current: Point[] = [];
    for (const point of route) {
      if (near(point)) current.push({ x: round(point.x), y: round(point.y) });
      else if (current.length > 0) { if (current.length >= 2) lines.push(simplify(current, SIMPLIFY_MM)); current = []; }
    }
    if (current.length >= 2) lines.push(simplify(current, SIMPLIFY_MM));
  }
  const total = lines.reduce((sum, line) => sum + line.length, 0);
  if (lines.length === 0 || total > ROUTE_HINT_LIMITS.points) return lines.length === 0 ? undefined
    : { from, to, lines: lines.map(line => simplify(line, SIMPLIFY_MM * 4)).slice(0, ROUTE_HINT_LIMITS.lines * 2) };
  return { from: { x: round(from.x), y: round(from.y) }, to: { x: round(to.x), y: round(to.y) }, lines };
}

const finitePoint = (point: unknown): point is Point => typeof point === "object" && point !== null &&
  Number.isFinite((point as Point).x) && Number.isFinite((point as Point).y) && Math.abs((point as Point).x) < 1e6 && Math.abs((point as Point).y) < 1e6;

/** `SET_ROUTE_HINTS`: vägarna sätts eller tas bort per nyckel; övriga står kvar. */
export function setRouteHints(document: CourseSettingDocument, hints: Readonly<Record<string, RouteHint | null>>): CourseSettingDocument {
  const next: Record<string, RouteHint> = { ...(document.event.routeHints ?? {}) };
  for (const [key, hint] of Object.entries(hints)) {
    if (key.length > 80) throw new CourseSettingEditError("INVALID", "Vägens nyckel är fel");
    if (hint === null) { delete next[key]; continue; }
    const lines: readonly (readonly Point[])[] = Array.isArray(hint.lines) ? hint.lines : [];
    if (!finitePoint(hint.from) || !finitePoint(hint.to) || !Array.isArray(hint.lines) || lines.length > ROUTE_HINT_LIMITS.lines * 2 ||
      lines.some(line => !Array.isArray(line) || line.length < 2 || !line.every(finitePoint)) ||
      lines.reduce((sum: number, line) => sum + line.length, 0) > ROUTE_HINT_LIMITS.points) {
      throw new CourseSettingEditError("INVALID", "Vägvalens vägar är fel");
    }
    next[key] = { from: { x: hint.from.x, y: hint.from.y }, to: { x: hint.to.x, y: hint.to.y },
      lines: lines.map(line => line.map(point => ({ x: point.x, y: point.y }))) };
  }
  const keys = Object.keys(next);
  // För många: de äldsta (först i ordningen) tas bort.
  for (const key of keys.slice(0, Math.max(0, keys.length - ROUTE_HINT_LIMITS.hints))) delete next[key];
  const event = { ...document.event };
  delete event.routeHints;
  return { ...document, event: Object.keys(next).length > 0 ? { ...event, routeHints: next } : event };
}

/**
 * Vägarnas sträckor nära en punkt (kartans mm), bara från vägar vars båda ändar står på en kontroll i dokumentet (en flyttad
 * kontroll gör vägen ogiltig tills den räknats igen).
 */
export function routeSegmentsNear(document: CourseSettingDocument, at: Point, reachMm: number = ROUTE_HINT_LIMITS.reachMm,
  keys?: ReadonlySet<string>): Point[][] {
  const hints = document.event.routeHints;
  if (!hints || keys?.size === 0) return [];
  const places = Object.values(document.controls).map(control => control.at);
  const onControl = (point: Point) => places.some(place => Math.abs(place.x - point.x) <= SAME_PLACE_MM && Math.abs(place.y - point.y) <= SAME_PLACE_MM);
  const out: Point[][] = [];
  for (const [key, hint] of Object.entries(hints)) {
    if (keys && !keys.has(key)) continue;
    if (Math.hypot(hint.from.x - at.x, hint.from.y - at.y) > reachMm * 3 && Math.hypot(hint.to.x - at.x, hint.to.y - at.y) > reachMm * 3) continue;
    if (!onControl(hint.from) || !onControl(hint.to)) continue;
    for (const line of hint.lines) if (line.some(point => Math.hypot(point.x - at.x, point.y - at.y) <= reachMm)) out.push([...line]);
  }
  return out;
}
