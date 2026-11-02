import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  racePeopleResponseSchema, racePersonGrantIdempotencyKeySchema, racePersonGrantRequestSchema,
  racePersonGrantResponseSchema, racePersonRevokeIdempotencyKeySchema, racePersonRevokeRequestSchema,
  racePersonRevokeResponseSchema, type RacePeopleResponse, type RacePerson, type RacePersonGrantResponse,
  type RacePersonRevokeResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { requireRaceRole, type RacePrincipal, type RaceSessionProof } from "./race-session";

/**
 * Personer med behörighet (ADR-0172 beslut 3): ägaren, administratörer och funktionärer på tävlingens event.
 * Alla administratörer ser listan och lägger till eller tar bort funktionärer; bara ägaren lägger till och tar
 * bort administratörer. Personen måste redan ha ett konto (inga inbjudningar). En borttagning gäller direkt:
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
const COURSE_LEVELS = { COURSE_EDIT: "EDIT", COURSE_SUGGEST: "SUGGEST", COURSE_COMMENT: "COMMENT", COURSE_MAP: "MAP" } as const;
type CourseRole = keyof typeof COURSE_LEVELS;
const isCourseRole = (role: string): role is CourseRole => role in COURSE_LEVELS;

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
  // ADR-0185: en behörighet från någon annan väntar tills kontots e-postadress är bekräftad (ägarskapet gäller alltid).
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
    return { status: "ok", response: racePeopleResponseSchema.parse({ formatVersion: 1, raceId: actor.raceId,
      viewer: { accountId: actor.accountId, role: actor.role }, people: await activePeople(tx, event.id, actor.raceId) }) } as const;
  });
}

async function readBody(read: () => Promise<unknown>): Promise<unknown> {
  try { return await read(); } catch { return undefined; }
}

export async function grantRacePersonAsAdmin(db: Database,
  input: Authentication & { idempotencyKey: string | null; readBody: () => Promise<unknown> }, now = new Date()): Promise<RacePersonGrantResult> {
  const key = racePersonGrantIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const request = racePersonGrantRequestSchema.safeParse(await readBody(input.readBody));
  if (!key.success || !request.success || key.data !== `race-person-grant:${request.data.requestId}`) return { status: "invalid-request" };
  const intent = request.data;
  const action = intent.role === "ADMIN" ? "GRANT_ADMIN" : "GRANT_FUNCTIONARY";
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN", requireCsrf: true }, now, "update");
    if (auth.status !== "authenticated") return auth;
    const actor = actorOf(auth.principal);
    if (!actor) return { status: "forbidden" } as const;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${intent.requestId}, 0))`);
    const event = await eventOf(tx, actor.raceId, "update");
    if (!event) return { status: "not-found" } as const;
    const role = intent.role;
    if (isCourseRole(role)) return grantCourseSetting(tx, actor, event.id, { requestId: intent.requestId, email: intent.email, role }, now);
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
    if (role === "ADMIN" && actor.role !== "OWNER") return { status: "forbidden" } as const;
    const [target] = await tx.select().from(schema.userAccounts).where(eq(schema.userAccounts.email, intent.email));
    if (!target || target.blockedAt) return { status: "not-found" } as const;
    if ((await activePeople(tx, event.id)).some(person => person.accountId === target.id)) return { status: "conflict" } as const;
    const [grant] = await tx.insert(schema.eventAdministrationGrants).values({
      eventId: event.id, accountId: target.id, role, grantedAt: now }).returning();
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
    if (!grant) return revokeCourseSetting(tx, actor, intent, now);
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

/** Steg 66: behörighet för banläggningen på tävlingen (ett befintligt konto utan behörighet där sedan tidigare). */
async function grantCourseSetting(tx: Transaction, actor: Actor, eventId: string, intent: { requestId: string; email: string; role: CourseRole },
  now: Date): Promise<RacePersonGrantResult> {
  const grants = schema.courseSettingGrants;
  const person = async (grantId: string) => (await courseSetters(tx, actor.raceId)).find(row => row.grantId === grantId);
  const [existing] = await tx.select().from(grants).where(eq(grants.requestId, intent.requestId));
  if (existing) {
    const found = await person(existing.id);
    if (existing.raceId !== actor.raceId || !found || found.email !== intent.email || found.role !== intent.role) return { status: "conflict" };
    return { status: "granted", response: racePersonGrantResponseSchema.parse({ formatVersion: 1, replayed: true, requestId: intent.requestId,
      person: found }) };
  }
  const [target] = await tx.select().from(schema.userAccounts).where(eq(schema.userAccounts.email, intent.email));
  if (!target || target.blockedAt) return { status: "not-found" };
  // Ägare och administratörer har redan EDIT; en person har en banläggningsbehörighet per tävling.
  const people = await activePeople(tx, eventId, actor.raceId);
  if (people.some(row => row.accountId === target.id && (row.role === "OWNER" || row.role === "ADMIN" || isCourseRole(row.role)))) {
    return { status: "conflict" };
  }
  const id = randomUUID();
  await tx.insert(grants).values({ id, raceId: actor.raceId, accountId: target.id, level: COURSE_LEVELS[intent.role], grantedAt: now,
    grantedBy: actor.accountId, requestId: intent.requestId });
  await tx.insert(schema.auditEvents).values({ raceId: actor.raceId, entityType: "course_setting_grant", entityId: id,
    action: "COURSE_SETTING_GRANTED", actorKind: "USER_ACCOUNT", actorId: actor.accountId, requestId: intent.requestId,
    after: { grantId: id, targetAccountId: target.id, level: COURSE_LEVELS[intent.role], grantedAt: now.toISOString() } });
  const found = await person(id);
  if (!found) throw new Error("Behörigheten kunde inte sparas");
  return { status: "granted", response: racePersonGrantResponseSchema.parse({ formatVersion: 1, replayed: false, requestId: intent.requestId,
    person: found }) };
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
