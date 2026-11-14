/**
 * Ägaren 2026-11-14 (Lida och Arboga: «kartan har varit lite skev från början … om en sten ska ligga precis ovanför kurvan
 * så måste den fortsätta göra det»): en äldre karta passas in mot laserns mark med ett mjukt fält av lokala förskjutningar.
 * En höjdkurva ska ligga på jämn höjd; kartans kurvor delas i bitar om `piece` m, och för varje nod i ett rutnät söks den
 * flytt av bitarna runt noden som ger minst avvikelse från jämn höjd i laserns höjdmodell. Grannoder hålls ihop (en flytt
 * som avviker från grannarnas kostar), så att fältet blir mjukt och inte följer brus. Noderna blir passpunkter (där något
 * ligger nu → där det ska ligga) för gummiduken i `warp.ts`, som flyttar alla kartans objekt; föremålen följer då med
 * kurvorna de är ritade mot.
 *
 * Mätt på Arboga (12,7 km²): flytten är 12 m i median, och föremål som inte var med i uträkningen hamnar bättre – branterna
 * på brantare mark (0,22 → 0,33), punkthöjderna närmare laserns kullar (15 → 27 % inom 5 m), grönt och byggnader likaså.
 *
 * Ren räkning utan I/O, i tre steg så att webbläsaren kan visa förloppet: `terrainFitPlan`, `terrainNodeCost` per nod och
 * `terrainFitSolve`. Koordinater i meter (höjdmodellens koordinatsystem).
 */
type Position = readonly [number, number];
export interface TerrainFitOptions {
  /** Avståndet mellan noderna och radien som en nod samlar kurvbitar inom (m). */
  readonly step?: number; readonly radius?: number;
  /** Största flytt som prövas åt varje håll, och stegen mellan prövade flyttar (m). */
  readonly reach?: number; readonly grid?: number;
  /** Kurvbitarnas längd och avståndet mellan proven längs dem (m). */
  readonly piece?: number; readonly sample?: number;
  /** Vad en meters avvikelse från grannodernas flytt kostar (meter höjdavvikelse per meter). */
  readonly smooth?: number;
  /** En nod behöver så här många kurvbitar. */
  readonly minPieces?: number;
}
const DEFAULTS = { step: 300, radius: 420, reach: 30, grid: 3, piece: 150, sample: 10, smooth: 0.005, minPieces: 12 } as const;

export interface TerrainFitPlan {
  readonly options: Required<TerrainFitOptions>;
  /** Kurvbitarna (provens koordinater, x och y omväxlande) och deras mittpunkter. */
  readonly pieces: readonly Float64Array[]; readonly centers: readonly Position[];
  readonly originX: number; readonly originY: number; readonly columns: number; readonly rows: number;
  /** Nodernas plats i rutnätet och kurvbitarna de räknas på. */
  readonly nodes: readonly { readonly column: number; readonly row: number; readonly at: Position; readonly pieces: readonly number[] }[];
}
export interface TerrainNode {
  readonly at: Position; readonly shift: Position; readonly pieces: number;
  /** Kurvbitarnas medianavvikelse från jämn höjd (m) utan flytt och med nodens flytt. */
  readonly before: number; readonly after: number;
}
export interface TerrainFit { readonly nodes: TerrainNode[]; readonly before: number; readonly after: number; readonly medianShift: number; readonly maxShift: number }

const median = (values: number[]) => { values.sort((a, b) => a - b); return values[values.length >> 1]!; };

/** Punkter med `step` m emellan längs linjen. */
function along(points: readonly Position[], step: number): Position[] {
  const out: Position[] = [points[0]!];
  let left = step;
  for (let i = 1; i < points.length; i += 1) {
    let from = points[i - 1]!;
    const to = points[i]!;
    let span = Math.hypot(to[0] - from[0], to[1] - from[1]);
    while (span >= left) {
      const t = left / span;
      from = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
      out.push(from); span -= left; left = step;
    }
    left -= span;
  }
  return out;
}

/** Kurvorna i bitar och noderna som har nog med bitar omkring sig. */
export function terrainFitPlan(contours: readonly (readonly Position[])[], options: TerrainFitOptions = {}): TerrainFitPlan {
  const used = { ...DEFAULTS, ...options }, count = Math.max(4, Math.round(used.piece / used.sample));
  const pieces: Float64Array[] = [], centers: Position[] = [];
  for (const contour of contours) {
    if (contour.length < 2) continue;
    const samples = along(contour, used.sample);
    for (let i = 0; i + count <= samples.length; i += count) {
      const piece = new Float64Array(count * 2);
      for (let k = 0; k < count; k += 1) { piece[k * 2] = samples[i + k]![0]; piece[k * 2 + 1] = samples[i + k]![1]; }
      pieces.push(piece); centers.push(samples[i + (count >> 1)]!);
    }
  }
  if (pieces.length === 0) return { options: used, pieces, centers, originX: 0, originY: 0, columns: 0, rows: 0, nodes: [] };
  const originX = Math.min(...centers.map(center => center[0])), originY = Math.min(...centers.map(center => center[1]));
  const columns = Math.floor((Math.max(...centers.map(center => center[0])) - originX) / used.step) + 2;
  const rows = Math.floor((Math.max(...centers.map(center => center[1])) - originY) / used.step) + 2;
  const nodes: TerrainFitPlan["nodes"][number][] = [];
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    const at: Position = [originX + column * used.step, originY + row * used.step];
    const near = centers.flatMap((center, index) => Math.hypot(center[0] - at[0], center[1] - at[1]) < used.radius ? [index] : []);
    if (near.length >= used.minPieces) nodes.push({ column, row, at, pieces: near });
  }
  return { options: used, pieces, centers, originX, originY, columns, rows, nodes };
}

