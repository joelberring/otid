/**
 * Storlekarna i banpåtrycket enligt ISOM 2017-2 och ISSprOM 2019-2, med Purple Pens mått och skalning
 * (NormalCourseAppearance i Appearance.cs, CourseAppearance i EventDB.cs, CourseView.CourseObjRatio; BSD, Peter Golde).
 */
import { rawAttribute } from "./ppen-common";
import type { CourseSettingDocument } from "./types";

/** Mått på papperet i mm vid standardens skala (ytterdiametrar inklusive linjen). */
export const OVERPRINT_SIZES = {
  ISOM2017: { line: 0.35, controlOutside: 5.35, finishOutside: 6.35, finishInside: 4.35, startRadius: 3.464, crossingRadius: 2.5, number: 4.0 },
  ISSPROM2019: { line: 0.35, controlOutside: 6.35, finishOutside: 7.35, finishInside: 5.35, startRadius: 4.041, crossingRadius: 2.5, number: 4.0 }
} as const;

/** Siffrans höjd för koder i "alla kontroller" (Roboto Condensed, 3 mm). */
export const CODE_HEIGHT = 3.0;
/** Avstånd från ringens kant till numret respektive koden. */
export const NUMBER_DISTANCE = 1.825;
export const CODE_DISTANCE = 0.325;

export type ItemScaling = "None" | "RelativeToMap" | "RelativeTo15000";

export interface Appearance {
  readonly itemScaling: ItemScaling;
  readonly circleSize: number;
  readonly lineWidth: number;
  readonly numberSize: number;
  readonly autoLegGap: number;
  readonly circleGapsScaled: boolean;
}

/** Utseendet ur händelsens `course-appearance` (som Purple Pen läser det, med samma förval). */
export function appearanceOf(document: CourseSettingDocument): Appearance {
  const raw = document.event.raw;
  const get = (name: string) => rawAttribute(raw, "course-appearance", name);
  const ratio = (name: string, fallback: number) => {
    const value = Number(get(name));
    return get(name) !== undefined && Number.isFinite(value) ? value : fallback;
  };
  const scaling = get("scale-sizes");
  return {
    itemScaling: scaling === "RelativeToMap" || scaling === "RelativeTo15000" ? scaling : "None",
    circleSize: ratio("control-circle-size-ratio", 1),
    lineWidth: ratio("line-width-ratio", 1),
    numberSize: ratio("number-size-ratio", 1),
    autoLegGap: ratio("auto-leg-gap-size", 3.5),
    circleGapsScaled: get("scale-sizes-circle-gaps")?.toLowerCase() === "true"
  };
}

/** Kvoten mellan banpåtryckets mått i kartans mm och på papperet (CourseView.CourseObjRatio). */
export function courseObjRatio(appearance: Appearance, printScale: number, mapScale: number): number {
  switch (appearance.itemScaling) {
    case "RelativeToMap": return 1;
    case "RelativeTo15000": return 15000 / mapScale;
    default: {
      const ratio = printScale / mapScale;
      return ratio > 0.99999 && ratio < 1.00001 ? 1 : ratio;
    }
  }
}

/** Skalan som ringavbrotten sparas för (CourseView.CircleGapScale). */
export function circleGapScale(appearance: Appearance, printScale: number, mapScale: number): number {
  switch (appearance.itemScaling) {
    case "RelativeToMap": return Math.round(mapScale);
    case "RelativeTo15000": return 15000;
    default: return Math.round(printScale);
  }
}

/** Måtten i kartans mm för en utskriftsskala. */
export interface Sizes {
  readonly ratio: number;
  readonly line: number;
  /** Diametrar till linjens mitt. */
  readonly control: number;
  readonly finishOuter: number;
  readonly finishInner: number;
  readonly startRadius: number;
  readonly crossingRadius: number;
  readonly numberHeight: number;
  readonly codeHeight: number;
  readonly numberDistance: number;
  readonly codeDistance: number;
  readonly autoLegGap: number;
  readonly sprint: boolean;
}

export function sizesFor(document: CourseSettingDocument, printScale: number): Sizes {
  const appearance = appearanceOf(document);
  const standard = OVERPRINT_SIZES[document.event.overprintStandard];
  const ratio = courseObjRatio(appearance, printScale, document.event.mapScale);
  const line = standard.line * appearance.lineWidth * ratio;
  // Purple Pen: ytterdiametern skalas med ringstorleken, linjen med linjebredden.
  const outside = (value: number) => value * appearance.circleSize * ratio;
  const finishInsideOutside = ((standard.finishInside + standard.line) * appearance.circleSize - standard.line * appearance.lineWidth) * ratio;
  return {
    ratio,
    line,
    control: outside(standard.controlOutside) - line,
    finishOuter: outside(standard.finishOutside) - line,
    finishInner: finishInsideOutside - line,
    startRadius: standard.startRadius * appearance.circleSize * ratio,
    crossingRadius: standard.crossingRadius * appearance.circleSize * ratio,
    numberHeight: standard.number * appearance.numberSize * ratio,
    codeHeight: CODE_HEIGHT * ratio,
    numberDistance: NUMBER_DISTANCE * ratio,
    codeDistance: CODE_DISTANCE * ratio,
    autoLegGap: appearance.autoLegGap * ratio,
    sprint: document.event.overprintStandard === "ISSPROM2019"
  };
}
