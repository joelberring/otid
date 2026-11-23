import type { Point } from "@o-tid/map-file";

/**
 * Trappor ur ritade trappsteg (ägaren 2026-11-23, Stockholms baskarta i en sprintkarta: «ritade trappor ersattes automatiskt av
 * trappsymbol i lämplig längd och bredd … annars blir det ett virrvarr av streck»). Baskartor ritar varje steg som en egen kort
 * linje och trappans sidor eller kontur som andra linjer. Här blir stegen trappor: korta raka linjer som ligger nästan
 * parallellt, sida vid sida och med jämnt avstånd (0,1–1,5 m) kedjas ihop till ett trapplopp; lopp som fortsätter i samma
 * riktning efter en kort vilplan blir en trappa. Varje trappa blir en mittlinje i gångriktningen från första till sista steget
 * (genom stegens mittpunkter, utjämnad), med bredden = stegens typiska längd. Sidolinjer, konturer och ensamma steg i ett lager
 * med trappsteg och slutna konturer ritas inte (ägaren: «trappstegen ska ju förenklas så och symbolen gälla»); de räknas.
 *
 * Ren funktion i kartans mm; måtten i meter räknas om med `metresPerMm` (kartans skala / 1000).
 */
export interface StairInput { readonly points: readonly Point[]; readonly closed: boolean; readonly layer: string }
export interface Stair {
  /** Mittlinjen i gångriktningen (mm), förlängd mot normens tre grafiska steg. */
  readonly path: Point[];
  /** Trappans bredd (mm på kartan): stegens medianlängd. */
  readonly width: number;
  readonly steps: number;
  /** Lagret som de flesta stegen kom ur. */
  readonly layer: string;
}
export interface StairLayer {
  readonly layer: string;
  /** Linjer i lagret, trappor som byggts av dem, steg i trapporna och linjer som inte ritas (sidolinjer, ensamma steg). */
  readonly lines: number; readonly stairs: number; readonly steps: number; readonly dropped: number;
}
export interface StairResult {
  readonly stairs: Stair[];
  /** Linjer som ritas som förut: lager utan trappsteg (t.ex. OpenStreetMaps trappor, som redan är mittlinjer). */
  readonly kept: StairInput[];
  readonly layers: StairLayer[];
}

const STEP_MIN_M = 0.4, STEP_MAX_M = 15;
// Stegdjupet: vanliga trappor 0,25–0,45 m, slänttrappor i parker upp till 1,5 m.
const TREAD_MIN_M = 0.1, TREAD_MAX_M = 1.5;
const STEP_TURN = 15 * Math.PI / 180;
/** Vilplan: högst så här långt mellan två lopp som fortsätter i samma riktning (högst 30° sväng). */
const LANDING_M = 3, LANDING_TURN = 30 * Math.PI / 180;
/** Normens minsta längd: tre grafiska steg, 0,4 mm isär. */
export const STAIR_MIN_LENGTH_MM = 1.2;
/** Ett lager «har trappsteg» när minst så stor del av dess steglika linjer blev trappor. */
const STEP_LAYER_SHARE = 0.25;
/** Minst tre steglinjer (två steg upp): två linjer är oftast ett enda steg eller en kant i en gångväg. */
const MIN_STEPS = 3;

interface Step { readonly index: number; readonly mid: Point; readonly dir: Point; readonly length: number; readonly layer: string }

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const norm = (a: Point) => Math.hypot(a.x, a.y);
const unit = (a: Point): Point => { const length = norm(a) || 1; return { x: a.x / length, y: a.y / length }; };
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 0; };

