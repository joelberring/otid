import { alignReadoutToCourse } from "./evaluate-card-readout";
import { inRaceDay, localRaceDate } from "./race-clock";
import type { Punch, RaceSnapshot } from "./types";
import { prepareReadoutForEvaluation, type AppliedStationAdjustment } from "./station-corrections";

/**
 * Brickans stämplingar som de lästes (ägarens önskan efter första riktiga avläsningen, 2026-10-19): alla stämplingar
 * på brickan, oavsett om de hör till banan eller till tävlingsdagen, så att en bricka med stämplingar från ett annat
 * lopp syns i stället för att bara ge "Felstämplad". Ändrar aldrig avläsningen och påverkar inte resultatet.
 */
export type CardPunchPlacement =
  /** Stämplingen hör till löparens bana (samma matchning som bedömningen). */
  | "ON_COURSE"
  /** Stämplingen är från tävlingsdagen men behövs inte för banan. */
  | "EXTRA"
  /** Stämplingen är från en annan dag än tävlingsdagen (i tävlingens tidszon). */
  | "OTHER_DAY"
  /** Stämplingen är från tävlingsdagen men från ett tidigare varv på brickan (före clear/check) och räknades inte. */
  | "OLD"
  /** Ingen bana att jämföra med (okänd bricka). */
  | "NO_COURSE";

export interface CardPunchRow {
  readonly order: number;
  readonly code: number;
  readonly punchedAt: string;
  /** Datumet (ÅÅÅÅ-MM-DD) i tävlingens tidszon. */
  readonly localDate: string;
  readonly placement: CardPunchPlacement;
}

export interface CardStationPunch {
  readonly punchedAt: string;
  readonly localDate: string;
}

export interface CardPunchList {
  readonly raceDate: string;
  readonly check?: CardStationPunch | undefined;
  readonly start?: CardStationPunch | undefined;
  readonly finish?: CardStationPunch | undefined;
  readonly punches: readonly CardPunchRow[];
  /** Obligatoriska kontroller på banan som inte finns bland stämplingarna (tom utan bana). */
  readonly missingControls: readonly number[];
  /** Datum som brickans tider utanför tävlingsdygnet (steg 58: tävlingsdagen till kl 12 dagen efter) ligger på, stigande. */
  readonly otherDates: readonly string[];
  /** Sant när brickan har tider och alla ligger utanför tävlingsdygnet. */
  readonly allOtherDay: boolean;
  /**
   * Brickan saknar startstämpling och starten behövs för tiden: startsätt stämpling, fast start utan lottad tid
   * eller okänd bricka. Vid lottad start är en saknad startstämpling normal och räknas inte.
   */
  readonly noStartPunch: boolean;
  /** Brickan saknar målstämpling. */
  readonly noFinishPunch: boolean;
  /** Tävlingens tidsjusteringar som ändrade brickans tider i bedömningen (PLAN.md steg 31). Saknas = inga. */
  readonly adjustments?: readonly AppliedStationAdjustment[] | undefined;
  /** Gamla stämplingar på en oröjd bricka som inte räknades i bedömningen (PLAN.md steg 31). Saknas = inga. */
  readonly ignoredPunches?: number | undefined;
}

export interface CardPunchReadout {
  readonly readAt?: string | undefined;
  readonly clearPunchedAt?: string | undefined;
  readonly checkPunchedAt?: string | undefined;
  readonly startPunchedAt?: string | undefined;
  readonly finishPunchedAt?: string | undefined;
  readonly punches: readonly Punch[];
}

/**
 * Brickans stämplingslista mot deltagarens bana (`entryId`, eller ingen för en okänd bricka) och tävlingsdagen i
 * tävlingens tidszon. En stämpling från en annan dag märks så även om koden finns på banan.
 */
export function cardPunchList(readout: CardPunchReadout, snapshot: RaceSnapshot, entryId: string | undefined,
  timeZone: string): CardPunchList {
  const raceDate = snapshot.race.raceDate;
  const dateOf = (instant: string) => {
    const date = new Date(instant);
    return Number.isFinite(date.getTime()) ? localRaceDate(date, timeZone) : raceDate;
  };
  const outside = (instant: string) => {
    const date = new Date(instant);
    return Number.isFinite(date.getTime()) && !inRaceDay(date, raceDate, timeZone);
  };
  const station = (instant: string | undefined): CardStationPunch | undefined =>
    instant ? { punchedAt: instant, localDate: dateOf(instant) } : undefined;
  // Samma förberedelse som bedömningen: tidsjusteringar och gamla stämplingar som inte räknas (PLAN.md steg 31).
  const prepared = prepareReadoutForEvaluation({ cardNumber: "",
    ...readout.startPunchedAt ? { startPunchedAt: readout.startPunchedAt } : {},
    ...readout.finishPunchedAt ? { finishPunchedAt: readout.finishPunchedAt } : {},
    ...readout.readAt ? { readAt: readout.readAt } : {}, ...readout.checkPunchedAt ? { checkPunchedAt: readout.checkPunchedAt } : {},
    ...readout.clearPunchedAt ? { clearPunchedAt: readout.clearPunchedAt } : {}, punches: readout.punches }, snapshot);
  const kept = new Set(prepared.keptPunchIndexes);
  const aligned = entryId === undefined ? undefined : alignReadoutToCourse(prepared.readout.punches, snapshot, entryId);
  const alignment = aligned && { ...aligned, onCourse: new Set([...aligned.onCourse].map((index) => prepared.keptPunchIndexes[index]!)) };
  const punches = readout.punches.map((punch, index): CardPunchRow => {
    const localDate = dateOf(punch.punchedAt);
    const placement: CardPunchPlacement = outside(punch.punchedAt) ? "OTHER_DAY" : !kept.has(index) ? "OLD" : !alignment ? "NO_COURSE"
      : alignment.onCourse.has(index) ? "ON_COURSE" : "EXTRA";
    return { order: index + 1, code: punch.code, punchedAt: punch.punchedAt, localDate, placement };
  });
  const check = station(readout.checkPunchedAt), start = station(readout.startPunchedAt), finish = station(readout.finishPunchedAt);
  const entry = entryId === undefined ? undefined : snapshot.entries.find((candidate) => candidate.id === entryId);
  const raceClass = entry && snapshot.classes.find((candidate) => candidate.id === entry.classId);
  const startNeeded = !raceClass || raceClass.startRule === "PUNCH" || !entry?.fixedStartTime;
  // Steg 58: "annan dag" bara utanför tävlingsdygnet; en stämpling efter midnatt i en nattävling är tävlingens.
  const stamps = [check, start, finish, ...punches].flatMap((row) => row ? [row] : []);
  const otherDates = [...new Set(stamps.filter((row) => outside(row.punchedAt)).map((row) => row.localDate))].sort();
  // Listan visar brickans egna tider; justeringarna och de gamla stämplingarna som bedömningen inte räknade står som notiser.
  const { adjustments, ignoredPunches } = prepared;
  return {
    ...(adjustments.length > 0 ? { adjustments } : {}),
    ...(ignoredPunches > 0 ? { ignoredPunches } : {}),
    raceDate,
    ...(check ? { check } : {}), ...(start ? { start } : {}), ...(finish ? { finish } : {}),
    punches,
    missingControls: alignment?.missingControls ?? [],
    otherDates,
    allOtherDay: stamps.length > 0 && stamps.every((row) => outside(row.punchedAt)),
    noStartPunch: !start && startNeeded,
    noFinishPunch: !finish
  };
}
