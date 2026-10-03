import type { EvaluationResult, WithoutTimingResult } from "./types";

export const WITHOUT_TIMING_DECISION_POLICY_VERSION = "without-timing-v1";
export const WITHOUT_TIMING_WITHDRAWAL_POLICY_VERSION = "without-timing-withdrawal-v1";

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

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
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

/** A physical result head selected by the application under its entry lock. */
export interface ManualWithoutTimingResultHead<TValue> {
  readonly resultRevisionId: string;
  readonly revision: number;
  readonly value: TValue;
}

/** Immutable NT decision/revision linkage, sufficient for pure lifecycle validation. */
export interface ManualWithoutTimingDecisionReference<TValue> {
  readonly id: string;
  readonly targetResultRevisionId: string;
  readonly targetResultRevision: number;
  readonly withoutTimingResultRevisionId: string;
  readonly withoutTimingResultRevision: number;
  readonly withoutTimingResultHead: ManualWithoutTimingResultHead<TValue> & {
    readonly withoutTimingDecisionId: string;
  };
  readonly withdrawal: ManualWithoutTimingWithdrawalReference<TValue> | null;
}

/**
 * Exact immutable closure of one NT decision. The domain resolver deliberately
 * repeats every revision identity so it can reject a malformed lifecycle
 * without depending on persistence details.
 */
export interface ManualWithoutTimingWithdrawalReference<TValue> {
  readonly id: string;
  readonly withoutTimingDecisionId: string;
  readonly withdrawnResultRevisionId: string;
  readonly withdrawnResultRevision: number;
  readonly expectedLatestResultRevisionId: string;
  readonly expectedLatestResultRevision: number;
  readonly restorationSourceResultRevisionId: string;
  readonly restorationSourceResultRevision: number;
  readonly restorationResultRevisionId: string;
  readonly restorationResultRevision: number;
  readonly restorationResultHead: ManualWithoutTimingResultHead<TValue> & {
    readonly withoutTimingWithdrawalId: string;
  };
}

export type ManualWithoutTimingResultHeadResolution<TValue> =
  | { readonly state: "NO_ACTIVE_RESULT" }
  | {
      readonly state: "ACTIVE_RESULT";
      readonly source: "RESULT_HEAD";
      readonly resultHead: ManualWithoutTimingResultHead<TValue>;
    }
  | {
      readonly state: "ACTIVE_RESULT";
      readonly source: "MANUAL_WITHOUT_TIMING";
      readonly resultHead: ManualWithoutTimingResultHead<TValue>;
      readonly decisionId: string;
      readonly targetResultRevisionId: string;
      readonly underlyingResultHead: ManualWithoutTimingResultHead<TValue>;
    };

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateResultHead<TValue>(head: ManualWithoutTimingResultHead<TValue>): void {
  if (!nonEmpty(head.resultRevisionId) || !Number.isSafeInteger(head.revision) || head.revision <= 0) {
    throw new WithoutTimingError("INVALID_RESULT_HEAD", "Resultathuvudet saknar giltig identitet");
  }
}

/**
 * Applies one TASK 006M/006N NT lifecycle to an already-selected physical
 * head. An active decision selects its frozen NT. A valid withdrawal ends the
 * overlay only when the selected head is its restoration or a later head; the
 * resolver never falls back to a technical target or restoration source.
 */
