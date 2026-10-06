import { and, eq, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { RocAdapterError, rocClient, type RocFetchResult } from "@o-tid/roc";

/**
 * Hämtning av radiostämplingar (ADR-0172 beslut 5, PLAN.md steg 20). Servern frågar ROC eller OResults med
 * tävlingens `lastId` och sparar de nya stämplingarna och det nya `lastId` i samma transaktion: kraschar
 * servern mellan hämtning och sparande hämtas samma stämplingar igen nästa gång, och mottagningen är
 * idempotent (källa + enhet + stämplings-id, och samma bricka + kontroll + tid). Tjänsten anropas utanför
 * databastransaktioner. Fel sparas som kod och visas i klartext för admin; loggarna har inga bricknummer.
 */

/** Driftens inställningar och (i tester) en egen fetch. */
export interface RadioRuntime {
  /** Bara för test: `OTID_ROC_BASE_URL` ersätter tjänstens ursprung (t.ex. en falsk ROC i Playwright). */
  readonly baseUrl?: string | undefined;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

export function radioRuntimeFromEnvironment(environment: Record<string, string | undefined>): RadioRuntime {
  const baseUrl = environment.OTID_ROC_BASE_URL?.trim();
  return baseUrl ? { baseUrl } : {};
}

export type RadioErrorCode = NonNullable<typeof schema.raceRadioLinks.$inferSelect["lastError"]>;
export type RadioPollOutcome =
  | { status: "fetched"; newPunches: number }
  | { status: "failed"; error: RadioErrorCode }
  | { status: "not-configured" }
  /** Kopplingen ändrades medan hämtningen pågick; svaret gällde den gamla och sparas inte. */
  | { status: "superseded" };

/** Grundintervallet och väntan efter fel: 10 s, sedan 20, 40 och högst 60 s. */
export const RADIO_POLL_INTERVAL_MS = 10_000;
export function radioRetryDelayMs(consecutiveFailures: number): number {
  return consecutiveFailures <= 0 ? RADIO_POLL_INTERVAL_MS : Math.min(60_000, RADIO_POLL_INTERVAL_MS * 2 ** consecutiveFailures);
}

/** Om det är dags att fråga igen (en sekunds marginal för pollerns takt). */
export function radioPollDue(link: { lastAttemptAt: Date | null; consecutiveFailures: number }, now: Date): boolean {
  if (!link.lastAttemptAt) return true;
  return now.getTime() - link.lastAttemptAt.getTime() >= radioRetryDelayMs(link.consecutiveFailures) - 1_000;
}

const INSERT_CHUNK = 500;

async function loadLink(db: Database, raceId: string) {
  const [row] = await db.select({ link: schema.raceRadioLinks, timeZone: schema.events.timeZone })
    .from(schema.raceRadioLinks)
    .innerJoin(schema.races, eq(schema.races.id, schema.raceRadioLinks.raceId))
    .innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
    .where(eq(schema.raceRadioLinks.raceId, raceId));
  return row;
}

async function recordFailure(db: Database, link: typeof schema.raceRadioLinks.$inferSelect, error: RadioErrorCode, now: Date) {
  await db.update(schema.raceRadioLinks).set({ lastAttemptAt: now, lastError: error, lastErrorAt: now,
    consecutiveFailures: sql`${schema.raceRadioLinks.consecutiveFailures} + 1` })
    .where(and(eq(schema.raceRadioLinks.raceId, link.raceId), eq(schema.raceRadioLinks.source, link.source),
      eq(schema.raceRadioLinks.unitId, link.unitId)));
}

/**
 * En hämtning för en tävling: frågar tjänsten med sparat `lastId` och sparar svaret. Används av pollern och
 * av "Hämta nu". Programfel (inte tjänstens fel) kastas vidare.
 */
export async function pollRadioRace(db: Database, raceId: string, runtime: RadioRuntime, now = new Date()): Promise<RadioPollOutcome> {
  const loaded = await loadLink(db, raceId);
  if (!loaded) return { status: "not-configured" };
  const { link, timeZone } = loaded;
  let fetched: RocFetchResult;
  try {
    const client = rocClient({ source: link.source, ...(runtime.baseUrl ? { baseUrl: runtime.baseUrl } : {}),
      ...(runtime.fetch ? { fetch: runtime.fetch } : {}), ...(runtime.timeoutMs ? { timeoutMs: runtime.timeoutMs } : {}) });
    fetched = await client.fetchPunches({ unitId: link.unitId, lastId: link.lastPunchId, timeZone });
  } catch (error) {
    if (!(error instanceof RocAdapterError)) throw error;
    // Ingen tyst hantering: felet sparas och visas för admin, och loggas utan innehåll från tjänsten.
    console.warn(`Radiokontroller: hämtningen misslyckades (lopp ${raceId}, källa ${link.source}, ${error.code})`);
    await recordFailure(db, link, error.code, now);
    return { status: "failed", error: error.code };
  }
  return db.transaction(async tx => {
    const [current] = await tx.select().from(schema.raceRadioLinks).where(eq(schema.raceRadioLinks.raceId, raceId)).for("update");
    if (!current || current.source !== link.source || current.unitId !== link.unitId) return { status: "superseded" } as const;
    let newPunches = 0;
    for (let index = 0; index < fetched.punches.length; index += INSERT_CHUNK) {
      const rows = fetched.punches.slice(index, index + INSERT_CHUNK).map(punch => ({ raceId, source: link.source, unitId: link.unitId,
        punchId: punch.punchId, controlCode: punch.controlCode, cardNumber: punch.cardNumber, punchedAt: new Date(punch.punchedAt),
        localTime: punch.localTime, rawLine: punch.rawLine, receivedAt: now }));
      // Redan sparade (samma id eller samma stämpling) hoppas över: mottagningen är idempotent.
      const inserted = await tx.insert(schema.radioPunches).values(rows).onConflictDoNothing().returning({ id: schema.radioPunches.id });
      newPunches += inserted.length;
    }
    await tx.update(schema.raceRadioLinks).set({
      lastPunchId: Math.max(current.lastPunchId, fetched.highestPunchId ?? 0),
      lastAttemptAt: now, lastSuccessAt: now, lastError: null, lastErrorAt: null, consecutiveFailures: 0,
      malformedLines: Math.min(2_147_483_647, current.malformedLines + fetched.malformedLines)
    }).where(eq(schema.raceRadioLinks.raceId, raceId));
    if (fetched.malformedLines > 0) {
      console.warn(`Radiokontroller: ${fetched.malformedLines} oläsbara rader hoppades över (lopp ${raceId}, svar ${fetched.bodyHash.slice(0, 12)})`);
    }
    return { status: "fetched", newPunches } as const;
  });
}

/**
 * Tävlingar som pollern ska fråga nu: radion påslagen, tävlingsdagen i tävlingens tidszon och dags enligt
 * intervallet (längre väntan efter fel).
 */
export async function listRadioRacesDue(db: Database, now = new Date()): Promise<string[]> {
  const rows = await db.select({ raceId: schema.raceRadioLinks.raceId, lastAttemptAt: schema.raceRadioLinks.lastAttemptAt,
    consecutiveFailures: schema.raceRadioLinks.consecutiveFailures })
    .from(schema.raceRadioLinks)
    .innerJoin(schema.races, eq(schema.races.id, schema.raceRadioLinks.raceId))
    .innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
    .where(and(eq(schema.raceRadioLinks.enabled, true),
      sql`${schema.races.raceDate} = (${now.toISOString()}::timestamptz at time zone ${schema.events.timeZone})::date`));
  return rows.filter(row => radioPollDue(row, now)).map(row => row.raceId);
}
