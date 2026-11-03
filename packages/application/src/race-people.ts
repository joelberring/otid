import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  racePeopleResponseSchema, racePersonGrantIdempotencyKeySchema, racePersonGrantRequestSchema,
  racePersonGrantResponseSchema, racePersonRevokeIdempotencyKeySchema, racePersonRevokeRequestSchema,
  racePersonRevokeResponseSchema, type RacePeopleResponse, type RacePerson, type RacePersonGrantResponse,
  type RacePersonRevokeResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { deliverPrepared, invitationSentTimes, prepareIfMail, replayedOutcome, type InvitationMailer,
  type PreparedInvitationMail } from "./invitation-links";
import { requireRaceRole, type RacePrincipal, type RaceSessionProof } from "./race-session";
import { alreadyGranted, hasOpenInvitation, invitationKind, lockInvitationEmail, openRacePersonInvitations,
  revokeRacePersonInvitation } from "./race-person-invitations";

/**
 * Personer med behörighet (ADR-0172 beslut 3): ägaren, administratörer och funktionärer på tävlingens event.
 * Alla administratörer ser listan och lägger till eller tar bort funktionärer; bara ägaren lägger till och tar
 * bort administratörer. ADR-0188 beslut 6: "Lägg till" sparar behörigheten för e-postadressen och svarar likadant
 * oavsett om adressen har ett konto (`race-person-invitations.ts`); den gäller när personen loggar in med adressen
 * och har bekräftat den. En borttagning gäller direkt:
 * kontots adminförfrågningar på tävlingen nekas från nästa anrop (`requireRaceRole`).
 *
 * Steg 66 (ADR-0181 beslut 5): administratörer ger också behörighet för banläggningen på just den här tävlingen
 * (COURSE_EDIT, COURSE_SUGGEST, COURSE_COMMENT, `course_setting_grant`) på samma sätt. Den ger bara banläggningen.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Authentication = RaceSessionProof;
type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" };
type Actor = { accountId: string; grantId: string; role: RacePrincipal["grantRole"]; raceId: string };

const REVOKE_REASON = "Borttagen under Inställningar";

export type RacePeopleResult = Failure | { status: "ok"; response: RacePeopleResponse };
export type RacePersonGrantResult = Failure | { status: "granted"; response: RacePersonGrantResponse };
export type RacePersonRevokeResult = Failure | { status: "revoked"; response: RacePersonRevokeResponse };

function actorOf(principal: RacePrincipal): Actor | undefined {
  if (principal.role !== "ADMIN") return undefined;
  return { accountId: principal.accountId, grantId: principal.grantId, role: principal.grantRole, raceId: principal.raceId };
}

async function eventOf(tx: Transaction, raceId: string, lock: "share" | "update") {
  const [race] = await tx.select({ eventId: schema.races.eventId }).from(schema.races).where(eq(schema.races.id, raceId));
  if (!race) return undefined;
  const query = tx.select({ id: schema.events.id }).from(schema.events).where(eq(schema.events.id, race.eventId));
  const [event] = lock === "share" ? await query.for("share") : await query.for("update");
  return event;
}

const ROLE_ORDER = { OWNER: 0, ADMIN: 1, FUNCTIONARY: 2, COURSE_EDIT: 3, COURSE_SUGGEST: 4, COURSE_COMMENT: 5, COURSE_MAP: 6 } as const;

/** Banläggningens behörigheter på tävlingen. */
async function courseSetters(tx: Transaction, raceId: string): Promise<RacePerson[]> {
  const grants = schema.courseSettingGrants;
  const rows = await tx.select({ grantId: grants.id, accountId: grants.accountId, level: grants.level, grantedAt: grants.grantedAt,
    email: schema.userAccounts.email, displayName: schema.userAccounts.displayName, verifiedAt: schema.userAccounts.emailVerifiedAt })
    .from(grants).innerJoin(schema.userAccounts, eq(schema.userAccounts.id, grants.accountId))
    .where(eq(grants.raceId, raceId)).orderBy(asc(grants.grantedAt), asc(grants.id)).limit(1000);
  return rows.map(row => ({ grantId: row.grantId, accountId: row.accountId, email: row.email, displayName: row.displayName,
    role: `COURSE_${row.level}`, grantedAt: row.grantedAt.toISOString(), ...(row.verifiedAt ? {} : { pendingVerification: true }) }));
}

