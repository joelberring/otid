import type { ReadoutPackage } from "@o-tid/contracts";
import { entryCourseControls, type RaceSnapshot } from "@o-tid/domain";
import { cardTypeForNumber, simulatedRun, type SimulatedCard } from "@o-tid/sportident";

export type ExerciseVariant = "ok" | "missing-control" | "no-finish";

export interface ExerciseRunner {
  readonly entryId: string;
  readonly label: string;
  readonly cardNumber: number;
  readonly controlCodes: readonly number[];
}

/** Deltagare med aktiv bricka och bana, som övningsstationen kan skapa brickor för. */
export function exerciseRunners(pkg: ReadoutPackage): ExerciseRunner[] {
  const snapshot = pkg.raceSnapshot;
  const runners: ExerciseRunner[] = [];
  for (const assignment of snapshot.cardAssignments) {
    if (!assignment.active) continue;
    const cardNumber = Number(assignment.cardNumber);
    if (!cardTypeForNumber(cardNumber)) continue;
    const entry = snapshot.entries.find((candidate) => candidate.id === assignment.entryId);
    const raceClass = entry && snapshot.classes.find((candidate) => candidate.id === entry.classId);
    // Gafflad bana: brickan stämplas med löparens variant (ADR-0169 beslut 2).
    const course = entry && entryCourseControls(snapshot as RaceSnapshot, entry.id);
    if (!entry || !raceClass || !course) continue;
    runners.push({
      entryId: entry.id,
      label: `${entry.givenName} ${entry.familyName} · ${raceClass.name} · ${cardNumber}`,
      cardNumber,
      controlCodes: course.controlCodes
    });
  }
  return runners.sort((a, b) => a.label.localeCompare(b.label, "sv"));
}

/**
 * Skapar en bricka som om löparen just gått i mål: start för 30 minuter
 * sedan, kontrollerna jämnt fördelade, mål för fem sekunder sedan.
 */
export function exerciseCard(cardNumber: number, controlCodes: readonly number[], variant: ExerciseVariant,
  now: Date, timeZone: string): SimulatedCard {
  const finishAt = new Date(now.getTime() - 5_000);
  const startAt = new Date(finishAt.getTime() - 30 * 60_000);
  const codes = variant === "missing-control" && controlCodes.length > 0
    ? controlCodes.filter((_, index) => index !== Math.floor(controlCodes.length / 2))
    : controlCodes;
  return simulatedRun(cardNumber, { startAt, controlCodes: codes, timeZone, ...(variant === "no-finish" ? {} : { finishAt }) });
}
