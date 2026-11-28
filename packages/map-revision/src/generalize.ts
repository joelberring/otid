import { maxOf, minOf, type MapObject, type Path, type PathCommand, type Point } from "@o-tid/map-file";
import type { RevisionClientState } from "./client-log";
import { areasInsideSameSymbol, joinTouchingLines } from "./generalize-topology";
import { checkNorm, type NormObject, type NormRule } from "./norm-check";
import { smoothShape } from "./shape-edit";
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
 * Del 2 (`generalize-topology.ts`): linjer med samma symbol vars ändar möts fogas ihop (JOIN; de andra tas bort som
 * JOINED), och ytor som helt ligger inne i en likadan yta tas bort (INSIDE).
 *
 * Kurvavstånd, tunna ytor, passager och öppningar kräver en kartritares val och föreslås inte här (normkontrollen visar dem).
 */
export type GeneralizeReason = "SIMPLIFY" | "SMOOTH" | "JOIN" | "JOINED" | "INSIDE" | Extract<NormRule, "SMALL_AREA" | "SHORT_LINE" | "SMALL_CLOSED">;
export const REMOVABLE_RULES: ReadonlySet<NormRule> = new Set(["SMALL_AREA", "SHORT_LINE", "SMALL_CLOSED"]);
export interface GeneralizeOptions {
  /** Toleransen för förenklingen i kartans mm; 0 = ingen förenkling. */
  readonly simplifyMm: number;
  readonly removeSmall: boolean;
  /** Del 2: foga ihop linjer vars ändar möts och ta bort ytor inuti en likadan yta (saknas = av). */
  readonly joinLines?: boolean | undefined;
  readonly removeInside?: boolean | undefined;
  /**
   * Ägaren 2026-11-11 («göra alla höjdkurvor mjuka», «mjukare brantmarkeringar», gröna «mer som blobbor»): symbolernas
   * huvudnummer (t.ex. 101) vars linjer och ytor görs mjuka efter förenklingen; `smoothSimplifyMm` förenklar dem mer först.
   */
  readonly smooth?: readonly string[] | undefined;
  readonly smoothSimplifyMm?: number | undefined;
  /**
   * Separat förenklingstolerans (kartans mm) för mjuka linjer (kurvor 101–103 och branter 201–202) innan `smoothShape`:
   * håller detaljerade höjdformer, näsor och smala sänkor skarpa utan att 0,15 mm (2,25 m i 1:15 000) rundar av dem.
   */
  readonly smoothLineSimplifyMm?: number | undefined;
  /** Bara objekt inom rutan (kartans mm), t.ex. en etapp. */
  readonly within?: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number } | undefined;
  /** Objekt som redan har en ändring (från en tidigare del, `generalizeParts`) och lämnas orörda. */
  readonly skip?: ReadonlySet<ObjectKey> | undefined;
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
  /** Del 2: ihopfogade linjer (nya linjer och linjer som gick upp i dem) och ytor inuti en likadan yta. */
  readonly joined?: { readonly lines: number; readonly absorbed: number } | undefined;
  readonly inside?: number | undefined;
  readonly smoothed?: number | undefined;
}

const perpendicular = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
  return length === 0 ? Math.hypot(p.x - a.x, p.y - a.y) : Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / length;
};

/** Douglas–Peucker (iterativt): indexen som behålls, första, sista och eventuella `pinned` (t.ex. hörn- och streckpunkter) alltid. */
export function simplifyIndices(points: readonly Point[], tolerance: number, pinned?: ReadonlySet<number>): number[] {
  if (points.length <= 2 || tolerance <= 0) return points.map((_, i) => i);
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const anchors = [0];
  if (pinned?.size) {
    for (let i = 1; i < points.length - 1; i += 1) if (pinned.has(i)) { keep[i] = 1; anchors.push(i); }
  }
  anchors.push(points.length - 1);
  const stack: [number, number][] = [];
  for (let a = 0; a + 1 < anchors.length; a += 1) if (anchors[a + 1]! - anchors[a]! > 1) stack.push([anchors[a]!, anchors[a + 1]!]);
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let worst = -1, index = -1;
    for (let i = first + 1; i < last; i += 1) {
      const distance = perpendicular(points[i]!, points[first]!, points[last]!);
      if (distance > worst) { worst = distance; index = i; }
    }
    if (worst > tolerance && index > 0) { keep[index] = 1; stack.push([first, index], [index, last]); }
  }
  const out: number[] = [];
  for (let i = 0; i < points.length; i += 1) if (keep[i] === 1) out.push(i);
  return out;
}

