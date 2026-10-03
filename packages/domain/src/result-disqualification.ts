import type { DisqualifiedResult, EvaluationResult } from "./types";

export const MANUAL_DISQUALIFICATION_POLICY_VERSION = "manual-disqualification-v1";
export const MANUAL_DISQUALIFICATION_WITHDRAWAL_POLICY_VERSION =
  "manual-disqualification-withdrawal-v1";

export type DisqualifiableResult = EvaluationResult & {
  readonly status: "OK" | "MP";
  readonly entryId: string;
  readonly classId: string;
  readonly courseVersionId: string;
};

export type ResultDisqualificationErrorCode =
  | "UNSUPPORTED_SOURCE_STATUS"
  | "INVALID_SOURCE_REASON"
  | "INVALID_SOURCE_IDENTITY"
  | "INVALID_RESULT_HEAD"
  | "INVALID_DISQUALIFICATION_DECISION"
  | "INVALID_DISQUALIFICATION_WITHDRAWAL"
  | "WITHDRAWAL_DECISION_MISMATCH"
  | "WITHDRAWAL_RESULT_MISMATCH";

export class ResultDisqualificationError extends Error {
  readonly code: ResultDisqualificationErrorCode;

  constructor(code: ResultDisqualificationErrorCode, message: string) {
    super(message);
    this.name = "ResultDisqualificationError";
    this.code = code;
  }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Pure constructor; application validation must additionally compare it to the immutable target row. */
export function createDisqualifiedResult(source: DisqualifiableResult): DisqualifiedResult {
  if (source.status !== "OK" && source.status !== "MP") {
    throw new ResultDisqualificationError(
      "UNSUPPORTED_SOURCE_STATUS",
      "Endast ett lagrat OK- eller MP-resultat kan diskvalificeras"
    );
  }
  const validReason = source.status === "OK"
    ? source.reason === "COMPLETE"
    : source.reason !== "COMPLETE" && source.reason !== "UNKNOWN_CARD";
  if (!validReason) {
    throw new ResultDisqualificationError(
      "INVALID_SOURCE_REASON",
      "Källresultatets status och orsak motsäger varandra"
    );
  }
  if (!nonEmpty(source.entryId) || !nonEmpty(source.classId) || !nonEmpty(source.courseVersionId)) {
    throw new ResultDisqualificationError(
      "INVALID_SOURCE_IDENTITY",
      "Källresultatet saknar entry-, klass- eller banidentitet"
    );
  }
  return {
    ...source,
    status: "DSQ",
    reason: "MANUAL_DISQUALIFICATION",
    missingControls: [...source.missingControls],
    extraPunches: [...source.extraPunches],
    splits: source.splits.map((split) => ({ ...split }))
  };
}

export interface ManualDisqualificationResultHead<TValue> {
  readonly resultRevisionId: string;
  readonly revision: number;
  readonly value: TValue;
}

export interface ManualDisqualificationWithdrawalReference {
  readonly id: string;
  readonly resultDisqualificationDecisionId: string;
  readonly disqualifiedResultRevisionId: string;
  readonly restorationResultRevisionId: string;
  readonly restorationResultRevision: number;
}

export interface ManualDisqualificationDecisionReference<TValue> {
  readonly id: string;
  readonly targetResultRevisionId: string;
  readonly disqualifiedResultHead: ManualDisqualificationResultHead<TValue>;
  readonly withdrawal: ManualDisqualificationWithdrawalReference | null;
}

export type ManualDisqualificationResultHeadResolution<TValue> =
  | {
      readonly state: "NO_ACTIVE_RESULT";
    }
  | {
      readonly state: "ACTIVE_RESULT";
      readonly source: "RESULT_HEAD";
      readonly resultHead: ManualDisqualificationResultHead<TValue>;
    }
  | {
      readonly state: "ACTIVE_RESULT";
      readonly source: "MANUAL_DISQUALIFICATION";
      readonly resultHead: ManualDisqualificationResultHead<TValue>;
      readonly decisionId: string;
      readonly underlyingResultHead: ManualDisqualificationResultHead<TValue> | null;
    };

function validateHead<TValue>(head: ManualDisqualificationResultHead<TValue>): void {
  if (!nonEmpty(head.resultRevisionId) || !Number.isSafeInteger(head.revision) || head.revision <= 0) {
    throw new ResultDisqualificationError("INVALID_RESULT_HEAD", "Resultathuvudet saknar giltig identitet");
  }
}

/**
 * Resolves one already-selected normal head with one immutable manual DSQ
 * lifecycle. An active decision overrides later technical heads. A withdrawn
 * decision requires its restoration revision to be the selected normal head,
 * which prevents historical fallback after withdrawal.
 */
export function resolveManualDisqualificationResultHead<TValue>(
  selectedResultHead: ManualDisqualificationResultHead<TValue> | null,
  decision: ManualDisqualificationDecisionReference<TValue> | null
): ManualDisqualificationResultHeadResolution<TValue> {
  if (selectedResultHead !== null) validateHead(selectedResultHead);
  if (decision === null) {
    return selectedResultHead === null
      ? { state: "NO_ACTIVE_RESULT" }
      : { state: "ACTIVE_RESULT", source: "RESULT_HEAD", resultHead: selectedResultHead };
  }
  if (!nonEmpty(decision.id) || !nonEmpty(decision.targetResultRevisionId)) {
    throw new ResultDisqualificationError(
      "INVALID_DISQUALIFICATION_DECISION",
      "Diskvalifikationsbeslutet saknar giltig targetidentitet"
    );
  }
  validateHead(decision.disqualifiedResultHead);

  if (decision.withdrawal === null) {
    return {
      state: "ACTIVE_RESULT",
      source: "MANUAL_DISQUALIFICATION",
      resultHead: decision.disqualifiedResultHead,
      decisionId: decision.id,
      underlyingResultHead: selectedResultHead
    };
  }

  const withdrawal = decision.withdrawal;
  if (!nonEmpty(withdrawal.id) || !nonEmpty(withdrawal.resultDisqualificationDecisionId) ||
      !nonEmpty(withdrawal.disqualifiedResultRevisionId) ||
      !nonEmpty(withdrawal.restorationResultRevisionId) ||
      !Number.isSafeInteger(withdrawal.restorationResultRevision) ||
      withdrawal.restorationResultRevision <= 0) {
    throw new ResultDisqualificationError(
      "INVALID_DISQUALIFICATION_WITHDRAWAL",
      "Diskvalifikationsåtertagandet saknar giltig proveniens"
    );
  }
  if (withdrawal.resultDisqualificationDecisionId !== decision.id) {
    throw new ResultDisqualificationError(
      "WITHDRAWAL_DECISION_MISMATCH",
      "Återtagandet tillhör inte det manuella diskvalifikationsbeslutet"
    );
  }
  const selectedIsRestoration = selectedResultHead !== null &&
    selectedResultHead.revision === withdrawal.restorationResultRevision &&
    selectedResultHead.resultRevisionId === withdrawal.restorationResultRevisionId;
  const selectedIsLater = selectedResultHead !== null &&
    selectedResultHead.revision > withdrawal.restorationResultRevision;
  if (withdrawal.disqualifiedResultRevisionId !== decision.disqualifiedResultHead.resultRevisionId ||
      (!selectedIsRestoration && !selectedIsLater)) {
    throw new ResultDisqualificationError(
      "WITHDRAWAL_RESULT_MISMATCH",
      "Återtagandet och det valda restaureringshuvudet motsäger varandra"
    );
  }
  return { state: "ACTIVE_RESULT", source: "RESULT_HEAD", resultHead: selectedResultHead };
}
