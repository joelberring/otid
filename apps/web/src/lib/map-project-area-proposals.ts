import { flattenPath, type MapObject, type Point } from "@o-tid/map-file";
import {
  FACE_MIN_AREA_M2, FACE_SUGGESTION_CODES, faceBoundaryRole, isSprintNorm, mapNorm, sprintSymbolForCode, suggestFaceRole, symbolObjectKind,
  type Box, type FaceBoundaryRole, type FaceVerdict, type SprintNorm
} from "@o-tid/map-revision";
import type { FacePoint } from "@o-tid/map-revision/faces";
import { FILL_FRAME, FILL_GAP_M, fillFaces, withoutStraightPoints, type FillInput } from "./map-project-fill-area";

/**
 * Ägaren 2026-11-13 («ytor är särskilt svårt», sprintkartans ytor): Föreslå ytor. Alla slutna rutor mellan kartans synliga
 * linjer och ytkanter i en ruta på kartan (det som syns på skärmen) som ännu inte täcks av ett ytobjekt blir kandidater, var
 * och en med ett förslag på symbol där de enkla reglerna (`suggestFaceRole` i `@o-tid/map-revision`) vågar ge ett. Rutorna
 * räknas med samma motor som Fyll yta, i kartans Worker. Inget läggs in här: kandidaterna visas som ett överlägg och
 * kartritaren lägger in dem en i taget eller alla med förslag.
 */
/** Flest kandidater i ett svar; de närmast rutans mitt behålls. */
export const PROPOSE_MAX_CANDIDATES = 400;
/** Rutan vidgas så här mycket åt varje håll (m), så att rutor som sticker ut en bit utanför skärmen kommer med. */
export const PROPOSE_MARGIN_M = 30;
/** Flest sträckor i rutan; fler betyder att man får zooma in. */
const PROPOSE_MAX_SEGMENTS = 250_000;

export interface ProposeQuery {
  /** Rutan i kartans mm (det som syns på skärmen). */
  readonly box: Box;
  /** Släckta symboler: de är inga gränser. */
  readonly hidden: readonly string[];
}

export interface AreaCandidate {
  /** Ringarna i kartans mm (ytterkanten först, sedan hålen). */
  readonly rings: Point[][];
  readonly areaM2: number;
  /** En punkt i rutan (för etiketten). */
  readonly at: Point;
  /** Föreslagen symbol (id), när reglerna ger ett förslag och kartan har symbolen. */
  readonly symbol?: string | undefined;
  /** Osäker: större än 0,5 ha, eller sluten först när glapp slöts. Får aldrig förslag. */
  readonly uncertain?: "large" | "gaps" | undefined;
  readonly rule: FaceVerdict["rule"];
}

export type ProposeResult =
  /** `found`: alla ofyllda slutna rutor (före taket); `filled`: rutor som redan täcks av ett ytobjekt; `small`: under minsta ytan. */
  | { readonly status: "done"; readonly candidates: AreaCandidate[]; readonly found: number; readonly filled: number; readonly small: number }
  /** För mycket i rutan: zooma in. */
  | { readonly status: "tooLarge" }
  /** Kartan är ingen sprintkarta. */
  | { readonly status: "notSprint" };

