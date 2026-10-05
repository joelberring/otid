import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  racePeopleResponseSchema, racePersonGrantIdempotencyKeySchema, racePersonGrantRequestSchema,
  racePersonGrantResponseSchema, racePersonRevokeIdempotencyKeySchema, racePersonRevokeRequestSchema,
  racePersonRevokeResponseSchema, type RacePeopleResponse, type RacePerson, type RacePersonGrantResponse,
  type RacePersonRevokeResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import {
  authenticatePairingAdminSessionForMutation, authenticatePairingAdminSessionForProtectedRead,
  type PairingAdminPrincipal, type PairingAdminRequestAuthentication
} from "./pairing-admin";

/**
 * Personer med behörighet (ADR-0172 beslut 3): ägaren, administratörer och funktionärer på tävlingens event.
 * Alla administratörer ser listan och lägger till eller tar bort funktionärer; bara ägaren lägger till och tar
 * bort administratörer. Personen måste redan ha ett konto (inga inbjudningar). En borttagning gäller direkt:
 * tävlingssessioner som bygger på behörigheten slutar fungera vid nästa anrop (`authorizeSession`).
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Authentication = Omit<PairingAdminRequestAuthentication, "capability" | "requireCsrf">;
type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" };
type Actor = NonNullable<PairingAdminPrincipal["account"]> & { raceId: string };

const REVOKE_REASON = "Borttagen under Inställningar";

export type RacePeopleResult = Failure | { status: "ok"; response: RacePeopleResponse };
export type RacePersonGrantResult = Failure | { status: "granted"; response: RacePersonGrantResponse };
export type RacePersonRevokeResult = Failure | { status: "revoked"; response: RacePersonRevokeResponse };

function actorOf(principal: PairingAdminPrincipal): Actor | undefined {
  // Bara en session som ett konto öppnat har en person bakom sig; äldre credentials får inte ändra behörigheter.
  if (!principal.account || principal.account.role === "FUNCTIONARY") return undefined;
  return { ...principal.account, raceId: principal.raceId };
}

async function eventOf(tx: Transaction, raceId: string, lock: "share" | "update") {
  const [race] = await tx.select({ eventId: schema.races.eventId }).from(schema.races).where(eq(schema.races.id, raceId));
  if (!race) return undefined;
  const query = tx.select({ id: schema.events.id }).from(schema.events).where(eq(schema.events.id, race.eventId));
  const [event] = lock === "share" ? await query.for("share") : await query.for("update");
  return event;
}

const ROLE_ORDER = { OWNER: 0, ADMIN: 1, FUNCTIONARY: 2 } as const;

async function activePeople(tx: Transaction, eventId: string): Promise<RacePerson[]> {
  const rows = await tx.select({ grantId: schema.eventAdministrationGrants.id, accountId: schema.eventAdministrationGrants.accountId,
    role: schema.eventAdministrationGrants.role, grantedAt: schema.eventAdministrationGrants.grantedAt,
    email: schema.userAccounts.email, displayName: schema.userAccounts.displayName })
    .from(schema.eventAdministrationGrants)
    .innerJoin(schema.userAccounts, eq(schema.userAccounts.id, schema.eventAdministrationGrants.accountId))
    .leftJoin(schema.eventAdministrationGrantRevocations,
      eq(schema.eventAdministrationGrantRevocations.grantId, schema.eventAdministrationGrants.id))
    .where(and(eq(schema.eventAdministrationGrants.eventId, eventId), isNull(schema.eventAdministrationGrantRevocations.id)))
    .orderBy(asc(schema.eventAdministrationGrants.grantedAt), asc(schema.eventAdministrationGrants.id)).limit(10_001);
  if (rows.length > 10_000) throw new Error("För många personer med behörighet");
  return rows.map(row => ({ grantId: row.grantId, accountId: row.accountId, email: row.email, displayName: row.displayName,
    role: row.role, grantedAt: row.grantedAt.toISOString() }))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
}

export async function listRacePeopleAsAdministrator(db: Database, input: Authentication, now = new Date()): Promise<RacePeopleResult> {
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability: "MANAGE_RACE" }, now);
    if (auth.status !== "authenticated") return auth;
    const actor = actorOf(auth.principal);
    if (!actor) return { status: "forbidden" } as const;
    const event = await eventOf(tx, actor.raceId, "share");
    if (!event) return { status: "not-found" } as const;
    return { status: "ok", response: racePeopleResponseSchema.parse({ formatVersion: 1, raceId: actor.raceId,
      viewer: { accountId: actor.accountId, role: actor.role }, people: await activePeople(tx, event.id) }) } as const;
  });
}

async function readBody(read: () => Promise<unknown>): Promise<unknown> {
  try { return await read(); } catch { return undefined; }
}

export async function grantRacePersonAsAdministrator(db: Database,
  input: Authentication & { idempotencyKey: string | null; readBody: () => Promise<unknown> }, now = new Date()): Promise<RacePersonGrantResult> {
  const key = racePersonGrantIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const request = racePersonGrantRequestSchema.safeParse(await readBody(input.readBody));
  if (!key.success || !request.success || key.data !== `race-person-grant:${request.data.requestId}`) return { status: "invalid-request" };
  const intent = request.data;
  const action = intent.role === "ADMIN" ? "GRANT_ADMIN" : "GRANT_FUNCTIONARY";
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, { ...input, capability: "MANAGE_RACE", requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    const actor = actorOf(auth.principal);
    if (!actor) return { status: "forbidden" } as const;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${intent.requestId}, 0))`);
    const event = await eventOf(tx, actor.raceId, "update");
    if (!event) return { status: "not-found" } as const;
    const [existing] = await tx.select().from(schema.eventAdministrationAccessRequests)
      .where(eq(schema.eventAdministrationAccessRequests.requestId, intent.requestId));
    if (existing) {
      const [grant] = await tx.select().from(schema.eventAdministrationGrants).where(eq(schema.eventAdministrationGrants.id, existing.grantId));
      const [target] = await tx.select().from(schema.userAccounts).where(eq(schema.userAccounts.id, existing.targetAccountId));
      if (existing.action !== action || existing.actorAccountId !== actor.accountId || existing.eventId !== event.id ||
        !grant || !target || target.email !== intent.email) return { status: "conflict" } as const;
      return { status: "granted", response: racePersonGrantResponseSchema.parse({ formatVersion: 1, replayed: true,
        requestId: intent.requestId, person: { grantId: grant.id, accountId: target.id, email: target.email,
          displayName: target.displayName, role: grant.role, grantedAt: grant.grantedAt.toISOString() } }) } as const;
    }
    if (intent.role === "ADMIN" && actor.role !== "OWNER") return { status: "forbidden" } as const;
    const [target] = await tx.select().from(schema.userAccounts).where(eq(schema.userAccounts.email, intent.email));
    if (!target || target.blockedAt) return { status: "not-found" } as const;
    if ((await activePeople(tx, event.id)).some(person => person.accountId === target.id)) return { status: "conflict" } as const;
    const [grant] = await tx.insert(schema.eventAdministrationGrants).values({
      eventId: event.id, accountId: target.id, role: intent.role, grantedAt: now }).returning();
    if (!grant) throw new Error("Behörigheten kunde inte sparas");
    await tx.insert(schema.eventAdministrationAccessRequests).values({ requestId: intent.requestId, action,
      actorAccountId: actor.accountId, eventId: event.id, targetAccountId: target.id, grantId: grant.id, reason: null, createdAt: now });
    await tx.insert(schema.auditEvents).values({ raceId: actor.raceId, entityType: "event_administration_grant", entityId: grant.id,
      action: intent.role === "ADMIN" ? "EVENT_ADMIN_GRANTED" : "EVENT_FUNCTIONARY_GRANTED", actorKind: "USER_ACCOUNT",
      actorId: actor.accountId, requestId: intent.requestId,
      after: { eventId: event.id, grantId: grant.id, targetAccountId: target.id, role: intent.role, grantedAt: now.toISOString() } });
    return { status: "granted", response: racePersonGrantResponseSchema.parse({ formatVersion: 1, replayed: false,
      requestId: intent.requestId, person: { grantId: grant.id, accountId: target.id, email: target.email,
        displayName: target.displayName, role: grant.role, grantedAt: now.toISOString() } }) } as const;
  });
}

export async function revokeRacePersonAsAdministrator(db: Database,
  input: Authentication & { idempotencyKey: string | null; readBody: () => Promise<unknown> }, now = new Date()): Promise<RacePersonRevokeResult> {
  const key = racePersonRevokeIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const request = racePersonRevokeRequestSchema.safeParse(await readBody(input.readBody));
  if (!key.success || !request.success || key.data !== `race-person-revoke:${request.data.requestId}`) return { status: "invalid-request" };
  const intent = request.data;
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, { ...input, capability: "MANAGE_RACE", requireCsrf: true }, now);
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
    if (!grant) return { status: "not-found" } as const;
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
