import {
  detectPressNorm, pressOrder, sourceMapColors, usageCodes, type PressNorm, type PrintProfile
} from "@o-tid/course-setting";
import type { ColorUsage, MapColor } from "@o-tid/map-file";

/**
 * Normens färgordning i förhandsvisningen (ADR-0211 beslut 3), samma som PDF:en (`colorsOverCourse` i print-pdf): kartans
 * färger under banan, banans undre lila, kartans färger över banan (ritade med multiplicering, som övertryck på tryck) och
 * banans övre lila (nummer, markeringar) överst. `undefined` = banan överst (Purple Pens sätt).
 */
export interface PressLayers {
  readonly norm: PressNorm;
  readonly numbersOnTop: boolean;
  readonly over: readonly number[];
  readonly under: readonly number[];
}

/** Normen för kartan: profilens val, annars ur skalan och symbolnumren. */
export function pressNormOf(profile: Pick<PrintProfile, "pressNorm">, mapScale: number | undefined, usage: ReadonlyMap<number, ColorUsage>): PressNorm {
  return profile.pressNorm ?? detectPressNorm({ scale: mapScale, codes: usageCodes(usage.values()) });
}

export function pressLayersFor(profile: PrintProfile, colors: readonly MapColor[], usage: ReadonlyMap<number, ColorUsage>, mapScale: number | undefined): PressLayers | undefined {
  if (profile.courseLayer !== "REFERENCE" || colors.length === 0) return undefined;
  const norm = pressNormOf(profile, mapScale, usage);
  const over = pressOrder(sourceMapColors(colors, usage), norm).over;
  if (over.size === 0) return undefined;
  return { norm, numbersOnTop: profile.numbersOnTop ?? true, over: colors.filter(color => over.has(color.id)).map(color => color.id),
    under: colors.filter(color => !over.has(color.id)).map(color => color.id) };
}
