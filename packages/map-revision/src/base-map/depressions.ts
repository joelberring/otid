import type { SourceFeature } from "../index";
import type { HeightField } from "./clear-contours";

/**
 * Negativ kurvbild (ägaren 2026-11-15, Grövelsjön: «mycket negativ kurvbild och den verkar inte alls klara detta»). I dödisterräng
 * ligger de flesta formerna mellan nivåerna: i ett utsnitt på 2,3 km² hade lasern 101 slutna sänkor på minst en meter, och bara
 * 23 av dem korsade en 5 m-nivå. Tre saker saknades, och två av dem finns här (den tredje, den egna sökningen, i `pit-search.ts`):
 *
 * 1. Karttapullautin ritar små gropar som en liten båge i lagret `small_depression` (86 i utsnittet). Lagerregeln fångade dem på
 *    ordet DEPRESSION och gjorde dem till bitar av höjdkurva. De blir nu punkter i lagret `udepression` (111) i bågens mitt; mot
 *    höjdrastret låg bågens mitt i en sänka på minst 0,2 m i 98 % av fallen.
 * 2. Lutningsstrecket sattes efter lagrets namn (`depression`), så en hjälpkurvering runt en sänka lästes som en höjd. Med markens
 *    höjd (`hojd.png`) prövas varje sluten kurva och hjälpkurva i stället: ligger marken strax innanför lägre än strax utanför är
 *    det en sänka (`depressionRing`), och den får ett streck (`tickDepressions`).
 *
 * Ren kod utan I/O. Koordinater i meter (SWEREF 99 TM eller kandidaternas koordinatsystem).
 */
type Position = readonly [number, number];
const SMALL_DEPRESSION = /^small_depression$/i, PIT_POINT = /^udepression/i;
const TICK_LAYER = "lutningsstreck";
/** Slutna linjer som kan vara en sänka: höjdkurvor, stödkurvor, Karttapullautins sänkkurvor och hjälpkurvor. */
const RING = /^(contour|depression)(_index)?$|^formline$/i;
const NAMED_DEPRESSION = /^depression(_index)?$/i;
/** Två gropar närmare varandra än så (meter) är samma grop. */
const SAME_PIT_METERS = 4;

/**
 * Karttapullautins små gropar (bågar i `small_depression`) som punkter i bågens mitt, utan dubblett där en grop redan ligger
 * (bland objekten själva eller i `others`, t.ex. knollarnas fil).
 */
export function smallDepressionPoints(features: readonly SourceFeature[], others: readonly SourceFeature[] = []): SourceFeature[] {
  if (!features.some(feature => SMALL_DEPRESSION.test(feature.layer))) return [...features];
  const pits: Position[] = [...features, ...others].filter(feature => feature.geometry.kind === "point" && PIT_POINT.test(feature.layer))
    .map(feature => (feature.geometry as { at: Position }).at);
  return features.flatMap((feature): SourceFeature[] => {
    if (!SMALL_DEPRESSION.test(feature.layer)) return [feature];
    const geometry = feature.geometry;
    const points = geometry.kind === "point" ? [geometry.at] : geometry.kind === "line" ? geometry.points : [];
    if (points.length === 0) return [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of points) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const at: [number, number] = [(minX + maxX) / 2, (minY + maxY) / 2];
    if (pits.some(([x, y]) => Math.hypot(x - at[0], y - at[1]) < SAME_PIT_METERS)) return [];
    pits.push(at);
    return [{ layer: "udepression", geometry: { kind: "point", at } }];
  });
}

/** Ringen utan upprepad slutpunkt, och dess yta med tecken (positiv = moturs). */
function openRing(points: readonly Position[]): readonly Position[] {
  const first = points[0]!, last = points[points.length - 1]!;
  return points.length > 3 && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6 ? points.slice(0, -1) : points;
}
const signedArea = (ring: readonly Position[]) => ring.reduce((sum, [x, y], i) => { const [nx, ny] = ring[(i + 1) % ring.length]!; return sum + x * ny - nx * y; }, 0) / 2;
/** Är linjen en sluten ring (sluten i sig, eller med första punkten en gång till sist)? */
export function isRing(feature: SourceFeature): boolean {
  const geometry = feature.geometry;
  if (geometry.kind !== "line" || geometry.points.length < 4) return false;
  const first = geometry.points[0]!, last = geometry.points[geometry.points.length - 1]!;
  return geometry.closed || Math.hypot(first[0] - last[0], first[1] - last[1]) <= 1;
}

/** Avståndet (meter) innanför och utanför ringen där markens höjd jämförs, och minsta skillnad som räknas. */
export const RING_PROBE_METERS = 3, RING_MIN_DROP = 0.15, RING_MIN_SHARE = 0.6;
const PROBE_STEP = 4;

