import type { Edge, Graph } from "./node";

/**
 * Ytor ur linjer, steg 3: den plana grafen blir ytor. Hängande kanter tas bort, varje kant blir två halvkanter, och runt
 * varje nod sorteras de utgående halvkanterna efter vinkel. Från en halvkant går man vidare med nästa kant medurs från den
 * man kom på; då får man ytan till vänster. Varv moturs är ytors ytterkanter, varv medurs är en sammanhängande dels utsida:
 * den blir ett hål i den minsta ytan som omsluter delen, eller hör till ytterytan (som inte tas med).
 */
export interface Cycle {
  /** Noderna i ordning (utan upprepad första nod). */
  readonly nodes: number[];
  /** Kanternas nummer i grafen. */
  readonly edges: number[];
  /** Ytan med tecken: positiv moturs. */
  readonly area: number;
}

export interface RawFace { readonly outer: Cycle; readonly holes: Cycle[] }

function trace(graph: Graph, alive: Uint8Array): { cycles: Cycle[]; cycleOf: Int32Array } {
  const { xs, ys, edges } = graph;
  // Halvkant 2k går u→v och 2k+1 går v→u.
  const outgoing: number[][] = xs.map(() => []);
  edges.forEach((edge, index) => { if (alive[index]) { outgoing[edge.u]!.push(index * 2); outgoing[edge.v]!.push(index * 2 + 1); } });
  const tail = (half: number) => half % 2 === 0 ? edges[half >> 1]!.u : edges[half >> 1]!.v;
  const head = (half: number) => half % 2 === 0 ? edges[half >> 1]!.v : edges[half >> 1]!.u;
  const angle = new Float64Array(edges.length * 2);
  const place = new Int32Array(edges.length * 2);
  outgoing.forEach((list, node) => {
    for (const half of list) angle[half] = Math.atan2(ys[head(half)]! - ys[node]!, xs[head(half)]! - xs[node]!);
    list.sort((a, b) => angle[a]! - angle[b]!);
    list.forEach((half, at) => { place[half] = at; });
  });
  const cycleOf = new Int32Array(edges.length * 2).fill(-1);
  const cycles: Cycle[] = [];
  for (let start = 0; start < edges.length * 2; start += 1) {
    if (!alive[start >> 1] || cycleOf[start]! >= 0) continue;
    const nodes: number[] = [], used: number[] = [];
    let area = 0;
    for (let half = start; cycleOf[half]! < 0;) {
      cycleOf[half] = cycles.length;
      const from = tail(half), to = head(half);
      nodes.push(from); used.push(half >> 1);
      area += xs[from]! * ys[to]! - xs[to]! * ys[from]!;
      // Nästa: kanten närmast medurs från den vi kom på, sedd från noden vi står i.
      const list = outgoing[to]!, twin = half ^ 1;
      half = list[(place[twin]! + list.length - 1) % list.length]!;
    }
    cycles.push({ nodes, edges: used, area: area / 2 });
  }
  return { cycles, cycleOf };
}

function insideRing(graph: Graph, ring: readonly number[], x: number, y: number): boolean {
  const { xs, ys } = graph;
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const ax = xs[ring[index]!]!, ay = ys[ring[index]!]!, bx = xs[ring[previous]!]!, by = ys[ring[previous]!]!;
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

export function polygonize(graph: Graph): RawFace[] {
  const { xs, ys, edges } = graph;
  const alive = new Uint8Array(edges.length).fill(1);

  // Hängande kanter: skala bort ändar tills varje nod har minst två kanter.
  const degree = new Int32Array(xs.length);
  const around: number[][] = xs.map(() => []);
  edges.forEach((edge: Edge, index) => { degree[edge.u]! += 1; degree[edge.v]! += 1; around[edge.u]!.push(index); around[edge.v]!.push(index); });
  const loose: number[] = [];
  for (let node = 0; node < xs.length; node += 1) if (degree[node] === 1) loose.push(node);
  while (loose.length) {
    const node = loose.pop()!;
    if (degree[node] !== 1) continue;
    const index = around[node]!.find(candidate => alive[candidate])!;
    const edge = edges[index]!, other = edge.u === node ? edge.v : edge.u;
    alive[index] = 0; degree[node] = 0; degree[other]! -= 1;
    if (degree[other] === 1) loose.push(other);
  }

  // Broar (en kant med samma yta på båda sidor, t.ex. en linje från en ö till ytans kant) ger ringar med en slits: bort med
  // dem, så att ön blir ett rent hål.
  let traced = trace(graph, alive);
  for (;;) {
    let bridges = 0;
    for (let index = 0; index < edges.length; index += 1) {
      if (alive[index] && traced.cycleOf[index * 2] === traced.cycleOf[index * 2 + 1]) { alive[index] = 0; bridges += 1; }
    }
    if (bridges === 0) break;
    traced = trace(graph, alive);
  }

  // Sammanhängande delar: ett medursvarv kan bara vara hål i en yta från en annan del.
  const parent = Int32Array.from(xs, (_, node) => node);
  const find = (node: number): number => { while (parent[node] !== node) { parent[node] = parent[parent[node]!]!; node = parent[node]!; } return node; };
  edges.forEach((edge, index) => { if (alive[index]) parent[find(edge.u)] = find(edge.v); });

  const box = (cycle: Cycle) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of cycle.nodes) {
      minX = Math.min(minX, xs[node]!); maxX = Math.max(maxX, xs[node]!);
      minY = Math.min(minY, ys[node]!); maxY = Math.max(maxY, ys[node]!);
    }
    return { minX, minY, maxX, maxY };
  };
  const outers = traced.cycles.filter(cycle => cycle.area > 0).sort((a, b) => a.area - b.area)
    .map(cycle => ({ outer: cycle, holes: [] as Cycle[], box: box(cycle), part: find(cycle.nodes[0]!) }));
  for (const cycle of traced.cycles) {
    if (cycle.area >= 0) continue;
    const node = cycle.nodes[0]!, x = xs[node]!, y = ys[node]!, part = find(node);
    // Minsta omslutande ytan (ytorna står i storleksordning).
    const home = outers.find(face => face.part !== part && -cycle.area < face.outer.area && x >= face.box.minX && x <= face.box.maxX
      && y >= face.box.minY && y <= face.box.maxY && insideRing(graph, face.outer.nodes, x, y));
    home?.holes.push(cycle);
  }
  return outers.map(({ outer, holes }) => ({ outer, holes }));
}
