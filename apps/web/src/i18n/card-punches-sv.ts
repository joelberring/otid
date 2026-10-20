import type { CardPunchList, CardPunchPlacement as Placement } from "@o-tid/domain";
import { formatClockTime } from "../lib/clock-time";
import { raceCorrectionsSv } from "./race-corrections-sv";

/** "ons 14 okt" för ett datum (ÅÅÅÅ-MM-DD), utan tidszon eftersom datumet redan är tävlingens. */
export function formatPunchDate(date: string): string {
  const instant = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(instant.getTime())) return date;
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })
    .format(instant).replaceAll(".", "");
}

const list = (values: readonly string[]) => values.length <= 1 ? values.join("")
  : `${values.slice(0, -1).join(", ")} och ${values[values.length - 1]}`;

/**
 * Brickans stämplingar (PLAN.md steg 27) i deltagarkortet och i avläsningens besked: alla stämplingar på brickan med
 * ordning, kod, klockslag och om de hör till banan. Bara i arbetsytan och avläsningen, aldrig publikt.
 */
export const cardPunchesSv = {
  title: "Brickans stämplingar",
  readAt: (time: string) => `Senast avläst ${time}`,
  order: "Nr", code: "Kod", time: "Tid", status: "Hör till",
  placement: { ON_COURSE: "på banan", EXTRA: "extra", OTHER_DAY: "utanför tävlingsdagen", NO_COURSE: "–" } satisfies Record<Placement, string>,
  /** Symbol före stämplingen i den kompakta listan; orden står i förklaringen, inte bara färgen. */
  mark: { ON_COURSE: "", EXTRA: "+", OTHER_DAY: "!", NO_COURSE: "" } satisfies Record<Placement, string>,
  legend: "+ extra · ! utanför tävlingsdagen",
  check: "Check", start: "Start", finish: "Mål", missing: "saknas",
  noPunches: "Brickan har inga kontrollstämplingar.",
  otherDay: (dates: readonly string[], raceDate: string, all: boolean) =>
    `${all ? "Stämplingarna" : "Några stämplingar"} är från ${list(dates.map(formatPunchDate))}, inte från tävlingsdagen (${formatPunchDate(raceDate)}).`,
  noStart: "Brickan har ingen startstämpling.",
  noFinish: "Brickan har ingen målstämpling.",
  missingControls: (codes: readonly number[]) => `Saknade kontroller: ${codes.join(", ")}.`,
  oldCardHint: "Brickan har troligen inte tömts före loppet.",
  table: "Brickans stämplingar i ordning",
  adjusted: (labels: readonly string[]) => `Tiden är justerad för hela tävlingen: ${labels.join(", ")}.`
} as const;

/**
 * Sammanfattningens rader i ordning: annan dag, start, mål och saknade kontroller. Avläsningens besked har redan en rad
 * om saknade kontroller (`missing: false`).
 */
export function cardPunchSummary(punches: CardPunchList, options: { missing?: boolean } = {}): string[] {
  const adjusted = (punches.adjustments ?? []).map((row) => raceCorrectionsSv.adjustmentLabel(row.station, row.controlCode ?? null, row.offsetMs));
  return [
    adjusted.length > 0 ? cardPunchesSv.adjusted(adjusted) : "",
    punches.otherDates.length > 0 ? cardPunchesSv.otherDay(punches.otherDates, punches.raceDate, punches.allOtherDay) : "",
    punches.allOtherDay ? cardPunchesSv.oldCardHint : "",
    punches.noStartPunch ? cardPunchesSv.noStart : "",
    punches.noFinishPunch ? cardPunchesSv.noFinish : "",
    options.missing !== false && punches.missingControls.length > 0 && !punches.allOtherDay ? cardPunchesSv.missingControls(punches.missingControls) : ""
  ].filter(Boolean);
}

/** Klockslaget i tävlingens tidszon, med veckodag och datum när stämplingen inte är från tävlingsdagen. */
export function punchTimeText(stamp: { punchedAt: string; localDate: string }, raceDate: string, timeZone: string): string {
  const time = formatClockTime(stamp.punchedAt, timeZone);
  return stamp.localDate === raceDate ? time : `${formatPunchDate(stamp.localDate)} ${time}`;
}
