import { createManuallyApprovedResult } from "./result-approval";
import { withMaxTime } from "./max-time";
import type { EvaluationResult, ManuallyApprovedResult } from "./types";

/**
 * Steg 31: arrangörens manuella tid och godkännande av enskilda saknade kontroller för en löpare. Rent och utan I/O;
 * statusflödet (`applyManualDecision`) prövar när besluten får fattas.
 */
export type ManualTimeStatus = "OK" | "MP";

export interface ManualTimeInput {
  /** Starttid; saknas den används löparens kända start (lottad tid eller startstämpling). */
  readonly startTime?: string | undefined;
  readonly finishTime?: string | undefined;
  /** Löptid i stället för måltid (eller starttid när bara måltiden är känd). */
  readonly elapsedMs?: number | undefined;
  readonly status: ManualTimeStatus;
}

/** Längsta manuella löptid: ett dygn. */
const MAX_MANUAL_ELAPSED_MS = 24 * 60 * 60 * 1000;

function instant(value: string | null | undefined): number | undefined {
  if (typeof value !== "string") return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

/** Start och mål ur arrangörens uppgifter, eller undefined när tiderna saknas, motsäger varandra eller inte går ihop. */
export function resolveManualTimes(input: ManualTimeInput, knownStartTime: string | null | undefined):
  { readonly startTime: string; readonly finishTime: string; readonly elapsedMs: number } | undefined {
  let start = instant(input.startTime) ?? instant(knownStartTime);
  let finish = instant(input.finishTime);
  if (input.startTime !== undefined && instant(input.startTime) === undefined) return undefined;
  if (input.finishTime !== undefined && finish === undefined) return undefined;
  if (input.elapsedMs !== undefined) {
    if (!Number.isSafeInteger(input.elapsedMs) || input.elapsedMs <= 0) return undefined;
    if (input.startTime !== undefined && finish !== undefined) {
      if (finish - start! !== input.elapsedMs) return undefined;
    } else if (finish !== undefined) start = finish - input.elapsedMs;
    else if (start !== undefined) finish = start + input.elapsedMs;
    else return undefined;
  }
  if (start === undefined || finish === undefined) return undefined;
  const elapsedMs = finish - start;
  if (!Number.isSafeInteger(elapsedMs) || elapsedMs <= 0 || elapsedMs > MAX_MANUAL_ELAPSED_MS) return undefined;
  return { startTime: new Date(start).toISOString(), finishTime: new Date(finish).toISOString(), elapsedMs };
}

export interface ManualTimeContext {
  readonly entryId: string;
  readonly classId: string;
  readonly courseVersionId: string;
  readonly maxTimeMinutes?: number | null | undefined;
  /**
   * Avläsningen bedömd med de manuella tiderna (samma resultatmotor), eller undefined utan avläsning. Ger kontroller,
   * sträcktider och maxtid; arrangörens status gäller sedan.
   */
  readonly evaluateWithTimes?: ((startTime: string, finishTime: string) => EvaluationResult | undefined) | undefined;
}

/**
 * Resultatet för en manuell tid. Med avläsning bedöms stämplingarna med de nya tiderna; utan avläsning (borttappad
 * eller trasig bricka) finns bara tiden. "Godkänd" blir godkänt (eller maxtid överskriden), "Felstämplad" felstämplat.
 */
export function manualTimeOutcome(input: ManualTimeInput, knownStartTime: string | null | undefined,
  context: ManualTimeContext): EvaluationResult | undefined {
  const times = resolveManualTimes(input, knownStartTime);
  if (!times) return undefined;
  const identity = { entryId: context.entryId, classId: context.classId, courseVersionId: context.courseVersionId };
  const evaluated = context.evaluateWithTimes?.(times.startTime, times.finishTime);
  const usable = evaluated && evaluated.entryId === context.entryId && evaluated.startTime !== undefined &&
    evaluated.finishTime !== undefined && evaluated.elapsedMs !== undefined &&
    Date.parse(evaluated.startTime) === Date.parse(times.startTime) && Date.parse(evaluated.finishTime) === Date.parse(times.finishTime)
    ? evaluated : undefined;
  const base: EvaluationResult = usable
    ? { ...usable, ...identity, startTime: times.startTime, finishTime: times.finishTime, elapsedMs: times.elapsedMs }
    : withMaxTime<EvaluationResult>({ status: "OK", reason: "COMPLETE", ...identity, ...times, missingControls: [], extraPunches: [],
      splits: [] }, context.maxTimeMinutes);
  if (input.status === "OK") {
    if (base.status === "OK" || base.status === "OVERTIME") return base;
    // Godkänd trots saknade kontroller: arrangörens beslut. Extra stämplingar och sträcktider står kvar.
    const approved: EvaluationResult = { ...base, status: "OK", reason: "COMPLETE", missingControls: [] };
    return withMaxTime(approved, context.maxTimeMinutes);
  }
  return base.status === "MP" ? base : { ...base, status: "MP", reason: "MISSING_CONTROL" };
}

/**
 * Godkänner valda saknade kontroller (en förekomst per vald kod). Saknas inget efteråt blir resultatet godkänt med
 * löparens tid; annars är det felstämplat med färre saknade kontroller. Undefined när en vald kod inte saknas.
 */
export function approveMissingControls(source: EvaluationResult, controls: readonly number[]):
  EvaluationResult | ManuallyApprovedResult | undefined {
  if (source.status !== "MP" || (source.reason !== "MISSING_CONTROL" && source.reason !== "WRONG_ORDER") || controls.length === 0) {
    return undefined;
  }
  const remaining = [...source.missingControls];
  for (const code of controls) {
    const index = remaining.indexOf(code);
    if (index < 0) return undefined;
    remaining.splice(index, 1);
  }
  if (remaining.length === 0) return createManuallyApprovedResult(source);
  return { ...source, status: "MP", reason: "MISSING_CONTROL", missingControls: remaining };
}
