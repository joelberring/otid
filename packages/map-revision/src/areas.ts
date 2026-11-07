import type { Point } from "@o-tid/map-file";
import type { ObjectState } from "./state";

/**
 * ADR-0219 tillägget om arbetssätt (K1): om en ändring görs direkt eller blir ett förslag avgörs bara på servern, med
 * `editRoute`. Arbetssättet är projektets (`SHARED` Gemensamt, `LEAD` Huvudkartritare) och delområdena är polygoner i kartans
 * mm med y uppåt (första ringen ytterkant, resten hål) som kan delas ut till en person.
 *
 * - Ägare (`OWNER`) ändrar alltid direkt; Föreslå (`SUGGEST`) aldrig.
 * - Ändra (`EDIT`) i Gemensamt: direkt, utom när ändringen ligger i någon annans delområde.
 * - Ändra i Huvudkartritare: direkt bara i ett eget delområde (och inte samtidigt i någon annans).
 *
 * Var ändringen ligger: alla brytpunkter och punkter i objektets nya läge och i serverns nuvarande läge (så att ett objekt inte
 * kan flyttas ut ur någon annans område direkt), annars den valfria punkten `point` på ändringen (borttagning av ett objekt som
 * servern bara har i grundfilen). En punkt i ett område räcker. Utan punkter ligger ändringen utanför alla områden.
 */
export type MapProjectMode = "SHARED" | "LEAD";
export type EditRole = "OWNER" | "EDIT" | "SUGGEST";
export type AreaPolygon = readonly (readonly Point[])[];

export interface WorkArea {
  readonly polygon: AreaPolygon;
  /** Kontot som fått området, eller null (inte utdelat). */
  readonly assigneeId: string | null;
}

/** Ett delområdes gränser: högst så många ringar och punkter per ring, minst tre punkter. */
export const AREA_LIMITS = { rings: 20, points: 2000, coordinate: 5_000_000 } as const;

/** Polygonen är giltig: 1–20 ringar med 3–2000 ändliga punkter var. Ger felet som text, eller undefined. */
export function areaPolygonProblem(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > AREA_LIMITS.rings) return "rings";
  for (const ring of value) {
    if (!Array.isArray(ring) || ring.length < 3 || ring.length > AREA_LIMITS.points) return "ring";
    for (const point of ring) {
      const { x, y } = (point ?? {}) as { x?: unknown; y?: unknown };
      if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y) ||
        Math.abs(x) > AREA_LIMITS.coordinate || Math.abs(y) > AREA_LIMITS.coordinate) return "point";
      if (Object.keys(point as object).length !== 2) return "point";
    }
  }
  return undefined;
}

/** Objektets punkter: läget för punkt och text, alla brytpunkter (inte styrpunkterna) för linje och yta. */
export function statePoints(state: ObjectState | undefined): Point[] {
  if (!state || state.kind !== "OBJECT") return [];
  const object = state.object;
  if (object.kind === "point" || object.kind === "text") return [object.at];
  const paths = object.kind === "line" ? [object.path] : object.rings;
  return paths.flatMap(path => path.map(command => ({ x: command.x, y: command.y })));
}

/** Ändringens punkter: nya läget och serverns nuvarande läge, annars `point` (se modulens kommentar). */
export function editPoints(state: ObjectState, current: ObjectState | undefined, point?: Point): Point[] {
  const points = [...statePoints(state), ...statePoints(current)];
  return points.length > 0 || !point ? points : [point];
}

interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
const boundsCache = new WeakMap<AreaPolygon, Bounds>();
function boundsOf(polygon: AreaPolygon): Bounds {
  const known = boundsCache.get(polygon);
  if (known) return known;
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const point of polygon[0] ?? []) {
    bounds.minX = Math.min(bounds.minX, point.x); bounds.maxX = Math.max(bounds.maxX, point.x);
    bounds.minY = Math.min(bounds.minY, point.y); bounds.maxY = Math.max(bounds.maxY, point.y);
  }
  boundsCache.set(polygon, bounds);
  return bounds;
}

/** Punkten ligger i polygonen (jämn–udda över alla ringar, så hålen räknas bort). En punkt på kanten kan räknas åt båda hållen. */
export function pointInPolygon(point: Point, polygon: AreaPolygon): boolean {
  const bounds = boundsOf(polygon);
  if (point.x < bounds.minX || point.x > bounds.maxX || point.y < bounds.minY || point.y > bounds.maxY) return false;
  let inside = false;
  for (const ring of polygon) {
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
      const a = ring[index]!, b = ring[previous]!;
      if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

const touches = (points: readonly Point[], area: WorkArea) => points.some(point => pointInPolygon(point, area.polygon));

/** Görs ändringen direkt (`APPLY`) eller blir den ett förslag (`PROPOSE`)? Se modulens kommentar. */
export function editRoute(input: { role: EditRole; mode: MapProjectMode; accountId: string; areas: readonly WorkArea[]; points: readonly Point[] })
  : "APPLY" | "PROPOSE" {
  if (input.role === "OWNER") return "APPLY";
  if (input.role !== "EDIT") return "PROPOSE";
  const hit = input.points.length === 0 ? [] : input.areas.filter(area => area.assigneeId !== null && touches(input.points, area));
  const others = hit.some(area => area.assigneeId !== input.accountId);
  if (others) return "PROPOSE";
  if (input.mode === "SHARED") return "APPLY";
  return hit.length > 0 ? "APPLY" : "PROPOSE";
}
