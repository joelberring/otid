import type { SourceFeature } from "../index";
import { elongatedKnoll } from "./elongated-knolls";
import { ringArea } from "./small-rings";

/**
 * Ägaren 2026-11-12 («om man vill få färre punkthöjder verkar laserdatat hämtas igen … måste väl inte allt köras om»,
 * «standardinställningen skapar väldigt mycket punkthöjder»): laserjobbet sparar alla möjliga små kullar med sina mått
 * (`kullar.geojson`), och valet bland dem görs här med reglage, utan ny körning. Samma regel som geo-arbetarens
 * `chooseKnolls` (scripts/geo-rock.ts): gränserna, och sedan de högsta först med ett minsta avstånd emellan.
 */
export interface KnollCandidate { readonly at: readonly [number, number]; readonly rise: number; readonly share: number; readonly footM2: number;
  /** Ligger i blöt eller fuktig mark: tas bara med om den är uppenbar (minst `KNOLL_OBVIOUS_RISE` m). */
  readonly wet?: boolean | undefined;
  /** Fotens längd/bredd-kvot (>= 1, från 2D-tröghetstensor i `kullar.geojson`). */
  readonly aspect?: number | undefined;
  /** Längdaxelns riktning i grader moturs från öster (+X) i [0, 180). */
  readonly angle?: number | undefined }
export const KNOLL_OBVIOUS_RISE = 1.5;
/** Minsta fot (m²) för en riktig kulle: rensar 1–2 m laserbrus och ensamma block utan att tappa skarpa små bergkullar. */
export const KNOLL_MIN_FOOT_M2 = 8;
/** Gränser för avlång punkthöjd (110) ur `kullar.geojson` (samma kriterium som `tools/otidgeo/src/knolls.rs`). */
export const KNOLL_ELONGATED_ASPECT = 1.65;
export const KNOLL_ELONGATED_MIN_FOOT_M2 = 18;
/** Minsta avstånd (m) mellan två punkthöjder (`109`/`110`) vid avdubblettering i sammansättningen. */
export const KNOLL_DEDUP_METERS = 6;
export interface KnollLimits { readonly minRise: number; readonly lowerShare: number; readonly maxFootM2: number; readonly spacing: number }
/**
 * Geo-arbetarens förval (det som `knollar`-lagret i grundkartan är räknat med). Kalibrerat mot fem svenska skogskartor
 * (Högdalen, Tyresta, Gömmaren, Lida, Djurgården) + Bandhagen: lägre stigning (0,9 m) och tätare avstånd (12 m) hittar
 * betydligt fler verkliga små kullar utan att översvämma kartan eftersom kompaktare fot (högst 70 m²) och 85 % lägre ring
 * håller bort breda sluttningsskuldor (oberoende 4-kartors F1 0,279 → 0,371, recall +70 % med bibehållen precision).
 */
export const DEFAULT_KNOLL_LIMITS: KnollLimits = { minRise: 0.9, lowerShare: 0.85, maxFootM2: 70, spacing: 12 };

/**
 * Ägaren 2026-11-12 («en skala 1–10 med 5 i mitten som är förinställt»): ett enda reglage för mängden. 5 är förvalen, 1 ger
 * bara de högsta och tydligaste med gott om plats emellan, 10 släpper in allt laserjobbet har sparat. Däremellan rätlinjigt.
 */
const FEWEST_KNOLLS: KnollLimits = { minRise: 2, lowerShare: 0.95, maxFootM2: 70, spacing: 40 };
const MOST_KNOLLS: KnollLimits = { minRise: 0.5, lowerShare: 0.5, maxFootM2: 160, spacing: 10 };
export const knollLimitsAt = (level: number): KnollLimits => blend(DEFAULT_KNOLL_LIMITS, level < 5 ? FEWEST_KNOLLS : MOST_KNOLLS, level < 5 ? (5 - level) / 4 : (level - 5) / 5);

/** Gränserna en andel `share` (0–1) av vägen från `from` till `to`, avrundade till två decimaler. Annat än tal tas från `from`. */
export function blend<L extends object>(from: L, to: L, share: number): L {
  const t = Math.min(1, Math.max(0, share));
  return Object.fromEntries(Object.entries(from).map(([key, value]) => {
    const other = (to as Record<string, unknown>)[key];
    return [key, typeof value === "number" && typeof other === "number" ? Math.round((value + (other - value) * t) * 100) / 100 : value];
  })) as L;
}

