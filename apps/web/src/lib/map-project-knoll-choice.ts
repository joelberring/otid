import type { SourceFeature } from "@o-tid/map-revision";

/**
 * Ägaren 2026-11-12 («om man vill få färre punkthöjder verkar laserdatat hämtas igen … måste väl inte allt köras om»,
 * «standardinställningen skapar väldigt mycket punkthöjder»): laserjobbet sparar alla möjliga små kullar med sina mått
 * (`kullar.geojson`), och valet bland dem görs här med reglage, utan ny körning. Samma regel som geo-arbetarens
 * `chooseKnolls` (scripts/geo-rock.ts): gränserna, och sedan de högsta först med ett minsta avstånd emellan.
 */
export interface KnollCandidate { readonly at: readonly [number, number]; readonly rise: number; readonly share: number; readonly footM2: number }
export interface KnollLimits { readonly minRise: number; readonly lowerShare: number; readonly maxFootM2: number; readonly spacing: number }
/** Geo-arbetarens förval (det som `knollar`-lagret i grundkartan är räknat med). */
export const DEFAULT_KNOLL_LIMITS: KnollLimits = { minRise: 1, lowerShare: 0.8, maxFootM2: 80, spacing: 10 };

/**
 * Ägaren 2026-11-12 («en skala 1–10 med 5 i mitten som är förinställt»): ett enda reglage för mängden. 5 är förvalen, 1 ger
 * bara de högsta och tydligaste med gott om plats emellan, 10 släpper in allt laserjobbet har sparat. Däremellan rätlinjigt.
 */
const FEWEST_KNOLLS: KnollLimits = { minRise: 2, lowerShare: 0.95, maxFootM2: 80, spacing: 40 };
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

/** Kandidaterna ur `kullar.geojson` (punkter i SWEREF 99 TM med egenskaperna rise, share och foot). Annat hoppas över. */
export function readKnollCandidates(json: unknown): KnollCandidate[] {
  const features = (json as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  return features.flatMap((feature): KnollCandidate[] => {
    const { geometry, properties } = (feature ?? {}) as { geometry?: { type?: unknown; coordinates?: unknown }; properties?: Record<string, unknown> };
    const at: unknown[] = geometry?.type === "Point" && Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
    const x = at[0], y = at[1], rise = properties?.rise, share = properties?.share, foot = properties?.foot;
    return typeof x === "number" && typeof y === "number" && typeof rise === "number" && typeof share === "number" && typeof foot === "number"
      ? [{ at: [x, y], rise, share, footM2: foot }] : [];
  });
}

export function chooseKnolls(candidates: readonly KnollCandidate[], limits: KnollLimits): [number, number][] {
  const found = candidates.filter(knoll => knoll.rise >= limits.minRise && knoll.share >= limits.lowerShare && knoll.footM2 <= limits.maxFootM2)
    .sort((a, b) => b.rise - a.rise);
  const reach = limits.spacing, cells = new Map<string, [number, number][]>(), kept: [number, number][] = [];
  for (const { at: [x, y] } of found) {
    const cx = Math.floor(x / reach), cy = Math.floor(y / reach);
    let near = false;
    for (let ax = -1; ax <= 1 && !near; ax += 1) for (let ay = -1; ay <= 1 && !near; ay += 1) {
      for (const [px, py] of cells.get(`${cx + ax},${cy + ay}`) ?? []) if (Math.hypot(px - x, py - y) < reach) { near = true; break; }
    }
    if (near) continue;
    kept.push([x, y]);
    const key = `${cx},${cy}`, list = cells.get(key);
    if (list) list.push([x, y]); else cells.set(key, [[x, y]]);
  }
  return kept;
}

/** Valet som kandidater i grundkartans lager för små kullar (109). */
export const knollFeatures = (points: readonly (readonly [number, number])[]): SourceFeature[] =>
  points.map(at => ({ layer: "dotknoll_laser", geometry: { kind: "point", at: [at[0], at[1]] } }));
