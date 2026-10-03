import { describe, expect, it } from "vitest";
import {
  organizerAccountInvitationIssueIdempotencyKeySchema,
  organizerAccountInvitationIssueRequestSchema,
  organizerAccountInvitationIssueResponseSchema,
  organizerAccountInvitationListResponseSchema,
  organizerAccountInvitationRevokeIdempotencyKeySchema,
  organizerAccountInvitationRevokeRequestSchema,
  organizerAccountInvitationRevokeResponseSchema
} from "../src";

const id = "a0000000-0000-4000-8000-000000000001";
const invitationId = "a0000000-0000-4000-8000-000000000002";
const instant = "2026-09-23T12:00:00.000Z";

describe("TASK160 ägarstyrda kontoinbjudningskontrakt", () => {
  it("validerar strikt issue-intent och idempotency-key", () => {
    const request = {
      formatVersion: 1 as const,
      requestId: id,
      eventId: id,
      loginName: "ol.runner-1",
      displayName: "  Ol Runner  ",
      codeHash: "a".repeat(64)
    };
    expect(organizerAccountInvitationIssueRequestSchema.parse(request)).toEqual({ ...request, displayName: "Ol Runner" });
    expect(organizerAccountInvitationIssueIdempotencyKeySchema.parse(`organizer-account-invitation-issue:${id}`))
      .toBe(`organizer-account-invitation-issue:${id}`);
    for (const invalid of [
      { ...request, loginName: "OL.runner" },
      { ...request, requestId: id.toUpperCase() },
      { ...request, codeHash: "A".repeat(64) },
      { ...request, code: "secret" },
      { ...request, extra: true }
    ]) expect(organizerAccountInvitationIssueRequestSchema.safeParse(invalid).success).toBe(false);
    expect(organizerAccountInvitationIssueIdempotencyKeySchema.safeParse(`account-invitation-issue:${id}`).success).toBe(false);
  });

  it("validerar issue-svar och begränsad eventlista utan kodmaterial", () => {
    const response = {
      formatVersion: 1 as const, requestId: id, eventId: id, invitationId,
      loginName: "ol.runner-1", displayName: "Ol Runner", expiresAt: instant, replayed: false
    };
    expect(organizerAccountInvitationIssueResponseSchema.parse(response)).toEqual(response);
    expect(organizerAccountInvitationIssueResponseSchema.safeParse({ ...response, codeHash: "a".repeat(64) }).success).toBe(false);
    const list = {
      formatVersion: 1 as const,
      eventId: id,
      invitations: [{ invitationId, loginName: "ol.runner-1", displayName: "Ol Runner", issuedAt: instant, expiresAt: instant, status: "PENDING" as const }]
    };
    expect(organizerAccountInvitationListResponseSchema.parse(list)).toEqual(list);
    for (const status of ["UNKNOWN", "ACTIVE"]) {
      expect(organizerAccountInvitationListResponseSchema.safeParse({
        ...list, invitations: [{ ...list.invitations[0], status }]
      }).success).toBe(false);
    }
    expect(organizerAccountInvitationListResponseSchema.safeParse({ ...list, codeHash: "a".repeat(64) }).success).toBe(false);
  });

  it("validerar revoke-intent, valfri anledning och exakt svar", () => {
    const request = { formatVersion: 1 as const, requestId: id, eventId: id, invitationId, reason: "  Fel person  " };
    expect(organizerAccountInvitationRevokeRequestSchema.parse(request)).toEqual({ ...request, reason: "Fel person" });
    expect(organizerAccountInvitationRevokeRequestSchema.parse({ formatVersion: 1, requestId: id, eventId: id, invitationId }))
      .toEqual({ formatVersion: 1, requestId: id, eventId: id, invitationId });
    expect(organizerAccountInvitationRevokeRequestSchema.safeParse({ ...request, reason: "x".repeat(241) }).success).toBe(false);
    expect(organizerAccountInvitationRevokeRequestSchema.safeParse({ ...request, reason: "   " }).success).toBe(false);
    expect(organizerAccountInvitationRevokeRequestSchema.safeParse({ ...request, extra: true }).success).toBe(false);
    expect(organizerAccountInvitationRevokeIdempotencyKeySchema.parse(`organizer-account-invitation-revoke:${id}`))
      .toBe(`organizer-account-invitation-revoke:${id}`);
    expect(organizerAccountInvitationRevokeIdempotencyKeySchema.safeParse(`organizer-account-invitation-issue:${id}`).success).toBe(false);

    const response = { formatVersion: 1 as const, requestId: id, eventId: id, invitationId, revokedAt: instant, replayed: true };
    expect(organizerAccountInvitationRevokeResponseSchema.parse(response)).toEqual(response);
    expect(organizerAccountInvitationRevokeResponseSchema.safeParse({ ...response, reason: "extra" }).success).toBe(false);
  });
});
