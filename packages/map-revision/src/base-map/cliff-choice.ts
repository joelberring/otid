import type { SourceFeature } from "../index";
import { blend } from "./knoll-choice";

/**
 * Ägaren 2026-11-12 (ändra utan ny körning): laserjobbet sparar alla branter från 0,8 m fall med sina mått
 * (`brantlinjer.geojson`), och valet görs här med reglage. Samma regel som geo-arbetarens `classifyCliff`
 * (scripts/geo-cliffs.ts): under `minDrop` ingen brant; opasserbar när fallet inom 3 och 6 m når `impassableDrop`,
 * längden `impassableLength` och (när branten bär `slope`) lutningen `impassableSlope`, annars passerbar.
 * Branter kortare än `minLength` tas inte med.
 */
export interface CliffCandidate {
  readonly line: readonly (readonly [number, number])[];
  readonly drop3: number;
  readonly drop6: number;
  readonly length: number;
  /** Medianlutning längs brantens mittlinje (grader, valfri från nyare `brantlinjer.geojson`). */
  readonly slope?: number | undefined;
  /** Brantkantens skärpa `drop3 / drop6` (valfri från nyare `brantlinjer.geojson`). */
  readonly sharpness?: number | undefined;
}
export interface CliffLimits {
  readonly minDrop: number;
  readonly impassableDrop: number;
  readonly impassableLength: number;
  readonly tags: boolean;
  /** Kortaste brant som tas med (m); normens 0,6 mm på kartan är förvalet (`normCliffLength`). */
  readonly minLength: number;
  /** Minsta medianlutning (grader) för opasserbar brant (201) när kandidaten bär `slope`; utelämnat = prövas inte. */
  readonly impassableSlope?: number | undefined;
}
/** Normens kortaste brant (0,6 mm på kartan) i meter för kartans skala. */
export const normCliffLength = (scale: number) => 0.6 * scale / 1000;
/** Sprintskala (≤ 1:5 000, t.ex. 1:4 000 ISSprOM). */
export const isSprintCliffScale = (scale: number) => scale <= 5000;
/** Skalanpassade förval kalibrerade mot 6 autentiska OCAD-kartor (4 skog + 2 sprint). */
export const FOREST_CLIFF_DEFAULTS = { minDrop: 1.3, impassableDrop: 4.0, impassableLength: 16, impassableSlope: 40 } as const;
export const SPRINT_CLIFF_DEFAULTS = { minDrop: 1.3, impassableDrop: 3.0, impassableLength: 8, impassableSlope: 39 } as const;
/** Geo-arbetarens skalanpassade förval, med normens kortaste brant för skalan. */
export const defaultCliffLimits = (scale: number): CliffLimits => {
  const base = isSprintCliffScale(scale) ? SPRINT_CLIFF_DEFAULTS : FOREST_CLIFF_DEFAULTS;
  return { ...base, tags: false, minLength: normCliffLength(scale) };
};

/**
 * Mängden på skalan 1–10 (5 = förvalen). Ägaren 2026-11-12 («punkthöjderna ändras med reglage men inte branterna»): laserns
 * branter har nästan alltid minst 2,3 m fall (hälften över 3,9 m) och hälften är kortare än 12 m, så skalan måste gå över
 * både fallet och längden för att märkas. 1 = bara de högsta och längsta (5,5 m / 30 m i skog, 4,0 m / 16 m i sprint),
 * 10 = alla, också de som är kortare än normens 0,6 mm. Gränsen för opasserbar och taggarna ändras inte.
 */
export function cliffLimitsAt(level: number, current: CliffLimits, scale: number): CliffLimits {
  const sprint = isSprintCliffScale(scale);
  const usual = { minDrop: sprint ? SPRINT_CLIFF_DEFAULTS.minDrop : FOREST_CLIFF_DEFAULTS.minDrop, minLength: normCliffLength(scale) };
  const fewest = sprint ? { minDrop: 4.0, minLength: 16 } : { minDrop: 5.5, minLength: 30 };
  return { ...current, ...blend(usual, level < 5 ? fewest : { minDrop: 0.8, minLength: 0 }, level < 5 ? (5 - level) / 4 : (level - 5) / 5) };
}

export function readCliffCandidates(json: unknown): CliffCandidate[] {
  const features = (json as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  return features.flatMap((feature): CliffCandidate[] => {
    const { geometry, properties } = (feature ?? {}) as { geometry?: { type?: unknown; coordinates?: unknown }; properties?: Record<string, unknown> };
    const raw: unknown[] = geometry?.type === "LineString" && Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
    const line = raw.flatMap((point): [number, number][] => {
      const pair: unknown[] = Array.isArray(point) ? point : [];
      return typeof pair[0] === "number" && Number.isFinite(pair[0]) && typeof pair[1] === "number" && Number.isFinite(pair[1]) ? [[pair[0], pair[1]]] : [];
    });
    const drop3 = properties?.drop3, drop6 = properties?.drop6, length = properties?.length;
    if (!(line.length >= 2 && typeof drop3 === "number" && Number.isFinite(drop3) && typeof length === "number" && Number.isFinite(length))) return [];
    // `drop6: null` uppstår vid kart-/vattenkant där ±6 m saknar data: bevara branten som passerbar (drop6 = NaN, aldrig opasserbar).
    if (!(drop6 === null || (typeof drop6 === "number" && Number.isFinite(drop6)))) return [];
    const slope = properties?.slope, sharpness = properties?.sharpness;
    return [{
      line, drop3, drop6: drop6 === null ? Number.NaN : drop6, length,
      ...(typeof slope === "number" && Number.isFinite(slope) ? { slope } : {}),
      ...(typeof sharpness === "number" && Number.isFinite(sharpness) ? { sharpness } : {})
    }];
  });
}

export function classifyCliff(
  cliff: { readonly drop3: number; readonly drop6: number; readonly length: number; readonly slope?: number | undefined },
  limits: CliffLimits
): "impassable" | "passable" | undefined {
  if (!Number.isFinite(cliff.drop3) || cliff.drop3 < limits.minDrop) return undefined;
  const steepEnough = limits.impassableSlope === undefined || cliff.slope === undefined || cliff.slope >= limits.impassableSlope;
  return cliff.drop3 >= limits.impassableDrop
    && Number.isFinite(cliff.drop6) && cliff.drop6 >= limits.impassableDrop
    && cliff.length >= limits.impassableLength
    && steepEnough
    ? "impassable" : "passable";
}

/** Valet som kandidater i grundkartans brantlager, med antalen. */
export function cliffFeatures(candidates: readonly CliffCandidate[], limits: CliffLimits): { features: SourceFeature[]; impassable: number; passable: number } {
  const features: SourceFeature[] = [];
  let impassable = 0, passable = 0;
  for (const cliff of candidates) {
    if (cliff.length < limits.minLength) continue;
    const kind = classifyCliff(cliff, limits);
    if (!kind) continue;
    if (kind === "impassable") impassable += 1; else passable += 1;
    features.push({ layer: kind === "impassable" ? "brant_opasserbar" : limits.tags ? "brant_passerbar_taggar" : "brant_passerbar",
      geometry: { kind: "line", closed: false, points: cliff.line.map(([x, y]) => [x, y]) } });
  }
  return { features, impassable, passable };
}