/**
 * Sänka (sant), höjd (falskt) eller okänt, ur markens höjd strax innanför och strax utanför ringen. Proven tas var fjärde meter
 * längs ringen, `RING_PROBE_METERS` åt varje håll (mindre för små ringar). En sänka är det när marken innanför ligger lägre i
 * minst `RING_MIN_SHARE` av proven och i median minst `RING_MIN_DROP` m lägre; en höjd tvärtom.
 */
export function depressionRing(points: readonly Position[], field: Pick<HeightField, "heightAt">): boolean | undefined {
  const ring = openRing(points);
  if (ring.length < 3) return undefined;
  const area = signedArea(ring);
  if (area === 0) return undefined;
  let perimeter = 0;
  for (let i = 0; i < ring.length; i += 1) { const a = ring[i]!, b = ring[(i + 1) % ring.length]!; perimeter += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  // En smal ring: provet får inte hamna på andra sidan.
  const reach = Math.min(RING_PROBE_METERS, Math.max(0.75, Math.abs(area) / perimeter / 2));
  const inward = area > 0 ? 1 : -1, drops: number[] = [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!, span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (span === 0) continue;
    // Vänster om färdriktningen är innanför på en ring som går moturs.
    const nx = -(b[1] - a[1]) / span * inward, ny = (b[0] - a[0]) / span * inward;
    const steps = Math.max(1, Math.round(span / PROBE_STEP));
    for (let step = 0; step < steps; step += 1) {
      const t = (step + 0.5) / steps, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      const inside = field.heightAt(x + nx * reach, y + ny * reach), outside = field.heightAt(x - nx * reach, y - ny * reach);
      if (inside !== undefined && outside !== undefined) drops.push(outside - inside);
    }
  }
  if (drops.length < 4) return undefined;
  drops.sort((a, b) => a - b);
  const median = drops[Math.floor(drops.length / 2)]!;
  const lower = drops.filter(drop => drop > 0).length / drops.length;
  if (median >= RING_MIN_DROP && lower >= RING_MIN_SHARE) return true;
  if (median <= -RING_MIN_DROP && 1 - lower >= RING_MIN_SHARE) return false;
  return undefined;
}

/**
 * Lutningsstrecket för en ring: mitt på den längsta sträckan, pekande vinkelrätt inåt (nedför i en sänka). `layer` är streckets
 * lager (grundkartans `lutningsstreck`, eller sänksökningens eget).
 */
export function ringTick(points: readonly Position[], layer = TICK_LAYER): SourceFeature[] {
  const ring = openRing(points);
  if (ring.length < 3) return [];
  let best = 0, longest = -1;
  for (let i = 0; i < ring.length; i += 1) {
    const next = ring[(i + 1) % ring.length]!, span = Math.hypot(next[0] - ring[i]![0], next[1] - ring[i]![1]);
    if (span > longest) { longest = span; best = i; }
  }
  if (!(longest > 0)) return [];
  const a = ring[best]!, b = ring[(best + 1) % ring.length]!, inward = signedArea(ring) >= 0 ? 1 : -1;
  const at: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const toward: [number, number] = [at[0] - (b[1] - a[1]) / longest * inward * 5, at[1] + (b[0] - a[0]) / longest * inward * 5];
  return [{ layer, geometry: { kind: "point", at, toward } }];
}

export interface DepressionTicks {
  readonly features: SourceFeature[];
  /** Ringar med streck, och hur många av dem som bara höjden visade vara sänkor (inte lagrets namn). */
  readonly ticks: number; readonly byHeight: number;
}

/**
 * Grundkartans lutningsstreck räknade om: alla gamla streck (lagret `lutningsstreck`) tas bort, och varje sluten kurva eller
 * hjälpkurva som är en sänka får ett nytt. Med markens höjd avgör höjden; där den inte räcker (utanför rastret, eller för liten
 * skillnad) avgör lagrets namn som förut. Körs sist, efter att kurvorna lugnats och jämnats ut, så att strecken sitter på
 * kurvorna som de blev och inga streck blir kvar efter borttagna ringar.
 */
export function tickDepressions(features: readonly SourceFeature[], field?: Pick<HeightField, "heightAt">): DepressionTicks {
  const kept = features.filter(feature => !(feature.layer === TICK_LAYER && feature.geometry.kind === "point"));
  const added: SourceFeature[] = [];
  let byHeight = 0;
  for (const feature of kept) {
    if (!RING.test(feature.layer) || !isRing(feature)) continue;
    const points = (feature.geometry as { points: readonly Position[] }).points, named = NAMED_DEPRESSION.test(feature.layer);
    const measured = field ? depressionRing(points, field) : undefined;
    if (!(measured ?? named)) continue;
    const tick = ringTick(points);
    if (tick.length === 0) continue;
    added.push(...tick);
    if (!named) byHeight += 1;
  }
  return { features: [...added, ...kept], ticks: added.length, byHeight };
}
