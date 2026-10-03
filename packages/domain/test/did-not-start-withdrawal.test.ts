import { describe, expect, it } from "vitest";
import {
  DID_NOT_START_WITHDRAWAL_POLICY_VERSION,
  DidNotStartWithdrawalResolutionError,
  resolveDidNotStartWithdrawalResultHead
} from "../src";

const resultHead = {
  resultRevisionId: "10000000-0000-4000-8000-000000000001",
  didNotStartDecisionId: "20000000-0000-4000-8000-000000000002",
  value: { status: "DNS" as const, revision: 1 }
};

const withdrawal = {
  id: "30000000-0000-4000-8000-000000000003",
  didNotStartDecisionId: resultHead.didNotStartDecisionId,
  withdrawnResultRevisionId: resultHead.resultRevisionId
};

describe("resolveDidNotStartWithdrawalResultHead", () => {
  it("behåller ett redan valt resultathuvud aktivt utan withdrawal", () => {
    expect(resolveDidNotStartWithdrawalResultHead(resultHead, null)).toEqual({
      state: "ACTIVE_RESULT",
      resultHead
    });
    expect(DID_NOT_START_WITHDRAWAL_POLICY_VERSION).toBe("did-not-start-withdrawal-v1");
  });

  it("gör en exakt targetad DNS-revision inaktiv utan fallback", () => {
    expect(resolveDidNotStartWithdrawalResultHead(resultHead, withdrawal)).toEqual({
      state: "NO_ACTIVE_RESULT",
      reason: "WITHDRAWN_DID_NOT_START",
      withdrawnResultHead: resultHead,
      withdrawal
    });
  });

  it("representerar avsaknad av valt huvud utan att fabricera withdrawal", () => {
    expect(resolveDidNotStartWithdrawalResultHead(null, null)).toEqual({
      state: "NO_ACTIVE_RESULT",
      reason: "NO_RESULT",
      withdrawal: null
    });
  });

  it("avvisar withdrawal utan valt huvud fail closed", () => {
    expectResolutionError(
      () => resolveDidNotStartWithdrawalResultHead(null, withdrawal),
      "WITHDRAWAL_WITHOUT_RESULT_HEAD"
    );
  });

  it("avvisar en annan revision eller decision i stället för att ignorera motsägelsen", () => {
    expectResolutionError(
      () => resolveDidNotStartWithdrawalResultHead(resultHead, {
        ...withdrawal,
        withdrawnResultRevisionId: "40000000-0000-4000-8000-000000000004"
      }),
      "WITHDRAWAL_TARGET_MISMATCH"
    );
    expectResolutionError(
      () => resolveDidNotStartWithdrawalResultHead(resultHead, {
        ...withdrawal,
        didNotStartDecisionId: "50000000-0000-4000-8000-000000000005"
      }),
      "WITHDRAWAL_TARGET_MISMATCH"
    );
  });

  it("avvisar tomma immutable identiteter", () => {
    expectResolutionError(
      () => resolveDidNotStartWithdrawalResultHead({ ...resultHead, resultRevisionId: " " }, null),
      "INVALID_RESULT_HEAD"
    );
    expectResolutionError(
      () => resolveDidNotStartWithdrawalResultHead(resultHead, { ...withdrawal, id: "" }),
      "INVALID_WITHDRAWAL"
    );
  });
});

function expectResolutionError(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error("Den motsägande livscykelprojektionen skulle ha avvisats");
  } catch (error) {
    expect(error).toBeInstanceOf(DidNotStartWithdrawalResolutionError);
    if (error instanceof DidNotStartWithdrawalResolutionError) expect(error.code).toBe(code);
  }
}
