import type { SourceFeature } from "../index";

/**
 * Ägaren 2026-11-17 («Jag tror att stigarna från OpenStreetMap ligger fel och kan behöva flyttas. Gäller även andra stigar»,
 * «Ofta»): OpenStreetMaps stigar och traktorvägar är ofta ritade ur en GPS-spårning eller en suddig flygbild och ligger
 * 5–15 m vid sidan av spåret i marken. Lasern ser spåret som en fåra (scripts/geo-tracks.ts, lagret `spar_laser`).
 *
 * Här flyttas en stig till fåran där fåran löper parallellt med stigen (högst 25° fel) inom `maxShift` m, längs minst
 * `minRun` m. Flyttningen jämnas ut längs stigen och tonas av mot noll där stigen slutar matcha och vid korsningar med andra
 * stigar och vägar (så att nätet hänger ihop). Fåror som efteråt ligger längs en stig eller väg tas bort (de är samma spår,
 * eller vägens diken); det som blir kvar är spår som OpenStreetMap saknar.
 */
export const LASER_TRACK_LAYER = "spar_laser";
/** OpenStreetMaps linjer som får flyttas till fåran. */
const MOVABLE = /^OSM (stig|traktorväg|gångväg och cykelväg)/;
/** Linjer som en fåra längs med är en del av (eller ett dike vid). */
const ALONG = /^OSM (stig|traktorväg|gångväg|väg|järnväg)/;

export interface PathSnapSettings {
  readonly maxShift: number; readonly maxAngle: number; readonly minRun: number; readonly taper: number; readonly smooth: number;
  /** En fåra närmare en stig eller väg än så (och parallell) är samma spår. */ readonly duplicate: number;
}
export const DEFAULT_PATH_SNAP: PathSnapSettings = { maxShift: 15, maxAngle: 25, minRun: 30, taper: 20, smooth: 10, duplicate: 10 };
const STEP = 2;

type Pair = [number, number];
interface Segment { readonly a: Pair; readonly b: Pair; readonly dx: number; readonly dy: number; readonly length: number }

/** Linjen med punkter högst `step` m isär. */
export function densify(points: readonly (readonly [number, number])[], step = STEP): Pair[] {
  const out: Pair[] = [[points[0]![0], points[0]![1]]];
  for (let k = 1; k < points.length; k += 1) {
    const [ax, ay] = points[k - 1]!, [bx, by] = points[k]!, n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let t = 1; t <= n; t += 1) out.push([ax + (bx - ax) * t / n, ay + (by - ay) * t / n]);
  }
  return out;
}

/** Sträckorna i rutor om `cell` m, för att hitta de närmaste. */
class SegmentIndex {
  private readonly cells = new Map<string, Segment[]>();
  constructor(lines: readonly (readonly Pair[])[], private readonly cell: number) {
    for (const line of lines) for (let k = 1; k < line.length; k += 1) {
      const a = line[k - 1]!, b = line[k]!, dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
      if (length < 1e-6) continue;
      const segment = { a, b, dx: dx / length, dy: dy / length, length };
      for (let x = Math.floor(Math.min(a[0], b[0]) / cell); x <= Math.floor(Math.max(a[0], b[0]) / cell); x += 1)
        for (let y = Math.floor(Math.min(a[1], b[1]) / cell); y <= Math.floor(Math.max(a[1], b[1]) / cell); y += 1) {
          const key = `${x},${y}`, list = this.cells.get(key);
          if (list) list.push(segment); else this.cells.set(key, [segment]);
        }
    }
  }
  /** Närmaste punkten inom `reach` på en sträcka som är parallell med riktningen (dx, dy) inom `cos`. */
  nearest(point: Pair, dx: number, dy: number, reach: number, cos: number): { at: Pair; distance: number } | undefined {
    let best: { at: Pair; distance: number } | undefined;
    const x0 = Math.floor((point[0] - reach) / this.cell), x1 = Math.floor((point[0] + reach) / this.cell);
    const y0 = Math.floor((point[1] - reach) / this.cell), y1 = Math.floor((point[1] + reach) / this.cell);
    for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) for (const segment of this.cells.get(`${x},${y}`) ?? []) {
      if (Math.abs(segment.dx * dx + segment.dy * dy) < cos) continue;
      const t = Math.max(0, Math.min(segment.length, (point[0] - segment.a[0]) * segment.dx + (point[1] - segment.a[1]) * segment.dy));
      const at: Pair = [segment.a[0] + segment.dx * t, segment.a[1] + segment.dy * t], distance = Math.hypot(at[0] - point[0], at[1] - point[1]);
      if (distance <= reach && (!best || distance < best.distance)) best = { at, distance };
    }
    return best;
  }
}

