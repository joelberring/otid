/**
 * Släpstigar, körspår och stigar ur terrängformen (ägaren 2026-11-17: «en sak som man kanske kan se från flygbild är också
 * släpstigar … andra former än släpstigar också … om släpstigarna syns men har hål en liten bit kanske man får gissa att de
 * fortsätter mellan»). Prövat i Python på Järvsö östra (claude/slapstigar-prov-2026-11-17.md), här i TypeScript:
 *
 * 1. Den lokala reliefen (höjden minus medelhöjden inom 4 m, geo-ditches.ts) läggs på ett rutnät om 2 m.
 * 2. Ett linjefilter i 16 riktningar: en fåra är lägre än marken 4 m åt båda sidor, längs en 40 m lång sträcka. Svaret är
 *    medelvärdet av (sidornas medel − mitten) längs sträckan, och riktningen med störst svar vinner.
 * 3. Hysteres: celler över 95:e percentilen (och minst 6 cm) startar, celler över 88:e (och minst 3 cm) fyller ut; masken
 *    tunnas till mittlinjer.
 * 4. Mittlinjerna delas i skarpa krökar; bara raka bitar (rakhet ≥ 0,8, minst 24 m) är spår.
 * 5. Glapp: två ändar som pekar mot varandra (högst 25° fel) och ligger högst 50 m isär binds ihop, närmaste paret först.
 * 6. Kedjor kortare än 80 m tas bort (enstaka fåror är oftast stenrader, sprickor eller rotvältor).
 *
 * Det som till mer än hälften ligger i fuktig mark är diken (dikessteget tar dem) och tas inte med; vatten likaså.
 * Linjerna blir lagret `spar_laser` (förslag till kartans stig 507 och underlag för att flytta OpenStreetMaps stigar).
 *
 * Bara Nodes egna moduler (filen körs direkt av Node i avbildningen `otid-geo`).
 */
import { paths, thin, type GroundGrid } from "./geo-cliffs.ts";
import { simplify } from "./geo-moisture.ts";

export interface TrackSettings {
  /** Rutnätets cell i m. */ readonly cell: number;
  /** Sidornas avstånd från mitten, m. */ readonly side: number;
  /** Filtrets halva längd, m. */ readonly reach: number;
  readonly strong: number; readonly weak: number;
  /** Minsta svar (m) för att starta och fylla ut, oavsett percentilen: på jämn mark är även den 95:e percentilen brus. */
  readonly minStrong: number; readonly minWeak: number;
  /** Minsta raka bit, m. */ readonly minPiece: number;
  /** Största glapp som binds ihop, m. */ readonly maxGap: number;
  /** Största vinkelfel för ett glapp, grader. */ readonly maxAngle: number;
  /** Minsta kedja, m. */ readonly minChain: number;
}
export const DEFAULT_TRACKS: TrackSettings = { cell: 2, side: 4, reach: 20, strong: 0.95, weak: 0.88, minStrong: 0.06, minWeak: 0.03, minPiece: 24, maxGap: 50, maxAngle: 25, minChain: 80 };
const DIRECTIONS = 16;
const MAX_TRACKS = 20_000;

type Pair = [number, number];
const length = (points: readonly Pair[]) => { let sum = 0; for (let k = 1; k < points.length; k += 1) sum += Math.hypot(points[k]![0] - points[k - 1]![0], points[k]![1] - points[k - 1]![1]); return sum; };

/** Reliefen som medel över celler om `factor` × `factor` (NaN där ingen mark finns). Index x·höjd + y. */
function coarse(relief: Float32Array, width: number, height: number, factor: number): { grid: Float32Array; w: number; h: number } {
  const w = Math.floor(width / factor), h = Math.floor(height / factor), grid = new Float32Array(w * h);
  for (let x = 0; x < w; x += 1) for (let y = 0; y < h; y += 1) {
    let sum = 0, n = 0;
    for (let ax = 0; ax < factor; ax += 1) for (let ay = 0; ay < factor; ay += 1) {
      const value = relief[(x * factor + ax) * height + y * factor + ay]!;
      if (Number.isFinite(value)) { sum += value; n += 1; }
    }
    grid[x * h + y] = n ? sum / n : Number.NaN;
  }
  return { grid, w, h };
}

