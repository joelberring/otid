import type { MapObject, Path, Point } from "@o-tid/map-file";
import { samplePath } from "../vector-fit";

/**
 * Ägaren 2026-11-14 («krångligt med lutningsstrecken, går det att lösa?»): när en kartas höjdkurvor byts mot nya följer
 * lutningsstrecken med. Ett streck sitter på en kurva och pekar nedför; kartritaren har satt det där riktningen annars är
 * oklar, och det valet ska finnas kvar. Varje gammalt streck flyttas till närmaste punkt på en ny kurva (inom `reach` mm) och
 * vrids lika mycket som kurvan har vridits där: vinkeln mellan den gamla kurvans riktning vid strecket och den nya kurvans
 * riktning i den nya punkten, den minsta av de två möjliga, så att strecket står kvar på samma sida. Streck utan en gammal
 * kurva intill (inom `onLine` mm) eller utan en ny kurva inom räckhåll tas bort. Ren räkning; kartans mm.
 */
export interface TickLimits { readonly reach: number; readonly onLine: number; readonly step: number }
/** 1,2 mm till en ny kurva (18 m vid 1:15 000), 0,6 mm till den gamla, prov var 0,25 mm. */
export const DEFAULT_TICK_LIMITS: TickLimits = { reach: 1.2, onLine: 0.6, step: 0.25 };

interface Sample { readonly x: number; readonly y: number; /** Kurvans riktning här (radianer, modulo ett halvt varv). */ readonly heading: number }
type Tick = Extract<MapObject, { kind: "point" }>;

function samplesOf(paths: readonly Path[], step: number): Sample[] {
  const out: Sample[] = [];
  for (const path of paths) {
    const points = samplePath(path, step);
    points.forEach((point, index) => {
      const before = points[Math.max(0, index - 1)]!, after = points[Math.min(points.length - 1, index + 1)]!;
      if (before === after) return;
      out.push({ x: point.x, y: point.y, heading: Math.atan2(after.y - before.y, after.x - before.x) });
    });
  }
  return out;
}

function nearestIn(samples: readonly Sample[], cell: number): (at: Point, reach: number) => Sample | undefined {
  const cells = new Map<string, Sample[]>();
  for (const sample of samples) {
    const key = `${Math.floor(sample.x / cell)},${Math.floor(sample.y / cell)}`, list = cells.get(key);
    if (list) list.push(sample); else cells.set(key, [sample]);
  }
  return (at, reach) => {
    const cx = Math.floor(at.x / cell), cy = Math.floor(at.y / cell);
    let best: Sample | undefined, distance = reach;
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
      for (const sample of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
        const d = Math.hypot(sample.x - at.x, sample.y - at.y);
        if (d <= distance) { distance = d; best = sample; }
      }
    }
    return best;
  };
}

/** Vinkeln (grader) från en riktning till en annan när båda gäller modulo ett halvt varv: mellan −90 och 90. */
function turn(from: number, to: number): number {
  let degrees = (to - from) * 180 / Math.PI;
  degrees = ((degrees % 180) + 180) % 180;
  return degrees > 90 ? degrees - 180 : degrees;
}
const normal = (angle: number) => { const value = ((angle % 360) + 360) % 360; return value > 180 ? value - 360 : value; };

/** Lutningsstrecken på de nya kurvorna: flyttade och vridna med kurvan. `dropped` är så många som inte fick någon ny plats. */
export function snapTicks(ticks: readonly Tick[], oldLines: readonly Path[], newLines: readonly Path[], limits: TickLimits = DEFAULT_TICK_LIMITS)
  : { ticks: Tick[]; dropped: number } {
  const cell = Math.max(limits.reach, limits.onLine);
  const oldAt = nearestIn(samplesOf(oldLines, limits.step), cell), newAt = nearestIn(samplesOf(newLines, limits.step), cell);
  const out: Tick[] = [], taken = new Set<string>();
  let dropped = 0;
  for (const tick of ticks) {
    const from = oldAt(tick.at, limits.onLine), to = newAt(tick.at, limits.reach);
    // Två streck på samma ställe på den nya kurvan säger samma sak: det andra tas bort.
    const key = to && `${Math.round(to.x / limits.step)},${Math.round(to.y / limits.step)}`;
    if (!from || !to || !key || taken.has(key)) { dropped += 1; continue; }
    taken.add(key);
    const round = (value: number) => Math.round(value * 1000) / 1000;
    out.push({ kind: "point", symbol: tick.symbol, at: { x: round(to.x), y: round(to.y) }, angle: Math.round(normal(tick.angle + turn(from.heading, to.heading)) * 10) / 10 });
  }
  return { ticks: out, dropped };
}
