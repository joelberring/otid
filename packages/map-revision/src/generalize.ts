import type { MapObject, Path, PathCommand, Point } from "@o-tid/map-file";
import type { RevisionClientState } from "./client-log";
import { checkNorm, type NormObject, type NormRule } from "./norm-check";
import type { ObjectKey } from "./state";

/**
 * ADR-0219 K6 (del 1, ägaren 2026-11-08): generaliseringen som förslag. Två säkra steg med normens mått, som var och en ger en
 * lista med ändringar att granska innan de lämnas som förslag (inget ändras direkt):
 *
 * - **Förenkla** linjer och ytor med raka sträckor (Douglas–Peucker med toleransen i kartans mm): Karttapullautins och andra
 *   källors täta punkter blir färre utan att formen syns ändras. Kurvor (Bézier) och objekt som skulle förlora sin form
 *   lämnas orörda.
 * - **Ta bort** objekt som är mindre än normen tillåter (normkontrollens SMALL_AREA, SHORT_LINE och SMALL_CLOSED): små ytor,
 *   korta linjer och små slutna kurvor (knollar).
 *
 * Kurvavstånd, tunna ytor, passager och öppningar kräver en kartritares val och föreslås inte här.
 */
export type GeneralizeReason = "SIMPLIFY" | Extract<NormRule, "SMALL_AREA" | "SHORT_LINE" | "SMALL_CLOSED">;
export const REMOVABLE_RULES: ReadonlySet<NormRule> = new Set(["SMALL_AREA", "SHORT_LINE", "SMALL_CLOSED"]);
export interface GeneralizeOptions {
  /** Toleransen för förenklingen i kartans mm; 0 = ingen förenkling. */
  readonly simplifyMm: number;
  readonly removeSmall: boolean;
  /** Bara objekt inom rutan (kartans mm), t.ex. en etapp. */
  readonly within?: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number } | undefined;
}
export interface GeneralizeChange {
  readonly key: ObjectKey; readonly code: string; readonly reason: GeneralizeReason;
  /** Det förenklade objektet; saknas för en borttagning. */
  readonly object?: MapObject | undefined;
  /** Var ändringen är (för listan och borttagningens plats). */
  readonly at: Point;
  /** Punkter före och efter (förenklingen). */
  readonly before: number; readonly after: number;
}
export interface GeneralizeResult {
  readonly changes: readonly GeneralizeChange[];
  readonly simplified: number; readonly pointsBefore: number; readonly pointsAfter: number;
  readonly removed: Readonly<Record<"SMALL_AREA" | "SHORT_LINE" | "SMALL_CLOSED", number>>;
}

const perpendicular = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
  return length === 0 ? Math.hypot(p.x - a.x, p.y - a.y) : Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / length;
};

/** Douglas–Peucker (iterativt): punkterna som behålls, första och sista alltid. */
export function simplifyPoints(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2 || tolerance <= 0) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let worst = -1, index = -1;
    for (let i = first + 1; i < last; i += 1) {
      const distance = perpendicular(points[i]!, points[first]!, points[last]!);
      if (distance > worst) { worst = distance; index = i; }
    }
    if (worst > tolerance && index > 0) { keep[index] = 1; stack.push([first, index], [index, last]); }
  }
  return points.filter((_, i) => keep[i] === 1);
}

const isStraight = (part: Path) => part.every(command => command.type === "M" || command.type === "L");
const pointsOf = (part: Path): Point[] => part.map(command => ({ x: command.x, y: command.y }));
const pathOf = (points: readonly Point[]): PathCommand[] => points.map((point, index) => ({ type: index === 0 ? "M" : "L", x: point.x, y: point.y }));

/**
 * En ring förenklas med sin längsta diagonal som fasta punkter (en ring har ingen början). Mindre än tre punkter kvar: orörd.
 */
