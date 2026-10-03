import { asc, desc, eq, and, sql } from "drizzle-orm";
import {
  accountInvitationIssueInputSchema,
  accountInvitationRevokeInputSchema,
  organizerAccountInvitationIssueIdempotencyKeySchema,
  organizerAccountInvitationIssueRequestSchema,
  organizerAccountInvitationIssueResponseSchema,
  organizerAccountInvitationListResponseSchema,
  organizerAccountInvitationRevokeIdempotencyKeySchema,
  organizerAccountInvitationRevokeRequestSchema,
  organizerAccountInvitationRevokeResponseSchema,
  type OrganizerAccountInvitationIssueResponse,
  type OrganizerAccountInvitationListResponse,
  type OrganizerAccountInvitationRevokeResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { issueAccountInvitationInTransaction,
  revokeAccountInvitationInTransaction, type AccountInvitationTransaction } from "./account-invitation";
import { activeEventAdministrationGrant } from "./organizer-events";
import { authenticateUserAccountSessionForMutation,
  authenticateUserAccountSessionForProtectedRead,
  type UserAccountSessionProof } from "./user-account";

const LIFETIME_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_REVOKE_REASON = "Återkallad av tävlingsägare";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "conflict" | "not-found" };

export interface OrganizerAccountInvitationIssueInput extends UserAccountSessionProof {
  idempotencyKey: string | null;
  readBody: () => Promise<unknown>;
}
export interface OrganizerAccountInvitationListInput extends UserAccountSessionProof { eventId: string }
export interface OrganizerAccountInvitationRevokeInput extends UserAccountSessionProof {
  invitationId: string;
  idempotencyKey: string | null;
  readBody: () => Promise<unknown>;
}

function operatorLabel(actorAccountId: string): string {
  return `EVENT_OWNER:${actorAccountId}`;
}

function validDate(now: Date): Date {
  if (!Number.isFinite(now.getTime())) throw new Error("Ogiltig tidpunkt");
  return now;
}

async function firstRaceId(tx: AccountInvitationTransaction, eventId: string): Promise<string | undefined> {
  const [race] = await tx.select({ id: schema.races.id }).from(schema.races)
    .where(eq(schema.races.eventId, eventId)).orderBy(asc(schema.races.id)).limit(1);
  return race?.id;
}

async function currentOwner(tx: AccountInvitationTransaction, actorAccountId: string,
  eventId: string, lock: "share" | "update"): Promise<boolean> {
  return !!await activeEventAdministrationGrant(tx, { accountId: actorAccountId,
    eventId, ownerOnly: true }, lock);
}

function issueResponse(row: {
  requestId: string; eventId: string; invitationId: string; loginName: string;
  displayName: string; expiresAt: Date;
}, replayed: boolean): OrganizerAccountInvitationIssueResponse {
  return organizerAccountInvitationIssueResponseSchema.parse({
    formatVersion: 1, requestId: row.requestId, eventId: row.eventId,
    invitationId: row.invitationId, loginName: row.loginName,
    displayName: row.displayName, expiresAt: row.expiresAt.toISOString(), replayed
  });
}

function revokeResponse(row: {
  requestId: string; eventId: string; invitationId: string; revokedAt: Date;
}, replayed: boolean): OrganizerAccountInvitationRevokeResponse {
  return organizerAccountInvitationRevokeResponseSchema.parse({
    formatVersion: 1, requestId: row.requestId, eventId: row.eventId,
    invitationId: row.invitationId, revokedAt: row.revokedAt.toISOString(), replayed
  });
}

