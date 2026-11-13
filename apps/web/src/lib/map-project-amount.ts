import { DEFAULT_CLEAR_CUT_AGES, type ClearCutAges } from "./map-project-clear-cuts";
import { DEFAULT_GREEN, type GreenSettings } from "./map-project-green-classes";
import { blend } from "./map-project-knoll-choice";
import { DEFAULT_DEPTH, type DepthSettings } from "./map-project-moisture-depth";

/**
 * Ägaren 2026-11-12 («en skala 1–10 med 5 i mitten som är förinställt … sätt samma reglage på alla»): mängden på skalan 1–10
 * för grönt, sankmark och hyggen. 5 är förvalen; 1 ger minst och 10 mest, rätlinjigt däremellan. Det som inte styr mängden
 * (minsta yta, gränser, undervegetation) tas från det som redan är inställt.
 */
const share = (level: number) => level < 5 ? (5 - level) / 4 : (level - 5) / 5;

/** Grönt: stegen där 406, 408 och 410 börjar. 1 = bara det tätaste blir grönt, 10 = redan gles vegetation blir grön. */
export function greenAt(level: number, current: GreenSettings = DEFAULT_GREEN): GreenSettings {
  const steps = blend({ slow: DEFAULT_GREEN.slow, difficult: DEFAULT_GREEN.difficult, fight: DEFAULT_GREEN.fight },
    level < 5 ? { slow: 6, difficult: 8, fight: 9 } : { slow: 0, difficult: 2, fight: 3 }, share(level));
  const slow = Math.round(steps.slow), difficult = Math.max(slow, Math.round(steps.difficult));
  // Buskskiktets gräns (klassbilder från geo-arbetaren 28) ger de fina stegen: 1 = en fjärdedel av träffarna, 10 = 4 %.
  const dense = blend({ share: DEFAULT_GREEN.denseShare! }, { share: level < 5 ? 0.25 : 0.04 }, share(level)).share;
  return { ...current, slow, difficult, fight: Math.max(difficult, Math.round(steps.fight)), denseShare: Math.round(dense * 1000) / 1000 };
}

/** Sankmark: hur högt över fuktstråket marken räknas som blöt och fuktig. 1 = bara det lägsta, 10 = långt upp på kanterna. */
export function depthAt(level: number, current: DepthSettings = DEFAULT_DEPTH): DepthSettings {
  const depths = blend({ wetMeters: DEFAULT_DEPTH.wetMeters, moistMeters: DEFAULT_DEPTH.moistMeters },
    level < 5 ? { wetMeters: 0.1, moistMeters: 0.25 } : { wetMeters: 0.8, moistMeters: 1.5 }, share(level));
  return { ...current, ...depths };
}

/** Hyggen: hur gamla hyggen som räknas som färska, sly och ungskog. 1 = bara de yngsta, 10 = dubbelt så gamla som förvalen. */
export function clearCutAgesAt(level: number): ClearCutAges {
  const factor = level < 5 ? 1 - 0.6 * share(level) : 1 + share(level);
  const fresh = Math.max(1, Math.round(DEFAULT_CLEAR_CUT_AGES.fresh * factor)), scrub = Math.max(fresh + 1, Math.round(DEFAULT_CLEAR_CUT_AGES.scrub * factor));
  return { fresh, scrub, young: Math.max(scrub + 1, Math.round(DEFAULT_CLEAR_CUT_AGES.young * factor)) };
}