async function activePeople(tx: Transaction, eventId: string, raceId?: string): Promise<RacePerson[]> {
  const rows = await tx.select({ grantId: schema.eventAdministrationGrants.id, accountId: schema.eventAdministrationGrants.accountId,
    role: schema.eventAdministrationGrants.role, grantedAt: schema.eventAdministrationGrants.grantedAt,
    email: schema.userAccounts.email, displayName: schema.userAccounts.displayName, verifiedAt: schema.userAccounts.emailVerifiedAt })
    .from(schema.eventAdministrationGrants)
    .innerJoin(schema.userAccounts, eq(schema.userAccounts.id, schema.eventAdministrationGrants.accountId))
    .leftJoin(schema.eventAdministrationGrantRevocations,
      eq(schema.eventAdministrationGrantRevocations.grantId, schema.eventAdministrationGrants.id))
    .where(and(eq(schema.eventAdministrationGrants.eventId, eventId), isNull(schema.eventAdministrationGrantRevocations.id)))
    .orderBy(asc(schema.eventAdministrationGrants.grantedAt), asc(schema.eventAdministrationGrants.id)).limit(10_001);
  if (rows.length > 10_000) throw new Error("För många personer med behörighet");
  // ADR-0186: en behörighet från någon annan väntar tills kontots e-postadress är bekräftad (ägarskapet gäller alltid).
  const people: RacePerson[] = rows.map(row => ({ grantId: row.grantId, accountId: row.accountId, email: row.email, displayName: row.displayName,
    role: row.role, grantedAt: row.grantedAt.toISOString(), ...(row.verifiedAt || row.role === "OWNER" ? {} : { pendingVerification: true }) }));
  return [...people, ...(raceId ? await courseSetters(tx, raceId) : [])].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
}

export async function listRacePeopleAsAdmin(db: Database, input: Authentication, now = new Date()): Promise<RacePeopleResult> {
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN" }, now, "share");
    if (auth.status !== "authenticated") return auth;
    const actor = actorOf(auth.principal);
    if (!actor) return { status: "forbidden" } as const;
    const event = await eventOf(tx, actor.raceId, "share");
    if (!event) return { status: "not-found" } as const;
    const open = await openRacePersonInvitations(tx, actor.raceId);
    const sent = await invitationSentTimes(tx, "RACE", open.map(row => row.id));
    const invitations = open.map(row => ({ invitationId: row.id, email: row.email,
      role: row.role, invitedAt: row.createdAt.toISOString(), sentAt: sent.get(row.id)?.toISOString() ?? null }));
    return { status: "ok", response: racePeopleResponseSchema.parse({ formatVersion: 1, raceId: actor.raceId,
      viewer: { accountId: actor.accountId, role: actor.role }, people: await activePeople(tx, event.id, actor.raceId), invitations }) } as const;
  });
}

async function readBody(read: () => Promise<unknown>): Promise<unknown> {
  try { return await read(); } catch { return undefined; }
}

