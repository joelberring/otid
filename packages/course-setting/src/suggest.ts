/**
 * Förslag på kontrollbeskrivning ur kartfilen (ADR-0180 beslut 13). Ren funktion: kartans objekt i och nära ringen
 * rangordnas (punktobjekt i centrum först, sedan linjers ändar, hörn och korsningar, sedan ytors kanter och hörn) och
 * ger kolumn D, och där geometrin säger det C (vilken), E (utseende eller andra objektet), F (korsning/förgrening, aldrig
 * mått) och G (läget med väderstreck från kartans norr). Varje förslag har säkerhet, förklaring och objekten som matchade
 * (för markeringen på kartan).
 *
 * Gränserna i `SUGGEST_LIMITS` är egna tumregler i kartans mm (samma för alla skalor, eftersom kartsymbolerna har samma
 * storlek i mm), valda mot ägarens kartor (Högdalen 2026, Djurgården 2025) och de syntetiska testerna.
 */
import type { ParsedMap, Point } from "@o-tid/map-file";
import { flattenPath } from "@o-tid/map-file";
import { sizesFor } from "./appearance";
import { symbolDb } from "./description-symbols";
import {
  centroidOf, clipNear, cornerNear, directionAt, featuresNear, insideRings, lineLength, loopsNear, nearestOnLines, prepareMap,
  type ContourLoop, type Feature
} from "./suggest-geometry";
import { normalizedCode, ONLY_IN, type FeatureKind } from "./suggest-symbols";
import type { CourseSettingDocument, DescriptionBox, DescriptionStandard } from "./types";

export const SUGGEST_LIMITS = {
  /** Kontrollen räknas som "på" objektet inom symbolens egen utsträckning plus så här mycket (placeringens noggrannhet). */
  onMarginMm: 0.2,
  /** Sida, fot och kant: högst så här långt utanför objektet (punktobjekt `pointNearMm`). */
  nearMm: 1.0,
  pointNearMm: 0.6,
  /** Flera likadana punktobjekt (kolumn C) räknas inom så stor del av ringens radie. */
  sameWithinRadius: 0.7,
  /** Ytans kant: centrum högst så här långt från kanten. */
  edgeMm: 0.3,
  /** Linjens ände: centrum högst så här långt (längs linjen) från änden. */
  endMm: 0.4,
  /** Hörn: böjen mäts över armar på 0,5 mm och ska vara minst 45°. */
  cornerArmMm: 0.5,
  cornerTurnDegrees: 45,
  /** En yta som är högst så här stor (mm) är ett litet objekt (en liten sankmark, en dunge). */
  smallAreaMm: 1.6,
  /** Korsning och förgrening: linjerna möts högst så här långt från centrum; en arm är minst 0,5 mm lång. */
  nodeMm: 0.45,
  armMm: 0.5
} as const;

export interface SuggestOptions {
  /** Kartans skala (för meter i förklaringen); saknas = kartfilens. */
  readonly mapScale?: number | undefined;
  readonly standard?: DescriptionStandard | undefined;
  /** ISSprOM 2019-2: sprinttabellen före ISOM. */
  readonly sprint?: boolean | undefined;
  /** Ringens radie i kartans mm (bestämmer vilka objekt som är "i ringen"); saknas = 2,5 mm. */
  readonly radiusMm?: number | undefined;
  /** Kartans norr i grader moturs från x-axeln; saknas = nordlinjerna (601) i kartan, annars rakt upp. */
  readonly northDegrees?: number | undefined;
  /** Högst så många förslag (standard 3). */
  readonly limit?: number | undefined;
}

/** Ett objekt i kartan som förslaget bygger på. */
export interface SuggestedFeature {
  /** Kartsymbolens nummer och namn som i filen. */
  readonly code: string;
  readonly name: string;
  readonly matchedBy: "NUMBER" | "NAME" | "CONTOUR";
  readonly geometry: "point" | "line" | "area";
  readonly distanceMeters: number;
  /** Närmaste punkten på objektet (kartans mm). */
  readonly at: Point;
  /** Objektet nära ringen för markeringen på kartan (punkter eller linjer i kartans mm). */
  readonly shape: readonly (readonly Point[])[];
}

export interface DescriptionSuggestion {
  /** Rutorna C–G som föreslås (aldrig mått i F). */
  readonly boxes: readonly DescriptionBox[];
  /** 0–1. */
  readonly confidence: number;
  readonly level: "HIGH" | "MEDIUM" | "LOW";
  /** Förklaringen på svenska, t.ex. "Sten (ISOM 204) 2 m från centrum". */
  readonly reason: string;
  readonly features: readonly SuggestedFeature[];
}

