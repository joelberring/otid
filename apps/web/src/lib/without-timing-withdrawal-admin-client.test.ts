import { describe, expect, it } from "vitest";
import { isDefinitiveWithoutTimingWithdrawalRejection } from "./without-timing-withdrawal-admin-client";

describe("TASK 006N NT-återtagningsklient", () => {
  it("markerar bara definitiva avslag", () => {
    expect([400, 404, 409, 413].every(isDefinitiveWithoutTimingWithdrawalRejection)).toBe(true);
    expect(isDefinitiveWithoutTimingWithdrawalRejection(500)).toBe(false);
  });
});
