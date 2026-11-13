import { closeGaps } from "./close-gaps";
import { nodeSegments, type Graph, type Segment } from "./node";
import { polygonize, type Cycle } from "./polygonize";

/**
 * Ytor ur linjer (sprintkartans ytor, ägaren 2026-11-13: «ytor är särskilt svårt»). Linjer och ytors ringar i ett plant
 * koordinatsystem delar marken i slutna rutor: linjerna nodas (`node.ts`), små glapp sluts (`close-gaps.ts`) och den plana
 * grafen blir ytor med hål (`polygonize.ts`). Ren TypeScript utan I/O och utan beroenden. Metoden är mätt mot en riktig
 * sprintkarta (Älvsjö–Solberga): linjerna sluter sig inte helt själva, så kartritaren får rätta kanter och färdiga rutor
 * att fylla, och avgör själv vad varje ruta är.
 */
export interface FacePoint { readonly x: number; readonly y: number }

/** En gränslinje: en polylinje, eller en sluten ring (`closed`). `id` följer med till ytorna som den begränsar. */
export interface FaceLine { readonly id: string; readonly points: readonly FacePoint[]; readonly closed?: boolean | undefined }

export interface FacesOptions {
  /** Största glapp som sluts, i linjernas enhet (0 = inga glapp sluts). */
  readonly gapTolerance: number;
  /** Punkter närmare varandra än så är samma punkt. Förval 0,001 (1 mm i meter, 1 µm i kartans mm). */
  readonly snap?: number | undefined;
}

/** En slutningsbit i en ytas gräns: glappet som slöts. */
export interface FaceClosure { readonly a: FacePoint; readonly b: FacePoint; readonly length: number }

export interface Face {
  /** Ytterkanten moturs, utan upprepad första punkt. */
  readonly outer: FacePoint[];
  /** Hålen (öar inuti ytan), medurs. */
  readonly holes: FacePoint[][];
  /** Ytan utan hålen. */
  readonly area: number;
  /** Källinjerna (`id`) som bildar gränsen. */
  readonly sources: string[];
  /** Hur lång bit av gränsen (ytterkant och hål) varje källa i `sources` bildar. En sträcka med flera källor räknas till alla. */
  readonly lengths: number[];
  /** Hela gränsens längd (ytterkant och hål), slutna glapp medräknade. */
  readonly perimeter: number;
  /** Glappen som slöts för att ytan skulle bli sluten. */
  readonly closures: FaceClosure[];
}

export interface FacesResult {
  readonly faces: Face[];
  /** Lösa ändar före glappslutningen, och hur många av dem som slöts. */
  readonly looseEnds: number;
  readonly closedEnds: number;
}

/** Förvald glapptolerans i terrängen (m): över hälften av glappen sluts vid 0,25 m, och över 2 m börjar fel saker slutas. */
export const FACE_GAP_M = 2;

function segmentsOf(lines: readonly FaceLine[]): Segment[] {
  const out: Segment[] = [];
  lines.forEach((line, index) => {
    const sources = [index], points = line.points;
    for (let at = 1; at < points.length; at += 1) {
      out.push({ ax: points[at - 1]!.x, ay: points[at - 1]!.y, bx: points[at]!.x, by: points[at]!.y, sources, closure: false });
    }
    if (line.closed && points.length > 2) {
      out.push({ ax: points[points.length - 1]!.x, ay: points[points.length - 1]!.y, bx: points[0]!.x, by: points[0]!.y, sources, closure: false });
    }
  });
  return out;
}

/** Alla slutna ytor som linjerna bildar. Den obegränsade ytan utanför tas inte med, och hängande linjer ger ingen gräns. */
export function facesFromLines(lines: readonly FaceLine[], options: FacesOptions): FacesResult {
  const snap = options.snap ?? 0.001;
  let graph: Graph = nodeSegments(segmentsOf(lines), snap);
  const gaps = closeGaps(graph, options.gapTolerance, snap);
  if (gaps.closures.length) {
    // Noda om med slutningsbitarna (de kan korsa varandra och andra linjer).
    const { xs, ys } = graph;
    graph = nodeSegments([...graph.edges.map(edge => ({ ax: xs[edge.u]!, ay: ys[edge.u]!, bx: xs[edge.v]!, by: ys[edge.v]!, sources: edge.sources, closure: false })),
      ...gaps.closures], snap);
  }
  const { xs, ys, edges } = graph;
  const ring = (cycle: Cycle): FacePoint[] => cycle.nodes.map(node => ({ x: xs[node]!, y: ys[node]! }));
  const faces = polygonize(graph).map(({ outer, holes }): Face => {
    const sources = new Map<number, number>(), closures: FaceClosure[] = [];
    let perimeter = 0;
    for (const cycle of [outer, ...holes]) for (const index of cycle.edges) {
      const edge = edges[index]!;
      const length = Math.hypot(xs[edge.v]! - xs[edge.u]!, ys[edge.v]! - ys[edge.u]!);
      perimeter += length;
      for (const source of edge.sources) sources.set(source, (sources.get(source) ?? 0) + length);
      if (edge.closure) closures.push({ a: { x: xs[edge.u]!, y: ys[edge.u]! }, b: { x: xs[edge.v]!, y: ys[edge.v]! }, length });
    }
    const order = [...sources.keys()].sort((a, b) => a - b);
    return { outer: ring(outer), holes: holes.map(ring), area: outer.area + holes.reduce((sum, hole) => sum + hole.area, 0),
      sources: order.map(source => lines[source]!.id), lengths: order.map(source => sources.get(source)!), perimeter, closures };
  });
  return { faces, looseEnds: gaps.looseEnds, closedEnds: gaps.closures.length };
}

function inRing(ring: readonly FacePoint[], point: FacePoint): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const a = ring[index]!, b = ring[previous]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Ytan som punkten ligger i (inte i ett hål), eller undefined utanför alla ytor. */
export function faceAt(faces: readonly Face[], point: FacePoint): Face | undefined {
  return faces.find(face => inRing(face.outer, point) && !face.holes.some(hole => inRing(hole, point)));
}
