import type { EvaluationResult, OutOfCompetitionResult, SplitTime } from "./types";
import { UUID_PATTERN as CANONICAL_UUID } from "./types";

export const OUT_OF_COMPETITION_DECISION_POLICY_VERSION = "out-of-competition-v1";

export type OutOfCompetitionErrorCode =
  | "UNSUPPORTED_SOURCE_STATUS"
  | "INVALID_SOURCE_REASON"
  | "INVALID_SOURCE_IDENTITY"
  | "INVALID_SOURCE_SHAPE"
  | "INVALID_RESULT_HEAD"
  | "INVALID_OUT_OF_COMPETITION_DECISION"
  | "INVALID_OUT_OF_COMPETITION_WITHDRAWAL"
  | "WITHDRAWAL_DECISION_MISMATCH"
  | "WITHDRAWAL_SOURCE_MISMATCH"
  | "WITHDRAWAL_RESULT_MISMATCH"
  | "OUT_OF_COMPETITION_RESULT_MISMATCH";

export class OutOfCompetitionError extends Error {
  readonly code: OutOfCompetitionErrorCode;

  constructor(code: OutOfCompetitionErrorCode, message: string) {
    super(message);
    this.name = "OutOfCompetitionError";
    this.code = code;
  }
}

const ISO_OFFSET_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/;
const TECHNICAL_KEYS = new Set([
  "status", "reason", "entryId", "classId", "courseVersionId", "startTime", "finishTime", "elapsedMs",
  "missingControls", "extraPunches", "splits", "rogaining"
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

function validSplits(value: unknown, elapsedMs: number): value is readonly SplitTime[] {
  if (!Array.isArray(value) || value.length > 1_000) return false;
  const seen = new Set<string>();
  let previousElapsedMs = 0;
  for (const split of value) {
    if (typeof split !== "object" || split === null || Array.isArray(split)) return false;
    const candidate = split as Partial<SplitTime>;
    if (Object.keys(candidate).some((key) =>
      key !== "controlCode" && key !== "occurrence" && key !== "elapsedMs" && key !== "legMs")) return false;
    if (!Number.isSafeInteger(candidate.controlCode) || (candidate.controlCode as number) <= 0 ||
        !Number.isSafeInteger(candidate.occurrence) || (candidate.occurrence as number) <= 0 ||
        !Number.isSafeInteger(candidate.elapsedMs) || (candidate.elapsedMs as number) < 0 ||
        (candidate.elapsedMs as number) > elapsedMs ||
        !Number.isSafeInteger(candidate.legMs) || (candidate.legMs as number) < 0) return false;
    const key = `${candidate.controlCode}:${candidate.occurrence}`;
    if (seen.has(key) || (candidate.elapsedMs as number) < previousElapsedMs ||
        candidate.legMs !== (candidate.elapsedMs as number) - previousElapsedMs) return false;
    seen.add(key);
    previousElapsedMs = candidate.elapsedMs as number;
  }
  return true;
}

function hasExactTechnicalKeys(source: EvaluationResult): boolean {
  return Object.keys(source).every((key) => TECHNICAL_KEYS.has(key));
}

function emptyExplanations(source: EvaluationResult): boolean {
  return Array.isArray(source.missingControls) && source.missingControls.length === 0 &&
    Array.isArray(source.extraPunches) && source.extraPunches.length === 0 &&
    Array.isArray(source.splits) && source.splits.length === 0;
}

function validTimedSource(source: EvaluationResult): boolean {
  return validDateTime(source.startTime) && validDateTime(source.finishTime) &&
    Number.isSafeInteger(source.elapsedMs) && (source.elapsedMs as number) >= 0 &&
    Date.parse(source.finishTime) - Date.parse(source.startTime) === source.elapsedMs &&
    validControlCodes(source.missingControls) && validControlCodes(source.extraPunches) &&
    validSplits(source.splits, source.elapsedMs);
}

function validTechnicalShape(source: EvaluationResult): boolean {
  if (!hasExactTechnicalKeys(source) || !validControlCodes(source.missingControls) ||
      !validControlCodes(source.extraPunches)) return false;
  switch (source.reason) {
    case "COMPLETE":
      return source.status === "OK" && validTimedSource(source) && source.missingControls.length === 0;
    case "MAX_TIME_EXCEEDED":
      return source.status === "OVERTIME" && validTimedSource(source) && source.missingControls.length === 0;
    case "MISSING_START":
      return source.status === "MP" && source.startTime === undefined && source.finishTime === undefined &&
        source.elapsedMs === undefined && emptyExplanations(source);
    case "MISSING_FINISH":
      return source.status === "MP" && validDateTime(source.startTime) && source.finishTime === undefined &&
        source.elapsedMs === undefined && emptyExplanations(source);
    case "INVALID_TIME_ORDER":
      return source.status === "MP" && typeof source.startTime === "string" && source.startTime.length > 0 &&
        source.startTime.length <= 64 && typeof source.finishTime === "string" && source.finishTime.length > 0 &&
        source.finishTime.length <= 64 && source.elapsedMs === undefined && emptyExplanations(source);
    case "MISSING_CONTROL":
      return source.status === "MP" && validTimedSource(source) && source.missingControls.length > 0;
    case "WRONG_ORDER":
      return source.status === "MP" && validTimedSource(source);
    default:
      return false;
  }
}

/** Creates a stored-only OOC outcome from one strict direct technical OK/MP result. */
export function createOutOfCompetitionResult(source: EvaluationResult): OutOfCompetitionResult {
  if (typeof source !== "object" || source === null || (source.status !== "OK" && source.status !== "OVERTIME" && source.status !== "MP")) {
    throw new OutOfCompetitionError(
      "UNSUPPORTED_SOURCE_STATUS",
      "Endast ett tekniskt OK- eller MP-resultat kan markeras utom tävlan"
    );
  }
  const reasonMatchesStatus = source.status === "OK" ? source.reason === "COMPLETE"
    : source.status === "OVERTIME" ? source.reason === "MAX_TIME_EXCEEDED"
      : source.reason !== "COMPLETE" && source.reason !== "MAX_TIME_EXCEEDED" && source.reason !== "UNKNOWN_CARD";
  if (!reasonMatchesStatus) {
    throw new OutOfCompetitionError("INVALID_SOURCE_REASON", "Källresultatets status och orsak motsäger varandra");
  }
  if (!canonicalUuid(source.entryId) || !canonicalUuid(source.classId) || !canonicalUuid(source.courseVersionId)) {
    throw new OutOfCompetitionError(
      "INVALID_SOURCE_IDENTITY",
      "Källresultatet saknar kanonisk entry-, klass- eller banidentitet"
    );
  }
  if (!validTechnicalShape(source)) {
    throw new OutOfCompetitionError(
      "INVALID_SOURCE_SHAPE",
      "Källresultatet är inte ett strikt direkt tekniskt OK- eller MP-utfall"
    );
  }
  return {
    status: "OOC",
    reason: "OUT_OF_COMPETITION",
    entryId: source.entryId,
    classId: source.classId,
    courseVersionId: source.courseVersionId,
    ...(source.startTime === undefined ? {} : { startTime: source.startTime }),
    ...(source.finishTime === undefined ? {} : { finishTime: source.finishTime }),
    ...(source.elapsedMs === undefined ? {} : { elapsedMs: source.elapsedMs }),
    missingControls: [...source.missingControls],
    extraPunches: [...source.extraPunches],
    splits: source.splits.map((split) => ({ ...split })),
    // Steg 45: rogaining behåller poängen (utom tävlan placeras aldrig).
    ...(source.rogaining && source.elapsedMs !== undefined ? { rogaining: source.rogaining } : {})
  };
}