function inRings(rings: readonly (readonly FacePoint[])[], point: FacePoint): boolean {
  let inside = false;
  for (const ring of rings) for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const a = ring[index]!, b = ring[previous]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** En punkt inne i ytan (inte i ett hål): mitten av den bredaste biten längs en vågrät linje genom ytan. */
export function interiorPoint(rings: readonly (readonly FacePoint[])[]): Point | undefined {
  const outer = rings[0];
  if (!outer || outer.length < 3) return undefined;
  let minY = Infinity, maxY = -Infinity;
  for (const point of outer) { minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y); }
  for (const fraction of [0.5, 0.35, 0.65, 0.2, 0.8]) {
    const y = minY + (maxY - minY) * fraction, xs: number[] = [];
    for (const ring of rings) for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
      const a = ring[index]!, b = ring[previous]!;
      if ((a.y > y) !== (b.y > y)) xs.push(a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    let best = -1, width = 0;
    for (let at = 0; at + 1 < xs.length; at += 2) if (xs[at + 1]! - xs[at]! > width) { width = xs[at + 1]! - xs[at]!; best = at; }
    if (best >= 0) return { x: (xs[best]! + xs[best + 1]!) / 2, y };
  }
  return undefined;
}

/** Kartans ytobjekt som kan täcka en ruta, med sina ringar uträtade först när de behövs. */
function areaIndex(input: FillInput, box: Box, roleOf: (index: number) => FaceBoundaryRole | undefined) {
  const candidates: number[] = [];
  input.objects.forEach((object, index) => {
    if (object.kind !== "area") return;
    const bounds = input.boxes[index];
    if (bounds && (bounds.maxX < box.minX || bounds.minX > box.maxX || bounds.maxY < box.minY || bounds.minY > box.maxY)) return;
    // Landformer (gropig mark), tekniska symboler och banpåtryck täcker ingenting, och okända symboler räknas inte.
    const main = input.symbols.get(object.symbol)?.code.main;
    if (main === undefined || (main >= 100 && main < 200) || main >= 600) return;
    candidates.push(index);
  });
  const flat = new Map<number, Point[][]>();
  const rings = (index: number) => {
    let found = flat.get(index);
    if (!found) {
      const object = input.objects[index] as Extract<MapObject, { kind: "area" }>;
      found = object.rings.flatMap(ring => flattenPath(ring));
      flat.set(index, found);
    }
    return found;
  };
  /** Ytobjekten som punkten ligger i (alla, eller bara byggnaderna). */
  return (point: Point, onlyBuildings: boolean): boolean => candidates.some(index => {
    if (onlyBuildings && roleOf(index) !== "building") return false;
    const bounds = input.boxes[index];
    if (bounds && (point.x < bounds.minX || point.x > bounds.maxX || point.y < bounds.minY || point.y > bounds.maxY)) return false;
    return inRings(rings(index), point);
  });
}

/** Kartans sprintnorm ur skalan och symbolerna, eller undefined för en skogskarta. */
function sprintNormOf(input: FillInput): { norm: SprintNorm; symbols: { id: string; code: string; kind: string; name: string }[] } | undefined {
  const symbols = [...input.symbols.values()].filter(symbol => !symbol.hidden)
    .map(symbol => ({ id: symbol.id, code: symbol.code.text, kind: symbolObjectKind(input, symbol), name: symbol.name }));
  const norm = mapNorm({ scale: input.scale, symbols });
  return isSprintNorm(norm) ? { norm: norm as SprintNorm, symbols } : undefined;
}

/** Kandidatytorna i rutan: slutna, ofyllda och minst `FACE_MIN_AREA_M2`, de närmast rutans mitt först. */
export function proposeAreas(input: FillInput, query: ProposeQuery): ProposeResult {
  const sprint = sprintNormOf(input);
  if (!sprint) return { status: "notSprint" };
  const mmPerM = 1000 / input.scale, margin = PROPOSE_MARGIN_M * mmPerM;
  const box = { minX: query.box.minX - margin, minY: query.box.minY - margin, maxX: query.box.maxX + margin, maxY: query.box.maxY + margin };
  const faces = fillFaces(input, new Set(query.hidden), box, FILL_GAP_M * mmPerM, PROPOSE_MAX_SEGMENTS);
  if (!faces) return { status: "tooLarge" };

  const roles = new Map<number, FaceBoundaryRole | undefined>();
  const roleOf = (index: number): FaceBoundaryRole | undefined => {
    if (!roles.has(index)) {
      const object = input.objects[index], symbol = object && input.symbols.get(object.symbol);
      roles.set(index, symbol && object && (object.kind === "line" || object.kind === "area") ? faceBoundaryRole(symbol.code.text, object.kind, sprint.norm) : undefined);
    }
    return roles.get(index);
  };
  const covered = areaIndex(input, box, roleOf);
  const symbolFor = new Map((Object.keys(FACE_SUGGESTION_CODES) as (keyof typeof FACE_SUGGESTION_CODES)[])
    .map(role => [role, sprintSymbolForCode(sprint.symbols, "area", FACE_SUGGESTION_CODES[role], sprint.norm)] as const));

  const centerX = (box.minX + box.maxX) / 2, centerY = (box.minY + box.maxY) / 2;
  const found: { candidate: AreaCandidate; distance: number }[] = [];
  let filled = 0, small = 0;
  for (const face of faces) {
    // En ruta som når rutans ram är inte sluten.
    if (face.sources.includes(FILL_FRAME)) continue;
    const areaM2 = face.area / (mmPerM * mmPerM);
    if (areaM2 < FACE_MIN_AREA_M2) { small += 1; continue; }
    const at = interiorPoint([face.outer, ...face.holes]);
    if (!at) continue;
    if (covered(at, false)) { filled += 1; continue; }
    const boundaryM: Partial<Record<FaceBoundaryRole, number>> = {};
    face.sources.forEach((source, index) => {
      const role = roleOf(Number(source));
      if (role) boundaryM[role] = (boundaryM[role] ?? 0) + face.lengths[index]! / mmPerM;
    });
    const buildingsInside = face.holes.filter(hole => { const inside = interiorPoint([hole]); return !!inside && covered(inside, true); }).length;
    const verdict = suggestFaceRole({ areaM2, perimeterM: face.perimeter / mmPerM, boundaryM, closures: face.closures.length, buildingsInside });
    found.push({ candidate: { rings: [face.outer, ...face.holes].map(withoutStraightPoints), areaM2, at,
      symbol: verdict.role ? symbolFor.get(verdict.role) : undefined, uncertain: verdict.uncertain, rule: verdict.rule },
      distance: Math.hypot(at.x - centerX, at.y - centerY) });
  }
  found.sort((a, b) => a.distance - b.distance);
  return { status: "done", candidates: found.slice(0, PROPOSE_MAX_CANDIDATES).map(row => row.candidate),
    found: found.length, filled, small };
}

/** Kandidaten som punkten ligger i (den minsta, om flera), eller −1. */
export function candidateAt(candidates: readonly AreaCandidate[], point: Point): number {
  let best = -1;
  candidates.forEach((candidate, index) => {
    if (inRings(candidate.rings, point) && (best < 0 || candidate.areaM2 < candidates[best]!.areaM2)) best = index;
  });
  return best;
}
