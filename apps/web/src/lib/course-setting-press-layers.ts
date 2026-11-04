import {
  detectPressNorm, pressOrder, sourceMapColors, usageCodes, type PressNorm, type PrintProfile
} from "@o-tid/course-setting";
import type { ColorUsage, MapColor } from "@o-tid/map-file";

/**
 * Normens färgordning i förhandsvisningen (ADR-0211 beslut 3), samma som PDF:en (`colorsOverCourse` i print-pdf): kartans
 * färger under banan, banans undre lila, kartans färger över banan (ritade med multiplicering, som övertryck på tryck; vitt
 * slår ut) och banans övre lila (markeringar, i sprint och med "Kontrollnummer och texter överst" också numren) överst. `undefined` = banan överst (Purple Pens sätt).
 */
export interface PressLayers {
  readonly norm: PressNorm;
  readonly numbersOnTop: boolean;
  readonly over: readonly number[];
  /** Vitt över banan (äkta övre vitt): slår ut som i PDF:en, ritas därför utan multiplicering under de andra färgerna över banan. */
  readonly overWhite: readonly number[];
  /** Färgerna över banan utom vitt (multiplicerade). */
  readonly overInk: readonly number[];
  readonly under: readonly number[];
}

/** Normen för kartan: profilens val, annars ur skalan och symbolnumren. */
export function pressNormOf(profile: Pick<PrintProfile, "pressNorm">, mapScale: number | undefined, usage: ReadonlyMap<number, ColorUsage>): PressNorm {
  return profile.pressNorm ?? detectPressNorm({ scale: mapScale, codes: usageCodes(usage.values()) });
}

export function pressLayersFor(profile: PrintProfile, colors: readonly MapColor[], usage: ReadonlyMap<number, ColorUsage>, mapScale: number | undefined): PressLayers | undefined {
  if (profile.courseLayer !== "REFERENCE" || colors.length === 0) return undefined;
  const norm = pressNormOf(profile, mapScale, usage);
  const order = pressOrder(sourceMapColors(colors, usage), norm);
  const over = order.over;
  if (over.size === 0) return undefined;
  const white = new Set(order.classes.filter(item => item.kind === "WHITE").map(item => item.ocadId));
  const overIds = colors.filter(color => over.has(color.id)).map(color => color.id);
  return { norm, numbersOnTop: profile.numbersOnTop ?? false, over: overIds, overWhite: overIds.filter(id => white.has(id)),
    overInk: overIds.filter(id => !white.has(id)), under: colors.filter(color => !over.has(color.id)).map(color => color.id) };
}
