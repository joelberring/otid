import type { ReadoutPackage } from "@o-tid/contracts";
import { cardTypeFromSi8PlusNumber, type SiCardType, type SimulatedCard, type SimulatedTime } from "@o-tid/sportident";

export type ExerciseVariant = "ok" | "missing-control" | "no-finish";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Klockslag och veckodag i tävlingens tidszon, som stationen skulle stämpla. */
export function stationClock(at: Date, timeZone: string): SimulatedTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short"
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)?.value ?? "0";
  return {
    secondsOfDay: Number(part("hour")) * 3600 + Number(part("minute")) * 60 + Number(part("second")),
    dayOfWeek: WEEKDAYS.indexOf(part("weekday"))
  };
}

/** Bricktyp för ett bricknummer, eller undefined om numret inte är en SPORTident-bricka. */
export function cardTypeForNumber(cardNumber: number): SiCardType | undefined {
  if (!Number.isInteger(cardNumber) || cardNumber <= 0) return undefined;
  if (cardNumber < 500_000) return "SI5";
  if (cardNumber < 1_000_000) return "SI6";
  return cardTypeFromSi8PlusNumber(cardNumber);
}

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
    const version = raceClass && snapshot.courses.flatMap((course) => course.versions)
      .find((candidate) => candidate.id === raceClass.courseVersionId);
    if (!entry || !raceClass || !version) continue;
    runners.push({
      entryId: entry.id,
      label: `${entry.givenName} ${entry.familyName} · ${raceClass.name} · ${cardNumber}`,
      cardNumber,
      controlCodes: [...version.controls].sort((a, b) => a.sequence - b.sequence).map((control) => control.controlCode)
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
  const cardType = cardTypeForNumber(cardNumber);
  if (!cardType) throw new Error("Bricknumret är inte en SPORTident-bricka");
  const finishAt = now.getTime() - 5_000;
  const startAt = finishAt - 30 * 60_000;
  const codes = variant === "missing-control" && controlCodes.length > 0
    ? controlCodes.filter((_, index) => index !== Math.floor(controlCodes.length / 2))
    : controlCodes;
  const step = (finishAt - startAt) / (codes.length + 1);
  const clock = (ms: number) => stationClock(new Date(Math.round(ms / 1000) * 1000), timeZone);
  return {
    cardType,
    cardNumber,
    start: clock(startAt),
    ...(variant === "no-finish" ? {} : { finish: clock(finishAt) }),
    punches: codes.map((code, index) => ({ code, time: clock(startAt + step * (index + 1)) }))
  };
}
