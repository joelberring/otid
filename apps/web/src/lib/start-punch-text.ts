import type { StartPunchNote } from "@o-tid/domain";
import { startRuleSv } from "../i18n/start-rule-sv";
import type { Texts } from "./language";
import { formatClockTime, formatDuration } from "./clock-time";

/** Varningen eller notisen om startstämplingen i klartext med klockslag i tävlingens tidszon (PLAN.md steg 25). */
export function startPunchText(note: StartPunchNote, timeZone: string, rule: Texts<typeof startRuleSv> = startRuleSv): string {
  const punched = formatClockTime(note.punchedAt, timeZone);
  if (note.kind === "FROM_PUNCH") return rule.startPunch.FROM_PUNCH(punched);
  return rule.startPunch[note.kind](punched, formatClockTime(note.scheduledAt, timeZone), formatDuration(note.deviationMs));
}