export async function grantRacePersonAsAdmin(db: Database,
  input: Authentication & { idempotencyKey: string | null; readBody: () => Promise<unknown> }, now = new Date(),
  mailer?: InvitationMailer): Promise<RacePersonGrantResult> {
  const key = racePersonGrantIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const request = racePersonGrantRequestSchema.safeParse(await readBody(input.readBody));
  if (!key.success || !request.success || key.data !== `race-person-grant:${request.data.requestId}`) return { status: "invalid-request" };
  const intent = request.data;
  const action = intent.role === "ADMIN" ? "GRANT_ADMIN" : "GRANT_FUNCTIONARY";
  const result = await db.transaction(async (tx): Promise<RacePersonGrantResult & { prepared?: PreparedInvitationMail }> => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN", requireCsrf: true }, now, "update");
    if (auth.status !== "authenticated") return auth;
    const actor = actorOf(auth.principal);
    if (!actor) return { status: "forbidden" } as const;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${intent.requestId}, 0))`);
    const event = await eventOf(tx, actor.raceId, "update");
    if (!event) return { status: "not-found" } as const;
    // ADR-0188 beslut 6: samma svar oavsett om adressen har ett konto. Behörigheten sparas för adressen.
    const invitations = schema.racePersonInvitations;
    const receipt = (row: { id: string; email: string; role: string; createdAt: Date }, replayed: boolean) =>
      racePersonGrantResponseSchema.parse({ formatVersion: 1, replayed, requestId: intent.requestId,
        invitation: { invitationId: row.id, email: row.email, role: row.role, invitedAt: row.createdAt.toISOString() } });
    const [prior] = await tx.select().from(invitations).where(eq(invitations.requestId, intent.requestId));
    if (prior) {
      if (prior.actorAccountId !== actor.accountId || prior.raceId !== actor.raceId || prior.email !== intent.email || prior.role !== intent.role) {
        return { status: "conflict" } as const;
      }
      return { status: "granted", response: receipt(prior, true) } as const;
    }
    // Förfrågningar sparade före ADR-0188 (behörigheten skapades direkt): samma id ger samma kvitto.
    const [legacy] = await tx.select().from(schema.eventAdministrationAccessRequests)
      .where(eq(schema.eventAdministrationAccessRequests.requestId, intent.requestId));
    const [legacyCourse] = legacy ? [] : await tx.select().from(schema.courseSettingGrants).where(eq(schema.courseSettingGrants.requestId, intent.requestId));
    if (legacy || legacyCourse) {
      const grantedAt = legacy?.createdAt ?? legacyCourse!.grantedAt;
      if ((legacy && (legacy.action !== action || legacy.actorAccountId !== actor.accountId || legacy.eventId !== event.id)) ||
        (legacyCourse && legacyCourse.raceId !== actor.raceId)) return { status: "conflict" } as const;
      return { status: "granted", response: receipt({ id: legacy?.grantId ?? legacyCourse!.id, email: intent.email, role: intent.role, createdAt: grantedAt }, true) } as const;
    }
    if (intent.role === "ADMIN" && actor.role !== "OWNER") return { status: "forbidden" } as const;
    await lockInvitationEmail(tx, actor.raceId, intent.email);
    const kind = invitationKind(intent.role);
    if (await hasOpenInvitation(tx, actor.raceId, intent.email, kind) ||
      await alreadyGranted(tx, { eventId: event.id, raceId: actor.raceId, email: intent.email, kind })) return { status: "conflict" } as const;
    const [row] = await tx.insert(invitations).values({ id: randomUUID(), requestId: intent.requestId, raceId: actor.raceId, eventId: event.id,
      email: intent.email, role: intent.role, actorAccountId: actor.accountId, createdAt: now }).returning();
    if (!row) throw new Error("Behörigheten kunde inte sparas");
    await tx.insert(schema.auditEvents).values({ raceId: actor.raceId, entityType: "race_person_invitation", entityId: row.id,
      action: "RACE_PERSON_INVITED", actorKind: "USER_ACCOUNT", actorId: actor.accountId, requestId: intent.requestId,
      after: { invitationId: row.id, role: intent.role, invitedAt: now.toISOString() } });
    // ADR-0206: mejlet går till adressen oavsett om den har ett konto.
    const prepared = await prepareIfMail(tx, mailer, { kind: "RACE", invitationId: row.id }, actor.accountId, now);
    return { status: "granted", response: receipt(row, false), ...(prepared ? { prepared } : {}) } as const;
  });
  if (result.status !== "granted") return result;
  const { prepared, response } = result;
  const mail = response.replayed ? await replayedOutcome(db, { kind: "RACE", invitationId: response.invitation.invitationId })
    : (await deliverPrepared(db, prepared, mailer, now)).outcome;
  return { status: "granted", response: { ...response, mail } };
}

export async function revokeRacePersonAsAdmin(db: Database,
  input: Authentication & { idempotencyKey: string | null; readBody: () => Promise<unknown> }, now = new Date()): Promise<RacePersonRevokeResult> {
  const key = racePersonRevokeIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const request = racePersonRevokeRequestSchema.safeParse(await readBody(input.readBody));
  if (!key.success || !request.success || key.data !== `race-person-revoke:${request.data.requestId}`) return { status: "invalid-request" };
  const intent = request.data;
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN", requireCsrf: true }, now, "update");
    if (auth.status !== "authenticated") return auth;
    const actor = actorOf(auth.principal);
    if (!actor) return { status: "forbidden" } as const;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${intent.requestId}, 0))`);
    const event = await eventOf(tx, actor.raceId, "update");
    if (!event) return { status: "not-found" } as const;
    const [existing] = await tx.select().from(schema.eventAdministrationAccessRequests)
      .where(eq(schema.eventAdministrationAccessRequests.requestId, intent.requestId));
    if (existing) {
      if (!existing.action.startsWith("REVOKE_") || existing.actorAccountId !== actor.accountId || existing.eventId !== event.id ||
        existing.grantId !== intent.grantId) return { status: "conflict" } as const;
      return { status: "revoked", response: racePersonRevokeResponseSchema.parse({ formatVersion: 1, replayed: true,
        requestId: intent.requestId, grantId: intent.grantId, revokedAt: existing.createdAt.toISOString() }) } as const;
    }
    const [grant] = await tx.select().from(schema.eventAdministrationGrants).where(and(
      eq(schema.eventAdministrationGrants.id, intent.grantId), eq(schema.eventAdministrationGrants.eventId, event.id))).for("update");
    if (!grant) {
      // ADR-0188 beslut 6: en sparad behörighet som ännu inte tagits tas bort direkt (en administratör bara av ägaren).
      const [open] = await tx.select({ role: schema.racePersonInvitations.role }).from(schema.racePersonInvitations)
        .where(and(eq(schema.racePersonInvitations.id, intent.grantId), eq(schema.racePersonInvitations.raceId, actor.raceId)));
      if (open?.role === "ADMIN" && actor.role !== "OWNER") return { status: "forbidden" } as const;
      const invitation = open ? await revokeRacePersonInvitation(tx, { raceId: actor.raceId, invitationId: intent.grantId,
        actorAccountId: actor.accountId, requestId: intent.requestId, now }) : undefined;
      if (open && !invitation) return { status: "conflict" } as const;
      if (invitation) {
        return { status: "revoked", response: racePersonRevokeResponseSchema.parse({ formatVersion: 1, replayed: false,
          requestId: intent.requestId, grantId: invitation.id, revokedAt: now.toISOString() }) } as const;
      }
      return revokeCourseSetting(tx, actor, intent, now);
    }
    const [prior] = await tx.select({ id: schema.eventAdministrationGrantRevocations.id }).from(schema.eventAdministrationGrantRevocations)
      .where(eq(schema.eventAdministrationGrantRevocations.grantId, grant.id));
    if (prior) return { status: "conflict" } as const;
    // Ägaren tas aldrig bort här; administratörer bara av ägaren.
    if (grant.role === "OWNER" || (grant.role === "ADMIN" && actor.role !== "OWNER")) return { status: "forbidden" } as const;
    await tx.insert(schema.eventAdministrationGrantRevocations).values({ id: randomUUID(), grantId: grant.id, revokedAt: now, reason: REVOKE_REASON });
    await tx.insert(schema.eventAdministrationAccessRequests).values({ requestId: intent.requestId,
      action: grant.role === "ADMIN" ? "REVOKE_ADMIN" : "REVOKE_FUNCTIONARY", actorAccountId: actor.accountId,
      eventId: event.id, targetAccountId: grant.accountId, grantId: grant.id, reason: REVOKE_REASON, createdAt: now });
    await tx.insert(schema.auditEvents).values({ raceId: actor.raceId, entityType: "event_administration_grant", entityId: grant.id,
      action: grant.role === "ADMIN" ? "EVENT_ADMIN_REVOKED" : "EVENT_FUNCTIONARY_REVOKED", actorKind: "USER_ACCOUNT",
      actorId: actor.accountId, requestId: intent.requestId,
      after: { eventId: event.id, grantId: grant.id, targetAccountId: grant.accountId, role: grant.role, revokedAt: now.toISOString() } });
    return { status: "revoked", response: racePersonRevokeResponseSchema.parse({ formatVersion: 1, replayed: false,
      requestId: intent.requestId, grantId: grant.id, revokedAt: now.toISOString() }) } as const;
  });
}