type Relation = "ON" | "SIDE" | "FOOT" | "TOP" | "END" | "CORNER" | "EDGE" | "PART" | "WHOLE" | "INSIDE" | "PYLON" | "JUNCTION" | "BETWEEN" | "HILL";

interface Candidate {
  readonly d: string;
  readonly e?: string | undefined;
  readonly f?: string | undefined;
  readonly g?: string | undefined;
  c?: string | undefined;
  score: number;
  readonly relation: Relation;
  /** Huvudobjektet först. */
  readonly features: readonly Feature[];
  readonly loop?: ContourLoop | undefined;
  readonly nearest: Point;
  readonly distance: number;
  readonly clause: string;
  readonly alternative?: boolean | undefined;
}

const DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
const DIRECTION_WORDS = ["norra", "nordöstra", "östra", "sydöstra", "södra", "sydvästra", "västra", "nordvästra"];

const BASE: Readonly<Record<Relation, number>> = {
  ON: 1, PYLON: 0.92, JUNCTION: 0.95, WHOLE: 0.85, END: 0.8, CORNER: 0.8, FOOT: 0.75, TOP: 0.6, SIDE: 0.7, HILL: 0.7, BETWEEN: 0.8,
  EDGE: 0.55, PART: 0.35, INSIDE: 0.35
};
const KIND_WEIGHT: Readonly<Record<FeatureKind, number>> = {
  OBJECT: 1, LANDFORM: 1, HOLE: 1, STEP: 0.95, BARRIER: 0.85, NETWORK: 0.8, BOUNDARY: 0.5, GROUND: 0.8, SOLID: 0.9, VEGETATION: 0.55
};
/** Ordningen när två linjer möts: den första blir D, den andra E. */
const NETWORK_ORDER = ["5.1", "5.2", "5.3", "5.26", "5.24", "3.4", "3.5", "3.6", "5.9", "5.8", "4.6", "1.7", "1.8", "5.5", "5.14", "2.10", "1.6"];
const JOINS: ReadonlySet<FeatureKind> = new Set(["NETWORK", "BARRIER"]);

const POINT_LIKE: ReadonlySet<FeatureKind> = new Set(["OBJECT", "LANDFORM", "HOLE"]);
/** Prickar som ritar en yta (stenig mark, blockterräng, småkuperad terräng): svaga som punktobjekt. */
const PATTERN_DOTS: ReadonlySet<string> = new Set(["2.5", "2.7", "1.15"]);

const northCache = new WeakMap<ParsedMap, number>();

/** Kartans norr: medianen av nordlinjerna (601) om de finns och lutar högst 30°, annars rakt upp (90°). */
export function mapNorthDegrees(map: ParsedMap): number {
  const known = northCache.get(map);
  if (known !== undefined) return known;
  const angles: number[] = [];
  for (const object of map.objects) {
    const symbol = map.symbols.get(object.symbol);
    if (object.kind !== "line" || !symbol || symbol.code.main !== 601) continue;
    for (const line of flattenPath(object.path)) {
      const a = line[0]!, b = line[line.length - 1]!;
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1) continue;
      let degrees = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      if (degrees < 0) degrees += 180;
      if (Math.abs(degrees - 90) <= 30) angles.push(degrees);
    }
  }
  angles.sort((x, y) => x - y);
  const north = angles.length > 0 ? angles[angles.length >> 1]! : 90;
  northCache.set(map, north);
  return north;
}

/** Väderstrecket (0 = N … 7 = NV) för en riktning i kartan. */
function sector(vector: Point, north: number): number {
  const degrees = Math.atan2(vector.y, vector.x) * 180 / Math.PI;
  const bearing = ((north - degrees) % 360 + 360) % 360;
  return Math.round(bearing / 45) % 8;
}
const compass = (prefix: string, index: number) => `${prefix}${DIRECTIONS[index]}`;
const cId = (index: number) => `${index % 2 === 0 ? "0.1" : "0.2"}${DIRECTIONS[index]}`;
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const length = (v: Point) => Math.hypot(v.x, v.y);
const closeness = (d: number, scale: number) => 1 / (1 + (d / scale) ** 2);

function sourceOf(feature: Feature): string {
  const code = normalizedCode(feature.symbol.code.text);
  return feature.lookup.by === "NAME" ? `kartsymbol ${code}, efter namnet` : `ISOM ${code}`;
}

function meters(mm: number, scale: number): string {
  const m = mm * scale / 1000;
  return m < 1 ? "under 1 m" : `${Math.round(m)} m`;
}

