import { describe, expect, it } from "vitest";
import {
  accountPasswordRecoveryCodeSchema,
  accountPasswordRecoveryIssueInputSchema,
  accountPasswordRecoveryIssueResponseSchema,
  accountPasswordRecoveryRevokeInputSchema,
  accountPasswordRecoveryRevokeResponseSchema,
  accountPasswordRecoveryStatusResponseSchema,
  accountPasswordRecoveryRedeemRequestSchema,
  accountPasswordRecoveryRedeemResponseSchema,
  accountPasswordRecoveryRedeemFailureSchema
} from "../src";

const requestId = "a0000000-0000-4000-8000-000000000001";
const recoveryId = "abcdef12-3456-4123-8abc-123456789abc";
const accountId = "40000000-0000-4000-8000-000000000004";
const code = "A".repeat(43);
const instant = "2026-09-23T12:00:00.000Z";

describe("TASK161 kontorecoverykontrakt", () => {
  it("återanvänder kanonisk opak 32-byte base64url", () => {
    expect(accountPasswordRecoveryCodeSchema.parse(code)).toBe(code);
    for (const invalid of [`${"A".repeat(42)}B`, `${"A".repeat(42)}R`, `${"A".repeat(42)}=`, "A".repeat(42)]) {
      expect(accountPasswordRecoveryCodeSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("validerar betrott issue-intent och en hemlighetsfri respons", () => {
    const input = {
      formatVersion: 1 as const, requestId, accountId, loginName: "ol.runner-1",
      operatorLabel: "  Karin  ", reason: "  Identitet kontrollerad  ",
      codeHash: "a".repeat(64), expiresAt: instant
    };
    expect(accountPasswordRecoveryIssueInputSchema.parse(input)).toEqual({ ...input, operatorLabel: "Karin", reason: "Identitet kontrollerad" });
    for (const invalid of [
      { ...input, loginName: "OL.runner" },
      { ...input, requestId: requestId.toUpperCase() },
      { ...input, operatorLabel: " " },
      { ...input, operatorLabel: "x".repeat(121) },
      { ...input, reason: " " },
      { ...input, reason: "x".repeat(241) },
      { ...input, codeHash: "A".repeat(64) },
      { ...input, expiresAt: "tomorrow" },
      { ...input, code }
    ]) expect(accountPasswordRecoveryIssueInputSchema.safeParse(invalid).success).toBe(false);

    const response = { formatVersion: 1 as const, recoveryId, accountId, loginName: input.loginName, expiresAt: instant };
    expect(accountPasswordRecoveryIssueResponseSchema.parse(response)).toEqual(response);
    expect(accountPasswordRecoveryIssueResponseSchema.safeParse({ ...response, code }).success).toBe(false);
  });

  it("validerar revoke, status och begränsade svar", () => {
    const revoke = { formatVersion: 1 as const, requestId, recoveryId, operatorLabel: " Karin ", reason: " Fel mottagare " };
    expect(accountPasswordRecoveryRevokeInputSchema.parse(revoke)).toEqual({ ...revoke, operatorLabel: "Karin", reason: "Fel mottagare" });
    expect(accountPasswordRecoveryRevokeInputSchema.safeParse({ ...revoke, extra: true }).success).toBe(false);
    const revoked = { formatVersion: 1 as const, recoveryId, status: "REVOKED" as const };
    expect(accountPasswordRecoveryRevokeResponseSchema.parse(revoked)).toEqual(revoked);
    expect(accountPasswordRecoveryRevokeResponseSchema.safeParse({ ...revoked, reason: "secret" }).success).toBe(false);

    const status = { formatVersion: 1 as const, recoveryId, accountId, loginName: "ol.runner-1", issuedAt: instant, expiresAt: instant, status: "PENDING" as const };
    expect(accountPasswordRecoveryStatusResponseSchema.parse(status)).toEqual(status);
    expect(accountPasswordRecoveryStatusResponseSchema.safeParse({ ...status, status: "UNKNOWN" }).success).toBe(false);
    expect(accountPasswordRecoveryStatusResponseSchema.safeParse({ ...status, codeHash: "a".repeat(64) }).success).toBe(false);
  });

  it("validerar inlösen och neutralt fel utan hemligheter i svaret", () => {
    const password = `${"B".repeat(42)}E`;
    const request = { formatVersion: 1 as const, requestId, loginName: "ol.runner-1", code, password };
    expect(accountPasswordRecoveryRedeemRequestSchema.parse(request)).toEqual(request);
    expect(accountPasswordRecoveryRedeemRequestSchema.safeParse({ ...request, code: `${"A".repeat(42)}B` }).success).toBe(false);
    expect(accountPasswordRecoveryRedeemRequestSchema.safeParse({ ...request, password: `${"B".repeat(42)}R` }).success).toBe(false);
    expect(accountPasswordRecoveryRedeemRequestSchema.safeParse({ ...request, extra: true }).success).toBe(false);

    const response = { formatVersion: 1 as const, accountId, loginName: request.loginName, passwordVersion: 2 };
    expect(accountPasswordRecoveryRedeemResponseSchema.parse(response)).toEqual(response);
    expect(accountPasswordRecoveryRedeemResponseSchema.safeParse({ ...response, password: request.password }).success).toBe(false);
    expect(accountPasswordRecoveryRedeemResponseSchema.safeParse({ ...response, passwordVersion: 0 }).success).toBe(false);
    const failure = { formatVersion: 1 as const, error: "RECOVERY_UNAVAILABLE" as const };
    expect(accountPasswordRecoveryRedeemFailureSchema.parse(failure)).toEqual(failure);
    expect(accountPasswordRecoveryRedeemFailureSchema.safeParse({ ...failure, accountId }).success).toBe(false);
  });
});