/** Ett steg: en öppen, nästan rak linje av rimlig längd. */
function stepOf(line: StairInput, index: number, metre: number): Step | undefined {
  if (line.closed || line.points.length < 2) return undefined;
  const a = line.points[0]!, b = line.points[line.points.length - 1]!;
  const chord = sub(b, a), length = norm(chord);
  if (length < STEP_MIN_M * metre || length > STEP_MAX_M * metre) return undefined;
  const tolerance = Math.max(0.05 * metre, 0.03 * length);
  for (const point of line.points) if (Math.abs(chord.x * (a.y - point.y) - (a.x - point.x) * chord.y) / length > tolerance) return undefined;
  // Riktningen modulo 180°: x ≥ 0 (och uppåt när den är lodrät).
  const dir = unit(chord.x < 0 || (chord.x === 0 && chord.y < 0) ? { x: -chord.x, y: -chord.y } : chord);
  return { index, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dir, length, layer: line.layer };
}

/** Grannen framför och bakom varje steg (närmast i gångriktningen bland stegen som får ligga intill). */
function neighbours(steps: readonly Step[], metre: number): [number, number][] {
  const cell = 2 * metre;
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number) => `${x},${y}`;
  steps.forEach((step, at) => {
    const k = key(Math.floor(step.mid.x / cell), Math.floor(step.mid.y / cell));
    const list = grid.get(k); if (list) list.push(at); else grid.set(k, [at]);
  });
  const links: [number, number][] = [];
  steps.forEach((step, at) => {
    const normal = { x: -step.dir.y, y: step.dir.x };
    const reach = TREAD_MAX_M * metre + 0.35 * step.length + 0.1 * metre, cells = Math.ceil(reach / cell);
    const cx = Math.floor(step.mid.x / cell), cy = Math.floor(step.mid.y / cell);
    const best: [number, number] = [-1, -1], bestScore = [Infinity, Infinity];
    for (let gx = cx - cells; gx <= cx + cells; gx += 1) for (let gy = cy - cells; gy <= cy + cells; gy += 1) {
      for (const other of grid.get(key(gx, gy)) ?? []) {
        if (other === at) continue;
        const next = steps[other]!;
        if (Math.acos(Math.min(1, Math.abs(dot(step.dir, next.dir)))) > STEP_TURN) continue;
        if (Math.min(step.length, next.length) < 0.5 * Math.max(step.length, next.length)) continue;
        const offset = sub(next.mid, step.mid), across = dot(offset, normal), along = Math.abs(dot(offset, step.dir));
        // Sida vid sida (inte i förlängningen av varandra, som två lopp bredvid varandra) och ett steg bort.
        if (Math.abs(across) < TREAD_MIN_M * metre || Math.abs(across) > TREAD_MAX_M * metre) continue;
        if (along > 0.35 * Math.min(step.length, next.length) + 0.1 * metre) continue;
        const side = across > 0 ? 0 : 1, score = Math.abs(across) + along;
        if (score < bestScore[side]!) { bestScore[side] = score; best[side] = other; }
      }
    }
    for (const other of best) if (other >= 0) links.push([at, other]);
  });
  return links;
}

/** Stegen i ordning längs loppet: längs kedjan när den är ogrenad, annars efter läget längs trappans riktning. */
function ordered(members: number[], adjacency: Map<number, Set<number>>, steps: readonly Step[]): number[] {
  const degree = (at: number) => adjacency.get(at)?.size ?? 0;
  if (members.every(at => degree(at) <= 2)) {
    const start = members.find(at => degree(at) <= 1);
    if (start !== undefined) {
      const order = [start], seen = new Set(order);
      for (let at = start; ;) {
        const next = [...adjacency.get(at) ?? []].find(other => !seen.has(other));
        if (next === undefined) break;
        order.push(next); seen.add(next); at = next;
      }
      if (order.length === members.length) return order;
    }
  }
  // Medelriktningen (dubbla vinkeln, så att motsatta riktningar räknas lika) och sortering längs normalen.
  let sx = 0, sy = 0;
  for (const at of members) { const { dir } = steps[at]!; sx += dir.x * dir.x - dir.y * dir.y; sy += 2 * dir.x * dir.y; }
  const angle = Math.atan2(sy, sx) / 2, normal = { x: -Math.sin(angle), y: Math.cos(angle) };
  return [...members].sort((a, b) => dot(steps[a]!.mid, normal) - dot(steps[b]!.mid, normal));
}

