import type { StartDrawPreviewResponse, StartDrawRules, StartDrawSavedSettings } from "@o-tid/contracts";
import { startDrawSavedSettingsSchema } from "@o-tid/contracts";
import type { StartDrawClassResult, StartDrawExistingClass, StartDrawWarning } from "@o-tid/domain";

/**
 * Förhandsvisningens delar för avancerad lottning (PLAN.md steg 26): regelbrott med klassnamn och klockslag,
 * befintliga klasser som inte rörs och minut för minut var de nya tiderna hamnar bland de befintliga.
 */
const MINUTE_MS = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

export const DEFAULT_START_DRAW_RULES: StartDrawRules = {
  groupControls: 1, maxPerMinute: null, maxPerMinutePerPen: null, lastStartTime: null, seeding: "LAST", classOrder: null
};

/** De sparade inställningarna, eller null om inga sparats eller de inte går att läsa (då gäller standard). */
export function readSavedSettings(value: unknown): StartDrawSavedSettings | null {
  const parsed = startDrawSavedSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function previewWarnings(warnings: readonly StartDrawWarning[], nameOf: (classId: string) => string,
  rules: StartDrawRules): StartDrawPreviewResponse["warnings"] {
  return warnings.map(warning => {
    switch (warning.code) {
      case "AFTER_LAST_START":
        return { code: warning.code, classNames: warning.classIds.map(nameOf), lastStartTime: rules.lastStartTime!,
          firstAfterTime: iso(warning.firstAfterMs), neededLastStartTime: iso(warning.neededLastStartMs) };
      case "LATER_START_MOVED":
        return { code: warning.code, className: nameOf(warning.classId), wantedTime: iso(warning.wantedMs), actualTime: iso(warning.actualMs) };
      case "EXISTING_OVER_LIMIT":
        return { code: warning.code, scope: warning.scope, limit: warning.limit, firstTime: iso(warning.firstMs), minuteCount: warning.minuteCount };
      case "EXISTING_GROUP_CLASH":
        return { code: warning.code, classNames: warning.classIds.map(nameOf), firstTime: iso(warning.firstMs), minuteCount: warning.minuteCount };
    }
  });
}

export function existingClassSummary(existing: readonly StartDrawExistingClass[], nameOf: (classId: string) => string)
  : StartDrawPreviewResponse["existingClasses"] {
  return existing.filter(row => row.startTimesMs.length > 0).map(row => ({ className: nameOf(row.classId),
    startCount: new Set(row.startTimesMs).size, firstStartTime: iso(Math.min(...row.startTimesMs)), lastStartTime: iso(Math.max(...row.startTimesMs)) }))
    .sort((a, b) => a.firstStartTime.localeCompare(b.firstStartTime) || a.className.localeCompare(b.className, "sv-SE"));
}

/** Minut för minut: antal starter per klass, befintliga och nya. */
export function previewTimeline(drawn: readonly StartDrawClassResult[], existing: readonly StartDrawExistingClass[],
  nameOf: (classId: string) => string): StartDrawPreviewResponse["timeline"] {
  type Start = { className: string; count: number; existing: boolean };
  const minutes = new Map<number, Map<string, Start>>();
  const note = (time: number, classId: string, isExisting: boolean) => {
    const minute = Math.floor(time / MINUTE_MS) * MINUTE_MS;
    const row = minutes.get(minute) ?? new Map<string, Start>();
    minutes.set(minute, row);
    const start = row.get(classId) ?? { className: nameOf(classId), count: 0, existing: isExisting };
    start.count += 1;
    row.set(classId, start);
  };
  for (const raceClass of drawn) for (const slot of raceClass.slots) note(slot.startMs, raceClass.classId, false);
  for (const row of existing) for (const time of new Set(row.startTimesMs)) note(time, row.classId, true);
  return [...minutes].sort((a, b) => a[0] - b[0]).map(([minute, starts]) => ({ startTime: iso(minute),
    starts: [...starts.values()].sort((a, b) => Number(b.existing) - Number(a.existing) || a.className.localeCompare(b.className, "sv-SE")) }));
}
