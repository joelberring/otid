import { formErrorsSv as text } from "../i18n/form-errors-sv";

/**
 * Fältfel för arbetsytans formulär (PLAN.md steg 24). Rena funktioner: indata in, ett fel per fält ut (svenska, med
 * fältets namn). Formulären har `noValidate` och visar felen vid fälten med `Field error`.
 */
export type FieldErrors<K extends string> = { [Field in K]?: string | undefined };

/** Tolkar kontrollkoder skrivna med mellanslag eller komma. Ger undefined om listan är tom, för lång eller ogiltig. */
export function parseControlCodes(input: string): number[] | undefined {
  const tokens = input.trim().split(/[\s,]+/).filter(Boolean);
  const codes = tokens.map(Number);
  if (!tokens.length || tokens.length > 1000 || codes.some(code => !Number.isInteger(code) || code <= 0 || code > 2147483647)) return undefined;
  return codes;
}

export function hasErrors(errors: FieldErrors<string>): boolean {
  return Object.values(errors).some(Boolean);
}

/** Klockslag som `parseRaceClock` godtar: 18:30, 18.30 eller 18:30:15. */
export function isClock(value: string): boolean {
  const match = /^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?$/.exec(value.trim());
  return !!match && Number(match[1]) <= 23 && Number(match[2]) <= 59 && Number(match[3] ?? 0) <= 59;
}

/** Ett riktigt datum skrivet ÅÅÅÅ-MM-DD. */
export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value.trim();
}

const name = (value: string, min: number, max: number) => value.trim().length >= min && value.trim().length <= max;

export type CreateRaceInput = { eventName: string; stageName: string; raceDate: string; timeZone: string };
export function validateCreateRace(input: CreateRaceInput): FieldErrors<keyof CreateRaceInput> {
  const stage = input.stageName.trim();
  return {
    eventName: name(input.eventName, 2, 160) ? undefined : text.eventName,
    stageName: stage === "" || name(stage, 2, 160) ? undefined : text.stageName,
    raceDate: isIsoDate(input.raceDate) ? undefined : text.raceDate,
    timeZone: input.timeZone.trim() ? undefined : text.timeZone
  };
}

export type CourseClassInput = { courseName: string; className: string; controls: string;
  rogaining?: { timeLimit: string; penalty: string } | undefined };
export function validateCourseClass(input: CourseClassInput): FieldErrors<"courseName" | "className" | "controls" | "timeLimit" | "penalty"> {
  const limit = input.rogaining?.timeLimit.trim() ?? "", penalty = input.rogaining?.penalty.trim() ?? "";
  // Steg 55: klassnamnet är valfritt; tidsgräns och straff gäller klassen och prövas bara när ett klassnamn finns.
  const withClass = input.className.trim() !== "";
  return {
    courseName: name(input.courseName, 1, 160) ? undefined : text.courseName,
    className: !withClass || name(input.className, 1, 160) ? undefined : text.tooLong(160),
    controls: !input.controls.trim() ? text.controls : parseControlCodes(input.controls) ? undefined : text.controlsInvalid,
    timeLimit: !input.rogaining || !withClass || (/^\d+$/.test(limit) && Number(limit) >= 1 && Number(limit) <= 2_880) ? undefined : text.timeLimit,
    penalty: !input.rogaining || !withClass || (/^\d+$/.test(penalty) && Number(penalty) <= 1_000) ? undefined : text.penalty
  };
}

export type ManualClassInput = { className: string; courseVersionId: string };
export function validateManualClass(input: ManualClassInput): FieldErrors<keyof ManualClassInput> {
  return {
    className: name(input.className, 1, 160) ? undefined : text.className,
    courseVersionId: input.courseVersionId ? undefined : text.chooseCourse
  };
}

/** Starttiden: krävs bara för minutstart som inte kan få sin tid av lottningen (`timeOptional`). */
export type RegistrationInput = { classId: string; classFull: boolean; givenName: string; familyName: string; card: string;
  startClock: string; fixedStart: boolean; timeOptional: boolean };
export function validateRegistration(input: RegistrationInput): FieldErrors<"classId" | "givenName" | "familyName" | "card" | "startClock"> {
  const card = input.card.trim(), clock = input.startClock.trim();
  return {
    classId: !input.classId ? text.chooseClass : input.classFull ? text.classFull : undefined,
    givenName: name(input.givenName, 1, 160) ? undefined : text.givenName,
    familyName: name(input.familyName, 1, 160) ? undefined : text.familyName,
    card: card === "" || /^[1-9][0-9]{0,31}$/.test(card) ? undefined : text.card,
    startClock: !input.fixedStart ? undefined : clock === "" ? (input.timeOptional ? undefined : text.startTime)
      : isClock(clock) ? undefined : text.startTime
  };
}

export function validateFirstStart(value: string): string | undefined {
  return isClock(value) ? undefined : text.firstStart;
}

/** Direktanmälan på avläsningssidan (PLAN.md steg 25): klass, förnamn och efternamn krävs; klubben är valfri. */
export type ReadoutRegistrationInput = { classId: string; givenName: string; familyName: string; club: string };
export function validateReadoutRegistration(input: ReadoutRegistrationInput): FieldErrors<keyof ReadoutRegistrationInput> {
  return {
    classId: input.classId ? undefined : text.chooseClass,
    givenName: !input.givenName.trim() ? text.givenName : input.givenName.trim().length > 160 ? text.tooLong(160) : undefined,
    familyName: !input.familyName.trim() ? text.familyName : input.familyName.trim().length > 160 ? text.tooLong(160) : undefined,
    club: input.club.trim().length > 200 ? text.tooLong(200) : undefined
  };
}
