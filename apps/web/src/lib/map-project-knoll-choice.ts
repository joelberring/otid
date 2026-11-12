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
