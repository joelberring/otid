import type { DidNotFinishResult, EvaluationResult, SplitTime } from "./types";
import { UUID_PATTERN as CANONICAL_UUID } from "./types";

export const DID_NOT_FINISH_POLICY_VERSION = "did-not-finish-v1";

export type DidNotFinishErrorCode =
  | "UNSUPPORTED_SOURCE_STATUS"
  | "INVALID_SOURCE_REASON"
  | "INVALID_SOURCE_IDENTITY"
  | "INVALID_SOURCE_SHAPE"
  | "INVALID_RESULT_HEAD"
  | "INVALID_DID_NOT_FINISH_DECISION"
  | "DID_NOT_FINISH_RESULT_MISMATCH"
  | "INVALID_DID_NOT_FINISH_WITHDRAWAL"
  | "WITHDRAWAL_DECISION_MISMATCH"
  | "WITHDRAWAL_SOURCE_MISMATCH"
  | "WITHDRAWAL_RESULT_MISMATCH";

/** A fail-closed error for a contradictory technical DNF target. */
export class DidNotFinishError extends Error {
  readonly code: DidNotFinishErrorCode;

  constructor(code: DidNotFinishErrorCode, message: string) {
    super(message);
    this.name = "DidNotFinishError";
    this.code = code;
  }
}

const ISO_OFFSET_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/;

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
  const calendarValid = calendar.getUTCFullYear() === year &&
    calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day;
  const offsetValid = offsetHour <= 14 && offsetMinute <= 59 && (offsetHour < 14 || offsetMinute === 0);
  return calendarValid && hour <= 23 && minute <= 59 && second <= 59 && offsetValid &&
    Number.isSafeInteger(Date.parse(value));
}

function validControlCodes(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.every((code) => Number.isSafeInteger(code) && code > 0);
}

function validSplits(value: unknown, elapsedMs: number): value is readonly SplitTime[] {
  if (!Array.isArray(value)) return false;
  const seen = new Set<string>();
  let previousElapsedMs = 0;
  for (const split of value) {
    if (typeof split !== "object" || split === null || Array.isArray(split)) return false;
    const candidate = split as Partial<SplitTime>;
    if (!Number.isSafeInteger(candidate.controlCode) || (candidate.controlCode as number) <= 0 ||
        !Number.isSafeInteger(candidate.occurrence) || (candidate.occurrence as number) <= 0 ||
        !Number.isSafeInteger(candidate.elapsedMs) || (candidate.elapsedMs as number) < 0 ||
        (candidate.elapsedMs as number) > elapsedMs ||
        !Number.isSafeInteger(candidate.legMs) || (candidate.legMs as number) < 0) {
      return false;
    }
    const key = `${candidate.controlCode}:${candidate.occurrence}`;
    if (seen.has(key) || (candidate.elapsedMs as number) < previousElapsedMs ||
        candidate.legMs !== (candidate.elapsedMs as number) - previousElapsedMs) {
      return false;
    }
    seen.add(key);
    previousElapsedMs = candidate.elapsedMs as number;
  }
  return true;
}

function emptyExplanations(source: EvaluationResult): boolean {
  return Array.isArray(source.missingControls) && source.missingControls.length === 0 &&
    Array.isArray(source.extraPunches) && source.extraPunches.length === 0 &&
    Array.isArray(source.splits) && source.splits.length === 0;
}

function validateTimedSource(source: EvaluationResult): boolean {
  const elapsedMs = source.elapsedMs;
  return validDateTime(source.startTime) && validDateTime(source.finishTime) &&
    typeof elapsedMs === "number" && Number.isSafeInteger(elapsedMs) && elapsedMs >= 0 &&
    Date.parse(source.finishTime) - Date.parse(source.startTime) === elapsedMs &&
    validControlCodes(source.missingControls) && validControlCodes(source.extraPunches) &&
    validSplits(source.splits, elapsedMs);
}

function validateTechnicalShape(source: EvaluationResult): boolean {
  switch (source.reason) {
    case "COMPLETE":
      return source.status === "OK" && validateTimedSource(source) && source.missingControls.length === 0;
    case "MISSING_START":
      return source.status === "MP" && source.startTime === undefined && source.finishTime === undefined &&
        source.elapsedMs === undefined && emptyExplanations(source);
    case "MISSING_FINISH":
      return source.status === "MP" && validDateTime(source.startTime) && source.finishTime === undefined &&
        source.elapsedMs === undefined && emptyExplanations(source);
    case "INVALID_TIME_ORDER":
      return source.status === "MP" && typeof source.startTime === "string" && source.startTime.length > 0 &&
        typeof source.finishTime === "string" && source.finishTime.length > 0 && source.elapsedMs === undefined &&
        emptyExplanations(source);
    case "MISSING_CONTROL":
      return source.status === "MP" && validateTimedSource(source) && source.missingControls.length > 0;
    case "WRONG_ORDER":
      return source.status === "MP" && validateTimedSource(source);
    default:
      return false;
  }
}

/**
 * Constructs a stored-only DNF from one exact technical OK/MP target. The
 * source is validated but only its immutable result identity crosses into the
 * status-only outcome.
 */
export function createDidNotFinishResult(source: EvaluationResult): DidNotFinishResult {
  if (typeof source !== "object" || source === null || (source.status !== "OK" && source.status !== "MP")) {
    throw new DidNotFinishError(
      "UNSUPPORTED_SOURCE_STATUS",
      "Endast ett tekniskt OK- eller MP-resultat kan markeras som ej fullföljt"
    );
  }
  const reasonMatchesStatus = source.status === "OK"
    ? source.reason === "COMPLETE"
    : source.reason !== "COMPLETE" && source.reason !== "UNKNOWN_CARD";
  if (!reasonMatchesStatus) {
    throw new DidNotFinishError("INVALID_SOURCE_REASON", "Källresultatets status och orsak motsäger varandra");
  }
  if (!canonicalUuid(source.entryId) || !canonicalUuid(source.classId) || !canonicalUuid(source.courseVersionId)) {
    throw new DidNotFinishError(
      "INVALID_SOURCE_IDENTITY",
      "Källresultatet saknar kanonisk entry-, klass- eller banidentitet"
    );
  }
  if (!validateTechnicalShape(source)) {
    throw new DidNotFinishError("INVALID_SOURCE_SHAPE", "Källresultatet är inte ett strikt tekniskt OK- eller MP-utfall");
  }
  return {
    status: "DNF",
    reason: "DID_NOT_FINISH",
    entryId: source.entryId,
    classId: source.classId,
    courseVersionId: source.courseVersionId
  };
}