/** Riktningen vid punkt k (över ±2 punkter). */
function directionAt(points: readonly Pair[], k: number): Pair {
  const a = points[Math.max(0, k - 2)]!, b = points[Math.min(points.length - 1, k + 2)]!, dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1;
  return [dx / n, dy / n];
}

/** Douglas–Peucker. */
function simplify(points: readonly Pair[], tolerance: number): Pair[] {
  if (points.length <= 2) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!, [ax, ay] = points[first]!, [bx, by] = points[last]!, length = Math.hypot(bx - ax, by - ay);
    let worst = -1, index = -1;
    for (let k = first + 1; k < last; k += 1) {
      const [px, py] = points[k]!;
      const distance = length < 1e-9 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length;
      if (distance > worst) { worst = distance; index = k; }
    }
    if (worst > tolerance) { keep[index] = 1; stack.push([first, index], [index, last]); }
  }
  return points.filter((_, k) => keep[k]);
}

const pointsOf = (feature: SourceFeature): readonly (readonly [number, number])[] => feature.geometry.kind === "line" ? feature.geometry.points : [];
const keyOf = ([x, y]: readonly [number, number]) => `${Math.round(x * 2)},${Math.round(y * 2)}`;

/** Förskjutningen per punkt: där fåran matchar längs minst `minRun` m, utjämnad och avtonad mot ändarna och de fasta punkterna. */
function offsets(points: readonly Pair[], index: SegmentIndex, fixed: readonly boolean[], settings: PathSnapSettings): Pair[] | undefined {
  const cos = Math.cos(settings.maxAngle * Math.PI / 180), n = points.length;
  const raw: (Pair | undefined)[] = points.map((point, k) => {
    const [dx, dy] = directionAt(points, k), hit = index.nearest(point, dx, dy, settings.maxShift, cos);
    return hit ? [hit.at[0] - point[0], hit.at[1] - point[1]] : undefined;
  });
  // Glapp på upp till 10 m inom en träff fylls i (fåran kan ha ett hål); sedan räknas träffarnas sträckor.
  const gap = Math.round(10 / STEP);
  for (let k = 0; k < n; k += 1) if (!raw[k]) {
    const before = k - 1;
    let after = k + 1;
    while (after < n && !raw[after] && after - before <= gap) after += 1;
    if (before >= 0 && raw[before] && after < n && raw[after] && after - before <= gap + 1) {
      for (let m = before + 1; m < after; m += 1) { const t = (m - before) / (after - before); raw[m] = [raw[before][0] + (raw[after]![0] - raw[before][0]) * t, raw[before][1] + (raw[after]![1] - raw[before][1]) * t]; }
      k = after;
    }
  }
  const weight = new Float64Array(n), out: Pair[] = points.map(() => [0, 0]);
  let any = false;
  for (let k = 0; k < n;) {
    if (!raw[k]) { k += 1; continue; }
    let end = k;
    while (end + 1 < n && raw[end + 1]) end += 1;
    if ((end - k) * STEP >= settings.minRun) { for (let m = k; m <= end; m += 1) { weight[m] = 1; out[m] = raw[m]!; } any = true; }
    k = end + 1;
  }
  if (!any) return undefined;
  // Utjämning längs stigen (glidande medel över ±smooth/2 m) bara inom träffarna.
  const half = Math.max(1, Math.round(settings.smooth / 2 / STEP)), smooth: Pair[] = out.map(() => [0, 0]);
  for (let k = 0; k < n; k += 1) {
    if (!weight[k]) continue;
    let sx = 0, sy = 0, count = 0;
    for (let m = Math.max(0, k - half); m <= Math.min(n - 1, k + half); m += 1) if (weight[m]) { sx += out[m]![0]; sy += out[m]![1]; count += 1; }
    smooth[k] = [sx / count, sy / count];
  }
  // Avtoning: vikten går mot noll inom `taper` m från en punkt som inte matchar eller är fast (korsningar).
  const reach = Math.max(1, Math.round(settings.taper / STEP)), distance = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
  for (let k = 0; k < n; k += 1) if (!weight[k] || fixed[k]) distance[k] = 0;
  for (let k = 1; k < n; k += 1) distance[k] = Math.min(distance[k]!, distance[k - 1]! + 1);
  for (let k = n - 2; k >= 0; k -= 1) distance[k] = Math.min(distance[k]!, distance[k + 1]! + 1);
  // Längs utan träff eller fast punkt i någon ände tonas inte av: hela linjen ligger i fåran.
  return smooth.map(([x, y], k) => { const w = Number.isFinite(distance[k]!) ? Math.min(1, distance[k]! / reach) : 1; return [x * w, y * w]; });
}

