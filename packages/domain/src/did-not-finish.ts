import type { DidNotFinishResult, EvaluationResult, SplitTime } from "./types";

export const DID_NOT_FINISH_POLICY_VERSION = "did-not-finish-v1";
export const DID_NOT_FINISH_WITHDRAWAL_POLICY_VERSION = "did-not-finish-withdrawal-v1";

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

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
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

/** A physical result head selected by the application under its entry lock. */
export interface ManualDidNotFinishResultHead<TValue> {
  readonly resultRevisionId: string;
  readonly revision: number;
  readonly value: TValue;
}

/**
 * Minimal immutable DNF lifecycle projection. The repeated revision identity
 * is deliberate: it lets the pure resolver verify the reciprocal
 * decision-to-result linkage before it applies the permanent overlay.
 */
export interface ManualDidNotFinishDecisionReference<TValue> {
  readonly id: string;
  readonly targetResultRevisionId: string;
  readonly targetResultRevision: number;
  readonly didNotFinishResultRevisionId: string;
  readonly didNotFinishResultRevision: number;
  readonly didNotFinishResultHead: ManualDidNotFinishResultHead<TValue> & {
    readonly didNotFinishDecisionId: string;
  };
  readonly withdrawal: ManualDidNotFinishWithdrawalReference<TValue> | null;
}

/**
 * Exact immutable closure of one DNF decision. Repeated identities let the
 * pure resolver reject a broken decision/withdrawal/restoration chain without
 * knowing anything about persistence.
 */
export interface ManualDidNotFinishWithdrawalReference<TValue> {
  readonly id: string;
  readonly didNotFinishDecisionId: string;
  readonly withdrawnResultRevisionId: string;
  readonly withdrawnResultRevision: number;
  readonly expectedLatestResultRevisionId: string;
  readonly expectedLatestResultRevision: number;
  readonly restorationSourceResultRevisionId: string;
  readonly restorationSourceResultRevision: number;
  readonly restorationResultRevisionId: string;
  readonly restorationResultRevision: number;
  readonly restorationResultHead: ManualDidNotFinishResultHead<TValue> & {
    readonly didNotFinishWithdrawalId: string;
  };
}

export type ManualDidNotFinishResultHeadResolution<TValue> =
  | { readonly state: "NO_ACTIVE_RESULT" }
  | {
      readonly state: "ACTIVE_RESULT";
      readonly source: "RESULT_HEAD";
      readonly resultHead: ManualDidNotFinishResultHead<TValue>;
    }
  | {
      readonly state: "ACTIVE_RESULT";
      readonly source: "MANUAL_DID_NOT_FINISH";
      readonly resultHead: ManualDidNotFinishResultHead<TValue>;
      readonly decisionId: string;
      readonly targetResultRevisionId: string;
      readonly underlyingResultHead: ManualDidNotFinishResultHead<TValue> | null;
    };

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateResultHead<TValue>(head: ManualDidNotFinishResultHead<TValue>): void {
  if (!nonEmpty(head.resultRevisionId) || !Number.isSafeInteger(head.revision) || head.revision <= 0) {
    throw new DidNotFinishError("INVALID_RESULT_HEAD", "Resultathuvudet saknar giltig identitet");
  }
}

/**
 * Applies one TASK 006I/006J DNF lifecycle to an already-selected physical
 * head. An active decision selects its frozen DNF. An exact withdrawal ends
 * the overlay only when the selected head is its restoration or a later head;
 * the resolver never falls back to the target or restoration source.
 */