/** Douglas–Peucker (iterativt): punkterna som behålls, första och sista alltid. */
export function simplifyPoints(points: readonly Point[], tolerance: number, pinned?: ReadonlySet<number>): Point[] {
  return simplifyIndices(points, tolerance, pinned).map(i => points[i]!);
}

const isStraight = (part: Path) => part.every(command => command.type === "M" || command.type === "L");
const pointsOf = (part: Path): Point[] => part.map(command => ({ x: command.x, y: command.y }));
const flagsOf = (command: PathCommand | undefined) => !command ? {} : ({
  ...(command.corner ? { corner: true as const } : {}),
  ...(command.dash ? { dash: true as const } : {}),
  ...(command.gap !== undefined ? { gap: command.gap } : {})
});
const pinnedIn = (part: Path): Set<number> => {
  const out = new Set<number>();
  part.forEach((command, i) => { if (command.corner || command.dash || command.gap !== undefined) out.add(i); });
  return out;
};

/**
 * En ring förenklas med sin längsta diagonal som fasta punkter (en ring har ingen början). Mindre än tre punkter kvar: orörd.
 */
function simplifyRingIndices(points: readonly Point[], tolerance: number, pinned?: ReadonlySet<number>): { indices: number[]; closed: boolean } | undefined {
  const closed = points.length > 1 && points[0]!.x === points[points.length - 1]!.x && points[0]!.y === points[points.length - 1]!.y;
  const ring = closed ? points.slice(0, -1) : [...points];
  if (ring.length < 4) return undefined;
  let far = 0, best = -1;
  for (let i = 1; i < ring.length; i += 1) {
    const distance = Math.hypot(ring[i]!.x - ring[0]!.x, ring[i]!.y - ring[0]!.y);
    if (distance > best) { best = distance; far = i; }
  }
  const pinOne = pinned?.size ? new Set([...pinned].filter(i => i > 0 && i < far)) : undefined;
  const secondPoints = [...ring.slice(far), ring[0]!];
  const pinTwo = pinned?.size ? new Set([...pinned].filter(i => i > far && i < ring.length).map(i => i - far)) : undefined;
  const one = simplifyIndices(ring.slice(0, far + 1), tolerance, pinOne);
  const two = simplifyIndices(secondPoints, tolerance, pinTwo).slice(1, -1).map(i => i + far);
  const result = [...one, ...two];
  if (result.length < 3) return undefined;
  return { indices: result, closed };
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
    const pinned = pinnedIn(part);
    before += points.length;
    if (object.kind === "area") {
      const simplified = simplifyRingIndices(points, tolerance, pinned);
      if (!simplified) { after += points.length; next.push([...part]); continue; }
      const cmds: PathCommand[] = simplified.indices.map((origIdx, idx) => ({
        type: idx === 0 ? "M" : "L", x: points[origIdx]!.x, y: points[origIdx]!.y, ...flagsOf(part[origIdx])
      }));
      if (simplified.closed) {
        const lastOrig = part[part.length - 1];
        cmds.push({ type: "L", x: points[simplified.indices[0]!]!.x, y: points[simplified.indices[0]!]!.y, ...flagsOf(lastOrig) });
      }
      after += cmds.length;
      next.push(cmds);
    } else {
      const indices = simplifyIndices(points, tolerance, pinned);
      after += indices.length;
      next.push(indices.map((origIdx, idx) => ({ type: idx === 0 ? "M" : "L", x: points[origIdx]!.x, y: points[origIdx]!.y, ...flagsOf(part[origIdx]) })));
    }
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
  return { x: (minOf(xs) + maxOf(xs)) / 2, y: (minOf(ys) + maxOf(ys)) / 2 };
}