/** Kandidaterna ur `kullar.geojson` (punkter i SWEREF 99 TM med egenskaperna rise, share och foot, samt valfria aspect/angle). Annat hoppas över. */
export function readKnollCandidates(json: unknown): KnollCandidate[] {
  const features = (json as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  return features.flatMap((feature): KnollCandidate[] => {
    const { geometry, properties } = (feature ?? {}) as { geometry?: { type?: unknown; coordinates?: unknown }; properties?: Record<string, unknown> };
    const at: unknown[] = geometry?.type === "Point" && Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
    const x = at[0], y = at[1], rise = properties?.rise, share = properties?.share, foot = properties?.foot;
    if (!(typeof x === "number" && typeof y === "number" && typeof rise === "number" && typeof share === "number" && typeof foot === "number")) return [];
    const aspect = properties?.aspect, angle = properties?.angle;
    const shape = typeof aspect === "number" && Number.isFinite(aspect) && aspect >= 1
      && typeof angle === "number" && Number.isFinite(angle)
      ? { aspect, angle } : {};
    return [{ at: [x, y], rise, share, footM2: foot, ...(properties?.wet ? { wet: true } : {}), ...shape }];
  });
}

/** Valda kandidater med alla mått bevarade (inkl. ev. `aspect` och `angle` för avlånga punkthöjder). */
export function chooseKnollCandidates(candidates: readonly KnollCandidate[], limits: KnollLimits): KnollCandidate[] {
  const found = candidates.filter(knoll => knoll.rise >= limits.minRise && knoll.share >= limits.lowerShare
    && knoll.footM2 >= KNOLL_MIN_FOOT_M2 && knoll.footM2 <= limits.maxFootM2
    && (!knoll.wet || knoll.rise >= KNOLL_OBVIOUS_RISE))
    .sort((a, b) => b.rise - a.rise);
  const reach = limits.spacing, cells = new Map<string, [number, number][]>(), kept: KnollCandidate[] = [];
  for (const knoll of found) {
    const [x, y] = knoll.at;
    const cx = Math.floor(x / reach), cy = Math.floor(y / reach);
    let near = false;
    for (let ax = -1; ax <= 1 && !near; ax += 1) for (let ay = -1; ay <= 1 && !near; ay += 1) {
      for (const [px, py] of cells.get(`${cx + ax},${cy + ay}`) ?? []) if (Math.hypot(px - x, py - y) < reach) { near = true; break; }
    }
    if (near) continue;
    kept.push(knoll);
    const key = `${cx},${cy}`, list = cells.get(key);
    if (list) list.push([x, y]); else cells.set(key, [[x, y]]);
  }
  return kept;
}

export function chooseKnolls(candidates: readonly KnollCandidate[], limits: KnollLimits): [number, number][] {
  return chooseKnollCandidates(candidates, limits).map(({ at: [x, y] }) => [x, y]);
}

/** Om en kandidat har formklassning och är tillräckligt avlång för symbol 110 (`dotknoll_avlang`). */
export const isElongatedKnollCandidate = (candidate: KnollCandidate): candidate is KnollCandidate & { readonly aspect: number; readonly angle: number } =>
  candidate.aspect !== undefined && candidate.angle !== undefined
  && candidate.aspect >= KNOLL_ELONGATED_ASPECT && candidate.footM2 >= KNOLL_ELONGATED_MIN_FOOT_M2;

/** Valet som kandidater i grundkartans lager för små kullar (109, eller 110 när foten är avlång). */
export function knollFeatures(points: readonly (readonly [number, number] | KnollCandidate)[]): SourceFeature[] {
  return points.map(item => {
    if (Array.isArray(item)) return { layer: "dotknoll_laser", geometry: { kind: "point", at: [item[0] as number, item[1] as number] } };
    const candidate = item as KnollCandidate;
    return isElongatedKnollCandidate(candidate)
      ? elongatedKnoll(candidate.at, candidate.angle * Math.PI / 180)
      : { layer: "dotknoll_laser", geometry: { kind: "point", at: [candidate.at[0], candidate.at[1]] } };
  });
}

const ANY_KNOLL_LAYER = /^dotknoll(_laser|_avlang)?$/i;
const SUMMIT_CONTOUR_LAYER = /^(contour|depression)(_index)?$/i;
const MAX_SUMMIT_RING_M2 = 3000;

function pointInRing(ring: readonly (readonly [number, number])[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * Filtrerar bort inkommande punkthöjder (`109`/`110`) som ligger inom `radius` m från redan kvarvarande punkthöjder
 * (eller inuti en kvarvarande sluten toppkurva under `maxSummitArea` m²), så att `109` och `110` aldrig hamnar dubbelt.
 */
export function deduplicateKnollFeatures(
  incoming: readonly SourceFeature[],
  existing: readonly SourceFeature[],
  radius = KNOLL_DEDUP_METERS,
  maxSummitArea = MAX_SUMMIT_RING_M2
): SourceFeature[] {
  const cell = Math.max(radius, 1);
  const radiusSq = radius * radius;
  const grid = new Map<string, [number, number][]>();
  const addPoint = (x: number, y: number) => {
    const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    const list = grid.get(key);
    if (list) list.push([x, y]); else grid.set(key, [[x, y]]);
  };
  const nearExisting = (x: number, y: number): boolean => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    for (let ax = -1; ax <= 1; ax += 1) for (let ay = -1; ay <= 1; ay += 1) {
      for (const [px, py] of grid.get(`${cx + ax},${cy + ay}`) ?? []) {
        const dx = px - x, dy = py - y;
        if (dx * dx + dy * dy <= radiusSq) return true;
      }
    }
    return false;
  };
  const summits: { readonly ring: readonly (readonly [number, number])[]; readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }[] = [];
  for (const feature of existing) {
    if (feature.geometry.kind === "point" && ANY_KNOLL_LAYER.test(feature.layer)) {
      addPoint(feature.geometry.at[0], feature.geometry.at[1]);
    } else if (feature.geometry.kind === "line" && feature.geometry.closed && SUMMIT_CONTOUR_LAYER.test(feature.layer) && feature.geometry.points.length >= 3) {
      const ring = feature.geometry.points;
      if (ringArea(ring) >= maxSummitArea) continue;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of ring) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      summits.push({ ring, minX, minY, maxX, maxY });
    }
  }
  const kept: SourceFeature[] = [];
  for (const feature of incoming) {
    if (feature.geometry.kind !== "point") { kept.push(feature); continue; }
    const [x, y] = feature.geometry.at;
    if (nearExisting(x, y)) continue;
    if (summits.some(s => x >= s.minX && x <= s.maxX && y >= s.minY && y <= s.maxY && pointInRing(s.ring, x, y))) continue;
    addPoint(x, y);
    kept.push(feature);
  }
  return kept;
}