function simplifyRing(points: readonly Point[], tolerance: number): Point[] | undefined {
  const closed = points.length > 1 && points[0]!.x === points[points.length - 1]!.x && points[0]!.y === points[points.length - 1]!.y;
  const ring = closed ? points.slice(0, -1) : [...points];
  if (ring.length < 4) return undefined;
  let far = 0, best = -1;
  for (let i = 1; i < ring.length; i += 1) {
    const distance = Math.hypot(ring[i]!.x - ring[0]!.x, ring[i]!.y - ring[0]!.y);
    if (distance > best) { best = distance; far = i; }
  }
  const one = simplifyPoints(ring.slice(0, far + 1), tolerance);
  const two = simplifyPoints([...ring.slice(far), ring[0]!], tolerance);
  const result = [...one, ...two.slice(1, -1)];
  if (result.length < 3) return undefined;
  return closed ? [...result, result[0]!] : result;
}

/** Objektet förenklat, eller inget om inget ändras (kurvor, punkter, texter och för få punkter lämnas). */
export function simplifyObject(object: MapObject, tolerance: number): { object: MapObject; before: number; after: number } | undefined {
  if (tolerance <= 0 || (object.kind !== "line" && object.kind !== "area")) return undefined;
  const parts: Path[] = object.kind === "area" ? object.rings.map(ring => [...ring]) : splitLine(object.path);
  if (!parts.every(isStraight)) return undefined;
  let before = 0, after = 0;
  const next: Path[] = [];
  for (const part of parts) {
    const points = pointsOf(part);
    before += points.length;
    const simplified = object.kind === "area" ? simplifyRing(points, tolerance) ?? points : simplifyPoints(points, tolerance);
    after += simplified.length;
    next.push(pathOf(simplified));
  }
  if (after >= before) return undefined;
  return { object: object.kind === "area" ? { ...object, rings: next } : { ...object, path: next.flat() }, before, after };
}

function splitLine(path: Path): Path[] {
  const parts: PathCommand[][] = [];
  for (const command of path) {
    if (command.type === "M" || parts.length === 0) parts.push([command]);
    else parts[parts.length - 1]!.push(command);
  }
  return parts;
}

function centerOf(object: MapObject): Point {
  if (object.kind === "point" || object.kind === "text") return object.at;
  const points = (object.kind === "area" ? object.rings.flat() : object.path).map(command => ({ x: command.x, y: command.y }));
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

const inside = (at: Point, box: GeneralizeOptions["within"]) => !box || (at.x >= box.minX && at.x <= box.maxX && at.y >= box.minY && at.y <= box.maxY);

/** Ändringarna för kartans objekt (skalan avgör normens mått). Ett objekt får högst en ändring; borttagning går före. */
export function generalize(objects: readonly NormObject[], scale: number, options: GeneralizeOptions): GeneralizeResult {
  const changes: GeneralizeChange[] = [];
  const removed = { SMALL_AREA: 0, SHORT_LINE: 0, SMALL_CLOSED: 0 };
  const taken = new Set<ObjectKey>();
  if (options.removeSmall) {
    for (const issue of checkNorm(objects, scale).issues) {
      if (!REMOVABLE_RULES.has(issue.rule) || taken.has(issue.key) || !inside(issue.at, options.within)) continue;
      taken.add(issue.key);
      const rule = issue.rule as keyof typeof removed;
      removed[rule] += 1;
      changes.push({ key: issue.key, code: issue.code, reason: rule, at: issue.at, before: 0, after: 0 });
    }
  }
  let simplified = 0, pointsBefore = 0, pointsAfter = 0;
  if (options.simplifyMm > 0) {
    for (const row of objects) {
      if (taken.has(row.key)) continue;
      const result = simplifyObject(row.object, options.simplifyMm);
      if (!result) continue;
      const at = centerOf(row.object);
      if (!inside(at, options.within)) continue;
      simplified += 1; pointsBefore += result.before; pointsAfter += result.after;
      changes.push({ key: row.key, code: row.code, reason: "SIMPLIFY", object: result.object, at, before: result.before, after: result.after });
    }
  }
  return { changes, simplified, pointsBefore, pointsAfter, removed };
}

/**
 * Förslagets grund för objektet: serverns senaste ändring, eller inget att bygga på när objektet har egna ändringar som inte
 * skickats eller en krock (då föreslås det inte nu).
 */
export function proposalBase(state: RevisionClientState, key: ObjectKey): { base: string | null } | undefined {
  if (state.conflicts[key] || state.pending.some(edit => edit.key === key)) return undefined;
  return { base: state.server[key]?.lastEditId ?? null };
}
