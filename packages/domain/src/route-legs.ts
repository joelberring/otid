import { invertRasterCoordinate, type RasterAffineTransform } from "./raster-georeference";
import { controlPointKey, FINISH_KEY, legKey, START_KEY, type SplitTableSplit } from "./split-table";

/**
 * Vägval (PLAN.md steg 16): en GPS-rutt kopplas till sträckorna med löparens starttid och stämplingstider.
 * Rutten är punkter [tid ms, latitud, longitud] i tidsordning. En sträcka är tiden mellan två stämplingar;
 * ruttens del under den tiden är löparens vägval. Inget här läser filer eller databasen.
 */
export type RoutePoint = readonly [timeMs: number, latitude: number, longitude: number];

/** En sträcka i löparens egen stämplingsordning, i millisekunder från start. */
export type RunnerLeg = { leg: string; fromElapsedMs: number; toElapsedMs: number };

/**
 * Löparens sträckor: start till första kontrollen med tid, mellan kontrollerna och sista kontrollen till mål.
 * Identiteten är från- och till-punkt som i sträcktidstabellen (`SplitTableColumn.leg`), så att en sträcka
 * med en missad kontroll emellan aldrig blir samma sträcka som i tabellen.
 */
export function runnerLegs(splits: readonly Pick<SplitTableSplit, "controlCode" | "occurrence" | "elapsedMs">[],
  finishElapsedMs: number | null): RunnerLeg[] {
  const legs: RunnerLeg[] = [];
  let from = START_KEY;
  let fromElapsedMs = 0;
  for (const split of splits) {
    const to = controlPointKey(split.controlCode, split.occurrence);
    if (split.elapsedMs >= fromElapsedMs) legs.push({ leg: legKey(from, to), fromElapsedMs, toElapsedMs: split.elapsedMs });
    from = to;
    fromElapsedMs = split.elapsedMs;
  }
  if (finishElapsedMs !== null && finishElapsedMs >= fromElapsedMs) {
    legs.push({ leg: legKey(from, FINISH_KEY), fromElapsedMs, toElapsedMs: finishElapsedMs });
  }
  return legs;
}

function interpolate(a: RoutePoint, b: RoutePoint, timeMs: number): RoutePoint {
  const span = b[0] - a[0];
  const share = span <= 0 ? 0 : (timeMs - a[0]) / span;
  return [timeMs, a[1] + (b[1] - a[1]) * share, a[2] + (b[2] - a[2]) * share];
}

/** Första index vars tid är minst `timeMs` (binärsökning; punkterna är i tidsordning). */
function firstAtOrAfter(points: readonly RoutePoint[], timeMs: number): number {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (points[middle]![0] < timeMs) low = middle + 1; else high = middle;
  }
  return low;
}

/**
 * Ruttens del mellan två klockslag. Ändpunkterna interpoleras när rutten har punkter på båda sidor, så att
 * sträckorna möts. Täcker rutten bara en del av tiden ges den delen; täcker den inget, eller färre än två
 * punkter, ges en tom lista.
 */
export function routeSegment(points: readonly RoutePoint[], fromMs: number, toMs: number): RoutePoint[] {
  if (points.length < 2 || !(toMs > fromMs)) return [];
  const first = firstAtOrAfter(points, fromMs);
  const end = firstAtOrAfter(points, toMs);
  const segment: RoutePoint[] = [];
  if (first > 0 && first < points.length && points[first]![0] > fromMs) segment.push(interpolate(points[first - 1]!, points[first]!, fromMs));
  for (let index = first; index < end; index += 1) segment.push(points[index]!);
  if (end < points.length) {
    const last = points[end]!;
    if (last[0] === toMs) segment.push(last);
    else if (end > 0) segment.push(interpolate(points[end - 1]!, last, toMs));
  }
  return segment.length >= 2 ? segment : [];
}

/** Sträckorna där rutten har ett vägval (minst två punkter), med löparens starttid som klockslag. */
export function routeLegs(points: readonly RoutePoint[], startMs: number, legs: readonly RunnerLeg[]): string[] {
  return legs.filter(leg => routeSegment(points, startMs + leg.fromElapsedMs, startMs + leg.toElapsedMs).length >= 2).map(leg => leg.leg);
}

/** Ruttens punkter som pixlar på den georefererade kartan. */
export function projectRoute(transform: RasterAffineTransform, points: readonly RoutePoint[]): [number, number][] {
  return points.map(point => {
    const pixel = invertRasterCoordinate(transform, point[2], point[1]);
    return [Math.round(pixel.pixelX * 10) / 10, Math.round(pixel.pixelY * 10) / 10];
  });
}

/**
 * Ruttpunkter från en GPX: bara punkter med tid, sorterade på tid, utan dubbletter av samma tid. Ger
 * tom lista när färre än två punkter har tid (rutten kan då inte kopplas till sträckorna).
 */
export function timedRoutePoints(points: readonly { latitude: number; longitude: number; recordedAt?: string | undefined }[]): RoutePoint[] {
  const timed = points.flatMap(point => {
    const timeMs = point.recordedAt === undefined ? Number.NaN : Date.parse(point.recordedAt);
    return Number.isFinite(timeMs) ? [[timeMs, point.latitude, point.longitude] as RoutePoint] : [];
  }).sort((a, b) => a[0] - b[0]);
  const unique = timed.filter((point, index) => index === 0 || point[0] !== timed[index - 1]![0]);
  return unique.length >= 2 ? unique : [];
}
