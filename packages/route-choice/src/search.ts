/**
 * Steg 60 (ADR-0179 beslut 8): sökning i rutnätet med 16 grannar (8 närmaste plus springarhopp, mindre sicksack än 8).
 *
 * Kostnaden är "meter i normal skog": längd × tid per meter (medel över cellerna som steget passerar) plus stigning.
 * Stigningen räknas på höjdkurvornas lager (2 = kurva, 1 = hjälpkurva): summan av |skillnaden| längs stegets celler
 * delad med 4 är antalet ekvidistanser (in i och ut ur en kurva = en hel, en hjälpkurva = en halv). Kostnaden är
 * symmetrisk, så fälten från båda ändarna kan läggas ihop. Ett steg får bara gå genom passerbara celler: springarhoppet
 * kontrollerar sina två mellanceller och diagonalsteget båda hörncellerna, så att inget läcker genom en spärrlinje.
 */

export interface SearchGrid {
  readonly width: number;
  readonly height: number;
  readonly cellMeters: number;
  /** Tid per meter relativt normal skog; `Infinity` = spärrat. */
  readonly pace: Float32Array;
  readonly contour: Uint8Array;
  /** Kostnad (meter) per stigningsenhet = ekvidistans × stigningsfaktor / 4. */
  readonly climbCostPerUnit: number;
}

interface Direction { dx: number; dy: number; length: number; kind: 0 | 1 | 2; m1x: number; m1y: number; m2x: number; m2y: number }

function directions(): Direction[] {
  const out: Direction[] = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) out.push({ dx, dy, length: 1, kind: 0, m1x: 0, m1y: 0, m2x: 0, m2y: 0 });
  for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) out.push({ dx, dy, length: Math.SQRT2, kind: 1, m1x: dx, m1y: 0, m2x: 0, m2y: dy });
  for (const [dx, dy] of [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]] as const) {
    const sx = Math.sign(dx), sy = Math.sign(dy);
    const wide = Math.abs(dx) === 2;
    out.push({ dx, dy, length: Math.sqrt(5), kind: 2, m1x: wide ? sx : 0, m1y: wide ? 0 : sy, m2x: sx, m2y: sy });
  }
  return out;
}

const DIRECTIONS = directions();

/** Kostnaden för ett steg mellan två celler (vilket som helst av de 16), eller `Infinity`. Används utanför sökningen. */
export function stepCost(grid: SearchGrid, pace: Float32Array, from: number, to: number): { cost: number; climbUnits: number; meters: number } {
  const w = grid.width;
  const fc = from % w, fr = (from - fc) / w, tc = to % w, tr = (to - tc) / w;
  const direction = DIRECTIONS.find(d => d.dx === tc - fc && d.dy === tr - fr);
  if (!direction) return { cost: Infinity, climbUnits: 0, meters: 0 };
  const meters = direction.length * grid.cellMeters;
  const c = grid.contour;
  if (direction.kind === 2) {
    const m1 = from + direction.m1y * w + direction.m1x, m2 = from + direction.m2y * w + direction.m2x;
    const climbUnits = Math.abs(c[m1]! - c[from]!) + Math.abs(c[m2]! - c[m1]!) + Math.abs(c[to]! - c[m2]!);
    const cost = meters * (pace[from]! + pace[m1]! + pace[m2]! + pace[to]!) / 4 + climbUnits * grid.climbCostPerUnit;
    return { cost, climbUnits, meters };
  }
  if (direction.kind === 1 && (pace[from + direction.m1x] === Infinity || pace[from + direction.m2y * w] === Infinity)) {
    return { cost: Infinity, climbUnits: 0, meters };
  }
  const climbUnits = Math.abs(c[to]! - c[from]!);
  return { cost: meters * (pace[from]! + pace[to]!) / 2 + climbUnits * grid.climbCostPerUnit, climbUnits, meters };
}

/** Binär min-hög med flyttalsnycklar och lat borttagning. */
class Heap {
  keys = new Float64Array(1024);
  values = new Int32Array(1024);
  size = 0;
  push(key: number, value: number) {
    if (this.size === this.keys.length) {
      const keys = new Float64Array(this.size * 2); keys.set(this.keys); this.keys = keys;
      const values = new Int32Array(this.size * 2); values.set(this.values); this.values = values;
    }
    const keys = this.keys, values = this.values;
    let index = this.size++;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (keys[parent]! <= key) break;
      keys[index] = keys[parent]!; values[index] = values[parent]!;
      index = parent;
    }
    keys[index] = key; values[index] = value;
  }
  /** Tar bort det minsta; nyckeln finns kvar i `lastKey`. */
  lastKey = 0;
  pop(): number {
    const keys = this.keys, values = this.values;
    const top = values[0]!;
    this.lastKey = keys[0]!;
    const size = --this.size;
    if (size > 0) {
      const key = keys[size]!, value = values[size]!;
      let index = 0;
      for (;;) {
        let child = 2 * index + 1;
        if (child >= size) break;
        if (child + 1 < size && keys[child + 1]! < keys[child]!) child += 1;
        if (keys[child]! >= key) break;
        keys[index] = keys[child]!; values[index] = values[child]!;
        index = child;
      }
      keys[index] = key; values[index] = value;
    }
    return top;
  }
}

