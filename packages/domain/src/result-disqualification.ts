import type { DisqualifiedResult, EvaluationResult } from "./types";

export const MANUAL_DISQUALIFICATION_POLICY_VERSION = "manual-disqualification-v1";

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