/** Normalen ut ur ytan vid närmaste kantpunkten. */
function outwardNormal(feature: Feature, point: Point, line: number, segment: number): Point {
  const ring = feature.lines[line]!;
  const a = ring[segment]!, b = ring[Math.min(segment + 1, ring.length - 1)]!;
  const t = { x: b.x - a.x, y: b.y - a.y };
  const l = length(t) || 1;
  const normal = { x: -t.y / l, y: t.x / l };
  const probe = { x: point.x + normal.x * 0.05, y: point.y + normal.y * 0.05 };
  return insideRings(probe, feature.lines) ? { x: -normal.x, y: -normal.y } : normal;
}

/** Linjens ände är fri: inget annat objekt med samma detalj börjar eller slutar där (OCAD delar ofta upp linjer). */
function freeEnd(end: Point, feature: Feature, nearby: readonly Feature[]): boolean {
  for (const other of nearby) {
    if (other === feature || other.lookup.rule.d !== feature.lookup.rule.d || other.geometry !== "line") continue;
    const hit = nearestOnLines(end, other.lines);
    if (hit && hit.distance < 0.15) return false;
  }
  return true;
}

function pointRelations(feature: Feature, at: Point, north: number, scale: number): Candidate[] {
  const p = feature.at!;
  const d = length(sub(at, p));
  const on = feature.extent + SUGGEST_LIMITS.onMarginMm;
  const base = { d: feature.lookup.rule.d, e: feature.lookup.rule.e, features: [feature], nearest: p, distance: d };
  const name = `${feature.symbol.name} (${sourceOf(feature)}) ${meters(d, scale)} från centrum`;
  // Prickar för stenig mark, blockterräng och småkuperad terräng: bara när centrum ligger på pricken.
  const pattern = PATTERN_DOTS.has(feature.lookup.rule.d) ? 0.6 : 1;
  if (d <= on) return [{ ...base, relation: "ON", score: BASE.ON * pattern * (1 - 0.25 * d / on), clause: name }];
  if (d > on + SUGGEST_LIMITS.pointNearMm || feature.kind === "GROUND") return [];
  const index = sector(sub(at, p), north);
  const g = feature.kind === "LANDFORM" || feature.kind === "STEP" ? compass("11.14", index) : feature.kind === "HOLE" ? compass("11.2", index) : compass("11.1", index);
  const where = feature.kind === "LANDFORM" || feature.kind === "STEP" ? "vid foten" : feature.kind === "HOLE" ? "vid kanten" : "på sidan";
  return [{ ...base, g, relation: "SIDE", score: BASE.SIDE * (1 - 0.6 * (d - on) / SUGGEST_LIMITS.pointNearMm),
    clause: `${name}, kontrollen ${where} åt ${DIRECTION_WORDS[index]} hållet` }];
}