export function resolveManualDidNotFinishResultHead<TValue>(
  selectedResultHead: ManualDidNotFinishResultHead<TValue> | null,
  decision: ManualDidNotFinishDecisionReference<TValue> | null
): ManualDidNotFinishResultHeadResolution<TValue> {
  if (selectedResultHead !== null) validateResultHead(selectedResultHead);
  if (decision === null) {
    return selectedResultHead === null
      ? { state: "NO_ACTIVE_RESULT" }
      : { state: "ACTIVE_RESULT", source: "RESULT_HEAD", resultHead: selectedResultHead };
  }

  if (!nonEmpty(decision.id) || !nonEmpty(decision.targetResultRevisionId) ||
      !Number.isSafeInteger(decision.targetResultRevision) || decision.targetResultRevision <= 0 ||
      !nonEmpty(decision.didNotFinishResultRevisionId) ||
      !Number.isSafeInteger(decision.didNotFinishResultRevision) || decision.didNotFinishResultRevision <= 0) {
    throw new DidNotFinishError(
      "INVALID_DID_NOT_FINISH_DECISION",
      "DNF-beslutet saknar giltig target- eller resultatrevisionsidentitet"
    );
  }
  validateResultHead(decision.didNotFinishResultHead);
  if (decision.targetResultRevisionId === decision.didNotFinishResultRevisionId ||
      decision.didNotFinishResultRevision !== decision.targetResultRevision + 1 ||
      decision.didNotFinishResultHead.didNotFinishDecisionId !== decision.id ||
      decision.didNotFinishResultHead.resultRevisionId !== decision.didNotFinishResultRevisionId ||
      decision.didNotFinishResultHead.revision !== decision.didNotFinishResultRevision) {
    throw new DidNotFinishError(
      "DID_NOT_FINISH_RESULT_MISMATCH",
      "DNF-beslutet och den frysta DNF-revisionen motsäger varandra"
    );
  }

  if (decision.withdrawal !== null) {
    const withdrawal = decision.withdrawal;
    if (!nonEmpty(withdrawal.id) || !nonEmpty(withdrawal.didNotFinishDecisionId) ||
        !nonEmpty(withdrawal.withdrawnResultRevisionId) ||
        !Number.isSafeInteger(withdrawal.withdrawnResultRevision) || withdrawal.withdrawnResultRevision <= 0 ||
        !nonEmpty(withdrawal.expectedLatestResultRevisionId) ||
        !Number.isSafeInteger(withdrawal.expectedLatestResultRevision) ||
        withdrawal.expectedLatestResultRevision <= 0 ||
        !nonEmpty(withdrawal.restorationSourceResultRevisionId) ||
        !Number.isSafeInteger(withdrawal.restorationSourceResultRevision) ||
        withdrawal.restorationSourceResultRevision <= 0 ||
        !nonEmpty(withdrawal.restorationResultRevisionId) ||
        !Number.isSafeInteger(withdrawal.restorationResultRevision) ||
        withdrawal.restorationResultRevision <= 0) {
      throw new DidNotFinishError(
        "INVALID_DID_NOT_FINISH_WITHDRAWAL",
        "DNF-återtagandet saknar giltig revisionsproveniens"
      );
    }
    validateResultHead(withdrawal.restorationResultHead);
    if (withdrawal.didNotFinishDecisionId !== decision.id) {
      throw new DidNotFinishError(
        "WITHDRAWAL_DECISION_MISMATCH",
        "Återtagandet tillhör inte DNF-beslutet"
      );
    }
    const noLaterTechnicalHead =
      withdrawal.expectedLatestResultRevisionId === decision.didNotFinishResultRevisionId &&
      withdrawal.expectedLatestResultRevision === decision.didNotFinishResultRevision;
    const laterTechnicalHead =
      withdrawal.expectedLatestResultRevision > decision.didNotFinishResultRevision &&
      withdrawal.expectedLatestResultRevisionId !== decision.didNotFinishResultRevisionId &&
      withdrawal.expectedLatestResultRevisionId !== decision.targetResultRevisionId;
    const sourceMatchesIntent = noLaterTechnicalHead
      ? withdrawal.restorationSourceResultRevisionId === decision.targetResultRevisionId &&
        withdrawal.restorationSourceResultRevision === decision.targetResultRevision
      : laterTechnicalHead &&
        withdrawal.restorationSourceResultRevisionId === withdrawal.expectedLatestResultRevisionId &&
        withdrawal.restorationSourceResultRevision === withdrawal.expectedLatestResultRevision;
    if (!sourceMatchesIntent ||
        withdrawal.restorationSourceResultRevisionId === decision.didNotFinishResultRevisionId ||
        withdrawal.restorationSourceResultRevisionId === withdrawal.restorationResultRevisionId) {
      throw new DidNotFinishError(
        "WITHDRAWAL_SOURCE_MISMATCH",
        "DNF-återtagandets absoluta huvud och restaureringskälla motsäger varandra"
      );
    }
    if (withdrawal.withdrawnResultRevisionId !== decision.didNotFinishResultRevisionId ||
        withdrawal.withdrawnResultRevision !== decision.didNotFinishResultRevision ||
        withdrawal.restorationResultRevision !== withdrawal.expectedLatestResultRevision + 1 ||
        withdrawal.restorationResultHead.didNotFinishWithdrawalId !== withdrawal.id ||
        withdrawal.restorationResultHead.resultRevisionId !== withdrawal.restorationResultRevisionId ||
        withdrawal.restorationResultHead.revision !== withdrawal.restorationResultRevision ||
        withdrawal.restorationResultRevisionId === decision.didNotFinishResultRevisionId ||
        withdrawal.restorationResultRevisionId === decision.targetResultRevisionId) {
      throw new DidNotFinishError(
        "WITHDRAWAL_RESULT_MISMATCH",
        "DNF-återtagandet och restaureringsrevisionen motsäger varandra"
      );
    }
    const selectedIsRestoration = selectedResultHead !== null &&
      selectedResultHead.resultRevisionId === withdrawal.restorationResultRevisionId &&
      selectedResultHead.revision === withdrawal.restorationResultRevision;
    const selectedIsLater = selectedResultHead !== null &&
      selectedResultHead.resultRevisionId !== withdrawal.restorationResultRevisionId &&
      selectedResultHead.resultRevisionId !== decision.didNotFinishResultRevisionId &&
      selectedResultHead.resultRevisionId !== decision.targetResultRevisionId &&
      selectedResultHead.revision > withdrawal.restorationResultRevision;
    if (!selectedIsRestoration && !selectedIsLater) {
      throw new DidNotFinishError(
        "WITHDRAWAL_RESULT_MISMATCH",
        "Det valda resultathuvudet är inte DNF-restaureringen eller en senare revision"
      );
    }
    return { state: "ACTIVE_RESULT", source: "RESULT_HEAD", resultHead: selectedResultHead };
  }

  return {
    state: "ACTIVE_RESULT",
    source: "MANUAL_DID_NOT_FINISH",
    resultHead: decision.didNotFinishResultHead,
    decisionId: decision.id,
    targetResultRevisionId: decision.targetResultRevisionId,
    underlyingResultHead: selectedResultHead
  };
}
