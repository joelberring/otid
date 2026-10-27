import type { ReadoutPackage } from "@o-tid/contracts";
import { entryCourseControls, inRaceDay, parseRaceClock, type RaceSnapshot } from "@o-tid/domain";
import { cardTypeForNumber, simulatedRun, type SimulatedCard } from "@o-tid/sportident";
import { relayExerciseWindow, relayPlace, teamSprintLegs } from "./relay";
import { readoutText as t } from "./text-sv";

/**
 * "late": rogaining, i mål 1:30 efter tidsgränsen (två påbörjade minuter). "late-start" (PLAN.md steg 25): minutstart,
 * startstämplingen 2:12 efter den lottade tiden.
 */
export type ExerciseVariant = "ok" | "missing-control" | "no-finish" | "late" | "late-start";
/** Övningens sena start vid minutstart. */
export const EXERCISE_LATE_START_MS = 132_000;

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
    // Steg 50: teamsprint med utläsning efter varje sträcka – en övningsbricka per sträcka som löparen springer.
    const sprint = entry.teamSprint;
    if (sprint?.mode === "EACH_LEG") {
      for (const legEntryId of sprint.legEntryIds.slice(1)) {
        const sibling = snapshot.entries.find((candidate) => candidate.id === legEntryId);
        const legCourse = entryCourseControls(snapshot as RaceSnapshot, legEntryId);
        const legPlace = relayPlace(pkg, legEntryId);
        if (!sibling || !legCourse) continue;
        runners.push({ entryId: sibling.id, label: [`${sibling.givenName} ${sibling.familyName}`, raceClass.name,
          ...(legPlace ? [t.relayPlace(legPlace.teamNumber, legPlace.leg)] : []), String(cardNumber)].join(" · "),
          cardNumber, controlCodes: legCourse.controlCodes });
      }
    }
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
 * "Nu" på tävlingsdagen: i tävlingsdygnet (steg 58: tävlingsdagen till kl 12 dagen efter, så en nattävling efter
 * midnatt) är det datorns klocka, annars samma klockslag på tävlingsdagen (i tävlingens tidszon). Övningen läses då som
 * om det vore tävlingsdag.
 */
export function exerciseAnchor(raceDate: string, timeZone: string, now: Date): Date {
  if (inRaceDay(now, raceDate, timeZone)) return now;
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)?.value ?? "00";
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
    const scheduled = new Date(runner.fixedStartTime);
    const raceDay = anchor === now;
    const finishAt = raceDay && runner.timeLimitMs === undefined && finishedNow.getTime() - scheduled.getTime() > duration
      ? finishedNow : new Date(scheduled.getTime() + duration);
    // Sen start: löparen stämplar start efter den lottade tiden; den lottade tiden gäller ändå.
    const startAt = variant === "late-start" ? new Date(scheduled.getTime() + EXERCISE_LATE_START_MS) : scheduled;
    return { startAt, finishAt };
  }
  return { startAt: new Date(finishedNow.getTime() - duration), finishAt: finishedNow };
}

/**
 * Teamsprint: en bricka för löparens sträckor. Varje sträcka stämplas i sitt eget fönster (som de andra sträcklöparna).
 * Steg 48, utläsning efter sista sträckan: alla löparens sträckor med växlingskontrollen sist i varje, lagets sista sträcka
 * slutar med målstämplingen; "Missad kontroll" gäller löparens första sträcka.
 * Steg 50, utläsning efter varje sträcka: brickan töms inte, så den har stämplingarna från löparens alla sträckor fram till
 * den valda och målstämplingen efter den (växlingskontrollen också när klassen har en); "Missad kontroll" gäller den valda.
 * Undefined när löparen bara springer en sträcka.
 */
export function teamSprintExerciseCard(pkg: ReadoutPackage, runner: ExerciseRunner, variant: ExerciseVariant, now: Date):
  { card: SimulatedCard; finishAt: Date } | undefined {
  const entry = pkg.raceSnapshot.entries.find((candidate) => candidate.id === runner.entryId);
  const sprint = entry?.teamSprint;
  if (!sprint) return undefined;
  const eachLeg = sprint.mode === "EACH_LEG";
  const legs = teamSprintLegs(pkg, eachLeg ? sprint.legEntryIds[0]! : runner.entryId);
  if (!legs) return undefined;
  const chosen = eachLeg ? legs.legs.findIndex((leg) => leg.entryId === runner.entryId) : legs.legs.length - 1;
  if (chosen < 0) return undefined;
  const code = sprint.changeoverCode;
  const parts = legs.legs.slice(0, chosen + 1).map((leg, index) => {
    const window = relayExerciseWindow(pkg, leg.entryId, now);
    const codes = entryCourseControls(pkg.raceSnapshot as RaceSnapshot, leg.entryId)?.controlCodes ?? [];
    const final = leg.leg === legs.legCount;
    const missed = variant === "missing-control" && index === (eachLeg ? chosen : 0) && codes.length > 0;
    const own = missed ? codes.filter((_, position) => position !== Math.floor(codes.length / 2)) : codes;
    return { window, final, run: window && simulatedRun(runner.cardNumber, { startAt: window.startAt, finishAt: window.finishAt,
      controlCodes: final || code === undefined ? own : [...own, code], timeZone: pkg.event.timeZone }) };
  });
  if (parts.some((part) => !part.run || !part.window)) return undefined;
  const last = parts.at(-1)!;
  const finish = eachLeg || last.final ? last.run!.finish : undefined;
  const card: SimulatedCard = { cardType: parts[0]!.run!.cardType, cardNumber: runner.cardNumber, ...(parts[0]!.run!.start ? { start: parts[0]!.run!.start } : {}),
    ...(finish ? { finish } : {}), punches: parts.flatMap((part) => part.run!.punches) };
  return { card, finishAt: last.window!.finishAt };
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