/** Mittpunkterna utjämnade (glidande medel över tre) och förenklade (Douglas–Peucker). */
function centreline(mids: readonly Point[], tolerance: number): Point[] {
  const smooth = mids.map((point, at) => at === 0 || at === mids.length - 1 ? point
    : { x: (mids[at - 1]!.x + point.x + mids[at + 1]!.x) / 3, y: (mids[at - 1]!.y + point.y + mids[at + 1]!.y) / 3 });
  const keep = new Array<boolean>(smooth.length).fill(false);
  keep[0] = true; keep[smooth.length - 1] = true;
  const stack: [number, number][] = [[0, smooth.length - 1]];
  while (stack.length) {
    const [from, to] = stack.pop()!;
    const a = smooth[from]!, chord = sub(smooth[to]!, a), length = norm(chord);
    let worst = -1, distance = tolerance;
    for (let at = from + 1; at < to; at += 1) {
      const offset = sub(smooth[at]!, a);
      const d = length === 0 ? norm(offset) : Math.abs(chord.x * offset.y - chord.y * offset.x) / length;
      if (d > distance) { distance = d; worst = at; }
    }
    if (worst >= 0) { keep[worst] = true; stack.push([from, worst], [worst, to]); }
  }
  return smooth.filter((_, at) => keep[at]);
}

interface Flight { path: Point[]; widths: number[]; layers: string[] }

/** Lopp som fortsätter efter en kort vilplan (samma riktning, liknande bredd) slås ihop till en trappa. */
function joinFlights(flights: Flight[], metre: number): Flight[] {
  const direction = (path: readonly Point[], atEnd: boolean) => atEnd ? unit(sub(path[path.length - 1]!, path[path.length - 2]!)) : unit(sub(path[0]!, path[1]!));
  const endOf = (path: readonly Point[], atEnd: boolean) => atEnd ? path[path.length - 1]! : path[0]!;
  const alive = flights.map(() => true), widths = flights.map(flight => median(flight.widths));
  // Ändarna i ett rutnät; en ände som inte längre är en ände på sitt lopp hoppas över.
  const cell = LANDING_M * metre, grid = new Map<string, number[]>();
  const key = (x: number, y: number) => `${x},${y}`;
  const index = (at: number) => {
    for (const atEnd of [false, true]) {
      const point = endOf(flights[at]!.path, atEnd), k = key(Math.floor(point.x / cell), Math.floor(point.y / cell));
      const list = grid.get(k); if (list) list.push(at); else grid.set(k, [at]);
    }
  };
  flights.forEach((_, at) => index(at));
  for (let a = 0; a < flights.length; a += 1) {
    for (let grown = true; grown && alive[a];) {
      grown = false;
      for (const endA of [true, false]) {
        const one = flights[a]!, pa = endOf(one.path, endA), outA = direction(one.path, endA);
        const cx = Math.floor(pa.x / cell), cy = Math.floor(pa.y / cell);
        let found: { b: number; endB: boolean } | undefined;
        for (let gx = cx - 1; gx <= cx + 1 && !found; gx += 1) for (let gy = cy - 1; gy <= cy + 1 && !found; gy += 1) {
          for (const b of grid.get(key(gx, gy)) ?? []) {
            if (b === a || !alive[b]) continue;
            if (Math.min(widths[a]!, widths[b]!) < 0.6 * Math.max(widths[a]!, widths[b]!)) continue;
            for (const endB of [false, true]) {
              const two = flights[b]!, gap = sub(endOf(two.path, endB), pa), distance = norm(gap);
              if (distance > LANDING_M * metre) continue;
              const outB = direction(two.path, endB);
              // Loppen pekar mot varandra och vilplanen ligger i deras förlängning.
              if (-dot(outA, outB) < Math.cos(LANDING_TURN)) continue;
              if (distance > 0 && dot(outA, unit(gap)) < Math.cos(LANDING_TURN)) continue;
              found = { b, endB }; break;
            }
            if (found) break;
          }
        }
        if (!found) continue;
        const two = flights[found.b]!;
        const first = endA ? one.path : [...one.path].reverse(), second = found.endB ? [...two.path].reverse() : two.path;
        flights[a] = { path: [...first, ...second], widths: [...one.widths, ...two.widths], layers: [...one.layers, ...two.layers] };
        widths[a] = median(flights[a]!.widths);
        alive[found.b] = false;
        index(a);
        grown = true;
        break;
      }
    }
  }
  return flights.filter((_, at) => alive[at]);
}