function lineRelations(feature: Feature, at: Point, nearby: readonly Feature[], north: number, scale: number): Candidate[] {
  const hit = nearestOnLines(at, feature.lines);
  if (!hit) return [];
  const line = feature.lines[hit.line]!;
  const total = lineLength(line);
  const on = feature.extent + SUGGEST_LIMITS.onMarginMm;
  const d = hit.distance;
  if (d > on + SUGGEST_LIMITS.nearMm) return [];
  const rule = feature.lookup.rule;
  const base = { d: rule.d, e: rule.e, features: [feature], nearest: hit.point, distance: d };
  const name = `${feature.symbol.name} (${sourceOf(feature)}) ${meters(d, scale)} från centrum`;
  const out: Candidate[] = [];
  // Kraftledningens stolpe: kontrollen vid en brytpunkt där symbolen har stolpar.
  if (rule.d === "5.5" && feature.corners && d <= 0.35) {
    const vertex = line.find(point => length(sub(point, at)) <= 0.35);
    if (vertex) out.push({ ...base, d: "5.6", relation: "PYLON", score: BASE.PYLON, clause: `${name}, vid en stolpe` });
  }
  const closed = line.length > 3 && length(sub(line[0]!, line[line.length - 1]!)) < 0.05;
  const toStart = hit.along, toEnd = total - hit.along;
  const end = toStart <= toEnd ? line[0]! : line[line.length - 1]!;
  if (!closed && Math.min(toStart, toEnd) <= SUGGEST_LIMITS.endMm && d <= on + SUGGEST_LIMITS.nearMm * 0.6 && total > SUGGEST_LIMITS.endMm * 2
    && freeEnd(end, feature, nearby)) {
    // Riktningen från linjen ut mot änden.
    const inward = toStart <= toEnd ? directionAt(line, Math.min(total, SUGGEST_LIMITS.cornerArmMm), SUGGEST_LIMITS.cornerArmMm)
      : directionAt(line, Math.max(0, total - SUGGEST_LIMITS.cornerArmMm), SUGGEST_LIMITS.cornerArmMm);
    const out_ = toStart <= toEnd ? { x: -inward.x, y: -inward.y } : inward;
    const index = sector(out_, north);
    out.push({ ...base, g: compass("11.8", index), relation: "END", score: BASE.END * closeness(d, on + 0.3),
      clause: `${name}, vid ${DIRECTION_WORDS[index]} änden` });
    return out;
  }
  if (feature.kind === "BARRIER" || feature.kind === "STEP" || feature.kind === "BOUNDARY") {
    const corner = cornerNear(line, hit.along, SUGGEST_LIMITS.cornerArmMm, SUGGEST_LIMITS.cornerArmMm);
    if (corner && Math.abs(corner.turn) >= SUGGEST_LIMITS.cornerTurnDegrees && length(sub(at, corner.at)) <= on + 0.3) {
      const inside = (at.x - corner.at.x) * -corner.outward.x + (at.y - corner.at.y) * -corner.outward.y > 0;
      const index = sector(corner.outward, north);
      out.push({ ...base, nearest: corner.at, g: compass(inside ? "11.4" : "11.5", index), relation: "CORNER", score: BASE.CORNER * KIND_WEIGHT[feature.kind],
        clause: `${name}, vid ${DIRECTION_WORDS[index]} hörnet (${inside ? "insidan" : "utsidan"})` });
      return out;
    }
  }
  // På en brant eller skärning: utom precis på linjen är det foten eller ovanpå (sidan nedan).
  if (d <= on && (feature.kind !== "STEP" || d <= 0.08)) {
    out.push({ ...base, relation: "ON", score: 0.7 * KIND_WEIGHT[feature.kind] * closeness(d, on * 1.5), clause: name });
    return out;
  }
  const along = directionAt(line, hit.along, SUGGEST_LIMITS.cornerArmMm);
  const away = sub(at, hit.point);
  const side = Math.sign(along.x * away.y - along.y * away.x);
  const index = sector(away, north);
  const fade = 1 - 0.5 * Math.max(0, d - on) / SUGGEST_LIMITS.nearMm;
  if (feature.kind === "STEP") {
    if (feature.tagSide === 0 || side === feature.tagSide) {
      const unknown = feature.tagSide === 0;
      out.push({ ...base, g: compass("11.14", index), relation: "FOOT", score: BASE.FOOT * (unknown ? 0.85 : 1) * fade,
        clause: `${name}, kontrollen vid ${DIRECTION_WORDS[index]} foten${unknown ? " (symbolen saknar taggar, så sidan är antagen)" : ""}` });
    } else {
      out.push({ ...base, g: "11.11", relation: "TOP", score: BASE.TOP * fade, clause: `${name}, kontrollen ovanför (på andra sidan än taggarna)` });
    }
  } else if (feature.kind === "BARRIER" || feature.kind === "NETWORK") {
    out.push({ ...base, g: compass("11.1", index), relation: "SIDE", score: BASE.SIDE * (feature.kind === "BARRIER" ? 0.75 : 0.4) * fade,
      clause: `${name}, kontrollen på ${DIRECTION_WORDS[index]} sidan` });
  }
  return out;
}

