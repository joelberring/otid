import type { SourceFeature } from "@o-tid/map-revision";
import { blend } from "./map-project-knoll-choice";

/**
 * Ägaren 2026-11-12 (ändra utan ny körning): laserjobbet sparar alla branter från 0,8 m fall med sina mått
 * (`brantlinjer.geojson`), och valet görs här med reglage. Samma regel som geo-arbetarens `classifyCliff`
 * (scripts/geo-cliffs.ts): under `minDrop` ingen brant; opasserbar när fallet inom 3 och 6 m når `impassableDrop` och
 * längden `impassableLength`, annars passerbar. Branter kortare än `minLength` (normens 0,6 mm på kartan) tas inte med.
 */
export interface CliffCandidate { readonly line: readonly (readonly [number, number])[]; readonly drop3: number; readonly drop6: number; readonly length: number }
export interface CliffLimits { readonly minDrop: number; readonly impassableDrop: number; readonly impassableLength: number; readonly tags: boolean }
/** Geo-arbetarens förval («Bara höga stup», lärt av Högdalen). */
export const DEFAULT_CLIFF_LIMITS: CliffLimits = { minDrop: 1.3, impassableDrop: 4.5, impassableLength: 20, tags: false };

/** Mängden på skalan 1–10 (5 = förvalen): 1 bara branter från 3 m fall, 10 allt från 0,8 m. Gränsen för opasserbar ändras inte. */
export const cliffLimitsAt = (level: number, current: CliffLimits = DEFAULT_CLIFF_LIMITS): CliffLimits => ({ ...current,
  minDrop: blend({ minDrop: DEFAULT_CLIFF_LIMITS.minDrop }, { minDrop: level < 5 ? 3 : 0.8 }, level < 5 ? (5 - level) / 4 : (level - 5) / 5).minDrop });

export function readCliffCandidates(json: unknown): CliffCandidate[] {
  const features = (json as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  return features.flatMap((feature): CliffCandidate[] => {
    const { geometry, properties } = (feature ?? {}) as { geometry?: { type?: unknown; coordinates?: unknown }; properties?: Record<string, unknown> };
    const raw: unknown[] = geometry?.type === "LineString" && Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
    const line = raw.flatMap((point): [number, number][] => {
      const pair: unknown[] = Array.isArray(point) ? point : [];
      return typeof pair[0] === "number" && typeof pair[1] === "number" ? [[pair[0], pair[1]]] : [];
    });
    const drop3 = properties?.drop3, drop6 = properties?.drop6, length = properties?.length;
    return line.length >= 2 && typeof drop3 === "number" && typeof drop6 === "number" && typeof length === "number" ? [{ line, drop3, drop6, length }] : [];
  });
}

export function classifyCliff(cliff: { drop3: number; drop6: number; length: number }, limits: CliffLimits): "impassable" | "passable" | undefined {
  if (cliff.drop3 < limits.minDrop) return undefined;
  return cliff.drop3 >= limits.impassableDrop && cliff.drop6 >= limits.impassableDrop && cliff.length >= limits.impassableLength ? "impassable" : "passable";
}

/** Valet som kandidater i grundkartans brantlager, med antalen. */
export function cliffFeatures(candidates: readonly CliffCandidate[], limits: CliffLimits, minLength = 0): { features: SourceFeature[]; impassable: number; passable: number } {
  const features: SourceFeature[] = [];
  let impassable = 0, passable = 0;
  for (const cliff of candidates) {
    if (cliff.length < minLength) continue;
    const kind = classifyCliff(cliff, limits);
    if (!kind) continue;
    if (kind === "impassable") impassable += 1; else passable += 1;
    features.push({ layer: kind === "impassable" ? "brant_opasserbar" : limits.tags ? "brant_passerbar_taggar" : "brant_passerbar",
      geometry: { kind: "line", closed: false, points: cliff.line.map(([x, y]) => [x, y]) } });
  }
  return { features, impassable, passable };
}
