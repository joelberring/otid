import { describe, expect, it } from "vitest";
import {
  organizerAdminGrantIdempotencyKeySchema,
  organizerAdminGrantRequestSchema,
  organizerAdminGrantResponseSchema,
  organizerAdminListRequestSchema,
  organizerAdminListResponseSchema,
  organizerAdminRevokeIdempotencyKeySchema,
  organizerAdminRevokeRequestSchema,
  organizerAdminRevokeResponseSchema
} from "../src";

const requestId = "a0000000-0000-4000-8000-000000000001";
const eventId = "abcdef12-3456-4123-8abc-123456789abc";
const grantId = "40000000-0000-4000-8000-000000000004";
const accountId = "50000000-0000-4000-8000-000000000005";
const grantedAt = "2026-09-23T10:00:00.000Z";

describe("TASK151 eventbundna medadministratörskontrakt", () => {
  it("binder grant till request, event, exakt login och ADMIN-rollen", () => {
    const request = { formatVersion: 1 as const, requestId, eventId, loginName: "ol.runner-1", role: "ADMIN" as const };
    expect(organizerAdminGrantRequestSchema.parse(request)).toEqual(request);
    for (const loginName of ["OL.runner", "ab", "ol runner", "åsa.runner"]) {
      expect(organizerAdminGrantRequestSchema.safeParse({ ...request, loginName }).success).toBe(false);
    }
    expect(organizerAdminGrantRequestSchema.safeParse({ ...request, requestId: requestId.toUpperCase() }).success).toBe(false);
    expect(organizerAdminGrantRequestSchema.safeParse({ ...request, role: "OWNER" }).success).toBe(false);
    expect(organizerAdminGrantRequestSchema.safeParse({ ...request, accountId }).success).toBe(false);
    expect(organizerAdminGrantIdempotencyKeySchema.parse(`organizer-admin-grant:${requestId}`))
      .toBe(`organizer-admin-grant:${requestId}`);
    expect(organizerAdminGrantIdempotencyKeySchema.safeParse(`organizer-admin-grant:${requestId.toUpperCase()}`).success).toBe(false);
    expect(organizerAdminGrantIdempotencyKeySchema.safeParse(`organizer-admin-revoke:${requestId}`).success).toBe(false);

    const response = {
      formatVersion: 1 as const, replayed: false, requestId, eventId, grantId, accountId,
      loginName: "ol.runner-1", displayName: "Ol Runner", role: "ADMIN" as const, grantedAt
    };
    expect(organizerAdminGrantResponseSchema.parse(response)).toEqual(response);
    expect(organizerAdminGrantResponseSchema.safeParse({ ...response, passwordHash: "secret" }).success).toBe(false);
    expect(organizerAdminGrantResponseSchema.safeParse({ ...response, eventId: eventId.toUpperCase() }).success).toBe(false);
  });

  it("listar bara medadministratörsmetadata för uttryckligt event och bevarar återkallelsetid", () => {
    const request = { formatVersion: 1 as const, eventId };
    const listItem = {
      grantId, accountId, loginName: "ol.runner-1", displayName: "Ol Runner", role: "ADMIN" as const,
      grantedAt, revokedAt: null
    };
    const response = { formatVersion: 1 as const, eventId, grants: [listItem] };
    expect(organizerAdminListRequestSchema.parse(request)).toEqual(request);
    expect(organizerAdminListRequestSchema.safeParse({ ...request, accountId }).success).toBe(false);
    expect(organizerAdminListResponseSchema.parse(response)).toEqual(response);
    expect(organizerAdminListResponseSchema.parse({
      ...response, grants: [{ ...listItem, revokedAt: "2026-09-23T11:00:00Z" }]
    }).grants[0]?.revokedAt).toBe("2026-09-23T11:00:00Z");
    expect(organizerAdminListResponseSchema.safeParse({
      ...response, grants: [{ ...listItem, role: "OWNER" }]
    }).success).toBe(false);
    expect(organizerAdminListResponseSchema.safeParse({
      ...response, grants: [{ ...listItem, email: "private@example.test" }]
    }).success).toBe(false);
    expect(organizerAdminListResponseSchema.safeParse({ ...response, ownerId: accountId }).success).toBe(false);
  });

  it("binder revoke till exakt event, grant och idempotent request", () => {
    const request = { formatVersion: 1 as const, requestId, eventId, grantId, reason: "Avslutat uppdrag" };
    expect(organizerAdminRevokeRequestSchema.parse(request)).toEqual(request);
    expect(organizerAdminRevokeRequestSchema.safeParse({ ...request, reason: "x".repeat(240) }).success).toBe(true);
    expect(organizerAdminRevokeRequestSchema.safeParse({ ...request, reason: "x".repeat(241) }).success).toBe(false);
    expect(organizerAdminRevokeRequestSchema.safeParse({ ...request, surprise: true }).success).toBe(false);
    expect(organizerAdminRevokeRequestSchema.safeParse({ ...request, reason: " " }).success).toBe(false);
    expect(organizerAdminRevokeIdempotencyKeySchema.parse(`organizer-admin-revoke:${requestId}`))
      .toBe(`organizer-admin-revoke:${requestId}`);
    expect(organizerAdminRevokeIdempotencyKeySchema.safeParse(`organizer-admin-grant:${requestId}`).success).toBe(false);

    const response = { formatVersion: 1 as const, replayed: false, requestId, eventId, grantId, revokedAt: grantedAt };
    expect(organizerAdminRevokeResponseSchema.parse(response)).toEqual(response);
    expect(organizerAdminRevokeResponseSchema.safeParse({ ...response, accountId }).success).toBe(false);
    expect(organizerAdminRevokeResponseSchema.safeParse({ ...response, revokedAt: "later" }).success).toBe(false);
  });
});
