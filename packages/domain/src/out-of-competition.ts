import type { EvaluationResult, OutOfCompetitionResult, SplitTime } from "./types";

export const OUT_OF_COMPETITION_DECISION_POLICY_VERSION = "out-of-competition-v1";
export const OUT_OF_COMPETITION_WITHDRAWAL_POLICY_VERSION =
  "out-of-competition-withdrawal-v1";

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
  if (typeof source !== "object" || source === null || (source.status !== "OK" && source.status !== "MP")) {
    throw new OutOfCompetitionError(
      "UNSUPPORTED_SOURCE_STATUS",
      "Endast ett tekniskt OK- eller MP-resultat kan markeras utom tävlan"
    );
  }
  const reasonMatchesStatus = source.status === "OK"
    ? source.reason === "COMPLETE"
    : source.reason !== "COMPLETE" && source.reason !== "UNKNOWN_CARD";
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
    splits: source.splits.map((split) => ({ ...split }))
  };
}

export interface ManualOutOfCompetitionResultHead<TValue> {
  readonly resultRevisionId: string;
  readonly revision: number;
  readonly value: TValue;
}

export interface ManualOutOfCompetitionDecisionReference<TValue> {
  readonly id: string;
  readonly targetResultRevisionId: string;
  readonly targetResultRevision: number;
  readonly outOfCompetitionResultRevisionId: string;
  readonly outOfCompetitionResultRevision: number;
  readonly outOfCompetitionResultHead: ManualOutOfCompetitionResultHead<TValue> & {
    readonly notCompetingDecisionId: string;
  };
  /**
   * Exact immutable closure of this decision. `undefined` is accepted only
   * for pre-006L callers; it is treated exactly as no withdrawal.
   */
  readonly withdrawal?: ManualOutOfCompetitionWithdrawalReference<TValue> | null;
}

/**
 * Immutable OOC withdrawal provenance. Repeating all linked identities makes
 * the pure resolver reject a broken decision/OOC/withdrawal/restoration chain
 * without relying on persistence queries or historical fallback.
 */
export interface ManualOutOfCompetitionWithdrawalReference<TValue> {
  readonly id: string;
  readonly notCompetingDecisionId: string;
  readonly withdrawnResultRevisionId: string;
  readonly withdrawnResultRevision: number;
  readonly expectedLatestResultRevisionId: string;
  readonly expectedLatestResultRevision: number;
  readonly restorationSourceResultRevisionId: string;
  readonly restorationSourceResultRevision: number;
  readonly restorationResultRevisionId: string;
  readonly restorationResultRevision: number;
  readonly restorationResultHead: ManualOutOfCompetitionResultHead<TValue> & {
    readonly notCompetingWithdrawalId: string;
  };
}

export type ManualOutOfCompetitionResultHeadResolution<TValue> =
  | { readonly state: "NO_ACTIVE_RESULT" }
  | {
      readonly state: "ACTIVE_RESULT";
      readonly source: "RESULT_HEAD";
      readonly resultHead: ManualOutOfCompetitionResultHead<TValue>;
    }
  | {
      readonly state: "ACTIVE_RESULT";
      readonly source: "MANUAL_OUT_OF_COMPETITION";
      readonly resultHead: ManualOutOfCompetitionResultHead<TValue>;
      readonly decisionId: string;
      readonly targetResultRevisionId: string;
      readonly underlyingResultHead: ManualOutOfCompetitionResultHead<TValue>;
    };

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateResultHead<TValue>(head: ManualOutOfCompetitionResultHead<TValue>): void {
  if (!nonEmpty(head.resultRevisionId) || !Number.isSafeInteger(head.revision) || head.revision <= 0) {
    throw new OutOfCompetitionError("INVALID_RESULT_HEAD", "Resultathuvudet saknar giltig identitet");
  }
}

/**
 * Applies the immutable OOC lifecycle to one already-selected physical head.
 * An active decision overlays its frozen OOC revision. A withdrawn decision
 * accepts only its restoration or a later physical head, never a target or
 * restoration-source fallback.
 */