/** Linjefiltrets svar (störst över riktningarna) per cell; 0 vid kanten och där marken saknas. */
export function trackResponse(grid: Float32Array, w: number, h: number, sideCells: number, reachCells: number): Float32Array {
  const best = new Float32Array(w * h), profile = new Float32Array(w * h);
  for (let d = 0; d < DIRECTIONS; d += 1) {
    const angle = Math.PI * d / DIRECTIONS, ux = Math.cos(angle), uy = Math.sin(angle);
    const nx = Math.round(-uy * sideCells), ny = Math.round(ux * sideCells);
    // Tvärprofilen: sidornas medel minus mitten (positivt i en fåra).
    for (let x = 0; x < w; x += 1) for (let y = 0; y < h; y += 1) {
      const i = x * h + y, ax = x + nx, ay = y + ny, bx = x - nx, by = y - ny;
      if (ax < 0 || ay < 0 || bx < 0 || by < 0 || ax >= w || ay >= h || bx >= w || by >= h) { profile[i] = 0; continue; }
      const value = (grid[ax * h + ay]! + grid[bx * h + by]!) / 2 - grid[i]!;
      profile[i] = Number.isFinite(value) ? value : 0;
    }
    // Medel längs riktningen.
    const offsets: number[] = [], steps: Pair[] = [];
    for (let t = -reachCells; t <= reachCells; t += 1) { const ox = Math.round(t * ux), oy = Math.round(t * uy); steps.push([ox, oy]); offsets.push(ox * h + oy); }
    const margin = reachCells + 1;
    for (let x = margin; x < w - margin; x += 1) for (let y = margin; y < h - margin; y += 1) {
      const i = x * h + y;
      let sum = 0;
      for (const offset of offsets) sum += profile[i + offset]!;
      const value = sum / offsets.length;
      if (value > best[i]!) best[i] = value;
    }
  }
  return best;
}

/** Värdet vid andelen `share` bland de positiva svaren (ungefärligt, med ett histogram). */
function quantile(values: Float32Array, share: number): number {
  let max = 0, n = 0;
  for (const value of values) if (value > 0) { n += 1; if (value > max) max = value; }
  if (!n) return Number.POSITIVE_INFINITY;
  const bins = 4096, counts = new Uint32Array(bins);
  for (const value of values) if (value > 0) counts[Math.min(bins - 1, Math.floor(value / max * bins))]! += 1;
  // Andelen räknas över alla celler med mark, som i provet (percentilen över hela bilden).
  const target = share * values.length;
  let below = values.length - n;
  for (let b = 0; b < bins; b += 1) { below += counts[b]!; if (below >= target) return (b + 1) / bins * max; }
  return max;
}

/** Spåren som linjer (SWEREF 99 TM). `wetAt` och `blockedAt` som för dikena. */
export function trackLines(ground: GroundGrid, relief: Float32Array, settings: TrackSettings = DEFAULT_TRACKS,
  wetAt?: (x: number, y: number) => boolean, blockedAt?: (x: number, y: number) => boolean): Pair[][] {
  const factor = Math.max(1, Math.round(settings.cell / ground.cell)), cell = ground.cell * factor;
  const { grid, w, h } = coarse(relief, ground.width, ground.height, factor);
  if (w < 8 || h < 8) return [];
  const response = trackResponse(grid, w, h, Math.max(1, Math.round(settings.side / cell)), Math.max(2, Math.round(settings.reach / cell)));
  const strong = Math.max(settings.minStrong, quantile(response, settings.strong)), weak = Math.max(settings.minWeak, quantile(response, settings.weak));
  // Hysteres: de svaga cellerna som hänger ihop med en stark.
  const mask = new Uint8Array(w * h), queue = new Int32Array(w * h);
  let tail = 0;
  for (let i = 0; i < mask.length; i += 1) if (response[i]! >= strong) { mask[i] = 1; queue[tail] = i; tail += 1; }
  for (let head = 0; head < tail; head += 1) {
    const i = queue[head]!, x = Math.floor(i / h), y = i - x * h;
    for (let ax = -1; ax <= 1; ax += 1) for (let ay = -1; ay <= 1; ay += 1) {
      const nx = x + ax, ny = y + ay;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = nx * h + ny;
      if (!mask[n] && response[n]! >= weak) { mask[n] = 1; queue[tail] = n; tail += 1; }
    }
  }
  const centre = (i: number): Pair => { const x = Math.floor(i / h), y = i - x * h; return [ground.minX + (x + 0.5) * cell, ground.minY + (y + 0.5) * cell]; };
  const pieces: Pair[][] = [];
  for (const path of paths(thin(mask, w, h), w, h, Math.max(3, Math.round(settings.minPiece / cell / Math.SQRT2)))) {
    for (const piece of straightPieces(simplify(path.map(centre), cell * 0.75), settings.minPiece)) {
      if (blockedAt && piece.some(point => blockedAt(...point))) continue;
      if (wetAt && densify(piece, cell).filter(point => wetAt(...point)).length * 2 > densify(piece, cell).length) continue;
      pieces.push(piece);
    }
  }
  return linkTracks(pieces, settings).map(line => simplify(line, cell * 0.5)).slice(0, MAX_TRACKS);
}

/** Punkter längs linjen med högst `step` m mellanrum. */
function densify(line: readonly Pair[], step: number): Pair[] {
  const out: Pair[] = [line[0]!];
  for (let k = 1; k < line.length; k += 1) {
    const [ax, ay] = line[k - 1]!, [bx, by] = line[k]!, n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let t = 1; t <= n; t += 1) out.push([ax + (bx - ax) * t / n, ay + (by - ay) * t / n]);
  }
  return out;
}