/**
 * Linjen förlängd lika mycket åt båda håll mot normens minsta längd `minimum` (mm), men högst till dubbla längden: en kort
 * trappa ska inte växa in i det som ligger runt den (normkontrollen visar den som för kort).
 */
function atLeast(path: Point[], minimum: number): Point[] {
  const length = path.reduce((sum, point, at) => at === 0 ? 0 : sum + norm(sub(point, path[at - 1]!)), 0);
  return length >= minimum || length === 0 ? path : extended(path, Math.min(minimum, 2 * length) / 2 - length / 2);
}

/** Linjen förlängd `extra` mm i båda ändar, i ändarnas riktning. */
function extended(path: Point[], extra: number): Point[] {
  if (path.length < 2 || extra <= 0) return path;
  const head = unit(sub(path[0]!, path[1]!)), tail = unit(sub(path[path.length - 1]!, path[path.length - 2]!));
  return [{ x: path[0]!.x + head.x * extra, y: path[0]!.y + head.y * extra }, ...path.slice(1, -1),
    { x: path[path.length - 1]!.x + tail.x * extra, y: path[path.length - 1]!.y + tail.y * extra }];
}

/** Trapporna ur linjerna i trapplagren (kartans mm, `metresPerMm` = skalan / 1000). */
export function stairsFromSteps(lines: readonly StairInput[], metresPerMm: number): StairResult {
  const metre = 1 / metresPerMm;
  const steps: Step[] = [];
  lines.forEach((line, index) => { const step = stepOf(line, index, metre); if (step) steps.push(step); });
  const adjacency = new Map<number, Set<number>>();
  for (const [a, b] of neighbours(steps, metre)) {
    for (const [from, to] of [[a, b], [b, a]] as const) { const set = adjacency.get(from); if (set) set.add(to); else adjacency.set(from, new Set([to])); }
  }
  // Loppen: sammanhängande steg.
  const seen = new Set<number>(), flights: Flight[] = [], used = new Set<number>();
  for (let start = 0; start < steps.length; start += 1) {
    if (seen.has(start) || !adjacency.has(start)) continue;
    const members: number[] = [], queue = [start];
    seen.add(start);
    while (queue.length) {
      const at = queue.pop()!;
      members.push(at);
      for (const other of adjacency.get(at) ?? []) if (!seen.has(other)) { seen.add(other); queue.push(other); }
    }
    if (members.length < MIN_STEPS) continue;
    const order = ordered(members, adjacency, steps);
    for (const at of order) used.add(steps[at]!.index);
    // Första och sista steglinjen är stegens framkanter: trappan räcker ett halvt steg längre åt båda håll.
    const mids = order.map(at => steps[at]!.mid);
    const tread = median(mids.slice(1).map((point, at) => norm(sub(point, mids[at]!))));
    flights.push({ path: extended(centreline(mids, 0.15 * metre), tread / 2), widths: order.map(at => steps[at]!.length),
      layers: order.map(at => steps[at]!.layer) });
  }
  const stairs: Stair[] = joinFlights(flights, metre).map(flight => {
    const counts = new Map<string, number>();
    for (const layer of flight.layers) counts.set(layer, (counts.get(layer) ?? 0) + 1);
    const layer = [...counts].sort((a, b) => b[1] - a[1])[0]![0];
    return { path: atLeast(flight.path, STAIR_MIN_LENGTH_MM), width: median(flight.widths), steps: flight.widths.length, layer };
  });
  // Lagren: ett lager med trappsteg ritar bara trapporna; i andra lager (OpenStreetMaps mittlinjer) ritas öppna linjer som förut.
  const stepLike = new Map<string, number>(), grouped = new Map<string, number>();
  for (const step of steps) {
    stepLike.set(step.layer, (stepLike.get(step.layer) ?? 0) + 1);
    if (used.has(step.index)) grouped.set(step.layer, (grouped.get(step.layer) ?? 0) + 1);
  }
  const stepLayer = (layer: string) => (grouped.get(layer) ?? 0) >= 2 && (grouped.get(layer) ?? 0) >= STEP_LAYER_SHARE * (stepLike.get(layer) ?? 0);
  const kept: StairInput[] = [];
  const rows = new Map<string, { lines: number; stairs: number; steps: number; dropped: number }>();
  const row = (layer: string) => { let found = rows.get(layer); if (!found) { found = { lines: 0, stairs: 0, steps: 0, dropped: 0 }; rows.set(layer, found); } return found; };
  lines.forEach((line, index) => {
    const at = row(line.layer);
    at.lines += 1;
    if (used.has(index)) { at.steps += 1; return; }
    // En sluten linje är en kontur (en trappsymbol runt en ring är aldrig rätt).
    if (line.closed || stepLayer(line.layer)) at.dropped += 1; else kept.push(line);
  });
  for (const stair of stairs) row(stair.layer).stairs += 1;
  return { stairs, kept, layers: [...rows].map(([layer, counts]) => ({ layer, ...counts })) };
}

