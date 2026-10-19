import type { StartPunchNote } from "@o-tid/domain";
import { startRuleSv } from "../i18n/start-rule-sv";
import { formatClockTime, formatDuration } from "./clock-time";

/** Varningen eller notisen om startstämplingen i klartext med klockslag i tävlingens tidszon (PLAN.md steg 25). */
export function startPunchText(note: StartPunchNote, timeZone: string): string {
  const punched = formatClockTime(note.punchedAt, timeZone);
  if (note.kind === "FROM_PUNCH") return startRuleSv.startPunch.FROM_PUNCH(punched);
  return startRuleSv.startPunch[note.kind](punched, formatClockTime(note.scheduledAt, timeZone), formatDuration(note.deviationMs));
}
