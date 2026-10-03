import type { EvaluationResult, ManuallyApprovedResult, SplitTime } from "./types";

export const MANUAL_RESULT_APPROVAL_POLICY_VERSION = "manual-result-approval-v1";
export const MANUAL_RESULT_APPROVAL_WITHDRAWAL_POLICY_VERSION =
  "manual-result-approval-withdrawal-v1";

export type ManuallyApprovableResult = EvaluationResult & {
  readonly status: "MP";
  readonly reason: "MISSING_CONTROL" | "WRONG_ORDER";
  readonly entryId: string;
  readonly classId: string;
  readonly courseVersionId: string;
  readonly startTime: string;
  readonly finishTime: string;
  readonly elapsedMs: number;
};

export type ResultApprovalErrorCode =
  | "UNSUPPORTED_SOURCE_STATUS"
  | "UNSUPPORTED_SOURCE_REASON"
  | "INVALID_SOURCE_IDENTITY"
  | "INVALID_SOURCE_TIME"
  | "INVALID_SOURCE_EXPLANATION"
  | "INVALID_SOURCE_SPLITS"
  | "INVALID_RESULT_HEAD"
  | "INVALID_APPROVAL_DECISION"
  | "INVALID_APPROVAL_WITHDRAWAL"
  | "WITHDRAWAL_DECISION_MISMATCH"
  | "WITHDRAWAL_RESULT_MISMATCH";

/** A fail-closed error for contradictory manual-approval inputs or projections. */
export class ResultApprovalError extends Error {
  readonly code: ResultApprovalErrorCode;

  constructor(code: ResultApprovalErrorCode, message: string) {
    super(message);
    this.name = "ResultApprovalError";
    this.code = code;
  }
}

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_OFFSET_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/;

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

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

function validCodeList(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.every((code) => Number.isSafeInteger(code) && code > 0);
}

function copyAndValidateSplits(value: unknown, elapsedMs: number): readonly SplitTime[] {
  if (!Array.isArray(value)) {
    throw new ResultApprovalError("INVALID_SOURCE_SPLITS", "Källresultatets splittar saknas");
  }
  const seen = new Set<string>();
  let previousElapsedMs = 0;
  return value.map((split) => {
    if (typeof split !== "object" || split === null || Array.isArray(split)) {
      throw new ResultApprovalError("INVALID_SOURCE_SPLITS", "Källresultatet har en ogiltig split");
    }
    const candidate = split as Partial<SplitTime>;
    const controlCode = candidate.controlCode;
    const occurrence = candidate.occurrence;
    const splitElapsedMs = candidate.elapsedMs;
    const legMs = candidate.legMs;
    if (typeof controlCode !== "number" || !Number.isSafeInteger(controlCode) || controlCode <= 0 ||
        typeof occurrence !== "number" || !Number.isSafeInteger(occurrence) || occurrence <= 0 ||
        typeof splitElapsedMs !== "number" || !Number.isSafeInteger(splitElapsedMs) || splitElapsedMs < 0 ||
        typeof legMs !== "number" || !Number.isSafeInteger(legMs) || legMs < 0 ||
        splitElapsedMs > elapsedMs) {
      throw new ResultApprovalError("INVALID_SOURCE_SPLITS", "Källresultatet har en korrupt split");
    }
    const key = `${controlCode}:${occurrence}`;
    if (seen.has(key) || splitElapsedMs < previousElapsedMs ||
        legMs !== splitElapsedMs - previousElapsedMs) {
      throw new ResultApprovalError("INVALID_SOURCE_SPLITS", "Källresultatets splittar motsäger varandra");
    }
    seen.add(key);
    previousElapsedMs = splitElapsedMs;
    return {
      controlCode,
      occurrence,
      elapsedMs: splitElapsedMs,
      legMs
    };
  });
}

/**
 * Converts one time-complete technical MP into its stored-only manual approval
 * outcome. It deliberately preserves missing controls and absent split facts;
 * approval never invents a punch, a split, or a time.
 */
export function createManuallyApprovedResult(source: EvaluationResult): ManuallyApprovedResult {
  if (typeof source !== "object" || source === null || source.status !== "MP") {
    throw new ResultApprovalError("UNSUPPORTED_SOURCE_STATUS", "Endast ett lagrat MP-resultat kan godkännas manuellt");
  }
  if (source.reason !== "MISSING_CONTROL" && source.reason !== "WRONG_ORDER") {
    throw new ResultApprovalError(
      "UNSUPPORTED_SOURCE_REASON",
      "Endast tidskomplett MP med saknad kontroll eller fel ordning kan godkännas"
    );
  }
  if (!canonicalUuid(source.entryId) || !canonicalUuid(source.classId) || !canonicalUuid(source.courseVersionId)) {
    throw new ResultApprovalError("INVALID_SOURCE_IDENTITY", "Källresultatet saknar kanonisk entry-, klass- eller banidentitet");
  }
  const elapsedMs = source.elapsedMs;
  if (!validDateTime(source.startTime) || !validDateTime(source.finishTime) ||
      typeof elapsedMs !== "number" || !Number.isSafeInteger(elapsedMs) || elapsedMs < 0 ||
      Date.parse(source.finishTime) - Date.parse(source.startTime) !== elapsedMs) {
    throw new ResultApprovalError("INVALID_SOURCE_TIME", "Källresultatet saknar en giltig och sammanhängande totaltid");
  }
  if (!validCodeList(source.missingControls) || !validCodeList(source.extraPunches)) {
    throw new ResultApprovalError("INVALID_SOURCE_EXPLANATION", "Källresultatet har ogiltiga kontrollförklaringar");
  }
  const splits = copyAndValidateSplits(source.splits, elapsedMs);
  return {
    status: "OK",
    reason: "MANUAL_APPROVAL",
    entryId: source.entryId,
    classId: source.classId,
    courseVersionId: source.courseVersionId,
    startTime: source.startTime,
    finishTime: source.finishTime,
    elapsedMs,
    missingControls: [...source.missingControls],
    extraPunches: [...source.extraPunches],
    splits
  };
}

