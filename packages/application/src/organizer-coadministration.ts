import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  organizerAdminGrantIdempotencyKeySchema,
  organizerAdminGrantRequestSchema,
  organizerAdminGrantResponseSchema,
  organizerAdminListRequestSchema,
  organizerAdminListResponseSchema,
  organizerAdminRevokeIdempotencyKeySchema,
  organizerAdminRevokeRequestSchema,
  organizerAdminRevokeResponseSchema,
  type OrganizerAdminGrantResponse,
  type OrganizerAdminListResponse,
  type OrganizerAdminRevokeResponse
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import { activeEventAdministrationGrant } from "./organizer-events";
import {
  authenticateUserAccountSessionForMutation,
  authenticateUserAccountSessionForProtectedRead,
  type UserAccountSessionProof
} from "./user-account";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DEFAULT_REVOKE_REASON = "Återkallad av tävlingsägare";
type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "conflict" | "not-found" };

export type OrganizerAdminGrantResult = Failure | { status: "granted"; response: OrganizerAdminGrantResponse };
export type OrganizerAdminListResult = Failure | { status: "ok"; response: OrganizerAdminListResponse };
export type OrganizerAdminRevokeResult = Failure | { status: "revoked"; response: OrganizerAdminRevokeResponse };

export interface OrganizerAdminGrantInput extends UserAccountSessionProof {
  idempotencyKey: string | null;
  readBody: () => Promise<unknown>;
}

export interface OrganizerAdminListInput extends UserAccountSessionProof { eventId: string }

export interface OrganizerAdminRevokeInput extends UserAccountSessionProof {
  grantId: string;
  idempotencyKey: string | null;
  readBody: () => Promise<unknown>;
}

function validDate(value: Date): Date {
  if (!Number.isFinite(value.getTime())) throw new Error("Ogiltig tidpunkt");
  return value;
}

async function eventRaceId(tx: DatabaseTransaction, eventId: string): Promise<string | undefined> {
  const [race] = await tx.select({ id: schema.races.id }).from(schema.races)
    .where(eq(schema.races.eventId, eventId)).orderBy(asc(schema.races.id)).limit(1);
  return race?.id;
}

async function activeOwner(tx: DatabaseTransaction, accountId: string, eventId: string,
  lock: "share" | "update"): Promise<boolean> {
  return !!await activeEventAdministrationGrant(tx, { accountId, eventId, ownerOnly: true }, lock);
}

function grantResponse(input: {
  requestId: string; eventId: string; grantId: string; accountId: string;
  email: string; displayName: string; grantedAt: Date;
}, replayed: boolean): OrganizerAdminGrantResponse {
  return organizerAdminGrantResponseSchema.parse({
    formatVersion: 1, replayed, requestId: input.requestId, eventId: input.eventId,
    grantId: input.grantId, accountId: input.accountId, email: input.email,
    displayName: input.displayName, role: "ADMIN", grantedAt: input.grantedAt.toISOString()
  });
}

function revokeResponse(input: {
  requestId: string; eventId: string; grantId: string; revokedAt: Date;
}, replayed: boolean): OrganizerAdminRevokeResponse {
  return organizerAdminRevokeResponseSchema.parse({
    formatVersion: 1, replayed, requestId: input.requestId, eventId: input.eventId,
    grantId: input.grantId, revokedAt: input.revokedAt.toISOString()
  });
}

