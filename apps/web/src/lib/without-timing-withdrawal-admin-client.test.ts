import { describe, expect, it } from "vitest";
import { isDefinitiveWithoutTimingWithdrawalRejection, readWithoutTimingWithdrawalAdminCsrf } from "./without-timing-withdrawal-admin-client";

describe("TASK 006N NT-återtagningsklient", () => {
  it("läser endast den egna CSRF-cookien", () => {
    const token = "c".repeat(43);
    expect(readWithoutTimingWithdrawalAdminCsrf(`otid_without_timing_withdrawal_admin_csrf=${token}; old_csrf=${token}`, new URL("http://127.0.0.1:3000/admin/race/without-timing-withdrawals"))).toBe(token);
  });
  it("markerar bara definitiva avslag", () => {
    expect([400, 404, 409, 413].every(isDefinitiveWithoutTimingWithdrawalRejection)).toBe(true);
    expect(isDefinitiveWithoutTimingWithdrawalRejection(500)).toBe(false);
  });
});
