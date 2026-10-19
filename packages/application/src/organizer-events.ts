import { and, asc, eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  organizerEventCreateIdempotencyKeySchema,
  organizerEventCreateRequestSchema,
  organizerEventCreateResponseSchema,
  organizerMyEventsResponseSchema,
  type OrganizerEventCreateResponse,
  type OrganizerMyEventsResponse
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import {
  authenticateUserAccountSessionForMutation,
  authenticateUserAccountSessionForProtectedRead,
  type UserAccountSessionProof
} from "./user-account";
import { activeEventAdministrationGrant, type EventGrantRole } from "./race-session";


export type OrganizerEventCreateResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "conflict" }
  | { status: "created"; response: OrganizerEventCreateResponse };
export type OrganizerMyEventsResult =
  | { status: "unauthorized" | "forbidden" }
  | { status: "ok"; response: OrganizerMyEventsResponse };

export interface OrganizerEventCreateInput extends UserAccountSessionProof {
  idempotencyKey: string | null;
  readBody: () => Promise<unknown>;
}

function validDate(value: Date): Date {
  if (!Number.isFinite(value.getTime())) throw new Error("Ogiltig tidpunkt");
  return value;
}

const ROLE_ORDER: Record<EventGrantRole, number> = { OWNER: 0, ADMIN: 1, FUNCTIONARY: 2 };

function responseFor(row: {
  requestId: string; eventId: string; raceId: string; createdAt: Date;
}, replayed: boolean): OrganizerEventCreateResponse {
  return organizerEventCreateResponseSchema.parse({
    formatVersion: 1, replayed, requestId: row.requestId,
    eventId: row.eventId, raceId: row.raceId, createdAt: row.createdAt.toISOString()
  });
}

/** All owner facts and the request receipt commit together or not at all. */
export async function createOrganizerEvent(
  db: Database,
  input: OrganizerEventCreateInput,
  now = new Date()
): Promise<OrganizerEventCreateResult> {
  const createdAt = validDate(now);
  const idempotencyKey = organizerEventCreateIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!idempotencyKey.success) return { status: "invalid-request" };
  let body: unknown;
  try { body = await input.readBody(); } catch { return { status: "invalid-request" }; }
  const request = organizerEventCreateRequestSchema.safeParse(body);
  if (!request.success) return { status: "invalid-request" };
  const requestId = idempotencyKey.data.slice("organizer-event-create:".length);

  return db.transaction(async (tx) => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...input, requireCsrf: true }, createdAt);
    if (auth.status !== "authenticated") return auth;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [existing] = await tx.select().from(schema.userAccountEventCreationRequests)
      .where(eq(schema.userAccountEventCreationRequests.requestId, requestId));
    if (existing) {
      if (existing.actorAccountId !== auth.principal.accountId ||
        existing.eventName !== request.data.eventName || existing.raceName !== request.data.raceName ||
        existing.raceDate !== request.data.raceDate || existing.timeZone !== request.data.timeZone ||
        existing.raceType !== request.data.raceType) {
        return { status: "conflict" } as const;
      }
      return { status: "created", response: responseFor(existing, true) } as const;
    }
    const [event] = await tx.insert(schema.events).values({
      name: request.data.eventName, startsOn: request.data.raceDate,
      timeZone: request.data.timeZone, createdAt
    }).returning({ id: schema.events.id });
    if (!event) throw new Error("Eventskapandet kunde inte bekräftas");
    const [race] = await tx.insert(schema.races).values({
      eventId: event.id, name: request.data.raceName, raceDate: request.data.raceDate,
      raceType: request.data.raceType, snapshotVersion: 1, createdAt
    }).returning({ id: schema.races.id });
    if (!race) throw new Error("Loppskapandet kunde inte bekräftas");
    await tx.insert(schema.eventAdministrationGrants).values({
      eventId: event.id, accountId: auth.principal.accountId, role: "OWNER", grantedAt: createdAt
    });
    const [journal] = await tx.insert(schema.userAccountEventCreationRequests).values({
      requestId, actorAccountId: auth.principal.accountId,
      eventName: request.data.eventName, raceName: request.data.raceName,
      raceDate: request.data.raceDate, timeZone: request.data.timeZone, raceType: request.data.raceType,
      eventId: event.id, raceId: race.id, createdAt
    }).returning();
    if (!journal) throw new Error("Skapanderequesten kunde inte bekräftas");
    await tx.insert(schema.auditEvents).values({
      raceId: race.id, entityType: "event", entityId: event.id,
      action: "EVENT_CREATED_BY_ACCOUNT", actorKind: "USER_ACCOUNT",
      actorId: auth.principal.accountId, requestId,
      after: {
        eventName: request.data.eventName, raceName: request.data.raceName,
        raceDate: request.data.raceDate, timeZone: request.data.timeZone, raceType: request.data.raceType,
        eventId: event.id, raceId: race.id, snapshotVersion: 1, createdAt: createdAt.toISOString()
      }
    });
    return { status: "created", response: responseFor(journal, false) } as const;
  });
}