function areaRelations(feature: Feature, at: Point, north: number, scale: number): Candidate[] {
  const hit = nearestOnLines(at, feature.lines);
  if (!hit) return [];
  const rule = feature.lookup.rule;
  const inside = insideRings(at, feature.lines);
  const d = inside ? 0 : hit.distance;
  const size = Math.max(feature.box.maxX - feature.box.minX, feature.box.maxY - feature.box.minY);
  const weight = KIND_WEIGHT[feature.kind];
  const base = { d: rule.d, e: rule.e, features: [feature], nearest: inside ? at : hit.point, distance: d };
  const name = `${feature.symbol.name} (${sourceOf(feature)})`;
  const open = rule.d === "4.1" || rule.d === "4.2";
  if (size <= SUGGEST_LIMITS.smallAreaMm && (inside || hit.distance <= SUGGEST_LIMITS.onMarginMm)) {
    // Ett litet objekt runt centrum: en liten öppen yta är en glänta.
    return [{ ...base, d: open ? "4.4" : rule.d, relation: "WHOLE", score: BASE.WHOLE * Math.max(weight, 0.8),
      clause: `${name} ${inside ? "runt centrum" : `${meters(hit.distance, scale)} från centrum`}, hela ytan i ringen` }];
  }
  if (hit.distance <= SUGGEST_LIMITS.edgeMm) {
    const ring = feature.lines[hit.line]!;
    const corner = cornerNear(ring, hit.along, SUGGEST_LIMITS.cornerArmMm, SUGGEST_LIMITS.cornerArmMm);
    if (corner && Math.abs(corner.turn) >= SUGGEST_LIMITS.cornerTurnDegrees && length(sub(at, corner.at)) <= SUGGEST_LIMITS.edgeMm + 0.15) {
      const probe = { x: corner.at.x - corner.outward.x * 0.05, y: corner.at.y - corner.outward.y * 0.05 };
      const convex = insideRings(probe, feature.lines);
      const away = convex ? corner.outward : { x: -corner.outward.x, y: -corner.outward.y };
      const index = sector(away, north);
      const out: Candidate[] = [];
      // Öppen marks inre hörn är ett skogshörn (skogen skjuter ut i det öppna).
      if (open && !convex) out.push({ ...base, nearest: corner.at, d: "4.3", relation: "CORNER", score: BASE.CORNER * 0.7,
        clause: `${name}, inre hörn där skogen skjuter ut (${meters(length(sub(at, corner.at)), scale)} från centrum)` });
      out.push({ ...base, nearest: corner.at, g: compass(convex ? "11.5" : "11.4", index), relation: "CORNER",
        score: BASE.CORNER * Math.max(weight, 0.7) * (open && !convex ? 0.9 : 1),
        clause: `${name}, vid ${DIRECTION_WORDS[index]} hörnet (${convex ? "utsidan" : "insidan"}) ${meters(length(sub(at, corner.at)), scale)} från centrum` });
      return out;
    }
    const normal = outwardNormal(feature, hit.point, hit.line, hit.segment);
    const index = sector(normal, north);
    const solid = feature.kind === "SOLID";
    return [{ ...base, g: compass(solid ? "11.1" : "11.2", index), relation: "EDGE", score: BASE.EDGE * Math.max(weight, solid ? 1.1 : 0.7),
      clause: `${name}, vid ${DIRECTION_WORDS[index]} ${solid ? "sidan" : "kanten"} ${meters(hit.distance, scale)} från centrum` }];
  }
  if (inside) {
    if (feature.kind === "SOLID") return [];
    const centroid = centroidOf([feature.lines[0]!]);
    const offset = sub(at, centroid);
    const part = size > 4 * SUGGEST_LIMITS.nearMm && length(offset) > size * 0.15;
    const index = sector(offset, north);
    return [{ ...base, ...(part ? { g: compass("11.3", index) } : {}), relation: part ? "PART" : "INSIDE",
      score: BASE.INSIDE * weight * (feature.kind === "GROUND" ? 1.2 : 1),
      clause: `Centrum ligger i ${name}${part ? `, i ${DIRECTION_WORDS[index]} delen` : ""}` }];
  }
  if (hit.distance <= SUGGEST_LIMITS.nearMm && (feature.kind === "SOLID" || feature.kind === "GROUND")) {
    const index = sector(outwardNormal(feature, hit.point, hit.line, hit.segment), north);
    const solid = feature.kind === "SOLID";
    return [{ ...base, g: compass(solid ? "11.1" : "11.2", index), relation: solid ? "SIDE" : "EDGE",
      score: (solid ? BASE.SIDE : BASE.EDGE * 0.8) * weight * (1 - 0.5 * hit.distance / SUGGEST_LIMITS.nearMm),
      clause: `${name} ${meters(hit.distance, scale)} från centrum, kontrollen ${solid ? "på" : "vid"} ${DIRECTION_WORDS[index]} ${solid ? "sidan" : "kanten"}` }];
  }
  return [];
}

/** Korsningar och förgreningar: linjer (stigar, vägar, bäckar, staket …) som möts vid centrum. */
function junctions(features: readonly Feature[], at: Point, scale: number): Candidate[] {
  const arms = new Map<string, { count: number; features: Feature[]; distance: number }>();
  for (const feature of features) {
    if (feature.geometry !== "line" || !JOINS.has(feature.kind)) continue;
    const hit = nearestOnLines(at, feature.lines);
    if (!hit || hit.distance > SUGGEST_LIMITS.nodeMm + feature.extent) continue;
    const line = feature.lines[hit.line]!;
    const total = lineLength(line);
    const closed = line.length > 3 && length(sub(line[0]!, line[line.length - 1]!)) < 0.05;
    const count = closed ? 2 : (hit.along > SUGGEST_LIMITS.armMm ? 1 : 0) + (total - hit.along > SUGGEST_LIMITS.armMm ? 1 : 0);
    const group = arms.get(feature.lookup.rule.d) ?? { count: 0, features: [], distance: 0 };
    group.count += count;
    group.features.push(feature);
    group.distance = Math.max(group.distance, hit.distance);
    arms.set(feature.lookup.rule.d, group);
  }
  const groups = [...arms.entries()].filter(([, group]) => group.count > 0)
    .sort(([a], [b]) => (NETWORK_ORDER.indexOf(a) + 1 || 99) - (NETWORK_ORDER.indexOf(b) + 1 || 99));
  const total = groups.reduce((sum, [, group]) => sum + group.count, 0);
  if (total < 3) return [];
  const [first, second] = groups;
  const label = (feature: Feature) => `${feature.symbol.name} (${sourceOf(feature)})`;
  if (!second) {
    const [d, group] = first!;
    const crossing = group.count >= 4;
    return [{ d, f: crossing ? "10.1single" : "10.2single", relation: "JUNCTION", features: group.features, nearest: at, distance: group.distance,
      score: BASE.JUNCTION * closeness(group.distance, SUGGEST_LIMITS.nodeMm),
      clause: `${label(group.features[0]!)}: ${crossing ? "korsning" : "förgrening"} ${meters(group.distance, scale)} från centrum` }];
  }
  const [d, a] = first!, [e, b] = second;
  const crossing = a.count >= 2 && b.count >= 2;
  const distance = Math.max(a.distance, b.distance);
  return [{ d, e, f: crossing ? "10.1" : "10.2", relation: "JUNCTION", features: [...a.features, ...b.features], nearest: at, distance,
    score: BASE.JUNCTION * closeness(distance, SUGGEST_LIMITS.nodeMm),
    clause: `${label(a.features[0]!)} och ${label(b.features[0]!)}: ${crossing ? "korsning" : "förgrening"} ${meters(distance, scale)} från centrum` }];
}