/** Linjen delad där den svänger mer än 35°; bitarna som är raka (korda ≥ 0,8 av längden) och långa nog. */
export function straightPieces(line: readonly Pair[], minLength: number): Pair[][] {
  const out: Pair[][] = [];
  let current: Pair[] = [line[0]!];
  const flush = () => {
    if (current.length >= 2) {
      const total = length(current), chord = Math.hypot(current.at(-1)![0] - current[0]![0], current.at(-1)![1] - current[0]![1]);
      if (total >= minLength && chord >= 0.8 * total) out.push(current);
    }
  };
  for (let k = 1; k < line.length; k += 1) {
    current.push(line[k]!);
    if (k + 1 < line.length) {
      const [ax, ay] = line[k - 1]!, [bx, by] = line[k]!, [cx, cy] = line[k + 1]!;
      const turn = Math.abs(Math.atan2((bx - ax) * (cy - by) - (by - ay) * (cx - bx), (bx - ax) * (cx - bx) + (by - ay) * (cy - by)));
      if (turn > Math.PI * 35 / 180) { flush(); current = [line[k]!]; }
    }
  }
  flush();
  return out;
}

/** Riktningen ut ur linjen vid änden (från punkten `back` m in mot änden). */
function endDirection(line: readonly Pair[], atStart: boolean, back = 15): Pair {
  const points = atStart ? [...line].reverse() : line, end = points.at(-1)!;
  let k = points.length - 2, walked = 0;
  while (k > 0 && walked < back) { walked += Math.hypot(points[k]![0] - points[k + 1]![0], points[k]![1] - points[k + 1]![1]); if (walked < back) k -= 1; }
  const from = points[Math.max(0, k)]!, dx = end[0] - from[0], dy = end[1] - from[1], n = Math.hypot(dx, dy) || 1;
  return [dx / n, dy / n];
}

/** Bitarna ihopbundna över glappen och kedjorna som är långa nog, som linjer (glappet blir en rak sträcka). */
export function linkTracks(pieces: readonly Pair[][], settings: Pick<TrackSettings, "maxGap" | "maxAngle" | "minChain">): Pair[][] {
  const ends = pieces.flatMap((line, piece) => [false, true].map(start => ({ piece, start, at: start ? line[0]! : line.at(-1)!, dir: endDirection(line, start) })));
  const cos = Math.cos(settings.maxAngle * Math.PI / 180), candidates: { gap: number; a: number; b: number }[] = [];
  // Ändarna i rutor om glappets storlek, så att bara grannar jämförs.
  const buckets = new Map<string, number[]>(), key = (x: number, y: number) => `${Math.floor(x / settings.maxGap)},${Math.floor(y / settings.maxGap)}`;
  ends.forEach((end, k) => { const id = key(...end.at); buckets.set(id, [...buckets.get(id) ?? [], k]); });
  ends.forEach((a, k) => {
    const bx = Math.floor(a.at[0] / settings.maxGap), by = Math.floor(a.at[1] / settings.maxGap);
    for (let ax = -1; ax <= 1; ax += 1) for (let ay = -1; ay <= 1; ay += 1) for (const m of buckets.get(`${bx + ax},${by + ay}`) ?? []) {
      if (m <= k || ends[m]!.piece === a.piece) continue;
      const b = ends[m]!, dx = b.at[0] - a.at[0], dy = b.at[1] - a.at[1], gap = Math.hypot(dx, dy);
      if (gap > settings.maxGap) continue;
      if (gap < 1) { candidates.push({ gap, a: k, b: m }); continue; }
      if ((a.dir[0] * dx + a.dir[1] * dy) / gap > cos && -(b.dir[0] * dx + b.dir[1] * dy) / gap > cos) candidates.push({ gap, a: k, b: m });
    }
  });
  candidates.sort((p, q) => p.gap - q.gap);
  const partner = new Int32Array(ends.length).fill(-1);
  // Ingen ring: bitarna i samma kedja binds inte ihop igen.
  const parent = pieces.map((_, k) => k), root = (k: number): number => { while (parent[k] !== k) { parent[k] = parent[parent[k]!]!; k = parent[k]!; } return k; };
  for (const { a, b } of candidates) {
    if (partner[a]! >= 0 || partner[b]! >= 0 || root(ends[a]!.piece) === root(ends[b]!.piece)) continue;
    partner[a] = b; partner[b] = a; parent[root(ends[a]!.piece)] = root(ends[b]!.piece);
  }
  // Kedjorna följs från en fri ände.
  const used = new Uint8Array(pieces.length), out: Pair[][] = [];
  for (let k = 0; k < ends.length; k += 1) {
    if (partner[k]! >= 0 || used[ends[k]!.piece]) continue;
    let line: Pair[] = [], end = k;
    while (end >= 0 && !used[ends[end]!.piece]) {
      const piece = ends[end]!.piece, points = pieces[piece]!;
      used[piece] = 1;
      line = line.concat(ends[end]!.start ? points : [...points].reverse());
      const other = end ^ 1;
      end = partner[other]!;
    }
    if (length(line) >= settings.minChain) out.push(line);
  }
  return out;
}