/** Flyttarna som prövas: (2·reach/grid + 1)² stycken, rad för rad. */
const shiftsOf = (options: Required<TerrainFitOptions>) => {
  const side = Math.floor(2 * options.reach / options.grid) + 1, out: Position[] = [];
  for (let a = 0; a < side; a += 1) for (let b = 0; b < side; b += 1) out.push([-options.reach + a * options.grid, -options.reach + b * options.grid]);
  return out;
};

/**
 * En nods kostnad för varje prövad flytt: medianen av provens avvikelse från sin kurvbits medianhöjd. `heightAt` ger markens
 * höjd (inget utanför data). En flytt där för få prov har höjd får `Infinity`.
 */
export function terrainNodeCost(plan: TerrainFitPlan, index: number, heightAt: (x: number, y: number) => number | undefined): Float32Array {
  const node = plan.nodes[index]!, shifts = shiftsOf(plan.options), out = new Float32Array(shifts.length);
  const heights: number[] = [], all: number[] = [];
  shifts.forEach(([dx, dy], at) => {
    all.length = 0;
    for (const id of node.pieces) {
      const piece = plan.pieces[id]!;
      heights.length = 0;
      for (let k = 0; k < piece.length; k += 2) { const z = heightAt(piece[k]! + dx, piece[k + 1]! + dy); if (z !== undefined) heights.push(z); }
      if (heights.length < piece.length * 0.4) continue;
      const level = median([...heights]);
      for (const z of heights) all.push(Math.abs(z - level));
    }
    out[at] = all.length >= plan.options.minPieces * 4 ? median(all) : Infinity;
  });
  return out;
}

/** Nodernas flyttar: den billigaste flytten för varje nod när avvikelsen från grannarna (och flyttens storlek, svagt) kostar. */
export function terrainFitSolve(plan: TerrainFitPlan, costs: readonly Float32Array[]): TerrainFit {
  const { options, columns } = plan, shifts = shiftsOf(options), zero = shifts.findIndex(([dx, dy]) => dx === 0 && dy === 0);
  // En nod utan höjd under sig (utanför laserns område) säger ingenting och blir ingen passpunkt.
  const known = plan.nodes.map((_, index) => Number.isFinite(costs[index]![zero]!));
  const slot = new Map(plan.nodes.flatMap((node, index) => known[index] ? [[node.row * columns + node.column, index] as const] : []));
  const chosen = plan.nodes.map(() => zero);
  for (let pass = 0; pass < 8; pass += 1) {
    plan.nodes.forEach((node, index) => {
      if (!known[index]) return;
      let ax = 0, ay = 0, count = 0;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const other = slot.get((node.row + dr) * columns + node.column + dc);
        if (other === undefined) continue;
        ax += shifts[chosen[other]!]![0]; ay += shifts[chosen[other]!]![1]; count += 1;
      }
      if (count) { ax /= count; ay /= count; }
      let best = Infinity, pick = zero;
      costs[index]!.forEach((cost, at) => {
        const [dx, dy] = shifts[at]!;
        const total = cost + options.smooth * Math.hypot(dx - ax, dy - ay) + options.smooth * 0.3 * Math.hypot(dx, dy);
        if (total < best) { best = total; pick = at; }
      });
      chosen[index] = pick;
    });
  }
  const finite = (value: number) => Number.isFinite(value) ? value : 0;
  const nodes = plan.nodes.flatMap((node, index): TerrainNode[] => known[index] ? [{ at: node.at, shift: shifts[chosen[index]!]!, pieces: node.pieces.length,
    before: finite(costs[index]![zero]!), after: finite(costs[index]![chosen[index]!]!) }] : []);
  const mean = (pick: (node: TerrainNode) => number) => nodes.length ? Math.round(nodes.reduce((sum, node) => sum + pick(node), 0) / nodes.length * 100) / 100 : 0;
  const sizes = nodes.map(node => Math.hypot(node.shift[0], node.shift[1]));
  return { nodes, before: mean(node => node.before), after: mean(node => node.after), medianShift: sizes.length ? median([...sizes]) : 0, maxShift: Math.max(0, ...sizes) };
}

/** Alla tre stegen på en gång (för tester och servern). */
export function fitTerrain(contours: readonly (readonly Position[])[], heightAt: (x: number, y: number) => number | undefined, options: TerrainFitOptions = {}): TerrainFit {
  const plan = terrainFitPlan(contours, options);
  return terrainFitSolve(plan, plan.nodes.map((_, index) => terrainNodeCost(plan, index, heightAt)));
}