/** Små slutna höjdkurvor: höjd (eller grop med lutningsstreck) runt centrum, eller foten strax utanför. */
function hills(loops: readonly ContourLoop[], at: Point, radius: number, north: number, scale: number): Candidate[] {
  const around = loops.filter(loop => insideRings(at, [loop.ring]))
    .sort((a, b) => (a.box.maxX - a.box.minX) * (a.box.maxY - a.box.minY) - (b.box.maxX - b.box.minX) * (b.box.maxY - b.box.minY));
  const label = (loop: ContourLoop) => `sluten ${loop.symbol.name.toLowerCase()} (ISOM ${normalizedCode(loop.symbol.code.text)})`;
  const inner = around[0];
  if (inner && Math.max(inner.box.maxX - inner.box.minX, inner.box.maxY - inner.box.minY) <= 2 * radius) {
    return [{ d: inner.depression ? "1.12" : "1.9", relation: "HILL", features: [], loop: inner, nearest: at, distance: 0, score: BASE.HILL,
      clause: `Centrum ligger i en ${label(inner)}${inner.depression ? " med lutningsstreck (grop)" : ""}` }];
  }
  let best: Candidate | undefined;
  for (const loop of loops) {
    if (around.includes(loop)) continue;
    const hit = nearestOnLines(at, [loop.ring]);
    if (!hit || hit.distance > SUGGEST_LIMITS.nearMm * 0.6) continue;
    const index = sector(sub(at, centroidOf([loop.ring])), north);
    const score = 0.5 * (1 - hit.distance / SUGGEST_LIMITS.nearMm);
    if (best && best.score >= score) continue;
    best = { d: loop.depression ? "1.12" : "1.9", g: compass(loop.depression ? "11.2" : "11.14", index), relation: "HILL", features: [], loop,
      nearest: hit.point, distance: hit.distance, score,
      clause: `${label(loop)} ${meters(hit.distance, scale)} från centrum, kontrollen vid ${DIRECTION_WORDS[index]} ${loop.depression ? "kanten" : "foten"}` };
  }
  return best ? [best] : [];
}


/** Mellan två punktobjekt: centrum nära mitten av linjen mellan dem och inget av dem i centrum. */
function between(features: readonly Feature[], at: Point, scale: number): Candidate[] {
  const points = features.filter(f => f.geometry === "point" && POINT_LIKE.has(f.kind) && length(sub(f.at!, at)) > f.extent + SUGGEST_LIMITS.onMarginMm
    && length(sub(f.at!, at)) <= 1.2);
  let best: Candidate | undefined;
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    const a = points[i]!, b = points[j]!;
    const ab = sub(b.at!, a.at!), span = length(ab);
    if (span < 0.3 || span > 2.2) continue;
    const t = ((at.x - a.at!.x) * ab.x + (at.y - a.at!.y) * ab.y) / (span * span);
    const off = Math.abs(ab.x * (at.y - a.at!.y) - ab.y * (at.x - a.at!.x)) / span;
    if (t < 0.25 || t > 0.75 || off > 0.2) continue;
    const same = a.lookup.rule.d === b.lookup.rule.d;
    const score = BASE.BETWEEN * (1 - Math.abs(t - 0.5)) * (1 - off / 0.4);
    if (best && best.score >= score) continue;
    best = { d: a.lookup.rule.d, ...(same ? {} : { e: b.lookup.rule.d }), g: same ? "11.15single" : "11.15", relation: "BETWEEN", features: [a, b],
      nearest: at, distance: Math.min(length(sub(a.at!, at)), length(sub(b.at!, at))), score,
      clause: `Mellan ${a.symbol.name} (${sourceOf(a)}) och ${b.symbol.name} (${sourceOf(b)}), ${meters(span, scale)} isär` };
  }
  return best ? [best] : [];
}