/**
 * OpenStreetMaps stigar flyttade till laserns fåror och fårorna utan de delar som redan är en stig eller väg.
 * Alla koordinater i meter (SWEREF 99 TM).
 */
export function snapPathsToTracks(features: readonly SourceFeature[], settings: PathSnapSettings = DEFAULT_PATH_SNAP): { features: SourceFeature[]; moved: number } {
  const tracks = features.filter(feature => feature.layer === LASER_TRACK_LAYER && feature.geometry.kind === "line");
  if (!tracks.length) return { features: [...features], moved: 0 };
  const trackLines = tracks.map(feature => densify(pointsOf(feature)));
  const index = new SegmentIndex(trackLines, 25);
  // Korsningar: punkter som finns i mer än en av OpenStreetMaps linjer.
  const lines = features.filter(feature => feature.geometry.kind === "line" && ALONG.test(feature.layer));
  const uses = new Map<string, number>();
  for (const feature of lines) for (const key of new Set(pointsOf(feature).map(keyOf))) uses.set(key, (uses.get(key) ?? 0) + 1);
  let moved = 0;
  const out = features.map(feature => {
    if (feature.geometry.kind !== "line" || !MOVABLE.test(feature.layer) || feature.geometry.points.length < 2) return feature;
    const original = feature.geometry.points;
    // De fasta punkterna (korsningar) hålls kvar exakt; de täta punkterna emellan flyttas.
    const points: Pair[] = [], fixed: boolean[] = [];
    for (let k = 0; k < original.length; k += 1) {
      const piece = k === 0 ? [[original[0]![0], original[0]![1]] as Pair] : densify([original[k - 1]!, original[k]!]).slice(1);
      piece.forEach((point, m) => { points.push(point); fixed.push(m === piece.length - 1 && (uses.get(keyOf(original[k]!)) ?? 0) > 1); });
    }
    const shift = offsets(points, index, fixed, settings);
    if (!shift) return feature;
    moved += 1;
    const shifted = points.map(([x, y], k): Pair => fixed[k] ? [x, y] : [x + shift[k]![0], y + shift[k]![1]]);
    // Förenklingen behåller de fasta punkterna (de delas med andra linjer).
    const parts: Pair[][] = [];
    let start = 0;
    for (let k = 1; k < shifted.length; k += 1) if (fixed[k] || k === shifted.length - 1) { parts.push(simplify(shifted.slice(start, k + 1), 0.5)); start = k; }
    const joined = parts.flatMap((part, k) => k === 0 ? part : part.slice(1));
    return { ...feature, geometry: { ...feature.geometry, points: joined } };
  });
  // Fårorna längs (de flyttade) stigarna och vägarna tas bort; bitar under en minsta längd också.
  const along = new SegmentIndex(out.filter(feature => feature.geometry.kind === "line" && ALONG.test(feature.layer))
    .map(feature => densify(pointsOf(feature))), 25);
  const cos = Math.cos(settings.maxAngle * Math.PI / 180), kept: SourceFeature[] = [];
  tracks.forEach((track, t) => {
    const line = trackLines[t]!;
    let run: Pair[] = [];
    const flush = () => { if (run.length > 1 && (run.length - 1) * STEP >= settings.minRun) kept.push({ ...track, geometry: { kind: "line", closed: false, points: simplify(run, 0.5) } }); run = []; };
    line.forEach((point, k) => {
      const [dx, dy] = directionAt(line, k);
      if (along.nearest(point, dx, dy, settings.duplicate, cos)) flush(); else run.push(point);
    });
    flush();
  });
  return { features: [...out.filter(feature => feature.layer !== LASER_TRACK_LAYER), ...kept], moved };
}

