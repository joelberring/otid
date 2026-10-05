import type { EvaluationStatus, RaceSnapshot } from "./types";

/**
 * Redigera bana (ADR-0169 beslut 4): en ny kontrollföljd för en bana prövas
 * mot samma resultatmotor som avläsningen använder. Funktionerna här är rena;
 * applikationslagret läser underlaget och sparar.
 */
export interface ProposedCourseVersion {
  readonly id: string;
  readonly version: number;
  readonly createdAt: string;
  readonly controlCodes: readonly number[];
  /** Gafflad bana: alla varianter med kontrollföljd (banans egen följd är då tom). */
  readonly variants?: readonly { readonly code: string; readonly controlCodes: readonly number[] }[];
}

/**
 * Ger en ögonblicksbild där banan har en ny version med föreslagna kontroller
 * och där alla klasser som i dag använder `currentCourseVersionId` pekar på den.
 * Strukna kontroller gäller en viss banversion och följer därför inte med,
 * precis som när ändringen sparas.
 */
export function withProposedCourseVersion(snapshot: RaceSnapshot, courseId: string, currentCourseVersionId: string,
  proposed: ProposedCourseVersion): RaceSnapshot {
  const controlIdByCode = new Map<number, string>();
  // Rogaining: poängen hör till kontrollkoden i hela tävlingen och följer med till den nya versionen.
  const pointsByCode = new Map<number, number>();
  for (const course of snapshot.courses) for (const version of course.versions) {
    for (const control of version.controls) {
      controlIdByCode.set(control.controlCode, control.controlId);
      if (control.points !== undefined) pointsByCode.set(control.controlCode, control.points);
    }
    for (const variant of version.variants ?? []) {
      for (const control of variant.controls) controlIdByCode.set(control.controlCode, control.controlId);
    }
  }
  const controls = proposed.controlCodes.map((code, index) => ({
    id: `${proposed.id}:${index + 1}`, courseVersionId: proposed.id,
    controlId: controlIdByCode.get(code) ?? `proposed-control:${code}`, sequence: index + 1, controlCode: code,
    ...(pointsByCode.has(code) ? { points: pointsByCode.get(code)! } : {})
  }));
  const variants = proposed.variants?.map((variant, variantIndex) => {
    const variantId = `${proposed.id}:variant:${variantIndex + 1}`;
    return { id: variantId, courseVersionId: proposed.id, code: variant.code, sequence: variantIndex + 1,
      controls: variant.controlCodes.map((code, index) => ({ id: `${variantId}:${index + 1}`, courseVariantId: variantId,
        controlId: controlIdByCode.get(code) ?? `proposed-control:${code}`, sequence: index + 1, controlCode: code })) };
  });
  return {
    ...snapshot,
    courses: snapshot.courses.map(course => course.id !== courseId ? course : {
      ...course,
      versions: [...course.versions, { id: proposed.id, courseId, version: proposed.version, createdAt: proposed.createdAt, controls,
        ...(variants && variants.length > 0 ? { variants } : {}) }]
    }),
    classes: snapshot.classes.map(raceClass => raceClass.courseVersionId === currentCourseVersionId
      ? { ...raceClass, courseVersionId: proposed.id } : raceClass)
  };
}

export type CourseEditOutcome = "BECOMES_OK" | "BECOMES_MISPUNCHED" | "UNCHANGED";

/**
 * Hur löparens status ändras av ändringen. Ett manuellt resultatbeslut (disk,
 * godkännande, brutit, utom tävlan, utan tidtagning) gäller fortsatt, så då
 * ändras inte det som visas.
 */
export function courseEditOutcome(before: EvaluationStatus, after: EvaluationStatus, manualDecision: boolean): CourseEditOutcome {
  if (manualDecision || before === after) return "UNCHANGED";
  if (after === "OK") return "BECOMES_OK";
  if (after === "MP") return "BECOMES_MISPUNCHED";
  return "UNCHANGED";
}

/** Antal per utfall för beskedet före sparande. */
export function summarizeCourseEdit(outcomes: readonly CourseEditOutcome[]) {
  return {
    becomesOkCount: outcomes.filter(outcome => outcome === "BECOMES_OK").length,
    becomesMispunchedCount: outcomes.filter(outcome => outcome === "BECOMES_MISPUNCHED").length,
    unchangedCount: outcomes.filter(outcome => outcome === "UNCHANGED").length
  };
}

/** Samma kontrollföljd i samma ordning. */
export function sameControlCodes(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((code, index) => code === right[index]);
}
