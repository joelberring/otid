import type { ReadoutPackage } from "@o-tid/contracts";
import { entryCourseControls, type RaceSnapshot } from "@o-tid/domain";
import { cardTypeForNumber, simulatedRun, type SimulatedCard } from "@o-tid/sportident";
import { relayPlace } from "./relay";
import { readoutText as t } from "./text-sv";

/** "late": rogaining, i mål 1:30 efter tidsgränsen (två påbörjade minuter). */
export type ExerciseVariant = "ok" | "missing-control" | "no-finish" | "late";

export interface ExerciseRunner {
  readonly entryId: string;
  readonly label: string;
  readonly cardNumber: number;
  readonly controlCodes: readonly number[];
  /** Rogainingklass: tidsgränsen. */
  readonly timeLimitMs?: number;
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
    // Stafett: lag och sträcka i etiketten.
    const place = relayPlace(pkg, entry.id);
    runners.push({
      entryId: entry.id,
      label: [`${entry.givenName} ${entry.familyName}`, raceClass.name, ...(place ? [t.relayPlace(place.teamNumber, place.leg)] : []),
        String(cardNumber)].join(" · "),
      cardNumber,
      controlCodes: course.controlCodes,
      ...(raceClass.rogaining ? { timeLimitMs: raceClass.rogaining.timeLimitSeconds * 1_000 } : {})
    });
  }
  return runners.sort((a, b) => a.label.localeCompare(b.label, "sv"));
}

/**
 * Rogaining: rätt stämplat går i mål inom tidsgränsen (30 minuter eller fyra femtedelar av en kortare gräns);
 * för sen går i mål 1:30 efter gränsen.
 */
export function rogainingExerciseWindow(timeLimitMs: number, variant: ExerciseVariant, now: Date): { startAt: Date; finishAt: Date } {
  const finishAt = new Date(now.getTime() - 5_000);
  const duration = variant === "late" ? timeLimitMs + 90_000 : Math.min(30 * 60_000, Math.floor(timeLimitMs * 0.8));
  return { startAt: new Date(finishAt.getTime() - duration), finishAt };
}

/**
 * Skapar en bricka som om löparen just gått i mål: start för 30 minuter
 * sedan, kontrollerna jämnt fördelade, mål för fem sekunder sedan. En stafettsträcka
 * får sitt eget fönster (`relayExerciseWindow`) så att lagets sträckor följer på varandra.
 */
export function exerciseCard(cardNumber: number, controlCodes: readonly number[], variant: ExerciseVariant,
  now: Date, timeZone: string, window?: { readonly startAt: Date; readonly finishAt: Date }): SimulatedCard {
  const finishAt = window?.finishAt ?? new Date(now.getTime() - 5_000);
  const startAt = window?.startAt ?? new Date(finishAt.getTime() - 30 * 60_000);
  const codes = variant === "missing-control" && controlCodes.length > 0
    ? controlCodes.filter((_, index) => index !== Math.floor(controlCodes.length / 2))
    : controlCodes;
  return simulatedRun(cardNumber, { startAt, controlCodes: codes, timeZone, ...(variant === "no-finish" ? {} : { finishAt }) });
}