export function resolveManualOutOfCompetitionResultHead<TValue>(
  selectedResultHead: ManualOutOfCompetitionResultHead<TValue> | null,
  decision: ManualOutOfCompetitionDecisionReference<TValue> | null
): ManualOutOfCompetitionResultHeadResolution<TValue> {
  if (selectedResultHead !== null) validateResultHead(selectedResultHead);
  if (decision === null) {
    return selectedResultHead === null
      ? { state: "NO_ACTIVE_RESULT" }
      : { state: "ACTIVE_RESULT", source: "RESULT_HEAD", resultHead: selectedResultHead };
  }
  if (!nonEmpty(decision.id) || !nonEmpty(decision.targetResultRevisionId) ||
      !Number.isSafeInteger(decision.targetResultRevision) || decision.targetResultRevision <= 0 ||
      !nonEmpty(decision.outOfCompetitionResultRevisionId) ||
      !Number.isSafeInteger(decision.outOfCompetitionResultRevision) ||
      decision.outOfCompetitionResultRevision <= 0) {
    throw new OutOfCompetitionError(
      "INVALID_OUT_OF_COMPETITION_DECISION",
      "OOC-beslutet saknar giltig target- eller resultatrevisionsidentitet"
    );
  }
  validateResultHead(decision.outOfCompetitionResultHead);
  if (decision.targetResultRevisionId === decision.outOfCompetitionResultRevisionId ||
      decision.outOfCompetitionResultRevision !== decision.targetResultRevision + 1 ||
      decision.outOfCompetitionResultHead.notCompetingDecisionId !== decision.id ||
      decision.outOfCompetitionResultHead.resultRevisionId !== decision.outOfCompetitionResultRevisionId ||
      decision.outOfCompetitionResultHead.revision !== decision.outOfCompetitionResultRevision) {
    throw new OutOfCompetitionError(
      "OUT_OF_COMPETITION_RESULT_MISMATCH",
      "OOC-beslutet och den frysta OOC-revisionen motsäger varandra"
    );
  }

  const withdrawal = decision.withdrawal ?? null;
  if (withdrawal !== null) {
    if (!nonEmpty(withdrawal.id) || !nonEmpty(withdrawal.notCompetingDecisionId) ||
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
      throw new OutOfCompetitionError(
        "INVALID_OUT_OF_COMPETITION_WITHDRAWAL",
        "OOC-återtagandet saknar giltig revisionsproveniens"
      );
    }
    validateResultHead(withdrawal.restorationResultHead);
    if (withdrawal.notCompetingDecisionId !== decision.id) {
      throw new OutOfCompetitionError(
        "WITHDRAWAL_DECISION_MISMATCH",
        "OOC-återtagandet tillhör inte beslutet"
      );
    }
    const noLaterTechnicalHead =
      withdrawal.expectedLatestResultRevisionId === decision.outOfCompetitionResultRevisionId &&
      withdrawal.expectedLatestResultRevision === decision.outOfCompetitionResultRevision;
    const laterTechnicalHead =
      withdrawal.expectedLatestResultRevision > decision.outOfCompetitionResultRevision &&
      withdrawal.expectedLatestResultRevisionId !== decision.outOfCompetitionResultRevisionId &&
      withdrawal.expectedLatestResultRevisionId !== decision.targetResultRevisionId;
    const sourceMatchesIntent = noLaterTechnicalHead
      ? withdrawal.restorationSourceResultRevisionId === decision.targetResultRevisionId &&
        withdrawal.restorationSourceResultRevision === decision.targetResultRevision
      : laterTechnicalHead &&
        withdrawal.restorationSourceResultRevisionId === withdrawal.expectedLatestResultRevisionId &&
        withdrawal.restorationSourceResultRevision === withdrawal.expectedLatestResultRevision;
    if (!sourceMatchesIntent ||
        withdrawal.restorationSourceResultRevisionId === decision.outOfCompetitionResultRevisionId ||
        withdrawal.restorationSourceResultRevisionId === withdrawal.restorationResultRevisionId) {
      throw new OutOfCompetitionError(
        "WITHDRAWAL_SOURCE_MISMATCH",
        "OOC-återtagandets absoluta huvud och restaureringskälla motsäger varandra"
      );
    }
    if (withdrawal.withdrawnResultRevisionId !== decision.outOfCompetitionResultRevisionId ||
        withdrawal.withdrawnResultRevision !== decision.outOfCompetitionResultRevision ||
        withdrawal.restorationResultRevision !== withdrawal.expectedLatestResultRevision + 1 ||
        withdrawal.restorationResultHead.notCompetingWithdrawalId !== withdrawal.id ||
        withdrawal.restorationResultHead.resultRevisionId !== withdrawal.restorationResultRevisionId ||
        withdrawal.restorationResultHead.revision !== withdrawal.restorationResultRevision ||
        withdrawal.restorationResultRevisionId === decision.outOfCompetitionResultRevisionId ||
        withdrawal.restorationResultRevisionId === decision.targetResultRevisionId) {
      throw new OutOfCompetitionError(
        "WITHDRAWAL_RESULT_MISMATCH",
        "OOC-återtagandet och restaureringsrevisionen motsäger varandra"
      );
    }
    const selectedIsRestoration = selectedResultHead !== null &&
      selectedResultHead.resultRevisionId === withdrawal.restorationResultRevisionId &&
      selectedResultHead.revision === withdrawal.restorationResultRevision;
    const selectedIsLater = selectedResultHead !== null &&
      selectedResultHead.resultRevisionId !== withdrawal.restorationResultRevisionId &&
      selectedResultHead.resultRevisionId !== decision.outOfCompetitionResultRevisionId &&
      selectedResultHead.resultRevisionId !== decision.targetResultRevisionId &&
      selectedResultHead.revision > withdrawal.restorationResultRevision;
    if (!selectedIsRestoration && !selectedIsLater) {
      throw new OutOfCompetitionError(
        "WITHDRAWAL_RESULT_MISMATCH",
        "Det valda resultathuvudet är inte OOC-restaureringen eller en senare revision"
      );
    }
    return { state: "ACTIVE_RESULT", source: "RESULT_HEAD", resultHead: selectedResultHead };
  }

  const selectedIsOutOfCompetition = selectedResultHead !== null &&
    selectedResultHead.resultRevisionId === decision.outOfCompetitionResultRevisionId &&
    selectedResultHead.revision === decision.outOfCompetitionResultRevision;
  const selectedIsLater = selectedResultHead !== null &&
    selectedResultHead.resultRevisionId !== decision.targetResultRevisionId &&
    selectedResultHead.resultRevisionId !== decision.outOfCompetitionResultRevisionId &&
    selectedResultHead.revision > decision.outOfCompetitionResultRevision;
  if (!selectedIsOutOfCompetition && !selectedIsLater) {
    throw new OutOfCompetitionError(
      "OUT_OF_COMPETITION_RESULT_MISMATCH",
      "Det valda resultathuvudet är inte OOC-revisionen eller en senare revision"
    );
  }
  return {
    state: "ACTIVE_RESULT",
    source: "MANUAL_OUT_OF_COMPETITION",
    resultHead: decision.outOfCompetitionResultHead,
    decisionId: decision.id,
    targetResultRevisionId: decision.targetResultRevisionId,
    underlyingResultHead: selectedResultHead
  };
}
