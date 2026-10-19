import { and, eq, isNotNull, sql } from "drizzle-orm";
import {
  raceSettingsIdempotencyKeySchema, raceSettingsRequestSchema, raceSettingsResponseSchema, type RaceSettingsResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { lockRaceForMutation } from "./concurrency";
import { UUID_PATTERN as uuid } from "./serialization";

type Authentication = RaceSessionProof;
type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" };
export type RaceSettingsResult = Failure | { status: "saved"; response: RaceSettingsResponse };
const MAX_VERSION = 2_147_483_647;

/**
 * Inställningar (ADR-0170 beslut 1): tävlingens namn, loppets namn, datum och tävlingstyp.
 * Sparas direkt med request-id (samma id ger samma kvitto) och ökar tävlingsversionen så att
 * avläsningspaketet hämtas på nytt med de nya namnen. Typen styr bara vad arbetsytan visar:
 * att byta typ tar aldrig bort data. Datumet kan bara ändras så länge loppet saknar fasta
 * starttider och avläsningar, eftersom tiderna tolkas mot loppets datum.
 */
export async function saveRaceSettingsAsAdmin(db: Database, input: Authentication & { idempotencyKey: string | null; request: unknown },
  now = new Date()): Promise<RaceSettingsResult> {
  const parsed = raceSettingsRequestSchema.safeParse(input.request);
  const key = raceSettingsIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!parsed.success || !key.success || key.data !== `race-settings:${parsed.data.requestId}` || !uuid.test(input.raceId)) {
    return { status: "invalid-request" };
  }
  const intent = parsed.data;
  const authentication = { ...input, role: "ADMIN" as const, requireCsrf: true };
  const initial = await requireRaceRole(db, authentication, now);
  if (initial.status !== "authenticated") return initial;
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, authentication, now, "update");
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    const locked = await lockRaceForMutation(tx, raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"race-settings:" + intent.requestId}, 0))`);
    const [prior] = await tx.select().from(schema.raceSettingsRequests).where(eq(schema.raceSettingsRequests.requestId, intent.requestId));
    if (prior) {
      const response = raceSettingsResponseSchema.parse(prior.response);
      if (prior.raceId !== raceId || prior.actorAccountId !== auth.principal.accountId ||
          JSON.stringify(response.request) !== JSON.stringify(intent)) return { status: "conflict" };
      return { status: "saved", response: { ...response, replayed: true } };
    }
    if (locked.snapshotVersion >= MAX_VERSION) return { status: "conflict" };
    const [race] = await tx.select({ eventId: schema.races.eventId, name: schema.races.name, raceDate: schema.races.raceDate,
      raceType: schema.races.raceType, eventName: schema.events.name })
      .from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
      .where(eq(schema.races.id, raceId));
    if (!race) return { status: "not-found" };
    if (race.raceDate !== intent.raceDate) {
      const [fixedStart] = await tx.select({ id: schema.entries.id }).from(schema.entries)
        .where(and(eq(schema.entries.raceId, raceId), isNotNull(schema.entries.fixedStartTime))).limit(1);
      const [readout] = await tx.select({ id: schema.cardReadouts.id }).from(schema.cardReadouts)
        .where(eq(schema.cardReadouts.raceId, raceId)).limit(1);
      if (fixedStart || readout) return { status: "conflict" };
    }
    const snapshotVersionAfter = locked.snapshotVersion + 1;
    await tx.update(schema.races).set({ name: intent.raceName, raceDate: intent.raceDate, raceType: intent.raceType,
      snapshotVersion: snapshotVersionAfter }).where(eq(schema.races.id, raceId));
    // Ett event med ett enda lopp (så skapar kontot tävlingar) får samma namn och startdatum som loppet.
    const [otherRace] = await tx.select({ id: schema.races.id }).from(schema.races)
      .where(and(eq(schema.races.eventId, race.eventId), sql`${schema.races.id} <> ${raceId}`)).limit(1);
    await tx.update(schema.events).set(otherRace ? { name: intent.eventName } : { name: intent.eventName, startsOn: intent.raceDate })
      .where(eq(schema.events.id, race.eventId));
    const response = raceSettingsResponseSchema.parse({ formatVersion: 1, replayed: false, requestId: intent.requestId, raceId,
      request: intent, snapshotVersionAfter, savedAt: now.toISOString() });
    await tx.insert(schema.raceSettingsRequests).values({ requestId: intent.requestId, raceId,
      actorAccountId: auth.principal.accountId,
      request: intent as unknown as Record<string, unknown>, response: response as unknown as Record<string, unknown>, createdAt: now });
    await tx.insert(schema.auditEvents).values({ raceId, entityType: "race", entityId: raceId, requestId: intent.requestId,
      actorKind: "USER_ACCOUNT", actorId: auth.principal.accountId, action: "RACE_SETTINGS_SAVED_BY_ADMIN",
      before: { eventName: race.eventName, raceName: race.name, raceDate: race.raceDate, raceType: race.raceType,
        snapshotVersion: locked.snapshotVersion },
      after: { eventName: intent.eventName, raceName: intent.raceName, raceDate: intent.raceDate, raceType: intent.raceType,
        snapshotVersion: snapshotVersionAfter }, createdAt: now });
    return { status: "saved", response };
  });
}