/** Lagren där laserns fåror inte blir spår: åker och fruktodling ur marktäcket (plus `managed`, OpenStreetMaps odlade ytor). */
const FIELD_LAYERS = new Set(["aker", "fruktodling"]);
type Field = { rings: readonly (readonly (readonly [number, number])[])[]; minX: number; minY: number; maxX: number; maxY: number };

/**
 * Ägaren 2026-11-18 («ska inte vara på åkrar eftersom de kan ändras över året»): laserns fåror på åker är plogfåror, körspår och
 * diken mellan tegarna och ändras med säsongen. De delar av `spar_laser` som ligger på åker (marktäckets `aker` och
 * `fruktodling`, och `managed`) tas bort; bitar som blir kortare än `minRun` m tas också bort.
 */
export function tracksOffFields(features: readonly SourceFeature[], managed: readonly SourceFeature[] = [], minRun = DEFAULT_PATH_SNAP.minRun): SourceFeature[] {
  const fields: Field[] = [];
  for (const feature of [...features.filter(row => FIELD_LAYERS.has(row.layer.toLowerCase())), ...managed]) {
    const geometry = feature.geometry;
    const rings = (geometry.kind === "area" ? geometry.rings : geometry.kind === "line" && geometry.closed ? [geometry.points] : []).filter(ring => ring.length >= 3);
    if (!rings.length) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of rings[0]!) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    fields.push({ rings, minX, minY, maxX, maxY });
  }
  if (!fields.length || !features.some(feature => feature.layer === LASER_TRACK_LAYER)) return [...features];
  // Inne i någon åker (jämn–udda inom åkerns egna ringar: ett hål räknas som utanför).
  const onField = ([x, y]: Pair) => fields.some(field => {
    if (x < field.minX || x > field.maxX || y < field.minY || y > field.maxY) return false;
    let inside = false;
    for (const ring of field.rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
      if (yi > y !== yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });
  const out: SourceFeature[] = [];
  for (const feature of features) {
    if (feature.layer !== LASER_TRACK_LAYER || feature.geometry.kind !== "line") { out.push(feature); continue; }
    const line = densify(feature.geometry.points);
    let run: Pair[] = [];
    const flush = () => { if (run.length > 1 && (run.length - 1) * STEP >= minRun) out.push({ ...feature, geometry: { kind: "line", closed: false, points: simplify(run, 0.5) } }); run = []; };
    for (const point of line) { if (onField(point)) flush(); else run.push(point); }
    flush();
  }
  return out;
}
