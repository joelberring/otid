import { describe, expect, it } from "vitest";
import {
  accountInvitationActivationRequestSchema,
  accountInvitationActivationResponseSchema,
  accountInvitationCodeSchema,
  accountInvitationIssueInputSchema,
  accountInvitationIssueResponseSchema,
  accountInvitationRevokeInputSchema,
  accountInvitationRevokeResponseSchema,
  accountInvitationStatusResponseSchema
} from "../src";

const requestId = "a0000000-0000-4000-8000-000000000001";
const invitationId = "abcdef12-3456-4123-8abc-123456789abc";
const accountId = "40000000-0000-4000-8000-000000000004";
const code = "A".repeat(43);
const instant = "2026-09-23T12:00:00.000Z";

describe("TASK159 kontoinbjudningskontrakt", () => {
  it("accepterar endast kanonisk opak 32-byte base64url", () => {
    expect(accountInvitationCodeSchema.parse(code)).toBe(code);
    for (const final of "AEIMQUYcgkosw048") {
      expect(accountInvitationCodeSchema.parse(`${"A".repeat(42)}${final}`)).toBe(`${"A".repeat(42)}${final}`);
    }
    for (const invalid of ["A".repeat(42), `${"A".repeat(42)}B`, `${"A".repeat(42)}R`, `${"A".repeat(42)}+`, `${"A".repeat(42)}/`, `${"A".repeat(42)}=`, ` ${code}`]) {
      expect(accountInvitationCodeSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("validerar aktiveringsrequestens canonicalitet och exakta form", () => {
    const request = { formatVersion: 1 as const, requestId, loginName: "ol.runner-1", password: code, code };
    expect(accountInvitationActivationRequestSchema.parse(request)).toEqual(request);
    for (const invalidName of ["OL.runner", "ab", " leading", "two words", "åsa.runner"]) {
      expect(accountInvitationActivationRequestSchema.safeParse({ ...request, loginName: invalidName }).success).toBe(false);
    }
    expect(accountInvitationActivationRequestSchema.safeParse({ ...request, requestId: requestId.toUpperCase() }).success).toBe(false);
    expect(accountInvitationActivationRequestSchema.safeParse({ ...request, password: `${"A".repeat(42)}B` }).success).toBe(false);
    expect(accountInvitationActivationRequestSchema.safeParse({ ...request, surprise: true }).success).toBe(false);

    const response = { formatVersion: 1 as const, accountId, loginName: request.loginName };
    expect(accountInvitationActivationResponseSchema.parse(response)).toEqual(response);
    expect(accountInvitationActivationResponseSchema.safeParse({ ...response, code }).success).toBe(false);
  });

  it("validerar issue/revoke intent och svar med trimmade fältgränser", () => {
    const issue = {
      formatVersion: 1 as const, requestId, loginName: "ol.runner-1", displayName: "  Ol Runner  ",
      operatorLabel: "  Karin  ", codeHash: "a".repeat(64), expiresAt: instant
    };
    expect(accountInvitationIssueInputSchema.parse(issue)).toEqual({ ...issue, displayName: "Ol Runner", operatorLabel: "Karin" });
    for (const displayName of [" ", "x".repeat(121)]) {
      expect(accountInvitationIssueInputSchema.safeParse({ ...issue, displayName }).success).toBe(false);
    }
    expect(accountInvitationIssueInputSchema.safeParse({ ...issue, operatorLabel: "x".repeat(121) }).success).toBe(false);
    expect(accountInvitationIssueInputSchema.safeParse({ ...issue, codeHash: "A".repeat(64) }).success).toBe(false);
    expect(accountInvitationIssueInputSchema.safeParse({ ...issue, expiresAt: "tomorrow" }).success).toBe(false);
    expect(accountInvitationIssueInputSchema.safeParse({ ...issue, code }).success).toBe(false);

    const issued = { formatVersion: 1 as const, invitationId, loginName: issue.loginName, expiresAt: instant };
    expect(accountInvitationIssueResponseSchema.parse(issued)).toEqual(issued);
    expect(accountInvitationIssueResponseSchema.safeParse({ ...issued, code }).success).toBe(false);

    const revoke = { formatVersion: 1 as const, requestId, invitationId, operatorLabel: "  Karin ", reason: "  Fel mottagare  " };
    expect(accountInvitationRevokeInputSchema.parse(revoke)).toEqual({ ...revoke, operatorLabel: "Karin", reason: "Fel mottagare" });
    expect(accountInvitationRevokeInputSchema.safeParse({ ...revoke, reason: " " }).success).toBe(false);
    expect(accountInvitationRevokeInputSchema.safeParse({ ...revoke, reason: "x".repeat(241) }).success).toBe(false);
    expect(accountInvitationRevokeInputSchema.safeParse({ ...revoke, extra: true }).success).toBe(false);

    const revoked = { formatVersion: 1 as const, invitationId, status: "REVOKED" as const };
    expect(accountInvitationRevokeResponseSchema.parse(revoked)).toEqual(revoked);
    expect(accountInvitationRevokeResponseSchema.safeParse({ ...revoked, reason: "secret" }).success).toBe(false);
  });

  it("validerar icke-hemlig status med begränsade tillstånd", () => {
    const status = {
      formatVersion: 1 as const, invitationId, loginName: "ol.runner-1", displayName: "Ol Runner",
      issuedAt: instant, expiresAt: instant, status: "PENDING" as const
    };
    expect(accountInvitationStatusResponseSchema.parse(status)).toEqual(status);
    expect(accountInvitationStatusResponseSchema.safeParse({ ...status, status: "UNKNOWN" }).success).toBe(false);
    expect(accountInvitationStatusResponseSchema.safeParse({ ...status, codeHash: "a".repeat(64) }).success).toBe(false);
    expect(accountInvitationStatusResponseSchema.safeParse({ ...status, displayName: "x".repeat(121) }).success).toBe(false);
  });
});
