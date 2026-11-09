import type { MapObject, Path, PathCommand, Point } from "@o-tid/map-file";
import { objectParts } from "./edit";
import { simplifyPoints } from "./generalize";

/**
 * Ägaren 2026-11-09 ("en höjdkurva med för många punkter"): formen på ett markerat objekt i ett grepp, som i Mapper och
 * OCAD. Förenkla (även kurvor: de plattas ut först), gör mjuk (raka sträckor blir kurvor genom samma punkter, Catmull–Rom),
 * gör rak (kurvorna blir raka mellan samma punkter) och runda former (cirkel som linje eller yta). Hörnpunkter (`corner`)
 * förblir hörn när en linje görs mjuk. Rena funktioner, kartans mm med y uppåt.
 */

/** Kurvornas utplattning: punkter per kurva. */
const CURVE_STEPS = 8;
/** Bézierkonstanten för en kvarts cirkel. */
const KAPPA = 0.5522847498;

const flagsOf = (command: PathCommand) => ({ ...(command.corner ? { corner: true as const } : {}), ...(command.dash ? { dash: true as const } : {}),
  ...(command.gap !== undefined ? { gap: command.gap } : {}) });
const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;

function withParts(object: MapObject, parts: readonly Path[]): MapObject {
  if (object.kind === "area") return { ...object, rings: parts };
  if (object.kind === "line") return { ...object, path: parts.flat() };
  return object;
}

/** Delens punkter med kurvorna utplattade. */
function flatten(part: Path): Point[] {
  const out: Point[] = [];
  for (const command of part) {
    const previous = out[out.length - 1];
    if (command.type === "C" && previous) {
      for (let step = 1; step <= CURVE_STEPS; step += 1) {
        const t = step / CURVE_STEPS, u = 1 - t;
        out.push({ x: u * u * u * previous.x + 3 * u * u * t * command.x1 + 3 * u * t * t * command.x2 + t * t * t * command.x,
          y: u * u * u * previous.y + 3 * u * u * t * command.y1 + 3 * u * t * t * command.y2 + t * t * t * command.y });
      }
    } else out.push({ x: command.x, y: command.y });
  }
  return out;
}

const straightPath = (points: readonly Point[]): PathCommand[] => points.map((point, index) => ({ type: index === 0 ? "M" : "L", x: point.x, y: point.y }));

/** Antalet punkter (kurvornas ändpunkter räknas, inte styrpunkterna). */
export function vertexCount(object: MapObject): number {
  return objectParts(object).reduce((sum, part) => sum + part.length, 0);
}

/**
 * Objektet med färre punkter (Douglas–Peucker, `tolerance` i kartans mm). Kurvor plattas ut först och blir raka sträckor
 * (gör det mjukt efteråt vid behov). En ring behåller minst tre punkter, en linje sina ändar. Undefined om antalet punkter
 * inte minskar.
 */
export function simplifyShape(object: MapObject, tolerance: number): MapObject | undefined {
  if (tolerance <= 0 || (object.kind !== "line" && object.kind !== "area")) return undefined;
  const before = vertexCount(object);
  const parts = objectParts(object).map(part => {
    const points = flatten(part);
    if (object.kind !== "area") return straightPath(simplifyPoints(points, tolerance));
    const closed = points.length > 1 && same(points[0]!, points[points.length - 1]!);
    const ring = closed ? points.slice(0, -1) : points;
    if (ring.length < 4) return [...part];
    // Ringen delas vid punkten längst från den första (en ring har ingen början).
    let far = 0, best = -1;
    ring.forEach((point, index) => { const d = Math.hypot(point.x - ring[0]!.x, point.y - ring[0]!.y); if (d > best) { best = d; far = index; } });
    const result = [...simplifyPoints(ring.slice(0, far + 1), tolerance), ...simplifyPoints([...ring.slice(far), ring[0]!], tolerance).slice(1, -1)];
    if (result.length < 3) return [...part];
    return straightPath(closed ? [...result, result[0]!] : result);
  });
  const next = withParts(object, parts);
  return vertexCount(next) < before ? next : undefined;
}

