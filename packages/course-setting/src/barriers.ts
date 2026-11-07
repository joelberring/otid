/**
 * Steg 64 (ägarens krav): banläggningens specialobjekt som spärrar för vägvalsanalysen och kontrollerna. Kartfilen har
 * inte banläggningens förbjudna områden, så de skickas med till analysen (`@o-tid/route-choice` `LegInput.barriers`).
 * Förbjudet och farligt område och tillfällig konstruktion är ytor som inte går att passera (ISOM 709, 710, 714), gränsen
 * (707) en linje, förbjuden väg (kryss, 711) spärrar där krysset står, och en valfri passage (710 i banpåtrycket) öppnar en
 * spärr där den står, som genomgångar (519) på kartan.
 */
import type { Point } from "@o-tid/map-file";
import { appearanceOf, sizesFor } from "./appearance";
import { place } from "./geometry";
import { legKey } from "./ppen-common";
import { printScaleOf } from "./overprint";
import { specialVisible } from "./specials";
import { activeParts } from "./summary";
import type { CourseSettingDocument, SpecialObject } from "./types";
import { enumerateCourseControls, enumerateLegs } from "./walk";

/** Samma form som `RouteBarriers` i `@o-tid/route-choice` (paketen beror inte på varandra). */
export interface RouteBarrierGeometry {
  readonly areas: readonly (readonly Point[])[];
  readonly lines: readonly { readonly points: readonly Point[]; readonly widthMm: number }[];
  readonly openings: readonly { readonly points: readonly Point[]; readonly widthMm: number }[];
}

const AREA_KINDS = new Set(["out-of-bounds", "dangerous-area", "temporary-construction"]);

/** Specialobjekt som spärrar eller öppnar. */
export const BARRIER_KINDS = new Set([...AREA_KINDS, "boundary", "forbidden-route", "optional-crossing-point"]);

/**
 * Figurernas skala i kartans mm per mm på papperet (ringstorleken och banans utskriftsskala): samma som banpåtrycket ritar
 * specialobjekten med (`specials.ts`). Okänd bana eller bara de som syns på alla banor: kartans skala.
 */
function figureScale(document: CourseSettingDocument, course: string | undefined): number {
  const scale = course === undefined || (course !== "ALL_CONTROLS" && !document.courses.some(item => item.id === course))
    ? document.event.mapScale : printScaleOf(document, course);
  return sizesFor(document, scale).ratio * appearanceOf(document).circleSize;
}

/** Kryssets halva bredd och höjd (förbjuden väg, ISOM 711) som det ritas: armarna 1,5 mm från mitten på papperet. */
const CROSS_HALF = 1.06;

/**
 * Spärrarna och öppningarna som gäller banan ("ALL_CONTROLS" = Alla kontroller; `undefined` = bara de som syns på alla
 * banor), i kartans mm. Linjernas bredd är banpåtryckets bredd i utskriftsskalan, minst 1 m i terrängen.
 */
export function routeBarriers(document: CourseSettingDocument, course: string | undefined): RouteBarrierGeometry {
  const visible = document.specialObjects.filter(special => BARRIER_KINDS.has(special.kind)
    && (course === undefined ? special.courses.length === 0 : specialVisible(special, course)));
  const areas: Point[][] = [], lines: { points: Point[]; widthMm: number }[] = [], openings: { points: Point[]; widthMm: number }[] = [];
  if (visible.length === 0) return { areas, lines, openings };
  const scale = course === undefined || (course !== "ALL_CONTROLS" && !document.courses.some(item => item.id === course))
    ? document.event.mapScale : printScaleOf(document, course);
  const sizes = sizesFor(document, scale);
  const k = figureScale(document, course);
  const meter = 1000 / document.event.mapScale;
  for (const special of visible) {
    const at = special.points[0]!;
    switch (special.kind) {
      case "boundary":
        lines.push({ points: [...special.points], widthMm: Math.max(meter, (sizes.sprint ? 1.0 : 0.7) * sizes.ratio) });
        break;
      case "forbidden-route":
        // Krysset spärrar vägen där det står (armarna 1,5 mm från mitten).
        for (const [a, b] of [[{ x: -CROSS_HALF, y: -CROSS_HALF }, { x: CROSS_HALF, y: CROSS_HALF }], [{ x: CROSS_HALF, y: -CROSS_HALF }, { x: -CROSS_HALF, y: CROSS_HALF }]] as const) {
          lines.push({ points: [{ x: at.x + a.x * k, y: at.y + a.y * k }, { x: at.x + b.x * k, y: at.y + b.y * k }], widthMm: Math.max(meter, 0.35 * k) });
        }
        break;
      case "optional-crossing-point": {
        // Passagen går mellan bågarna (längs figurens y-axel); öppningen är lika lång som figuren.
        const half = (1.5 + (special.stretch ?? 0) / 2) * k;
        openings.push({ points: [place({ x: 0, y: -half / k }, at, special.orientation ?? 0, k), place({ x: 0, y: half / k }, at, special.orientation ?? 0, k)],
          widthMm: Math.max(2 * meter, 0.7 * k) });
        break;
      }
      default:
        if (AREA_KINDS.has(special.kind) && special.points.length >= 3) areas.push([...special.points]);
    }
  }
  return { areas, lines, openings };
}

