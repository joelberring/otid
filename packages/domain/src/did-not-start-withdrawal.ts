/**
 * Versioned policy for withdrawing one explicit TASK 006E DNS decision.
 * This is a lifecycle policy for a manual decision, not a result status.
 */
export const DID_NOT_START_WITHDRAWAL_POLICY_VERSION = "did-not-start-withdrawal-v1";

/**
 * A result head already selected by the caller's normal projection policy.
 * `value` is opaque so the same rule can guard public, export and finalization
 * projections without moving their data model into the domain package.
 */
export interface DidNotStartWithdrawalResultHead<TValue> {
  readonly resultRevisionId: string;
  readonly didNotStartDecisionId: string | null;
  readonly value: TValue;
}

/** Exact immutable link between a withdrawal and its original DNS source. */
export interface DidNotStartWithdrawalReference {
  readonly id: string;
  readonly didNotStartDecisionId: string;
  readonly withdrawnResultRevisionId: string;
}

export type DidNotStartWithdrawalResolution<TValue> =
  | {
      readonly state: "ACTIVE_RESULT";
      readonly resultHead: DidNotStartWithdrawalResultHead<TValue>;
    }
  | {
      readonly state: "NO_ACTIVE_RESULT";
      readonly reason: "NO_RESULT";
      readonly withdrawal: null;
    }
  | {
      readonly state: "NO_ACTIVE_RESULT";
      readonly reason: "WITHDRAWN_DID_NOT_START";
      readonly withdrawnResultHead: DidNotStartWithdrawalResultHead<TValue>;
      readonly withdrawal: DidNotStartWithdrawalReference;
    };

export type DidNotStartWithdrawalResolutionErrorCode =
  | "INVALID_RESULT_HEAD"
  | "INVALID_WITHDRAWAL"
  | "WITHDRAWAL_WITHOUT_RESULT_HEAD"
  | "WITHDRAWAL_TARGET_MISMATCH";

/** A fail-closed error for contradictory stored lifecycle projections. */
export class DidNotStartWithdrawalResolutionError extends Error {
  readonly code: DidNotStartWithdrawalResolutionErrorCode;

  constructor(code: DidNotStartWithdrawalResolutionErrorCode, message: string) {
    super(message);
    this.name = "DidNotStartWithdrawalResolutionError";
    this.code = code;
  }
}

function isNonEmptyIdentity(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateResultHead<TValue>(head: DidNotStartWithdrawalResultHead<TValue>): void {
  if (!isNonEmptyIdentity(head.resultRevisionId) ||
      (head.didNotStartDecisionId !== null && !isNonEmptyIdentity(head.didNotStartDecisionId))) {
    throw new DidNotStartWithdrawalResolutionError(
      "INVALID_RESULT_HEAD",
      "Det valda resultathuvudet saknar giltig immutable identitet"
    );
  }
}

function validateWithdrawal(withdrawal: DidNotStartWithdrawalReference): void {
  if (!isNonEmptyIdentity(withdrawal.id) ||
      !isNonEmptyIdentity(withdrawal.didNotStartDecisionId) ||
      !isNonEmptyIdentity(withdrawal.withdrawnResultRevisionId)) {
    throw new DidNotStartWithdrawalResolutionError(
      "INVALID_WITHDRAWAL",
      "DNS-återtagandet saknar giltig immutable targetidentitet"
    );
  }
}

/**
 * Applies an exact DNS-withdrawal overlay after a caller has selected its
 * result head. The function never searches for, or falls back to, an older
 * revision. A contradictory withdrawal is rejected rather than ignored.
 */
export function resolveDidNotStartWithdrawalResultHead<TValue>(
  selectedResultHead: DidNotStartWithdrawalResultHead<TValue> | null,
  withdrawal: DidNotStartWithdrawalReference | null
): DidNotStartWithdrawalResolution<TValue> {
  if (selectedResultHead !== null) validateResultHead(selectedResultHead);
  if (withdrawal !== null) validateWithdrawal(withdrawal);

  if (selectedResultHead === null) {
    if (withdrawal !== null) {
      throw new DidNotStartWithdrawalResolutionError(
        "WITHDRAWAL_WITHOUT_RESULT_HEAD",
        "Ett DNS-återtagande kan inte appliceras utan det targetade resultathuvudet"
      );
    }
    return { state: "NO_ACTIVE_RESULT", reason: "NO_RESULT", withdrawal: null };
  }

  if (withdrawal === null) {
    return { state: "ACTIVE_RESULT", resultHead: selectedResultHead };
  }

  if (withdrawal.withdrawnResultRevisionId !== selectedResultHead.resultRevisionId ||
      withdrawal.didNotStartDecisionId !== selectedResultHead.didNotStartDecisionId) {
    throw new DidNotStartWithdrawalResolutionError(
      "WITHDRAWAL_TARGET_MISMATCH",
      "DNS-återtagandet targetar inte det redan valda resultathuvudet exakt"
    );
  }

  return {
    state: "NO_ACTIVE_RESULT",
    reason: "WITHDRAWN_DID_NOT_START",
    withdrawnResultHead: selectedResultHead,
    withdrawal
  };
}