/** Direct OWNER-to-existing-account grant. Event row serializes concurrent intent for one event. */
export async function grantEventAdministratorAsUserAccount(
  db: Database, input: OrganizerAdminGrantInput, now = new Date()
): Promise<OrganizerAdminGrantResult> {
  const grantedAt = validDate(now);
  const key = organizerAdminGrantIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!key.success) return { status: "invalid-request" };
  let body: unknown;
  try { body = await input.readBody(); } catch { return { status: "invalid-request" }; }
  const request = organizerAdminGrantRequestSchema.safeParse(body);
  if (!request.success || key.data !== `organizer-admin-grant:${request.data.requestId}`) {
    return { status: "invalid-request" };
  }
  return db.transaction(async (tx) => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...input, requireCsrf: true }, grantedAt);
    if (auth.status !== "authenticated") return auth;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${request.data.requestId}, 0))`);
    const [existing] = await tx.select().from(schema.eventAdministrationAccessRequests)
      .where(eq(schema.eventAdministrationAccessRequests.requestId, request.data.requestId));
    if (existing) {
      if (existing.action !== "GRANT_ADMIN" || existing.actorAccountId !== auth.principal.accountId ||
        existing.eventId !== request.data.eventId || existing.reason !== null) return { status: "conflict" } as const;
      const [target] = await tx.select().from(schema.userAccounts)
        .where(eq(schema.userAccounts.id, existing.targetAccountId));
      const [grant] = await tx.select().from(schema.eventAdministrationGrants)
        .where(eq(schema.eventAdministrationGrants.id, existing.grantId));
      if (!target || !grant || target.email !== request.data.email || grant.role !== "ADMIN") {
        return { status: "conflict" } as const;
      }
      return { status: "granted", response: grantResponse({ requestId: existing.requestId,
        eventId: existing.eventId, grantId: grant.id, accountId: target.id,
        email: target.email, displayName: target.displayName, grantedAt: grant.grantedAt }, true) } as const;
    }
    const [event] = await tx.select({ id: schema.events.id }).from(schema.events)
      .where(eq(schema.events.id, request.data.eventId)).for("update");
    if (!event || !await activeOwner(tx, auth.principal.accountId, event.id, "update")) {
      return { status: "not-found" } as const;
    }
    const [target] = await tx.select().from(schema.userAccounts)
      .where(eq(schema.userAccounts.email, request.data.email));
    if (!target || target.id === auth.principal.accountId || target.blockedAt) return { status: "not-found" } as const;
    const existingGrants = await tx.select({ id: schema.eventAdministrationGrants.id,
      role: schema.eventAdministrationGrants.role })
      .from(schema.eventAdministrationGrants)
      .where(and(eq(schema.eventAdministrationGrants.eventId, event.id),
        eq(schema.eventAdministrationGrants.accountId, target.id))).for("update");
    for (const candidate of existingGrants) {
      const [revocation] = await tx.select({ id: schema.eventAdministrationGrantRevocations.id })
        .from(schema.eventAdministrationGrantRevocations)
        .where(eq(schema.eventAdministrationGrantRevocations.grantId, candidate.id));
      if (!revocation) return { status: "conflict" } as const;
    }
    const raceId = await eventRaceId(tx, event.id);
    if (!raceId) return { status: "conflict" } as const;
    const [grant] = await tx.insert(schema.eventAdministrationGrants).values({
      eventId: event.id, accountId: target.id, role: "ADMIN", grantedAt
    }).returning();
    if (!grant) throw new Error("ADMIN-grant kunde inte bekräftas");
    await tx.insert(schema.eventAdministrationAccessRequests).values({
      requestId: request.data.requestId, action: "GRANT_ADMIN", actorAccountId: auth.principal.accountId,
      eventId: event.id, targetAccountId: target.id, grantId: grant.id, reason: null, createdAt: grantedAt
    });
    await tx.insert(schema.auditEvents).values({
      raceId, entityType: "event_administration_grant", entityId: grant.id,
      action: "EVENT_ADMIN_GRANTED_BY_OWNER", actorKind: "USER_ACCOUNT",
      actorId: auth.principal.accountId, requestId: request.data.requestId,
      after: { eventId: event.id, grantId: grant.id, targetAccountId: target.id,
        role: "ADMIN", grantedAt: grantedAt.toISOString() }
    });
    return { status: "granted", response: grantResponse({ requestId: request.data.requestId,
      eventId: event.id, grantId: grant.id, accountId: target.id,
      email: target.email, displayName: target.displayName, grantedAt }, false) } as const;
  });
}

/** OWNER-only exact-event history. Protected read holds the event lock against revocation. */
export async function listEventAdministratorsAsUserAccount(
  db: Database, input: OrganizerAdminListInput, now = new Date()
): Promise<OrganizerAdminListResult> {
  const request = organizerAdminListRequestSchema.safeParse({ formatVersion: 1, eventId: input.eventId });
  if (!request.success) return { status: "not-found" };
  return db.transaction(async (tx) => {
    const auth = await authenticateUserAccountSessionForProtectedRead(tx, input, validDate(now));
    if (auth.status !== "authenticated") return auth;
    const [event] = await tx.select({ id: schema.events.id }).from(schema.events)
      .where(eq(schema.events.id, request.data.eventId)).for("share");
    if (!event || !await activeOwner(tx, auth.principal.accountId, event.id, "share")) {
      return { status: "not-found" } as const;
    }
    const grants = await tx.select({ id: schema.eventAdministrationGrants.id,
      accountId: schema.eventAdministrationGrants.accountId,
      grantedAt: schema.eventAdministrationGrants.grantedAt,
      email: schema.userAccounts.email, displayName: schema.userAccounts.displayName })
      .from(schema.eventAdministrationGrants)
      .innerJoin(schema.userAccounts, eq(schema.userAccounts.id, schema.eventAdministrationGrants.accountId))
      .where(and(eq(schema.eventAdministrationGrants.eventId, event.id),
        eq(schema.eventAdministrationGrants.role, "ADMIN")))
      .orderBy(asc(schema.eventAdministrationGrants.grantedAt), asc(schema.eventAdministrationGrants.id))
      .limit(10_001);
    if (grants.length > 10_000) throw new Error("För många administratörsgrants för kontraktet");
    const items: OrganizerAdminListResponse["grants"] = [];
    for (const grant of grants) {
      const [revocation] = await tx.select({ revokedAt: schema.eventAdministrationGrantRevocations.revokedAt })
        .from(schema.eventAdministrationGrantRevocations)
        .where(eq(schema.eventAdministrationGrantRevocations.grantId, grant.id));
      items.push({ grantId: grant.id, accountId: grant.accountId, email: grant.email,
        displayName: grant.displayName, role: "ADMIN", grantedAt: grant.grantedAt.toISOString(),
        revokedAt: revocation?.revokedAt.toISOString() ?? null });
    }
    return { status: "ok", response: organizerAdminListResponseSchema.parse({
      formatVersion: 1, eventId: event.id, grants: items
    }) } as const;
  });
}

/** Revoke is append-only and advances the existing MVCC grant guard in the same transaction. */
export async function revokeEventAdministratorAsUserAccount(
  db: Database, input: OrganizerAdminRevokeInput, now = new Date()
): Promise<OrganizerAdminRevokeResult> {
  const revokedAt = validDate(now);
  if (!UUID_PATTERN.test(input.grantId)) return { status: "invalid-request" };
  const key = organizerAdminRevokeIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!key.success) return { status: "invalid-request" };
  let body: unknown;
  try { body = await input.readBody(); } catch { return { status: "invalid-request" }; }
  const request = organizerAdminRevokeRequestSchema.safeParse(body);
  if (!request.success || request.data.grantId !== input.grantId ||
    key.data !== `organizer-admin-revoke:${request.data.requestId}`) return { status: "invalid-request" };
  const reason = request.data.reason ?? DEFAULT_REVOKE_REASON;
  return db.transaction(async (tx) => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...input, requireCsrf: true }, revokedAt);
    if (auth.status !== "authenticated") return auth;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${request.data.requestId}, 0))`);
    const [existing] = await tx.select().from(schema.eventAdministrationAccessRequests)
      .where(eq(schema.eventAdministrationAccessRequests.requestId, request.data.requestId));
    if (existing) {
      if (existing.action !== "REVOKE_ADMIN" || existing.actorAccountId !== auth.principal.accountId ||
        existing.eventId !== request.data.eventId || existing.grantId !== input.grantId ||
        existing.reason !== reason) return { status: "conflict" } as const;
      return { status: "revoked", response: revokeResponse({ requestId: existing.requestId,
        eventId: existing.eventId, grantId: existing.grantId, revokedAt: existing.createdAt }, true) } as const;
    }
    const [event] = await tx.select({ id: schema.events.id }).from(schema.events)
      .where(eq(schema.events.id, request.data.eventId)).for("update");
    if (!event || !await activeOwner(tx, auth.principal.accountId, event.id, "update")) {
      return { status: "not-found" } as const;
    }
    const [grant] = await tx.select().from(schema.eventAdministrationGrants)
      .where(and(eq(schema.eventAdministrationGrants.id, input.grantId),
        eq(schema.eventAdministrationGrants.eventId, event.id),
        eq(schema.eventAdministrationGrants.role, "ADMIN"))).for("update");
    if (!grant) return { status: "not-found" } as const;
    const [prior] = await tx.select({ id: schema.eventAdministrationGrantRevocations.id })
      .from(schema.eventAdministrationGrantRevocations)
      .where(eq(schema.eventAdministrationGrantRevocations.grantId, grant.id));
    if (prior) return { status: "conflict" } as const;
    const raceId = await eventRaceId(tx, event.id);
    if (!raceId) return { status: "conflict" } as const;
    await tx.insert(schema.eventAdministrationGrantRevocations).values({
      id: randomUUID(), grantId: grant.id, revokedAt, reason
    });
    await tx.insert(schema.eventAdministrationAccessRequests).values({
      requestId: request.data.requestId, action: "REVOKE_ADMIN", actorAccountId: auth.principal.accountId,
      eventId: event.id, targetAccountId: grant.accountId, grantId: grant.id, reason, createdAt: revokedAt
    });
    await tx.insert(schema.auditEvents).values({
      raceId, entityType: "event_administration_grant", entityId: grant.id,
      action: "EVENT_ADMIN_REVOKED_BY_OWNER", actorKind: "USER_ACCOUNT",
      actorId: auth.principal.accountId, requestId: request.data.requestId,
      after: { eventId: event.id, grantId: grant.id, targetAccountId: grant.accountId,
        role: "ADMIN", revokedAt: revokedAt.toISOString(), reason }
    });
    return { status: "revoked", response: revokeResponse({ requestId: request.data.requestId,
      eventId: event.id, grantId: grant.id, revokedAt }, false) } as const;
  });
}
