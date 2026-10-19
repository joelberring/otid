import type { EvaluationResult, WithoutTimingResult } from "./types";
import { UUID_PATTERN as CANONICAL_UUID } from "./types";

export const WITHOUT_TIMING_DECISION_POLICY_VERSION = "without-timing-v1";

export type WithoutTimingErrorCode =
  | "UNSUPPORTED_SOURCE_STATUS"
  | "INVALID_SOURCE_REASON"
  | "INVALID_SOURCE_IDENTITY"
  | "INVALID_SOURCE_SHAPE"
  | "INVALID_RESULT_HEAD"
  | "INVALID_WITHOUT_TIMING_DECISION"
  | "WITHOUT_TIMING_RESULT_MISMATCH"
  | "INVALID_WITHOUT_TIMING_WITHDRAWAL"
  | "WITHDRAWAL_DECISION_MISMATCH"
  | "WITHDRAWAL_SOURCE_MISMATCH"
  | "WITHDRAWAL_RESULT_MISMATCH";

/** A fail-closed error for an invalid without-timing target or lifecycle. */
export class WithoutTimingError extends Error {
  readonly code: WithoutTimingErrorCode;

  constructor(code: WithoutTimingErrorCode, message: string) {
    super(message);
    this.name = "WithoutTimingError";
    this.code = code;
  }
}

const ISO_OFFSET_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/;
const TECHNICAL_KEYS = new Set([
  "status", "reason", "entryId", "classId", "courseVersionId", "startTime", "finishTime", "elapsedMs",
  "missingControls", "extraPunches", "splits"
]);

function canonicalUuid(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_UUID.test(value);
}

function validDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_OFFSET_DATE_TIME.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = zone === "Z" ? 0 : Number(offsetHourText);
  const offsetMinute = zone === "Z" ? 0 : Number(offsetMinuteText);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  return calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 &&
    calendar.getUTCDate() === day && hour <= 23 && minute <= 59 && second <= 59 &&
    offsetHour <= 14 && offsetMinute <= 59 && (offsetHour < 14 || offsetMinute === 0) &&
    Number.isSafeInteger(Date.parse(value));
}

function validControlCodes(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.length <= 1_000 &&
    value.every((code) => Number.isSafeInteger(code) && code > 0);
}

function validSplits(value: unknown, elapsedMs: number): boolean {
  if (!Array.isArray(value) || value.length > 1_000) return false;
  const seen = new Set<string>();
  let previousElapsedMs = 0;
  for (const split of value) {
    if (typeof split !== "object" || split === null || Array.isArray(split)) return false;
    const candidate = split as Record<string, unknown>;
    if (Object.keys(candidate).some((key) =>
      key !== "controlCode" && key !== "occurrence" && key !== "elapsedMs" && key !== "legMs")) return false;
    if (!Number.isSafeInteger(candidate.controlCode) || (candidate.controlCode as number) <= 0 ||
        !Number.isSafeInteger(candidate.occurrence) || (candidate.occurrence as number) <= 0 ||
        !Number.isSafeInteger(candidate.elapsedMs) || (candidate.elapsedMs as number) < 0 ||
        (candidate.elapsedMs as number) > elapsedMs ||
        !Number.isSafeInteger(candidate.legMs) || (candidate.legMs as number) < 0) return false;
    const controlCode = candidate.controlCode as number;
    const occurrence = candidate.occurrence as number;
    const splitElapsedMs = candidate.elapsedMs as number;
    const legMs = candidate.legMs as number;
    const splitKey = `${controlCode}:${occurrence}`;
    if (seen.has(splitKey) || splitElapsedMs < previousElapsedMs || legMs !== splitElapsedMs - previousElapsedMs) return false;
    seen.add(splitKey);
    previousElapsedMs = splitElapsedMs;
  }
  return true;
}

function validCompleteTechnicalSource(source: EvaluationResult): boolean {
  if (!Object.keys(source).every((key) => TECHNICAL_KEYS.has(key)) ||
      source.status !== "OK" || source.reason !== "COMPLETE" ||
      !validDateTime(source.startTime) || !validDateTime(source.finishTime) ||
      !Number.isSafeInteger(source.elapsedMs) || (source.elapsedMs as number) < 0 ||
      Date.parse(source.finishTime) - Date.parse(source.startTime) !== source.elapsedMs ||
      !validControlCodes(source.missingControls) || source.missingControls.length !== 0 ||
      !validControlCodes(source.extraPunches) || !validSplits(source.splits, source.elapsedMs)) {
    return false;
  }
  return true;
}

/**
 * Constructs a stored-only no-timing outcome from one strict direct technical
 * OK/COMPLETE target. The target's timing and control facts remain immutable
 * provenance and are deliberately not copied to the active outcome.
 */
export function createWithoutTimingResult(source: EvaluationResult): WithoutTimingResult {
  if (typeof source !== "object" || source === null || source.status !== "OK") {
    throw new WithoutTimingError(
      "UNSUPPORTED_SOURCE_STATUS",
      "Endast ett tekniskt godkänt resultat kan markeras utan tidtagning"
    );
  }
  if (source.reason !== "COMPLETE") {
    throw new WithoutTimingError("INVALID_SOURCE_REASON", "Källresultatet måste vara tekniskt OK/COMPLETE");
  }
  if (!canonicalUuid(source.entryId) || !canonicalUuid(source.classId) || !canonicalUuid(source.courseVersionId)) {
    throw new WithoutTimingError(
      "INVALID_SOURCE_IDENTITY",
      "Källresultatet saknar kanonisk entry-, klass- eller banidentitet"
    );
  }
  if (!validCompleteTechnicalSource(source)) {
    throw new WithoutTimingError("INVALID_SOURCE_SHAPE", "Källresultatet är inte ett strikt tekniskt OK/COMPLETE-utfall");
  }
  return {
    status: "NT",
    reason: "WITHOUT_TIMING",
    entryId: source.entryId,
    classId: source.classId,
    courseVersionId: source.courseVersionId
  };
}