const inside = (at: Point, box: GeneralizeOptions["within"]) => !box || (at.x >= box.minX && at.x <= box.maxX && at.y >= box.minY && at.y <= box.maxY);

/** Ändringarna för kartans objekt (skalan avgör normens mått). Ett objekt får högst en ändring; borttagning går före. */
export function generalize(all: readonly NormObject[], scale: number, options: GeneralizeOptions): GeneralizeResult {
  const objects = options.skip?.size ? all.filter(row => !options.skip!.has(row.key)) : all;
  const changes: GeneralizeChange[] = [];
  const removed = { SMALL_AREA: 0, SHORT_LINE: 0, SMALL_CLOSED: 0 };
  const taken = new Set<ObjectKey>();
  if (options.removeSmall) {
    for (const issue of checkNorm(objects, scale, { rules: REMOVABLE_RULES, maxPerRule: Infinity }).issues) {
      if (!REMOVABLE_RULES.has(issue.rule) || taken.has(issue.key) || !inside(issue.at, options.within)) continue;
      taken.add(issue.key);
      const rule = issue.rule as keyof typeof removed;
      removed[rule] += 1;
      changes.push({ key: issue.key, code: issue.code, reason: rule, at: issue.at, before: 0, after: 0 });
    }
  }
  let joined: GeneralizeResult["joined"], insideCount: number | undefined;
  if (options.removeInside) {
    const found = areasInsideSameSymbol(objects, taken).filter(change => inside(change.at, options.within));
    for (const change of found) {
      taken.add(change.key);
      changes.push({ key: change.key, code: change.code, reason: "INSIDE", at: change.at, before: 0, after: 0 });
    }
    insideCount = found.length;
  }
  if (options.joinLines) {
    const found = joinTouchingLines(objects, undefined, taken).filter(change => inside(change.at, options.within));
    for (const change of found) {
      taken.add(change.keep);
      changes.push({ key: change.keep, code: change.code, reason: "JOIN", object: change.object, at: change.at, before: 0, after: 0 });
      for (const key of change.absorbed) {
        taken.add(key);
        changes.push({ key, code: change.code, reason: "JOINED", at: change.at, before: 0, after: 0 });
      }
    }
    joined = { lines: found.length, absorbed: found.reduce((sum, change) => sum + change.absorbed.length, 0) };
  }
  let simplified = 0, pointsBefore = 0, pointsAfter = 0, smoothed = 0;
  const smooth = new Set(options.smooth ?? []);
  if (options.simplifyMm > 0 || smooth.size > 0) {
    for (const row of objects) {
      if (taken.has(row.key)) continue;
      const soft = smooth.has(row.code.split(".")[0]!) && (row.object.kind === "line" || row.object.kind === "area");
      const tolerance = soft
        ? (row.object.kind === "line" && options.smoothLineSimplifyMm !== undefined
            ? options.smoothLineSimplifyMm
            : Math.max(options.simplifyMm, options.smoothSimplifyMm ?? 0))
        : options.simplifyMm;
      const result = simplifyObject(row.object, tolerance);
      const curved = soft ? smoothShape(result?.object ?? row.object) : undefined;
      if (!result && !curved) continue;
      const at = centerOf(row.object);
      if (!inside(at, options.within)) continue;
      if (result) { simplified += 1; pointsBefore += result.before; pointsAfter += result.after; }
      if (curved) smoothed += 1;
      changes.push({ key: row.key, code: row.code, reason: curved ? "SMOOTH" : "SIMPLIFY", object: curved ?? result!.object, at,
        before: result?.before ?? 0, after: result?.after ?? 0 });
    }
  }
  return { changes, simplified, pointsBefore, pointsAfter, removed, ...(joined ? { joined } : {}), ...(insideCount !== undefined ? { inside: insideCount } : {}),
    ...(smooth.size > 0 ? { smoothed } : {}) };
}