/**
 * E ur omgivningen för landformer och gropar: sank i sankmark, stenig i stenig mark. "Bevuxen" föreslås inte: grön
 * vegetation runt en höjd betyder inte att höjden själv är bevuxen.
 */
function contextE(candidate: Candidate, features: readonly Feature[], at: Point): string | undefined {
  if (candidate.e || !["LANDFORM", "HOLE"].includes(candidate.features[0]?.kind ?? (candidate.loop ? "LANDFORM" : ""))) return undefined;
  for (const [d, e] of [["3.7", "8.7"], ["2.7", "8.6"]] as const) {
    if (features.some(f => f.geometry === "area" && f.lookup.rule.d === d && insideRings(at, f.lines))) return e;
  }
  return undefined;
}

/** C: flera likadana punktobjekt i ringen – vilken av dem (den norra, den mellersta …). */
function which(candidate: Candidate, features: readonly Feature[], at: Point, radius: number, north: number): { c?: string; count: number } {
  const own = candidate.features[0];
  if (!own || own.geometry !== "point" || !POINT_LIKE.has(own.kind) || candidate.relation === "BETWEEN") return { count: 1 };
  const same = features.filter(f => f.geometry === "point" && f.lookup.rule.d === own.lookup.rule.d
    && length(sub(f.at!, at)) <= radius * SUGGEST_LIMITS.sameWithinRadius);
  if (same.length < 2) return { count: same.length };
  const centroid = centroidOf([same.map(f => f.at!)]);
  const offset = sub(own.at!, centroid);
  const spread = Math.max(...same.map(f => length(sub(f.at!, centroid))));
  if (length(offset) < spread * 0.25) return same.length >= 3 ? { c: "0.5", count: same.length } : { count: same.length };
  const index = sector(offset, north);
  const angle = (90 - index * 45 + north - 90) * Math.PI / 180;
  const axis = { x: Math.cos(angle), y: Math.sin(angle) };
  const projection = (p: Point) => (p.x - centroid.x) * axis.x + (p.y - centroid.y) * axis.y;
  const mine = projection(own.at!);
  const extreme = same.every(f => f === own || projection(f.at!) < mine - 0.1);
  return extreme ? { c: cId(index), count: same.length } : { count: same.length };
}

function boxesOf(candidate: Candidate): DescriptionBox[] {
  const boxes: DescriptionBox[] = [];
  if (candidate.c) boxes.push({ box: "C", ref: candidate.c });
  boxes.push({ box: "D", ref: candidate.d });
  if (candidate.e) boxes.push({ box: "E", ref: candidate.e });
  if (candidate.f) boxes.push({ box: "F", ref: candidate.f });
  if (candidate.g) boxes.push({ box: "G", ref: candidate.g });
  return boxes;
}

const signature = (boxes: readonly DescriptionBox[]) => boxes.map(box => `${box.box}:${box.ref}`).join("|");

/** Förslagen för en punkt i kartan (bäst först, högst `limit`). */
export function suggestAt(map: ParsedMap, at: Point, options: SuggestOptions = {}): DescriptionSuggestion[] {
  const standard = options.standard ?? "2018";
  const scale = options.mapScale ?? map.scale;
  const radius = options.radiusMm ?? 2.5;
  const north = options.northDegrees ?? mapNorthDegrees(map);
  const prepared = prepareMap(map, options.sprint ?? false);
  const nearby = featuresNear(prepared, at, radius + SUGGEST_LIMITS.nearMm);
  const candidates: Candidate[] = [];
  for (const feature of nearby) {
    const found = feature.geometry === "point" ? pointRelations(feature, at, north, scale)
      : feature.geometry === "line" ? lineRelations(feature, at, nearby, north, scale) : areaRelations(feature, at, north, scale);
    for (const candidate of found) {
      candidate.score *= (feature.lookup.by === "NAME" ? 0.75 : 1) * (candidate.relation === "ON" && feature.geometry === "point" ? KIND_WEIGHT[feature.kind] : 1);
      candidates.push(candidate);
      // Symbolens andra tolkningar som alternativ.
      for (const alternative of feature.lookup.rule.alternatives ?? []) {
        if (candidate.d !== feature.lookup.rule.d) continue;
        candidates.push({ ...candidate, d: alternative, score: candidate.score * 0.6, alternative: true });
      }
    }
  }
  candidates.push(...junctions(nearby, at, scale), ...hills(loopsNear(prepared, at, radius), at, radius, north, scale), ...between(nearby, at, scale));
  const db = symbolDb();
  const valid = (boxes: readonly DescriptionBox[]) => boxes.every(box => box.ref && db.find(box.ref, standard))
    && !boxes.some(box => box.ref && ONLY_IN[box.ref] && ONLY_IN[box.ref] !== standard);
  const out: DescriptionSuggestion[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    const counted = which(candidate, nearby, at, radius, north);
    if (counted.c) candidate.c = counted.c;
    else if (counted.count >= 2) candidate.score *= 0.85;
    const e = contextE(candidate, nearby, at);
    const final: Candidate = e ? { ...candidate, e } : candidate;
    const boxes = boxesOf(final);
    if (!valid(boxes) || seen.has(signature(boxes))) continue;
    seen.add(signature(boxes));
    const confidence = Math.max(0.05, Math.min(0.97, final.score));
    const clause = final.clause + (counted.c ? `; ${counted.count} likadana i ringen` : counted.count >= 2 ? `; ${counted.count} likadana i ringen, oklart vilken` : "")
      + (e ? "; utseendet ur omgivningen" : "") + (final.alternative ? " (annan tolkning av symbolen)" : "");
    out.push({ boxes, confidence, level: confidence >= 0.7 ? "HIGH" : confidence >= 0.45 ? "MEDIUM" : "LOW", reason: clause,
      features: suggestedFeatures(final, at, radius, scale) });
    if (out.length >= (options.limit ?? 3)) break;
  }
  return out;
}