/** A selected normal physical head, kept opaque to make the resolver reusable. */
export interface ManualResultApprovalResultHead<TValue> {
  readonly resultRevisionId: string;
  readonly revision: number;
  readonly value: TValue;
}

export interface ManualResultApprovalWithdrawalReference {
  readonly id: string;
  readonly resultApprovalDecisionId: string;
  readonly approvedResultRevisionId: string;
  readonly restorationResultRevisionId: string;
  readonly restorationResultRevision: number;
}

export interface ManualResultApprovalDecisionReference<TValue> {
  readonly id: string;
  readonly targetResultRevisionId: string;
  readonly approvedResultHead: ManualResultApprovalResultHead<TValue>;
  readonly withdrawal: ManualResultApprovalWithdrawalReference | null;
}

export type ManualResultApprovalResultHeadResolution<TValue> =
  | { readonly state: "NO_ACTIVE_RESULT" }
  | {
      readonly state: "ACTIVE_RESULT";
      readonly source: "RESULT_HEAD";
      readonly resultHead: ManualResultApprovalResultHead<TValue>;
    }
  | {
      readonly state: "ACTIVE_RESULT";
      readonly source: "MANUAL_RESULT_APPROVAL";
      readonly resultHead: ManualResultApprovalResultHead<TValue>;
      readonly decisionId: string;
      readonly underlyingResultHead: ManualResultApprovalResultHead<TValue> | null;
    };

function validateHead<TValue>(head: ManualResultApprovalResultHead<TValue>): void {
  if (!nonEmpty(head.resultRevisionId) || !Number.isSafeInteger(head.revision) || head.revision <= 0) {
    throw new ResultApprovalError("INVALID_RESULT_HEAD", "Resultathuvudet saknar giltig identitet");
  }
}

/**
 * Resolves one normal physical head with the immutable approval lifecycle.
 * An active approval deliberately survives later technical revisions; only an
 * exact restoration revision ends the overlay without historical fallback.
 */
export function resolveManualResultApprovalResultHead<TValue>(
  selectedResultHead: ManualResultApprovalResultHead<TValue> | null,
  decision: ManualResultApprovalDecisionReference<TValue> | null
): ManualResultApprovalResultHeadResolution<TValue> {
  if (selectedResultHead !== null) validateHead(selectedResultHead);
  if (decision === null) {
    return selectedResultHead === null
      ? { state: "NO_ACTIVE_RESULT" }
      : { state: "ACTIVE_RESULT", source: "RESULT_HEAD", resultHead: selectedResultHead };
  }
  if (!nonEmpty(decision.id) || !nonEmpty(decision.targetResultRevisionId)) {
    throw new ResultApprovalError("INVALID_APPROVAL_DECISION", "Godkännandebeslutet saknar giltig targetidentitet");
  }
  validateHead(decision.approvedResultHead);

  if (decision.withdrawal === null) {
    return {
      state: "ACTIVE_RESULT",
      source: "MANUAL_RESULT_APPROVAL",
      resultHead: decision.approvedResultHead,
      decisionId: decision.id,
      underlyingResultHead: selectedResultHead
    };
  }

  const withdrawal = decision.withdrawal;
  if (!nonEmpty(withdrawal.id) || !nonEmpty(withdrawal.resultApprovalDecisionId) ||
      !nonEmpty(withdrawal.approvedResultRevisionId) ||
      !nonEmpty(withdrawal.restorationResultRevisionId) ||
      !Number.isSafeInteger(withdrawal.restorationResultRevision) ||
      withdrawal.restorationResultRevision <= 0) {
    throw new ResultApprovalError("INVALID_APPROVAL_WITHDRAWAL", "Godkännandeåtertagandet saknar giltig proveniens");
  }
  if (withdrawal.resultApprovalDecisionId !== decision.id) {
    throw new ResultApprovalError("WITHDRAWAL_DECISION_MISMATCH", "Återtagandet tillhör inte godkännandebeslutet");
  }
  const selectedIsRestoration = selectedResultHead !== null &&
    selectedResultHead.revision === withdrawal.restorationResultRevision &&
    selectedResultHead.resultRevisionId === withdrawal.restorationResultRevisionId;
  const selectedIsLater = selectedResultHead !== null &&
    selectedResultHead.revision > withdrawal.restorationResultRevision;
  if (withdrawal.approvedResultRevisionId !== decision.approvedResultHead.resultRevisionId ||
      (!selectedIsRestoration && !selectedIsLater)) {
    throw new ResultApprovalError(
      "WITHDRAWAL_RESULT_MISMATCH",
      "Återtagandet och det valda restaureringshuvudet motsäger varandra"
    );
  }
  return { state: "ACTIVE_RESULT", source: "RESULT_HEAD", resultHead: selectedResultHead };
}