/**
 * Objektet mjukt: varje sträcka blir en kurva genom samma punkter (Catmull–Rom, styrpunkterna en sjättedel av grannarnas
 * avstånd). Hörnpunkter och linjens ändar får ingen tangent från andra sidan. Undefined om objektet saknar sträckor.
 */
export function smoothShape(object: MapObject): MapObject | undefined {
  if (object.kind !== "line" && object.kind !== "area") return undefined;
  let changed = false;
  const parts = objectParts(object).map(part => {
    const ring = object.kind === "area";
    const closed = ring || (part.length > 2 && same(part[0]!, part[part.length - 1]!));
    // Punkterna utan den upprepade första punkten i en sluten del.
    const anchors = closed && part.length > 1 && same(part[0]!, part[part.length - 1]!) ? part.slice(0, -1) : [...part];
    const n = anchors.length;
    if (n < 2 || (closed && n < 3)) return [...part];
    const p = (i: number): Point => {
      const index = closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i));
      return { x: anchors[index]!.x, y: anchors[index]!.y };
    };
    const tangent = (i: number): Point => {
      if (!closed && (i <= 0 || i >= n - 1)) {
        const a = p(i <= 0 ? 0 : n - 2), b = p(i <= 0 ? 1 : n - 1);
        return { x: (b.x - a.x) / 2, y: (b.y - a.y) / 2 };
      }
      if (anchors[((i % n) + n) % n]!.corner) return { x: 0, y: 0 };
      const a = p(i - 1), b = p(i + 1);
      return { x: (b.x - a.x) / 2, y: (b.y - a.y) / 2 };
    };
    const segments = closed ? n : n - 1;
    const out: PathCommand[] = [{ type: "M", x: anchors[0]!.x, y: anchors[0]!.y, ...flagsOf(anchors[0]!) }];
    for (let i = 0; i < segments; i += 1) {
      const from = p(i), to = p(i + 1), t0 = tangent(i), t1 = tangent(i + 1);
      const target = anchors[(i + 1) % n]!;
      out.push({ type: "C", x1: from.x + t0.x / 3, y1: from.y + t0.y / 3, x2: to.x - t1.x / 3, y2: to.y - t1.y / 3, x: to.x, y: to.y,
        ...(i + 1 < n ? flagsOf(target) : {}) });
      changed = true;
    }
    return out;
  });
  return changed ? withParts(object, parts) : undefined;
}

/** Objektet rakt: kurvorna blir raka sträckor mellan samma punkter. Undefined om det inte har några kurvor. */
export function straightenShape(object: MapObject): MapObject | undefined {
  if (object.kind !== "line" && object.kind !== "area") return undefined;
  const parts = objectParts(object);
  if (!parts.some(part => part.some(command => command.type === "C"))) return undefined;
  return withParts(object, parts.map(part => part.map(command => command.type === "C"
    ? { type: "L" as const, x: command.x, y: command.y, ...flagsOf(command) } : command)));
}

/** En cirkel (fyra kurvor) som sluten linje eller yta med symbolen; undefined om radien är för liten. */
export function circleShape(kind: "line" | "area", symbol: string, center: Point, radius: number): MapObject | undefined {
  if (!(radius > 0.05)) return undefined;
  const k = radius * KAPPA, { x, y } = center;
  const path: PathCommand[] = [
    { type: "M", x: x + radius, y },
    { type: "C", x1: x + radius, y1: y + k, x2: x + k, y2: y + radius, x, y: y + radius },
    { type: "C", x1: x - k, y1: y + radius, x2: x - radius, y2: y + k, x: x - radius, y },
    { type: "C", x1: x - radius, y1: y - k, x2: x - k, y2: y - radius, x, y: y - radius },
    { type: "C", x1: x + k, y1: y - radius, x2: x + radius, y2: y - k, x: x + radius, y }
  ];
  return kind === "area" ? { kind: "area", symbol, rings: [path], angle: 0 } : { kind: "line", symbol, path };
}