export interface SearchOptions {
  /** Stanna när målet är taget (A*). */
  readonly goal?: number;
  /** Cell som den nedre gränsen (fågelväg × minsta tid per meter) räknas mot: A*-mål eller beskärning av fältet. */
  readonly towards?: number;
  /** Lägsta tid per meter i rutnätet (för den nedre gränsen). */
  readonly minPace?: number;
  /** Beskär celler där kostnad + nedre gräns till `towards` är större än detta. */
  readonly bound?: number;
}

export interface SearchResult {
  readonly cost: Float64Array;
  readonly parent: Int32Array;
}

/**
 * Dijkstra från `start`. Med `goal` blir det A* (nedre gräns mot målet) och sökningen stannar vid målet; med `bound`
 * beskärs celler som inte kan ligga på en väg under gränsen. `parent` = −1 för start och ej nådda celler.
 */
export function search(grid: SearchGrid, pace: Float32Array, start: number, options: SearchOptions = {}): SearchResult {
  const w = grid.width, h = grid.height, n = w * h;
  const cost = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const c = grid.contour;
  const climb = grid.climbCostPerUnit;
  const towards = options.towards ?? options.goal;
  const goal = options.goal ?? -1;
  const bound = options.bound ?? Infinity;
  const lower = (options.minPace ?? 0) * grid.cellMeters;
  const tc = towards === undefined ? 0 : towards % w, tr = towards === undefined ? 0 : (towards - tc) / w;
  const useLower = towards !== undefined && lower > 0;
  const heuristic = (index: number) => {
    if (!useLower) return 0;
    const col = index % w, dx = col - tc, dy = (index - col) / w - tr;
    return Math.sqrt(dx * dx + dy * dy) * lower;
  };
  const astar = goal >= 0;
  const count = DIRECTIONS.length;
  const dxs = Int32Array.from(DIRECTIONS, d => d.dx), dys = Int32Array.from(DIRECTIONS, d => d.dy);
  const offs = Int32Array.from(DIRECTIONS, d => d.dy * w + d.dx);
  const kinds = Uint8Array.from(DIRECTIONS, d => d.kind);
  const lens = Float64Array.from(DIRECTIONS, d => d.length * grid.cellMeters);
  const m1 = Int32Array.from(DIRECTIONS, d => d.m1y * w + d.m1x), m2 = Int32Array.from(DIRECTIONS, d => d.m2y * w + d.m2x);
  const heap = new Heap();
  if (!(pace[start]! < Infinity)) return { cost, parent };
  cost[start] = 0;
  heap.push(astar ? heuristic(start) : 0, start);
  while (heap.size > 0) {
    const u = heap.pop();
    if (done[u] === 1) continue;
    done[u] = 1;
    if (u === goal) break;
    const gu = cost[u]!;
    const pu = pace[u]!, cu = c[u]!;
    const col = u % w, row = (u - col) / w;
    for (let k = 0; k < count; k += 1) {
      const nc = col + dxs[k]!, nr = row + dys[k]!;
      if (nc < 0 || nr < 0 || nc >= w || nr >= h) continue;
      const v = u + offs[k]!;
      if (done[v] === 1) continue;
      const pv = pace[v]!;
      if (pv === Infinity) continue;
      let step: number;
      const kind = kinds[k]!;
      if (kind === 0) {
        step = lens[k]! * (pu + pv) * 0.5 + Math.abs(c[v]! - cu) * climb;
      } else if (kind === 1) {
        if (pace[u + m1[k]!] === Infinity || pace[u + m2[k]!] === Infinity) continue;
        step = lens[k]! * (pu + pv) * 0.5 + Math.abs(c[v]! - cu) * climb;
      } else {
        const a = u + m1[k]!, b = u + m2[k]!;
        const pa = pace[a]!, pb = pace[b]!;
        if (pa === Infinity || pb === Infinity) continue;
        const ca = c[a]!, cb = c[b]!;
        step = lens[k]! * (pu + pa + pb + pv) * 0.25 + (Math.abs(ca - cu) + Math.abs(cb - ca) + Math.abs(c[v]! - cb)) * climb;
      }
      const g = gu + step;
      if (g >= cost[v]!) continue;
      const hv = heuristic(v);
      if (g + hv > bound) continue;
      cost[v] = g;
      parent[v] = u;
      heap.push(astar ? g + hv : g, v);
    }
  }
  return { cost, parent };
}

/** Cellerna från start till `end` ur föräldrapekarna (tom om `end` inte nåddes). */
export function backtrack(parent: Int32Array, start: number, end: number): number[] {
  const out: number[] = [];
  let at = end;
  for (let guard = parent.length; guard > 0; guard -= 1) {
    out.push(at);
    if (at === start) return out.reverse();
    at = parent[at]!;
    if (at < 0) return [];
  }
  return [];
}

/** Lägsta ändliga tid per meter i fältet. */
export function minimumPace(pace: Float32Array): number {
  let min = Infinity;
  for (let index = 0; index < pace.length; index += 1) if (pace[index]! < min) min = pace[index]!;
  return Number.isFinite(min) ? min : 1;
}

/** Vägens kostnad, stigningsenheter och längd längs cellerna (för omvärdering med andra farter). */
export function pathCost(grid: SearchGrid, pace: Float32Array, cells: readonly number[]): { cost: number; climbUnits: number } {
  let cost = 0, climbUnits = 0;
  for (let index = 1; index < cells.length; index += 1) {
    const step = stepCost(grid, pace, cells[index - 1]!, cells[index]!);
    cost += step.cost;
    climbUnits += step.climbUnits;
  }
  return { cost, climbUnits };
}