function suggestedFeatures(candidate: Candidate, at: Point, radius: number, scale: number): SuggestedFeature[] {
  const toMeters = (mm: number) => Math.round(mm * scale / 100) / 10;
  if (candidate.loop) {
    const loop = candidate.loop;
    return [{ code: loop.symbol.code.text, name: loop.symbol.name, matchedBy: "CONTOUR", geometry: "line", distanceMeters: toMeters(candidate.distance),
      at: candidate.nearest, shape: clipNear([loop.ring], at, radius * 1.5) }];
  }
  return candidate.features.slice(0, 4).map(feature => {
    const nearest = feature.at ?? nearestOnLines(at, feature.lines)?.point ?? at;
    const inside = feature.geometry === "area" && insideRings(at, feature.lines);
    return { code: feature.symbol.code.text, name: feature.symbol.name, matchedBy: feature.lookup.by, geometry: feature.geometry,
      distanceMeters: toMeters(inside ? 0 : length(sub(nearest, at))), at: nearest,
      shape: feature.at ? [[feature.at]] : clipNear(feature.lines, at, radius * 1.5) };
  });
}

/** Valen för en tävlings banläggning: skala, standard, sprint och ringens radius i alla kontrollers utskriftsskala. */
export function suggestOptionsFor(document: CourseSettingDocument): SuggestOptions {
  const scale = document.event.allControlsPrintScale ?? document.event.mapScale;
  return { mapScale: document.event.mapScale, standard: document.event.descriptionStandard, sprint: document.event.overprintStandard === "ISSPROM2019",
    radiusMm: sizesFor(document, scale).control / 2 };
}

/** Kontrollen saknar detalj (kolumn D). */
export const lacksFeature = (boxes: readonly DescriptionBox[]) => !boxes.some(box => box.box === "D" && (box.ref || box.text));

/**
 * Rutorna efter att förslaget godtagits: C, D, E och G (och F när förslaget har korsning/förgrening) ersätts; ett mått i
 * F och H står kvar. Ordningen C–H som Purple Pen.
 */
export function acceptSuggestion(current: readonly DescriptionBox[], suggestion: Pick<DescriptionSuggestion, "boxes">): DescriptionBox[] {
  const replaced = new Set(["C", "D", "E", "G", ...(suggestion.boxes.some(box => box.box === "F") ? ["F"] : [])]);
  const kept = current.filter(box => !replaced.has(box.box));
  const order = "CDEFGH";
  return [...kept, ...suggestion.boxes].sort((a, b) => order.indexOf(a.box) - order.indexOf(b.box));
}

/** Förslagen för kontrollerna i dokumentet (alla vanliga kontroller, eller de angivna), per kontrollens id. */
export function suggestForDocument(map: ParsedMap, document: CourseSettingDocument, controls?: readonly string[],
  options?: SuggestOptions): Record<string, DescriptionSuggestion[]> {
  const chosen = { ...suggestOptionsFor(document), ...options };
  const out: Record<string, DescriptionSuggestion[]> = {};
  for (const id of controls ?? Object.keys(document.controls)) {
    const control = document.controls[id];
    if (control?.kind === "NORMAL") out[id] = suggestAt(map, control.at, chosen);
  }
  return out;
}
