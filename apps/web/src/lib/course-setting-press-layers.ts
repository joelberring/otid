import {
  detectPressNorm, effectiveSourceMapColors, mapColorAdjust, overColorBands, pressOrder, usageCodes, type OverColorBand, type PressNorm, type PrintProfile
} from "@o-tid/course-setting";
import type { ColorUsage, MapColor } from "@o-tid/map-file";

/**
 * Normens färgordning i förhandsvisningen (ADR-0211 beslut 3), samma som PDF:en (`colorsOverCourse` i print-pdf): kartans
 * färger under banan, banans undre lila, kartans färger över banan i sammanhängande `overBands` i exakt `rank`-ordning
 * (`INK` med Darken, `WHITE` som slår ut) och banans övre lila överst. `undefined` = banan överst (Purple Pens sätt).
 */
export interface PressLayers {
  readonly norm: PressNorm;
  readonly numbersOnTop: boolean;
  readonly over: readonly number[];
  /** Sammanhängande band i exakt ritordning (understa först, översta sist): INK (blandas med Darken) och WHITE (slår ut). */
  readonly overBands: readonly OverColorBand[];
  /** Vitt över banan (äkta övre vitt) ur `overBands`. */
  readonly overWhite: readonly number[];
  /** Färgerna över banan utom vitt ur `overBands`. */
  readonly overInk: readonly number[];
  readonly under: readonly number[];
}

/** Bildnyckel för ett `OVER`-band i förhandsvisningen. */
export const overBandImageKey = (frameKey: string, bandIndex: number) => `${frameKey}|OVER:${bandIndex}`;

/** Normen för kartan: profilens val, annars ur skalan och symbolnumren. */
export function pressNormOf(profile: Pick<PrintProfile, "pressNorm">, mapScale: number | undefined, usage: ReadonlyMap<number, ColorUsage>): PressNorm {
  return profile.pressNorm ?? detectPressNorm({ scale: mapScale, codes: usageCodes(usage.values()) });
}

export function pressLayersFor(profile: PrintProfile, colors: readonly MapColor[], usage: ReadonlyMap<number, ColorUsage>, mapScale: number | undefined): PressLayers | undefined {
  if (profile.courseLayer !== "REFERENCE" || colors.length === 0) return undefined;
  const norm = pressNormOf(profile, mapScale, usage);
  const adjust = mapColorAdjust(profile, colors);
  const source = effectiveSourceMapColors(colors, usage, adjust);
  const order = pressOrder(source, norm);
  if (order.over.size === 0) return undefined;
  const overBands = overColorBands(colors, order.over, adjust);
  if (overBands.length === 0) return undefined;
  const overIds = overBands.flatMap(band => band.ids);
  const overSet = new Set(overIds);
  return {
    norm,
    numbersOnTop: profile.numbersOnTop ?? false,
    over: overIds,
    overBands,
    overWhite: overBands.filter(band => band.kind === "WHITE").flatMap(band => band.ids),
    overInk: overBands.filter(band => band.kind === "INK").flatMap(band => band.ids),
    under: colors.filter(color => !overSet.has(color.id) && !adjust[color.id]?.hidden).map(color => color.id)
  };
}