function inside(ring: readonly Point[], point: Point): boolean {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

function segmentsCross(p: Point, q: Point, r: Point, s: Point): boolean {
  const d = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(r, s, p), d2 = d(r, s, q), d3 = d(p, q, r), d4 = d(p, q, s);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
}

/**
 * Går linjen (sträckans) genom ytan eller över spärrlinjen? Sträckans ändar (kontrollerna) räknas inte. `k` är figurernas
 * skala (`figureScale`): krysset är lika stort som det ritas på banans utskrift.
 */
export function pathHitsBarrier(path: readonly Point[], special: SpecialObject, k: number): boolean {
  const segments: [Point, Point][] = [];
  for (let i = 1; i < path.length; i += 1) segments.push([path[i - 1]!, path[i]!]);
  if (AREA_KINDS.has(special.kind)) {
    const ring = special.points;
    for (const [a, b] of segments) {
      // Mittpunkter längs linjen inne i ytan, eller linjen över ytans kant.
      for (let t = 0.1; t < 0.95; t += 0.1) if (inside(ring, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) return true;
      for (let i = 0; i < ring.length; i += 1) if (segmentsCross(a, b, ring[i]!, ring[(i + 1) % ring.length]!)) return true;
    }
    return false;
  }
  const lines = special.kind === "boundary" ? [special.points] : special.kind === "forbidden-route" ? (() => {
    const at = special.points[0]!, r = CROSS_HALF * k;
    return [[{ x: at.x - r, y: at.y - r }, { x: at.x + r, y: at.y + r }], [{ x: at.x + r, y: at.y - r }, { x: at.x - r, y: at.y + r }]];
  })() : [];
  for (const line of lines) for (let i = 1; i < line.length; i += 1) for (const [a, b] of segments) if (segmentsCross(a, b, line[i - 1]!, line[i]!)) return true;
  return false;
}

/** Specialobjekten som spärrar på banan (inte passagerna, som öppnar). */
function blockingSpecials(document: CourseSettingDocument, course: string): SpecialObject[] {
  return document.specialObjects.filter(special => BARRIER_KINDS.has(special.kind) && special.kind !== "optional-crossing-point"
    && specialVisible(special, course));
}

/** Ligger punkten i specialobjektets yta (förbjudet område, farligt område, tillfällig konstruktion)? */
export function insideBarrierArea(special: SpecialObject, point: Point): boolean {
  return AREA_KINDS.has(special.kind) && special.points.length >= 3 && inside(special.points, point);
}

/**
 * Sträckorna på banan vars fågelväg (med böjar) går genom ett förbjudet område eller över en spärr (kontrollen
 * LEG_THROUGH_FORBIDDEN). Ligger en ände i området räknas det som kontrollen i området (`controlsInForbidden`), inte här.
 * Sträckor som bara finns i bortvalda varianter räknas inte (ADR-0198 tillägg 12).
 */
export function forbiddenLegs(document: CourseSettingDocument, course: string): { from: string; to: string; special: string }[] {
  const specials = blockingSpecials(document, course);
  if (specials.length === 0) return [];
  const out: { from: string; to: string; special: string }[] = [];
  const seen = new Set<string>();
  const active = activeParts(document, course);
  const k = figureScale(document, course);
  for (const [a, b] of enumerateLegs(document, course)) {
    const from = document.courseControls[a]!.control, to = document.courseControls[b]!.control;
    const key = legKey(from, to);
    if (seen.has(key) || from === to || (active && !active.legs.has(key))) continue;
    seen.add(key);
    const start = document.controls[from], end = document.controls[to];
    if (!start || !end) continue;
    const path = [start.at, ...(document.legs[key]?.bends ?? []), end.at];
    for (const special of specials) {
      if (insideBarrierArea(special, start.at) || insideBarrierArea(special, end.at)) continue;
      if (pathHitsBarrier(path, special, k)) out.push({ from, to, special: special.id });
    }
  }
  return out;
}

/**
 * ADR-0199: banans kontroller som ligger i ett förbjudet område som syns på banan (kontrollen CONTROL_IN_FORBIDDEN).
 * Kontroller som bara finns i bortvalda varianter räknas inte (ADR-0198 tillägg 12).
 */
export function controlsInForbidden(document: CourseSettingDocument, course: string): { control: string; special: string }[] {
  const areas = blockingSpecials(document, course).filter(special => AREA_KINDS.has(special.kind));
  if (areas.length === 0) return [];
  const out: { control: string; special: string }[] = [];
  const seen = new Set<string>();
  const active = activeParts(document, course);
  for (const id of enumerateCourseControls(document, course)) {
    const control = document.courseControls[id]?.control;
    const point = control === undefined ? undefined : document.controls[control];
    if (!point || seen.has(point.id) || (active && !active.controls.has(point.id))) continue;
    seen.add(point.id);
    for (const special of areas) if (insideBarrierArea(special, point.at)) out.push({ control: point.id, special: special.id });
  }
  return out;
}
