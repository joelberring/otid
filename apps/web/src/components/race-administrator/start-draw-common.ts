import type { StartDrawMethod, StartDrawPreviewResponse } from "@o-tid/contracts";
import type { DrawAdvanced } from "./start-draw-advanced";
import type { DrawRow } from "./start-draw";

/**
 * Gemensamma inställningar i lottningen (ADR-0188 beslut 1): startsätt, intervall, första start och vakanser för alla
 * eller de ikryssade klasserna på en gång. Raderna i tabellen står kvar för klassvisa avvikelser.
 */
export type DrawCommon = {
  method: StartDrawMethod; interval: string; vacancies: string; vacancyKind: "COUNT" | "PERCENT";
  /** Klockslag för klassernas första start; tomt = behåll klassens (oftast "med de andra"). */
  laterStart: string;
};
export type DrawCommonScope = "ALL" | "SELECTED";

export const DRAW_COMMON_DEFAULT: DrawCommon = { method: "MINUTE", interval: "2", vacancies: "0", vacancyKind: "COUNT", laterStart: "" };

/**
 * De gemensamma värdena på klasserna: alla (som då också kryssas i) eller de ikryssade. Första start som klockslag blir
 * klassens senare start under Avancerat; ett tomt fält lämnar den orörd.
 */
export function applyDrawCommon(rows: Readonly<Record<string, DrawRow>>, advanced: DrawAdvanced, common: DrawCommon,
  scope: DrawCommonScope): { rows: Record<string, DrawRow>; advanced: DrawAdvanced; count: number } {
  const targets = Object.entries(rows).filter(([, row]) => scope === "ALL" || row.selected).map(([id]) => id);
  const next: Record<string, DrawRow> = { ...rows };
  for (const id of targets) {
    next[id] = { ...rows[id]!, method: common.method, interval: common.interval.trim(), vacancies: common.vacancies.trim(),
      vacancyKind: common.vacancyKind, selected: true };
  }
  const later = common.laterStart.trim();
  const laterStarts = later === "" ? advanced.laterStarts
    : { ...advanced.laterStarts, ...Object.fromEntries(targets.map(id => [id, { kind: "CLOCK" as const, value: later }])) };
  return { rows: next, advanced: later === "" ? advanced : { ...advanced, laterStarts }, count: targets.length };
}

/** Lotta-kolumnens kryssruta för alla: ikryssad, tom eller blandad. */
export function drawSelection(rows: Readonly<Record<string, DrawRow>>): "ALL" | "NONE" | "SOME" {
  const values = Object.values(rows);
  const selected = values.filter(row => row.selected).length;
  return selected === 0 ? "NONE" : selected === values.length ? "ALL" : "SOME";
}

export type DrawClassSummary = { classId: string; className: string; method: StartDrawMethod; runners: number; vacant: number;
  firstStartTime: string | null; lastStartTime: string | null };

/** Förhandsvisningens rad per klass: antal löpare och vakanser, första och sista start. */
export function drawClassSummary(raceClass: StartDrawPreviewResponse["classes"][number]): DrawClassSummary {
  const times = raceClass.slots.map(slot => slot.startTime).sort();
  return { classId: raceClass.classId, className: raceClass.className, method: raceClass.method,
    runners: raceClass.slots.filter(slot => slot.entry).length, vacant: raceClass.slots.filter(slot => !slot.entry).length,
    firstStartTime: times[0] ?? raceClass.firstStartTime, lastStartTime: times.at(-1) ?? raceClass.firstStartTime };
}