/** Mina tävlingar: där kontot är ägare, administratör eller funktionär (ADR-0172 beslut 3). */
export async function listMyEvents(
  db: Database,
  proof: UserAccountSessionProof,
  now = new Date()
): Promise<OrganizerMyEventsResult> {
  return db.transaction(async (tx) => {
    const auth = await authenticateUserAccountSessionForProtectedRead(tx, proof, validDate(now));
    if (auth.status !== "authenticated") return auth;
    const grants = await tx.select({ id: schema.eventAdministrationGrants.id,
      eventId: schema.eventAdministrationGrants.eventId,
      role: schema.eventAdministrationGrants.role })
      .from(schema.eventAdministrationGrants)
      .where(and(eq(schema.eventAdministrationGrants.accountId, auth.principal.accountId),
        inArray(schema.eventAdministrationGrants.role, ["OWNER", "ADMIN", "FUNCTIONARY"])))
      .orderBy(asc(schema.eventAdministrationGrants.grantedAt)).limit(10_001);
    if (grants.length > 10_000) throw new Error("För många administrerade event för detta kontrakt");
    const events: OrganizerMyEventsResponse["events"] = [];
    const eventIndexes = new Map<string, number>();
    for (const grant of grants) {
      if (!await activeEventAdministrationGrant(tx, {
        accountId: auth.principal.accountId, eventId: grant.eventId, grantId: grant.id, roles: [grant.role]
      }, "share")) continue;
      const existingIndex = eventIndexes.get(grant.eventId);
      if (existingIndex !== undefined) {
        const existing = events[existingIndex];
        if (existing && ROLE_ORDER[grant.role] < ROLE_ORDER[existing.role]) existing.role = grant.role;
        continue;
      }
      const [event] = await tx.select({ id: schema.events.id, name: schema.events.name,
        startsOn: schema.events.startsOn, timeZone: schema.events.timeZone })
        .from(schema.events).where(eq(schema.events.id, grant.eventId));
      if (!event) throw new Error("Eventgrant utan event");
      const races = await tx.select({ id: schema.races.id, name: schema.races.name,
        raceDate: schema.races.raceDate, raceType: schema.races.raceType })
        .from(schema.races).where(eq(schema.races.eventId, event.id))
        .orderBy(asc(schema.races.raceDate), asc(schema.races.id)).limit(10_001);
      if (races.length > 10_000) throw new Error("För många lopp för detta kontrakt");
      eventIndexes.set(event.id, events.length);
      events.push({ eventId: event.id, eventName: event.name, startsOn: event.startsOn,
        timeZone: event.timeZone, role: grant.role,
        races: races.map(race => ({ raceId: race.id, raceName: race.name, raceDate: race.raceDate,
          raceType: race.raceType })) });
    }
    return { status: "ok", response: organizerMyEventsResponseSchema.parse({ formatVersion: 1, events }) } as const;
  });
}
