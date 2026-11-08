import { MAP_PROJECT_TRACK_MAX_PARTS, MAP_PROJECT_TRACK_PART_POINTS } from "@o-tid/contracts";
import { wgs84ToMapPoint, type MapGeoreference } from "@o-tid/map-file";
import type { TrackPoint } from "@o-tid/map-revision";

/**
 * ADR-0219 tillägget om rekningen (K3): spårens punkter i webbläsaren, ren logik. En punkt är [lat, lon, sekunder från spårets
 * start, noggrannhet i meter] (som servern). GPX-filer läses utan DOM (bara `trkpt`/`rtept` med lat, lon, tid och hdop), spåren
 * förenklas med 1,5 m tolerans (Douglas–Peucker i meter) och skickas i delar.
 */
export type RawPoint = [number, number, number, number];

/** Noggrannheten när GPX-filen inte säger något (klockor skriver sällan hdop). */
export const GPX_DEFAULT_ACCURACY_M = 8;
export const SIMPLIFY_TOLERANCE_M = 1.5;
/**
 * Förenklingen lämnar ingen sträcka längre än så (meter): en lång rak sträcka får mellanpunkter, så att den inte ser ut som en
 * lucka i spåret (tappad signal, `MAX_SEGMENT_M` i map-revision).
 */
export const MAX_KEPT_SEGMENT_M = 50;
/** Så många punkter ett spår får ha efter förenklingen. */
export const MAX_TRACK_POINTS = MAP_PROJECT_TRACK_PART_POINTS * MAP_PROJECT_TRACK_MAX_PARTS;

export interface ParsedGpx { readonly name: string | undefined; readonly startedAt: string | undefined; readonly segments: RawPoint[][] }

const decode = (value: string) => value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const attribute = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`).exec(tag)?.[1];
const child = (body: string, name: string) => new RegExp(`<(?:\\w+:)?${name}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(body)?.[1]?.trim();

/** GPX 1.0/1.1: spårets segment (`trkseg`, annars rutten) med tiden räknad från den första punkten. Kastar om filen inte är GPX. */
export function parseGpx(text: string): ParsedGpx {
  if (!/<gpx[\s>]/.test(text)) throw new Error("Filen är inte en GPX-fil");
  // Spårets namn före filens (metadata).
  const head = text.replace(/<trkseg[\s\S]*$/, "");
  const name = child(/<trk[\s>][\s\S]*$/.exec(head)?.[0] ?? "", "name") ?? child(head, "name");
  const segments: { lat: number; lon: number; time: number | undefined; accuracy: number }[][] = [];
  const blocks = text.match(/<trkseg[\s\S]*?<\/trkseg>/g) ?? text.match(/<rte[\s>][\s\S]*?<\/rte>/g) ?? [];
  for (const block of blocks) {
    const segment: { lat: number; lon: number; time: number | undefined; accuracy: number }[] = [];
    for (const match of block.matchAll(/<(trkpt|rtept)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g)) {
      const lat = Number(attribute(match[2]!, "lat")), lon = Number(attribute(match[2]!, "lon"));
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
      const body = match[3] ?? "";
      const time = child(body, "time");
      const parsed = time ? Date.parse(time) : NaN;
      const hdop = Number(child(body, "hdop"));
      segment.push({ lat, lon, time: Number.isFinite(parsed) ? parsed : undefined, accuracy: Number.isFinite(hdop) && hdop > 0 ? Math.min(100, hdop * 5) : GPX_DEFAULT_ACCURACY_M });
    }
    if (segment.length > 0) segments.push(segment);
  }
  const first = segments.flat().find(point => point.time !== undefined)?.time;
  const raw = segments.map(segment => segment.map((point, index): RawPoint => [point.lat, point.lon,
    first !== undefined && point.time !== undefined ? Math.max(0, (point.time - first) / 1000) : index, point.accuracy]));
  return { name: name ? decode(name).slice(0, 80) : undefined, startedAt: first !== undefined ? new Date(first).toISOString() : undefined, segments: raw };
}

/** Meter mellan två punkter (lokal plan projektion, gott nog för korta sträckor). */
function local(origin: RawPoint) {
  const cos = Math.cos(origin[0] * Math.PI / 180);
  return (point: RawPoint) => ({ x: (point[1] - origin[1]) * 111_320 * cos, y: (point[0] - origin[0]) * 110_574 });
}

/** Douglas–Peucker i meter; första och sista punkten behålls och ingen sträcka blir längre än MAX_KEPT_SEGMENT_M. */
export function simplifyTrack(points: readonly RawPoint[], toleranceM = SIMPLIFY_TOLERANCE_M): RawPoint[] {
  if (points.length <= 2) return [...points];
  const project = local(points[0]!);
  const xy = points.map(project);
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    const a = xy[start]!, b = xy[end]!;
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    let worst = -1, index = -1;
    for (let i = start + 1; i < end; i += 1) {
      const p = xy[i]!;
      const distance = length === 0 ? Math.hypot(p.x - a.x, p.y - a.y) : Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / length;
      if (distance > worst) { worst = distance; index = i; }
    }
    if (worst > toleranceM && index > 0) { keep[index] = 1; stack.push([start, index], [index, end]); }
    else if (length > MAX_KEPT_SEGMENT_M && end - start > 1) {
      const middle = Math.floor((start + end) / 2);
      keep[middle] = 1; stack.push([start, middle], [middle, end]);
    }
  }
  return points.filter((_, index) => keep[index] === 1);
}

/** Delarna att skicka (högst MAX_TRACK_POINTS punkter, resten släpps). */
export function trackParts(points: readonly RawPoint[]): RawPoint[][] {
  const kept = points.slice(0, MAX_TRACK_POINTS);
  const out: RawPoint[][] = [];
  for (let i = 0; i < kept.length; i += MAP_PROJECT_TRACK_PART_POINTS) out.push(kept.slice(i, i + MAP_PROJECT_TRACK_PART_POINTS));
  return out;
}

/** Spårets punkter i kartans mm (y uppåt); punkter som inte går att räkna om (fel koordinatsystem) hoppas över. */
export function trackOnMap(points: readonly RawPoint[], georeference: MapGeoreference): TrackPoint[] {
  const out: TrackPoint[] = [];
  for (const [latitude, longitude, , accuracyM] of points) {
    try {
      const at = wgs84ToMapPoint(georeference, { latitude, longitude });
      out.push({ x: at.x, y: at.y, accuracyM });
    } catch { return out; }
  }
  return out;
}

/** Ett GPX-spår är en serie segment; en lucka mellan segmenten blir en lucka i spåret (servern har bara en lista). */
export function joinSegments(segments: readonly RawPoint[][]): RawPoint[] {
  return segments.flatMap(segment => simplifyTrack(segment));
}

/** Längden i meter (för visningen innan servern räknat). */
export function trackLengthM(points: readonly RawPoint[]): number {
  if (points.length < 2) return 0;
  const project = local(points[0]!);
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = project(points[i - 1]!), b = project(points[i]!);
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}