/** En trappsymbol och dess bredd i meter (ur namnet, t.ex. «Stairway, 1.6 m» eller «Trappa (2,8 m)»), om namnet anger den. */
export interface StairSymbol { readonly id: string; readonly widthM?: number | undefined }
export function stairWidthOfName(name: string | undefined): number | undefined {
  const found = name ? /(\d+(?:[.,]\d+)?)\s*m\b/.exec(name) : null;
  const value = found ? Number(found[1]!.replace(",", ".")) : NaN;
  return value > 0 && value < 50 ? value : undefined;
}

/**
 * Trappans linjer i kartans symboler: varianten vars bredd ligger närmast trappans (`chosen` om ingen symbol anger bredd).
 * En trappa mycket bredare än den bredaste varianten fylls med flera parallella linjer, så att trappsymbolen täcker hela bredden.
 */
export function stairLines(stair: Stair, chosen: string, symbols: readonly StairSymbol[], metresPerMm: number): { symbol: string; path: Point[] }[] {
  const sized = symbols.filter((symbol): symbol is StairSymbol & { widthM: number } => symbol.widthM !== undefined);
  if (sized.length === 0) return [{ symbol: chosen, path: stair.path }];
  const width = stair.width * metresPerMm;
  const nearest = [...sized].sort((a, b) => Math.abs(a.widthM - width) - Math.abs(b.widthM - width))[0]!;
  const widest = [...sized].sort((a, b) => b.widthM - a.widthM)[0]!;
  if (width < 1.6 * widest.widthM) return [{ symbol: nearest.id, path: stair.path }];
  const copies = Math.round(width / widest.widthM), spread = (width - widest.widthM) / metresPerMm;
  return Array.from({ length: copies }, (_, copy) => ({ symbol: widest.id, path: offset(stair.path, (copy / (copies - 1) - 0.5) * spread) }));
}

/** Linjen flyttad `distance` mm åt vänster (negativt: höger), hörnen längs medelnormalen. */
function offset(path: readonly Point[], distance: number): Point[] {
  return path.map((point, at) => {
    const before = at > 0 ? unit(sub(point, path[at - 1]!)) : undefined, after = at < path.length - 1 ? unit(sub(path[at + 1]!, point)) : undefined;
    const dir = unit({ x: (before?.x ?? 0) + (after?.x ?? 0), y: (before?.y ?? 0) + (after?.y ?? 0) });
    return { x: point.x - dir.y * distance, y: point.y + dir.x * distance };
  });
}