async function revokeCourseSetting(tx: Transaction, actor: Actor, intent: { requestId: string; grantId: string }, now: Date)
  : Promise<RacePersonRevokeResult> {
  const [prior] = await tx.select({ entityId: schema.auditEvents.entityId, createdAt: schema.auditEvents.createdAt }).from(schema.auditEvents)
    .where(and(eq(schema.auditEvents.requestId, intent.requestId), eq(schema.auditEvents.action, "COURSE_SETTING_REVOKED"),
      eq(schema.auditEvents.raceId, actor.raceId)));
  if (prior) {
    if (prior.entityId !== intent.grantId) return { status: "conflict" };
    return { status: "revoked", response: racePersonRevokeResponseSchema.parse({ formatVersion: 1, replayed: true, requestId: intent.requestId,
      grantId: intent.grantId, revokedAt: prior.createdAt.toISOString() }) };
  }
  const grants = schema.courseSettingGrants;
  const [grant] = await tx.delete(grants).where(and(eq(grants.id, intent.grantId), eq(grants.raceId, actor.raceId))).returning();
  if (!grant) return { status: "not-found" };
  await tx.insert(schema.auditEvents).values({ raceId: actor.raceId, entityType: "course_setting_grant", entityId: grant.id,
    action: "COURSE_SETTING_REVOKED", actorKind: "USER_ACCOUNT", actorId: actor.accountId, requestId: intent.requestId, createdAt: now,
    after: { grantId: grant.id, targetAccountId: grant.accountId, level: grant.level, revokedAt: now.toISOString() } });
  return { status: "revoked", response: racePersonRevokeResponseSchema.parse({ formatVersion: 1, replayed: false, requestId: intent.requestId,
    grantId: grant.id, revokedAt: now.toISOString() }) };
}