/** A3b: an active OWNER may issue an account-only invitation, never a grant. */
export async function issueEventAccountInvitationAsOwner(
  db: Database, input: OrganizerAccountInvitationIssueInput, now = new Date()
): Promise<Failure | { status: "issued"; response: OrganizerAccountInvitationIssueResponse }> {
  const issuedAt = validDate(now);
  const key = organizerAccountInvitationIssueIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!key.success) return { status: "invalid-request" };
  let body: unknown;
  try { body = await input.readBody(); } catch { return { status: "invalid-request" }; }
  const parsed = organizerAccountInvitationIssueRequestSchema.safeParse(body);
  if (!parsed.success || key.data !== `organizer-account-invitation-issue:${parsed.data.requestId}`) {
    return { status: "invalid-request" };
  }
  const request = parsed.data;
  return db.transaction(async (tx) => {
    const auth = await authenticateUserAccountSessionForMutation(tx,
      { ...input, requireCsrf: true }, issuedAt);
    if (auth.status !== "authenticated") return auth;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${request.requestId}, 0))`);
    const [prior] = await tx.select({ ownerIssue: schema.eventAccountInvitationIssues,
      issue: schema.accountInvitationIssues })
      .from(schema.eventAccountInvitationIssues)
      .innerJoin(schema.accountInvitationIssues,
        eq(schema.accountInvitationIssues.id, schema.eventAccountInvitationIssues.invitationId))
      .where(eq(schema.eventAccountInvitationIssues.requestId, request.requestId));
    if (prior) {
      if (prior.ownerIssue.actorAccountId !== auth.principal.accountId ||
        prior.ownerIssue.eventId !== request.eventId || prior.issue.loginName !== request.loginName ||
        prior.issue.displayName !== request.displayName || prior.issue.codeHash !== request.codeHash) {
        return { status: "conflict" } as const;
      }
      return { status: "issued", response: issueResponse({ requestId: request.requestId,
        eventId: request.eventId, invitationId: prior.issue.id,
        loginName: prior.issue.loginName, displayName: prior.issue.displayName,
        expiresAt: prior.issue.expiresAt }, true) } as const;
    }
    const [otherIssue] = await tx.select({ id: schema.accountInvitationIssues.id })
      .from(schema.accountInvitationIssues)
      .where(eq(schema.accountInvitationIssues.requestId, request.requestId));
    if (otherIssue) return { status: "conflict" } as const;
    const [event] = await tx.select({ id: schema.events.id }).from(schema.events)
      .where(eq(schema.events.id, request.eventId)).for("update");
    if (!event || !await currentOwner(tx, auth.principal.accountId, event.id, "update")) {
      return { status: "not-found" } as const;
    }
    const raceId = await firstRaceId(tx, event.id);
    if (!raceId) return { status: "conflict" } as const;
    const expiresAt = new Date(issuedAt.getTime() + LIFETIME_MS);
    const issueInput = accountInvitationIssueInputSchema.parse({
      formatVersion: 1, requestId: request.requestId,
      loginName: request.loginName, displayName: request.displayName,
      operatorLabel: operatorLabel(auth.principal.accountId), codeHash: request.codeHash,
      expiresAt: expiresAt.toISOString()
    });
    const issued = await issueAccountInvitationInTransaction(tx, issueInput, issuedAt);
    if (issued.status !== "issued") return issued;
    await tx.insert(schema.eventAccountInvitationIssues).values({
      requestId: request.requestId, invitationId: issued.response.invitationId,
      eventId: event.id, actorAccountId: auth.principal.accountId, createdAt: issuedAt
    });
    await tx.insert(schema.auditEvents).values({
      raceId, entityType: "event_account_invitation_issue",
      entityId: issued.response.invitationId, action: "EVENT_ACCOUNT_INVITATION_ISSUED_BY_OWNER",
      actorKind: "USER_ACCOUNT", actorId: auth.principal.accountId,
      requestId: request.requestId,
      after: { eventId: event.id, invitationId: issued.response.invitationId,
        loginName: request.loginName, expiresAt: issued.response.expiresAt }
    });
    return { status: "issued", response: issueResponse({ requestId: request.requestId,
      eventId: event.id, invitationId: issued.response.invitationId,
      loginName: request.loginName, displayName: request.displayName, expiresAt }, false) } as const;
  });
}

/** OWNER-only status; no code or code hash is ever projected. */
export async function listEventAccountInvitationsAsOwner(
  db: Database, input: OrganizerAccountInvitationListInput, now = new Date()
): Promise<Failure | { status: "ok"; response: OrganizerAccountInvitationListResponse }> {
  if (!UUID_PATTERN.test(input.eventId)) return { status: "invalid-request" };
  return db.transaction(async (tx) => {
    const auth = await authenticateUserAccountSessionForProtectedRead(tx, input, validDate(now));
    if (auth.status !== "authenticated") return auth;
    const [event] = await tx.select({ id: schema.events.id }).from(schema.events)
      .where(eq(schema.events.id, input.eventId)).for("share");
    if (!event || !await currentOwner(tx, auth.principal.accountId, event.id, "share")) {
      return { status: "not-found" } as const;
    }
    const rows = await tx.select({ ownerIssue: schema.eventAccountInvitationIssues,
      issue: schema.accountInvitationIssues,
      revocationId: schema.accountInvitationRevocations.id,
      redemptionId: schema.accountInvitationRedemptions.id })
      .from(schema.eventAccountInvitationIssues)
      .innerJoin(schema.accountInvitationIssues,
        eq(schema.accountInvitationIssues.id, schema.eventAccountInvitationIssues.invitationId))
      .leftJoin(schema.accountInvitationRevocations,
        eq(schema.accountInvitationRevocations.invitationId, schema.accountInvitationIssues.id))
      .leftJoin(schema.accountInvitationRedemptions,
        eq(schema.accountInvitationRedemptions.invitationId, schema.accountInvitationIssues.id))
      .where(eq(schema.eventAccountInvitationIssues.eventId, event.id))
      .orderBy(desc(schema.accountInvitationIssues.issuedAt), desc(schema.accountInvitationIssues.id))
      .limit(501);
    if (rows.length > 500) throw new Error("För många kontoinbjudningar för kontraktet");
    const invitations: OrganizerAccountInvitationListResponse["invitations"] = rows.map(row => ({
      invitationId: row.issue.id, loginName: row.issue.loginName,
      displayName: row.issue.displayName, issuedAt: row.issue.issuedAt.toISOString(),
      expiresAt: row.issue.expiresAt.toISOString(),
      status: row.redemptionId ? "REDEEMED" : row.revocationId ? "REVOKED" :
        row.issue.expiresAt.getTime() <= now.getTime() ? "EXPIRED" : "PENDING"
    }));
    return { status: "ok", response: organizerAccountInvitationListResponseSchema.parse({
      formatVersion: 1, eventId: event.id, invitations
    }) } as const;
  });
}

/** Pending-only revoke, recorded with the current OWNER actor and event. */
export async function revokeEventAccountInvitationAsOwner(
  db: Database, input: OrganizerAccountInvitationRevokeInput, now = new Date()
): Promise<Failure | { status: "revoked"; response: OrganizerAccountInvitationRevokeResponse }> {
  const revokedAt = validDate(now);
  if (!UUID_PATTERN.test(input.invitationId)) return { status: "invalid-request" };
  const key = organizerAccountInvitationRevokeIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!key.success) return { status: "invalid-request" };
  let body: unknown;
  try { body = await input.readBody(); } catch { return { status: "invalid-request" }; }
  const parsed = organizerAccountInvitationRevokeRequestSchema.safeParse(body);
  if (!parsed.success || parsed.data.invitationId !== input.invitationId ||
    key.data !== `organizer-account-invitation-revoke:${parsed.data.requestId}`) {
    return { status: "invalid-request" };
  }
  const request = parsed.data;
  const reason = request.reason ?? DEFAULT_REVOKE_REASON;
  return db.transaction(async (tx) => {
    const auth = await authenticateUserAccountSessionForMutation(tx,
      { ...input, requireCsrf: true }, revokedAt);
    if (auth.status !== "authenticated") return auth;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${request.requestId}, 0))`);
    const [prior] = await tx.select({ ownerRevocation: schema.eventAccountInvitationRevocations,
      revocation: schema.accountInvitationRevocations })
      .from(schema.eventAccountInvitationRevocations)
      .innerJoin(schema.accountInvitationRevocations,
        eq(schema.accountInvitationRevocations.id, schema.eventAccountInvitationRevocations.revocationId))
      .where(eq(schema.eventAccountInvitationRevocations.requestId, request.requestId));
    if (prior) {
      if (prior.ownerRevocation.actorAccountId !== auth.principal.accountId ||
        prior.ownerRevocation.eventId !== request.eventId ||
        prior.ownerRevocation.invitationId !== request.invitationId ||
        prior.ownerRevocation.reason !== reason) return { status: "conflict" } as const;
      return { status: "revoked", response: revokeResponse({ requestId: request.requestId,
        eventId: request.eventId, invitationId: request.invitationId,
        revokedAt: prior.revocation.revokedAt }, true) } as const;
    }
    const [otherRevocation] = await tx.select({ id: schema.accountInvitationRevocations.id })
      .from(schema.accountInvitationRevocations)
      .where(eq(schema.accountInvitationRevocations.requestId, request.requestId));
    if (otherRevocation) return { status: "conflict" } as const;
    const [event] = await tx.select({ id: schema.events.id }).from(schema.events)
      .where(eq(schema.events.id, request.eventId)).for("update");
    if (!event || !await currentOwner(tx, auth.principal.accountId, event.id, "update")) {
      return { status: "not-found" } as const;
    }
    const [ownerIssue] = await tx.select({ invitationId: schema.eventAccountInvitationIssues.invitationId })
      .from(schema.eventAccountInvitationIssues)
      .where(and(eq(schema.eventAccountInvitationIssues.invitationId, request.invitationId),
        eq(schema.eventAccountInvitationIssues.eventId, event.id)));
    if (!ownerIssue) return { status: "not-found" } as const;
    const raceId = await firstRaceId(tx, event.id);
    if (!raceId) return { status: "conflict" } as const;
    const revokeInput = accountInvitationRevokeInputSchema.parse({
      formatVersion: 1, requestId: request.requestId, invitationId: request.invitationId,
      operatorLabel: operatorLabel(auth.principal.accountId), reason
    });
    const revoked = await revokeAccountInvitationInTransaction(tx, revokeInput, revokedAt);
    if (revoked.status !== "revoked") return revoked;
    const [revocation] = await tx.select({ id: schema.accountInvitationRevocations.id })
      .from(schema.accountInvitationRevocations)
      .where(eq(schema.accountInvitationRevocations.requestId, request.requestId));
    if (!revocation) throw new Error("Kontoinbjudningsspärr saknas efter skrivning");
    await tx.insert(schema.eventAccountInvitationRevocations).values({
      requestId: request.requestId, revocationId: revocation.id,
      invitationId: request.invitationId, eventId: event.id,
      actorAccountId: auth.principal.accountId, reason, createdAt: revokedAt
    });
    await tx.insert(schema.auditEvents).values({
      raceId, entityType: "event_account_invitation_revocation",
      entityId: request.invitationId, action: "EVENT_ACCOUNT_INVITATION_REVOKED_BY_OWNER",
      actorKind: "USER_ACCOUNT", actorId: auth.principal.accountId,
      requestId: request.requestId,
      after: { eventId: event.id, invitationId: request.invitationId,
        reason, revokedAt: revokedAt.toISOString() }
    });
    return { status: "revoked", response: revokeResponse({ requestId: request.requestId,
      eventId: event.id, invitationId: request.invitationId, revokedAt }, false) } as const;
  });
}