export function resolveManualWithoutTimingResultHead<TValue>(
  selectedResultHead: ManualWithoutTimingResultHead<TValue> | null,
  decision: ManualWithoutTimingDecisionReference<TValue> | null
): ManualWithoutTimingResultHeadResolution<TValue> {
  if (selectedResultHead !== null) validateResultHead(selectedResultHead);
  if (decision === null) {
    return selectedResultHead === null
      ? { state: "NO_ACTIVE_RESULT" }
      : { state: "ACTIVE_RESULT", source: "RESULT_HEAD", resultHead: selectedResultHead };
  }
  if (!nonEmpty(decision.id) || !nonEmpty(decision.targetResultRevisionId) ||
      !Number.isSafeInteger(decision.targetResultRevision) || decision.targetResultRevision <= 0 ||
      !nonEmpty(decision.withoutTimingResultRevisionId) ||
      !Number.isSafeInteger(decision.withoutTimingResultRevision) || decision.withoutTimingResultRevision <= 0) {
    throw new WithoutTimingError(
      "INVALID_WITHOUT_TIMING_DECISION",
      "Utan-tidtagning-beslutet saknar giltig target- eller resultatrevisionsidentitet"
    );
  }
  validateResultHead(decision.withoutTimingResultHead);
  if (decision.targetResultRevisionId === decision.withoutTimingResultRevisionId ||
      decision.withoutTimingResultRevision !== decision.targetResultRevision + 1 ||
      decision.withoutTimingResultHead.withoutTimingDecisionId !== decision.id ||
      decision.withoutTimingResultHead.resultRevisionId !== decision.withoutTimingResultRevisionId ||
      decision.withoutTimingResultHead.revision !== decision.withoutTimingResultRevision) {
    throw new WithoutTimingError(
      "WITHOUT_TIMING_RESULT_MISMATCH",
      "Utan-tidtagning-beslutet och den frysta NT-revisionen motsäger varandra"
    );
  }

  if (decision.withdrawal !== null) {
    const withdrawal = decision.withdrawal;
    if (!nonEmpty(withdrawal.id) || !nonEmpty(withdrawal.withoutTimingDecisionId) ||
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
      throw new WithoutTimingError(
        "INVALID_WITHOUT_TIMING_WITHDRAWAL",
        "Utan-tidtagning-återtagandet saknar giltig revisionsproveniens"
      );
    }
    validateResultHead(withdrawal.restorationResultHead);
    if (withdrawal.withoutTimingDecisionId !== decision.id) {
      throw new WithoutTimingError(
        "WITHDRAWAL_DECISION_MISMATCH",
        "Återtagandet tillhör inte utan-tidtagning-beslutet"
      );
    }
    const noLaterTechnicalHead =
      withdrawal.expectedLatestResultRevisionId === decision.withoutTimingResultRevisionId &&
      withdrawal.expectedLatestResultRevision === decision.withoutTimingResultRevision;
    const laterTechnicalHead =
      withdrawal.expectedLatestResultRevision > decision.withoutTimingResultRevision &&
      withdrawal.expectedLatestResultRevisionId !== decision.withoutTimingResultRevisionId &&
      withdrawal.expectedLatestResultRevisionId !== decision.targetResultRevisionId;
    const sourceMatchesIntent = noLaterTechnicalHead
      ? withdrawal.restorationSourceResultRevisionId === decision.targetResultRevisionId &&
        withdrawal.restorationSourceResultRevision === decision.targetResultRevision
      : laterTechnicalHead &&
        withdrawal.restorationSourceResultRevisionId === withdrawal.expectedLatestResultRevisionId &&
        withdrawal.restorationSourceResultRevision === withdrawal.expectedLatestResultRevision;
    if (!sourceMatchesIntent ||
        withdrawal.restorationSourceResultRevisionId === decision.withoutTimingResultRevisionId ||
        withdrawal.restorationSourceResultRevisionId === withdrawal.restorationResultRevisionId) {
      throw new WithoutTimingError(
        "WITHDRAWAL_SOURCE_MISMATCH",
        "Utan-tidtagning-återtagandets absoluta huvud och restaureringskälla motsäger varandra"
      );
    }
    if (withdrawal.withdrawnResultRevisionId !== decision.withoutTimingResultRevisionId ||
        withdrawal.withdrawnResultRevision !== decision.withoutTimingResultRevision ||
        withdrawal.restorationResultRevision !== withdrawal.expectedLatestResultRevision + 1 ||
        withdrawal.restorationResultHead.withoutTimingWithdrawalId !== withdrawal.id ||
        withdrawal.restorationResultHead.resultRevisionId !== withdrawal.restorationResultRevisionId ||
        withdrawal.restorationResultHead.revision !== withdrawal.restorationResultRevision ||
        withdrawal.restorationResultRevisionId === decision.withoutTimingResultRevisionId ||
        withdrawal.restorationResultRevisionId === decision.targetResultRevisionId) {
      throw new WithoutTimingError(
        "WITHDRAWAL_RESULT_MISMATCH",
        "Utan-tidtagning-återtagandet och restaureringsrevisionen motsäger varandra"
      );
    }
    const selectedIsRestoration = selectedResultHead !== null &&
      selectedResultHead.resultRevisionId === withdrawal.restorationResultRevisionId &&
      selectedResultHead.revision === withdrawal.restorationResultRevision;
    const selectedIsLater = selectedResultHead !== null &&
      selectedResultHead.resultRevisionId !== withdrawal.restorationResultRevisionId &&
      selectedResultHead.resultRevisionId !== decision.withoutTimingResultRevisionId &&
      selectedResultHead.resultRevisionId !== decision.targetResultRevisionId &&
      selectedResultHead.revision > withdrawal.restorationResultRevision;
    if (!selectedIsRestoration && !selectedIsLater) {
      throw new WithoutTimingError(
        "WITHDRAWAL_RESULT_MISMATCH",
        "Det valda resultathuvudet är inte NT-restaureringen eller en senare revision"
      );
    }
    return { state: "ACTIVE_RESULT", source: "RESULT_HEAD", resultHead: selectedResultHead };
  }

  const selectedIsWithoutTiming = selectedResultHead !== null &&
    selectedResultHead.resultRevisionId === decision.withoutTimingResultRevisionId &&
    selectedResultHead.revision === decision.withoutTimingResultRevision;
  const selectedIsLater = selectedResultHead !== null &&
    selectedResultHead.resultRevisionId !== decision.targetResultRevisionId &&
    selectedResultHead.resultRevisionId !== decision.withoutTimingResultRevisionId &&
    selectedResultHead.revision > decision.withoutTimingResultRevision;
  if (!selectedIsWithoutTiming && !selectedIsLater) {
    throw new WithoutTimingError(
      "WITHOUT_TIMING_RESULT_MISMATCH",
      "Det valda resultathuvudet är inte NT-revisionen eller en senare revision"
    );
  }
  return {
    state: "ACTIVE_RESULT",
    source: "MANUAL_WITHOUT_TIMING",
    resultHead: decision.withoutTimingResultHead,
    decisionId: decision.id,
    targetResultRevisionId: decision.targetResultRevisionId,
    underlyingResultHead: selectedResultHead
  };
}
