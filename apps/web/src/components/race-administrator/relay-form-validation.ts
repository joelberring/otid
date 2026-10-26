import { relayFormSv as text } from "../../i18n/relay-form-sv";
import { isClock, type FieldErrors } from "../../lib/form-validation";

/**
 * Steg 56: fältfel i stafettformulären (ny och ändrad stafettklass, nytt lag). Rena funktioner: formulärets värden in,
 * ett fel per fält ut. Nycklarna är fältens namn i formuläret (`course-2` = bana sträcka 2), så att felet visas vid fältet.
 */
export type RelayLegFormValues = { method: "MASS_START" | "CHANGEOVER" | "RESTART" | "FLYING_RESTART"; time: string; minutes: string;
  course: string };
export type RelayClassFormValues = { name: string; legs: readonly RelayLegFormValues[]; changeoverCode: string;
  readoutMode: "" | "EACH_LEG" | "LAST_LEG" };

/** Klockslag skrivna 18.30, 18:30 eller 1830 (och 930) som 18:30. Annat lämnas som det är. */
export function relayClock(value: string): string {
  const trimmed = value.trim();
  const digits = /^(\d{1,2})(\d{2})$/.exec(trimmed);
  return digits ? `${digits[1]!.padStart(2, "0")}:${digits[2]}` : trimmed;
}

/** Minuter för flygande omstart: heltal 1–720, annars undefined. */
export function restartMinutes(value: string): number | undefined {
  const trimmed = value.trim();
  const minutes = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 720 ? minutes : undefined;
}

/** Växlingskontrollens kod: tom = ingen (null), annars 1–999; undefined = ogiltig. */
export function changeoverCodeOf(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const code = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  return Number.isInteger(code) && code >= 1 && code <= 999 ? code : undefined;
}

export function validateRelayClass(input: RelayClassFormValues): FieldErrors<string> {
  const errors: FieldErrors<string> = {};
  if (!input.name.trim()) errors.name = text.name;
  else if (input.name.trim().length > 160) errors.name = text.tooLong(160);
  input.legs.forEach((leg, index) => {
    const number = index + 1;
    const method = index === 0 ? "MASS_START" : leg.method;
    if (!leg.course) errors[`course-${number}`] = text.course(number);
    if ((method === "MASS_START" || method === "RESTART") && !isClock(relayClock(leg.time))) errors[`time-${number}`] = text.time(number, method);
    if (method === "FLYING_RESTART" && restartMinutes(leg.minutes) === undefined) errors[`minutes-${number}`] = text.minutes(number);
  });
  const code = changeoverCodeOf(input.changeoverCode);
  if (code === undefined) errors.changeoverCode = text.changeoverCode;
  else if (code === null && input.readoutMode === "LAST_LEG") errors.changeoverCode = text.changeoverCodeRequired;
  return errors;
}

export type RelayTeamRunnerValues = { givenName: string; familyName: string; card: string };
export type RelayTeamFormValues = { classId: string; number: string; name: string; club: string; runners: readonly RelayTeamRunnerValues[] };

/** Nytt lag: klass, lagnummer (tomt = nästa lediga), lagnamn och för- och efternamn och bricka för varje plats. */
export function validateRelayTeam(input: RelayTeamFormValues): FieldErrors<string> {
  const errors: FieldErrors<string> = {};
  if (!input.classId) errors.class = text.teamClass;
  const number = input.number.trim();
  if (number !== "" && !(/^\d+$/.test(number) && Number(number) >= 1 && Number(number) <= 99_999)) errors.number = text.teamNumber;
  if (!input.name.trim()) errors.name = text.teamName;
  else if (input.name.trim().length > 160) errors.name = text.tooLong(160);
  if (input.club.trim().length > 200) errors.club = text.tooLong(200);
  const seen = new Map<string, number>();
  input.runners.forEach((runner, index) => {
    if (!runner.givenName.trim()) errors[`given-${index}`] = text.givenName;
    if (!runner.familyName.trim()) errors[`family-${index}`] = text.familyName;
    const card = runner.card.trim();
    if (card === "") return;
    if (!/^[1-9][0-9]{0,31}$/.test(card)) errors[`card-${index}`] = text.card;
    else if (seen.has(card)) errors[`card-${index}`] = text.cardRepeated;
    else seen.set(card, index);
  });
  return errors;
}