/**
 * Förslagets grund för objektet: serverns senaste ändring, eller inget att bygga på när objektet har egna ändringar som inte
 * skickats eller en krock (då föreslås det inte nu).
 */
export function proposalBase(state: RevisionClientState, key: ObjectKey): { base: string | null } | undefined {
  if (state.conflicts[key] || state.pending.some(edit => edit.key === key)) return undefined;
  return { base: state.server[key]?.lastEditId ?? null };
}

/**
 * Symbolerna som görs mjuka (jämför Högdalenkartan, ägaren 2026-11-11): kurvorna (101–103), branterna (201, 202) och de
 * gröna ytorna (406–410).
 */
export const SOFT_CODES: readonly string[] = ["101", "102", "103", "201", "202", "406", "407", "408", "409", "410"];
/** Förenklingstolerans (kartans mm) för kurvor (101–103) och branter (201–202) före Bézier-mjukning (~0,68 m i 1:15 000, ~0,45 m i 1:10 000). */
export const CONTOUR_LINE_SIMPLIFY_MM = 0.045;
/** Minsta förförenkling i terrängmeter före Bézier-mjukning i sprint (skala ≤ 1:5 000), så sub-grid-trappsteg inte ger ryckningar. */
const SPRINT_CONTOUR_MIN_SIMPLIFY_M = 0.35;

/** Förenklingstolerans (kartans mm) för kurvor/branter före Bézier-mjukning: 0,045 mm i skog, minst 0,35 m i terrängen i sprint (0,0875 mm i 1:4 000). */
export function contourLineSimplifyMm(scale: number): number {
  return scale > 0 && scale <= 5000
    ? Math.max(CONTOUR_LINE_SIMPLIFY_MM, SPRINT_CONTOUR_MIN_SIMPLIFY_M * 1000 / scale)
    : CONTOUR_LINE_SIMPLIFY_MM;
}

/**
 * Ägaren 2026-11-11 («orienteringskartor ska kunna läsas i fart … en del generalisering»): en inläsnings kandidater
 * generaliseras efter normen innan de läggs in, med samma steg som generaliseringen av kartan (förenkla 0,1 mm för vanliga
 * objekt, 0,15 mm för mjuka grönytor och `contourLineSimplifyMm(scale)` för kurvor/branter så att skarpa höjder inte rundas av
 * i skog medan sprint slipper sub-grid-trappsteg; ta bort det som är mindre än normen, foga ihop linjer, ta bort ytor inuti en
 * likadan yta). `codeOf` ger symbolens nummer.
 */
export function generalizeCandidates(objects: readonly MapObject[], codeOf: (symbol: string) => string | undefined, scale: number,
  simplifyMm = 0.1, smooth: readonly string[] = SOFT_CODES): { objects: MapObject[]; removed: number; simplified: number } {
  const rows: NormObject[] = objects.map((object, index) => ({ key: `c:${index}`, code: codeOf(object.symbol) ?? "", object }));
  const lineSimplifyMm = contourLineSimplifyMm(scale);
  const result = generalize(rows, scale, {
    simplifyMm,
    removeSmall: true,
    joinLines: true,
    removeInside: true,
    smooth,
    smoothSimplifyMm: 0.15,
    smoothLineSimplifyMm: simplifyMm <= 0 ? 0 : scale > 0 && scale <= 5000 ? lineSimplifyMm : Math.min(simplifyMm, lineSimplifyMm)
  });
  const replaced = new Map<ObjectKey, MapObject | undefined>(result.changes.map(change => [change.key, change.object]));
  const out: MapObject[] = [];
  rows.forEach(row => {
    if (!replaced.has(row.key)) { out.push(row.object); return; }
    const next = replaced.get(row.key);
    if (next) out.push(next);
  });
  return { objects: out, removed: objects.length - out.length, simplified: result.simplified };
}
