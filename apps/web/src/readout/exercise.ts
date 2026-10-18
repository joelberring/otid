import type { ReadoutPackage } from "@o-tid/contracts";
import { entryCourseControls, parseRaceClock, type RaceSnapshot } from "@o-tid/domain";
import { cardTypeForNumber, simulatedRun, type SimulatedCard } from "@o-tid/sportident";
import { relayExerciseWindow, relayPlace } from "./relay";
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
  /** Löparens fasta starttid (lottad eller satt), när klassen har fast start. */
  readonly fixedStartTime?: string;
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
      ...(raceClass.rogaining ? { timeLimitMs: raceClass.rogaining.timeLimitSeconds * 1_000 } : {}),
      ...(raceClass.startRule === "FIXED" && entry.fixedStartTime ? { fixedStartTime: entry.fixedStartTime } : {})
    });
  }
  return runners.sort((a, b) => a.label.localeCompare(b.label, "sv"));
}

export interface ExerciseWindow { readonly startAt: Date; readonly finishAt: Date }

/** Loppets längd i övningen: 30 minuter; rogaining inom tidsgränsen (fyra femtedelar av en kortare gräns) eller 1:30 över. */
function exerciseDuration(runner: Pick<ExerciseRunner, "timeLimitMs">, variant: ExerciseVariant): number {
  if (runner.timeLimitMs === undefined) return 30 * 60_000;
  return variant === "late" ? runner.timeLimitMs + 90_000 : Math.min(30 * 60_000, Math.floor(runner.timeLimitMs * 0.8));
}

/**
 * "Nu" på tävlingsdagen: är tävlingen idag är det datorns klocka, annars samma klockslag på tävlingsdagen
 * (i tävlingens tidszon). Övningen läses då som om det vore tävlingsdag.
 */
export function exerciseAnchor(raceDate: string, timeZone: string, now: Date): Date {
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)?.value ?? "00";
  if (`${part("year")}-${part("month")}-${part("day")}` === raceDate) return now;
  const shifted = parseRaceClock(raceDate, `${part("hour")}:${part("minute")}:${part("second")}`, timeZone);
  return shifted ? new Date(shifted) : now;
}

/**
 * Tiderna för en övningsbricka (PLAN.md steg 22): relativt löparens fasta starttid när den finns (start där,
 * mål efter loppets längd), annars i mål fem sekunder före "nu" på tävlingsdagen. En stafettsträcka följer
 * lagets tidigare sträckor (ADR-0169 beslut 3) när masstarten har passerats. På tävlingsdagen går en löpare
 * med fast start som startat mer än loppets längd sedan i mål nu, som en riktig löpare (inte i rogaining,
 * där tiden mot tidsgränsen är själva övningen).
 */
export function exerciseWindow(pkg: ReadoutPackage, runner: ExerciseRunner, variant: ExerciseVariant, now: Date): ExerciseWindow {
  const relay = relayExerciseWindow(pkg, runner.entryId, now);
  if (relay) return relay;
  const duration = exerciseDuration(runner, variant);
  const anchor = exerciseAnchor(pkg.raceSnapshot.race.raceDate, pkg.event.timeZone, now);
  const finishedNow = new Date(anchor.getTime() - 5_000);
  if (runner.fixedStartTime) {
    const startAt = new Date(runner.fixedStartTime);
    const raceDay = anchor === now;
    const finishAt = raceDay && runner.timeLimitMs === undefined && finishedNow.getTime() - startAt.getTime() > duration
      ? finishedNow : new Date(startAt.getTime() + duration);
    return { startAt, finishAt };
  }
  return { startAt: new Date(finishedNow.getTime() - duration), finishAt: finishedNow };
}

/**
 * Skapar en bricka som om löparen just gått i mål: start för 30 minuter
 * sedan, kontrollerna jämnt fördelade, mål för fem sekunder sedan. En stafettsträcka
 * får sitt eget fönster (`relayExerciseWindow`) så att lagets sträckor följer på varandra.
 */
export function exerciseCard(cardNumber: number, controlCodes: readonly number[], variant: ExerciseVariant,
  now: Date, timeZone: string, window?: ExerciseWindow): SimulatedCard {
  const finishAt = window?.finishAt ?? new Date(now.getTime() - 5_000);
  const startAt = window?.startAt ?? new Date(finishAt.getTime() - 30 * 60_000);
  const codes = variant === "missing-control" && controlCodes.length > 0
    ? controlCodes.filter((_, index) => index !== Math.floor(controlCodes.length / 2))
    : controlCodes;
  return simulatedRun(cardNumber, { startAt, controlCodes: codes, timeZone, ...(variant === "no-finish" ? {} : { finishAt }) });
}
