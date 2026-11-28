import type { StartDrawPreviewResponse, StartDrawSetupResponse } from "@o-tid/contracts";
import type { Texts } from "../../lib/language";
import type { startDrawAdvancedSv } from "../../i18n/start-draw-advanced-sv";
import { formatClockTime, normalizeClock, parseRaceClock, parseRaceClockNear } from "../../lib/clock-time";

const MINUTE_MS = 60_000;

export type MassStartWave = {
  /** ISO-ögonblick för vågens nuvarande masstart (hel minut). */
  startTime: string;
  /** Klockslag i tävlingens tidszon, t.ex. "19:10". */
  clock: string;
  /** Klasser som startar i den här masstartsvågen, i svensk bokstavsordning. */
  classes: { id: string; name: string; entryCount: number }[];
  /** Totalt antal anmälda i vågens klasser. */
  entryCount: number;
};

export type WaveShiftRequest = {
  firstStartTime: string;
  targetStartTime: string;
  targetClock: string;
  deltaMinutes: number;
  clubSeparation: false;
  classes: {
    classId: string;
    method: "MASS";
    intervalMinutes: 1;
    vacancies: { kind: "COUNT"; value: 0 };
    laterStart: { kind: "CLOCK"; startTime: string };
  }[];
};

/** Tolkar ett klockslag (t.ex. 19:10, 19.10, 1910, 19) till en hel minut i tävlingens tidszon. */
export function parseWholeMinuteClock(raceDate: string, value: string, timeZone: string,
  reference?: string | null): string | null {
  const normalized = normalizeClock(value);
  if (!normalized || normalized.length !== 5) return null;
  const instant = reference
    ? parseRaceClockNear(raceDate, normalized, timeZone, reference)
    : parseRaceClock(raceDate, normalized, timeZone);
  return instant && Date.parse(instant) % MINUTE_MS === 0 ? instant : null;
}

/** Grupperar klasser som nu har en sparad masstartstid per startvåg, tidigast först. */
export function groupMassStartWaves(setup: StartDrawSetupResponse): MassStartWave[] {
  const byStart = new Map<string, MassStartWave>();
  for (const row of setup.classes) {
    if (row.method !== "MASS" || !row.firstStartTime) continue;
    const key = new Date(Date.parse(row.firstStartTime)).toISOString();
    let wave = byStart.get(key);
    if (!wave) {
      wave = { startTime: key, clock: formatClockTime(key, setup.timeZone).slice(0, 5), classes: [], entryCount: 0 };
      byStart.set(key, wave);
    }
    wave.classes.push({ id: row.id, name: row.name, entryCount: row.entryCount });
    wave.entryCount += row.entryCount;
  }
  const waves = [...byStart.values()].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  for (const wave of waves) wave.classes.sort((a, b) => a.name.localeCompare(b.name, "sv-SE"));
  return waves;
}

/** Förskjuter ett klockslag med `deltaMinutes` minuter i tävlingens tidszon (hanterar midnatt och sommartid). */
export function shiftClockByMinutes(clock: string, deltaMinutes: number, raceDate: string, timeZone: string,
  reference?: string | null): string | null {
  const instant = parseWholeMinuteClock(raceDate, clock, timeZone, reference);
  if (!instant) return null;
  const shifted = new Date(Date.parse(instant) + deltaMinutes * MINUTE_MS).toISOString();
  return formatClockTime(shifted, timeZone).slice(0, 5);
}

/** Skillnad i hela minuter mellan två ISO-tidpunkter (positivt = senare, negativt = tidigare). */
export function waveDeltaMinutes(fromStartTime: string, toStartTime: string): number {
  return Math.round((Date.parse(toStartTime) - Date.parse(fromStartTime)) / MINUTE_MS);
}

/** Översätter en lottningsvarning till lokaliserad text på användarens språk (alla fem varningstyper). */
export function formatDrawWarning(
  warning: StartDrawPreviewResponse["warnings"][number],
  timeZone: string,
  advancedText: Pick<Texts<typeof startDrawAdvancedSv>, "afterLastStart" | "laterMoved" | "existingOverLimit" | "existingClash" | "massStartClash">
): string {
  const short = (instant: string) => formatClockTime(instant, timeZone).slice(0, 5);
  switch (warning.code) {
    case "AFTER_LAST_START":
      return advancedText.afterLastStart(warning.classNames, short(warning.lastStartTime), short(warning.firstAfterTime), short(warning.neededLastStartTime));
    case "LATER_START_MOVED":
      return advancedText.laterMoved(warning.className, short(warning.wantedTime), short(warning.actualTime));
    case "EXISTING_OVER_LIMIT":
      return advancedText.existingOverLimit(warning.scope, warning.limit, short(warning.firstTime), warning.minuteCount);
    case "EXISTING_GROUP_CLASH":
      return advancedText.existingClash(warning.classNames, short(warning.firstTime), warning.minuteCount);
    case "MASS_START_GROUP_CLASH":
      return advancedText.massStartClash(warning.className, warning.conflictClassNames, short(warning.startTime));
  }
}

/** Varningar som rör klassen som sparas i Klasser → Redigera (inte orelaterade befintliga krockar i andra klasser). */
export function isClassRelevantDrawWarning(warning: StartDrawPreviewResponse["warnings"][number]): boolean {
  return warning.code === "MASS_START_GROUP_CLASH" || warning.code === "LATER_START_MOVED" || warning.code === "AFTER_LAST_START";
}

/** Bygger lottningsbegäran för att flytta alla klasser i en masstartsvåg till ett nytt klockslag. */
export function buildWaveShiftRequest(setup: StartDrawSetupResponse, wave: MassStartWave, targetClock: string)
  : WaveShiftRequest | "invalid" | "unchanged" | "empty" {
  const targetStartTime = parseWholeMinuteClock(setup.raceDate, targetClock, setup.timeZone, wave.startTime);
  if (!targetStartTime) return "invalid";
  const deltaMinutes = waveDeltaMinutes(wave.startTime, targetStartTime);
  if (deltaMinutes === 0) return "unchanged";
  const known = new Set(setup.classes.map(row => row.id));
  const classIds = wave.classes.map(row => row.id).filter(id => known.has(id));
  if (classIds.length === 0) return "empty";
  return {
    firstStartTime: targetStartTime,
    targetStartTime,
    targetClock: formatClockTime(targetStartTime, setup.timeZone).slice(0, 5),
    deltaMinutes,
    clubSeparation: false,
    classes: classIds.map(classId => ({
      classId,
      method: "MASS" as const,
      intervalMinutes: 1 as const,
      vacancies: { kind: "COUNT" as const, value: 0 as const },
      laterStart: { kind: "CLOCK" as const, startTime: targetStartTime }
    }))
  };
}
