import { and, asc, count, desc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import {
  RUNNER_LOOKUP_LIMITS, RUNNER_SEARCH_LIMIT, runnerDatabaseRefreshRequestSchema, runnerDatabaseRefreshResponseSchema,
  runnerDatabaseSettingsResponseSchema, runnerLookupSchema, runnerSearchRequestSchema, runnerSearchResponseSchema,
  type RunnerClub, type RunnerDatabaseRefreshOutcome, type RunnerDatabaseRefreshResponse, type RunnerDatabaseSettingsResponse,
  type RunnerLookup, type RunnerSearchResponse, type RunnerSuggestion
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { EventorAdapterError, type EventorCompetitor, type EventorOrganisationSummary } from "@o-tid/eventor";
import { clientForLink, type EventorRuntime } from "./eventor-link";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import type { DbExecutor } from "./snapshot";

/**
 * Löpardatabasen från Eventor (PLAN.md steg 29). En databas per Eventor-organisation: klubben som tävlingens nyckel
 * tillhör (`race_eventor_link.organisation_id`, satt när nyckeln testats). Varje administratör med en sparad nyckel för
 * klubben kan uppdatera eller radera den; administratörer och funktionärer i klubbens tävlingar får förslag. Ingen
 * publik väg läser tabellerna. Eventor anropas utanför databastransaktionen; uppdateringen ersätter allt i en transaktion.
 *
 * Avläsningspaketet (offline) får den egna klubbens och de tillagda klubbarnas löpare, högst
 * `RUNNER_LOOKUP_LIMITS.runners`. Hela landet söks på servern (`searchRunnerDatabaseAsAdmin`) när nätet finns.
 */
type Authentication = RaceSessionProof;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" };
type RunnerDatabase = typeof schema.runnerDatabases.$inferSelect;

const INSERT_BATCH = 1_000;

/** Klubben som tävlingens Eventor-nyckel tillhör, eller null (ingen nyckel, eller nyckeln inte testad). */
async function raceOrganisation(tx: DbExecutor, raceId: string): Promise<{ id: string; name: string } | null> {
  const [link] = await tx.select({ id: schema.raceEventorLinks.organisationId, name: schema.raceEventorLinks.organisationName,
    ciphertext: schema.raceEventorLinks.ciphertext }).from(schema.raceEventorLinks).where(eq(schema.raceEventorLinks.raceId, raceId));
  return link?.id && link.name && link.ciphertext ? { id: link.id, name: link.name } : null;
}

async function databaseFor(tx: DbExecutor, organisationId: string): Promise<RunnerDatabase | undefined> {
  const [row] = await tx.select().from(schema.runnerDatabases).where(eq(schema.runnerDatabases.eventorOrganisationId, organisationId));
  return row;
}

/** Klubbarna som avläsningspaketet tar med: den egna först, sedan de tillagda. */
function offlineClubIds(database: RunnerDatabase): string[] {
  return [database.eventorOrganisationId, ...database.extraOrganisationIds];
}

async function settings(tx: DbExecutor, raceId: string): Promise<RunnerDatabaseSettingsResponse> {
  const organisation = await raceOrganisation(tx, raceId);
  const database = organisation ? await databaseFor(tx, organisation.id) : undefined;
  let value: RunnerDatabaseSettingsResponse["database"] = null;
  if (database) {
    const [offline] = await tx.select({ value: count() }).from(schema.runnerDatabaseCompetitors)
      .where(and(eq(schema.runnerDatabaseCompetitors.runnerDatabaseId, database.id),
        inArray(schema.runnerDatabaseCompetitors.clubEventorId, offlineClubIds(database))));
    const names = database.extraOrganisationIds.length === 0 ? [] : await tx.select({ id: schema.runnerDatabaseClubs.eventorId,
      name: schema.runnerDatabaseClubs.name }).from(schema.runnerDatabaseClubs).where(and(
      eq(schema.runnerDatabaseClubs.runnerDatabaseId, database.id), inArray(schema.runnerDatabaseClubs.eventorId, database.extraOrganisationIds)));
    const offlineCount = offline?.value ?? 0;
    value = { refreshedAt: database.refreshedAt.toISOString(), competitorCount: database.competitorCount, cardCount: database.cardCount,
      clubCount: database.clubCount, wholeCountry: database.wholeCountry,
      extraClubs: database.extraOrganisationIds.map((id) => ({ id, name: names.find((row) => row.id === id)?.name ?? null })),
      offlineCount: Math.min(offlineCount, RUNNER_LOOKUP_LIMITS.runners), offlineTruncated: offlineCount > RUNNER_LOOKUP_LIMITS.runners };
  }
  return runnerDatabaseSettingsResponseSchema.parse({ formatVersion: 1, raceId, organisation, database: value });
}

export async function getRunnerDatabaseSettingsAsAdmin(db: Database, input: Authentication, now = new Date())
  : Promise<Failure | { status: "ok"; response: RunnerDatabaseSettingsResponse }> {
  return db.transaction(async (tx) => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN" }, now, "share");
    if (auth.status !== "authenticated") return auth;
    return { status: "ok" as const, response: await settings(tx, input.raceId) };
  });
}

function refreshFailure(error: unknown): RunnerDatabaseRefreshOutcome {
  if (!(error instanceof EventorAdapterError)) throw error;
  return error.code === "REJECTED" ? "REJECTED" : error.code === "RESPONSE_TOO_LARGE" ? "TOO_LARGE" : "UNAVAILABLE";
}

/** Löpare med samma Eventor-id slås ihop (brickorna läggs ihop); högst 20 brickor per löpare. */
function uniqueCompetitors(competitors: readonly EventorCompetitor[]): EventorCompetitor[] {
  const byPerson = new Map<string, EventorCompetitor>();
  const anonymous: EventorCompetitor[] = [];
  for (const competitor of competitors) {
    if (!competitor.personId) { anonymous.push(competitor); continue; }
    const earlier = byPerson.get(competitor.personId);
    byPerson.set(competitor.personId, earlier
      ? { ...earlier, cardNumbers: [...new Set([...earlier.cardNumbers, ...competitor.cardNumbers])] } : competitor);
  }
  return [...byPerson.values(), ...anonymous].map((competitor) => competitor.cardNumbers.length > RUNNER_LOOKUP_LIMITS.cardsPerRunner
    ? { ...competitor, cardNumbers: competitor.cardNumbers.slice(0, RUNNER_LOOKUP_LIMITS.cardsPerRunner) } : competitor);
}

/**
 * Hämtar klubbens (och de tillagda klubbarnas, eller hela landets) löpare och Eventors organisationer och ersätter
 * klubbens löpardatabas i en transaktion. Felen från Eventor är lägen; inget sparas då.
 */
export async function refreshRunnerDatabaseAsAdmin(db: Database, input: Authentication & { request: unknown }, runtime: EventorRuntime,
  now = new Date()): Promise<Failure | { status: "ok"; response: RunnerDatabaseRefreshResponse }> {
  const parsed = runnerDatabaseRefreshRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  const preflight = await requireRaceRole(db, { ...input, role: "ADMIN", requireCsrf: true }, now);
  if (preflight.status !== "authenticated") return preflight;
  const reply = async (outcome: RunnerDatabaseRefreshOutcome) => ({ status: "ok" as const,
    response: runnerDatabaseRefreshResponseSchema.parse({ formatVersion: 1, raceId: input.raceId, outcome, settings: await settings(db, input.raceId) }) });
  const organisation = await raceOrganisation(db, input.raceId);
  if (!organisation) return reply("NO_ORGANISATION");
  const extra = parsed.data.extraOrganisationIds.filter((id) => id !== organisation.id);
  const [link] = await db.select().from(schema.raceEventorLinks).where(eq(schema.raceEventorLinks.raceId, input.raceId));
  const client = clientForLink(link, input.raceId, runtime);
  if (client.outcome !== "OK") return reply(client.outcome);
  let organisations: readonly EventorOrganisationSummary[];
  let competitors: EventorCompetitor[];
  try {
    organisations = await client.client.organisations();
    const list = await client.client.competitors(parsed.data.wholeCountry ? { wholeCountry: true }
      : { organisationIds: [organisation.id, ...extra] });
    competitors = uniqueCompetitors(list.competitors);
  } catch (error) {
    return reply(refreshFailure(error));
  }
  return db.transaction(async (tx) => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN", requireCsrf: true }, now, "update");
    if (auth.status !== "authenticated") return auth;
    // Nyckeln kan ha bytts till en annan klubb medan Eventor lästes.
    const current = await raceOrganisation(tx, input.raceId);
    if (current?.id !== organisation.id) {
      return { status: "ok" as const, response: runnerDatabaseRefreshResponseSchema.parse({ formatVersion: 1, raceId: input.raceId,
        outcome: "NO_ORGANISATION", settings: await settings(tx, input.raceId) }) };
    }
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`runner-database:${organisation.id}`}, 0))`);
    const cardCount = competitors.reduce((sum, competitor) => sum + competitor.cardNumbers.length, 0);
    const values = { organisationName: organisation.name, extraOrganisationIds: extra, wholeCountry: parsed.data.wholeCountry,
      competitorCount: competitors.length, cardCount, clubCount: organisations.length, refreshedAt: now };
    const [database] = await tx.insert(schema.runnerDatabases).values({ eventorOrganisationId: organisation.id, ...values })
      .onConflictDoUpdate({ target: schema.runnerDatabases.eventorOrganisationId, set: values })
      .returning({ id: schema.runnerDatabases.id });
    if (!database) throw new Error("Löpardatabasen kunde inte sparas");
    await tx.delete(schema.runnerDatabaseCompetitors).where(eq(schema.runnerDatabaseCompetitors.runnerDatabaseId, database.id));
    await tx.delete(schema.runnerDatabaseClubs).where(eq(schema.runnerDatabaseClubs.runnerDatabaseId, database.id));
    for (let offset = 0; offset < organisations.length; offset += INSERT_BATCH) {
      await tx.insert(schema.runnerDatabaseClubs).values(organisations.slice(offset, offset + INSERT_BATCH).map((club) => ({
        runnerDatabaseId: database.id, eventorId: club.id, name: club.name, shortName: club.shortName ?? null, type: club.type })));
    }
    for (let offset = 0; offset < competitors.length; offset += INSERT_BATCH) {
      await tx.insert(schema.runnerDatabaseCompetitors).values(competitors.slice(offset, offset + INSERT_BATCH).map((competitor) => ({
        runnerDatabaseId: database.id, eventorPersonId: competitor.personId ?? null, givenName: competitor.givenName,
        familyName: competitor.familyName, birthYear: competitor.birthYear ?? null, sex: competitor.sex ?? null,
        clubEventorId: competitor.club?.id ?? null, clubName: competitor.club?.name ?? null, clubShortName: competitor.club?.shortName ?? null,
        cardNumbers: [...competitor.cardNumbers] })));
    }
    // Auditposten har bara antal, aldrig namn eller brickor.
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "runner_database", entityId: database.id,
      action: "RUNNER_DATABASE_REFRESHED", actorKind: "USER_ACCOUNT", actorId: auth.principal.accountId, createdAt: now,
      after: { competitorCount: competitors.length, cardCount, clubCount: organisations.length, wholeCountry: parsed.data.wholeCountry,
        extraOrganisationCount: extra.length } });
    return { status: "ok" as const, response: runnerDatabaseRefreshResponseSchema.parse({ formatVersion: 1, raceId: input.raceId,
      outcome: "REFRESHED", settings: await settings(tx, input.raceId) }) };
  });
}

/** Raderar klubbens löpardatabas (löpare och klubbar följer med). */
export async function deleteRunnerDatabaseAsAdmin(db: Database, input: Authentication, now = new Date())
  : Promise<Failure | { status: "ok"; response: RunnerDatabaseSettingsResponse }> {
  return db.transaction(async (tx) => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN", requireCsrf: true }, now, "update");
    if (auth.status !== "authenticated") return auth;
    const organisation = await raceOrganisation(tx, input.raceId);
    const database = organisation ? await databaseFor(tx, organisation.id) : undefined;
    if (database) {
      await tx.delete(schema.runnerDatabases).where(eq(schema.runnerDatabases.id, database.id));
      await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "runner_database", entityId: database.id,
        action: "RUNNER_DATABASE_DELETED", actorKind: "USER_ACCOUNT", actorId: auth.principal.accountId, createdAt: now,
        before: { competitorCount: database.competitorCount, clubCount: database.clubCount } });
    }
    return { status: "ok" as const, response: await settings(tx, input.raceId) };
  });
}

type CompetitorRow = typeof schema.runnerDatabaseCompetitors.$inferSelect;

function suggestion(row: CompetitorRow): RunnerSuggestion {
  return { ...(row.eventorPersonId ? { personId: row.eventorPersonId } : {}), givenName: row.givenName, familyName: row.familyName,
    ...(row.birthYear !== null ? { birthYear: row.birthYear } : {}), ...(row.sex ? { sex: row.sex } : {}),
    ...(row.clubEventorId ? { clubId: row.clubEventorId } : {}), ...(row.clubName ? { club: row.clubName } : {}), cards: row.cardNumbers };
}

function club(row: typeof schema.runnerDatabaseClubs.$inferSelect): RunnerClub {
  return { id: row.eventorId, name: row.name, ...(row.shortName ? { shortName: row.shortName } : {}), type: row.type };
}

/** Text i ett LIKE-mönster, med jokertecknen skyddade. */
function likePrefix(text: string): string {
  return `${text.toLocaleLowerCase("sv").replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/**
 * Söker i tävlingens klubbs löpardatabas: på bricka, på namn (varje ord måste börja ett för- eller efternamn) eller på
 * klubb. Den egna klubbens löpare kommer först. Administratören och funktionären (avläsningssidan) får söka.
 */
export async function searchRunnerDatabaseAsAdmin(db: Database, input: Authentication & { request: unknown }, now = new Date())
  : Promise<Failure | { status: "ok"; response: RunnerSearchResponse }> {
  const parsed = runnerSearchRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  return db.transaction(async (tx) => {
    const auth = await requireRaceRole(tx, { ...input, role: "FUNCTIONARY" }, now, "share");
    if (auth.status !== "authenticated") return auth;
    const reply = (runners: RunnerSuggestion[], clubs: RunnerClub[]) => ({ status: "ok" as const,
      response: runnerSearchResponseSchema.parse({ formatVersion: 1, raceId: input.raceId, runners, clubs }) });
    const organisation = await raceOrganisation(tx, input.raceId);
    const database = organisation ? await databaseFor(tx, organisation.id) : undefined;
    if (!database) return reply([], []);
    const competitors = schema.runnerDatabaseCompetitors;
    const own = sql`(${competitors.clubEventorId} = ${database.eventorOrganisationId})`;
    const request = parsed.data;
    if (request.kind === "CLUB") {
      const clubs = schema.runnerDatabaseClubs;
      const pattern = likePrefix(request.text);
      const rows = await tx.select().from(clubs).where(and(eq(clubs.runnerDatabaseId, database.id),
        sql`(lower(${clubs.name}) LIKE ${pattern} OR lower(coalesce(${clubs.shortName}, '')) LIKE ${pattern}
          OR lower(${clubs.name}) LIKE ${`% ${pattern}`})`))
        .orderBy(desc(sql`${clubs.type} = 'CLUB'`), asc(clubs.name)).limit(RUNNER_SEARCH_LIMIT);
      return reply([], rows.map(club));
    }
    let condition: SQL;
    if (request.kind === "CARD") condition = sql`${competitors.cardNumbers} @> ARRAY[${request.cardNumber}]::text[]`;
    else {
      const words = request.text.split(/\s+/).filter(Boolean).slice(0, 4);
      condition = and(...words.map((word) => {
        const pattern = likePrefix(word);
        return sql`(lower(${competitors.givenName}) LIKE ${pattern} OR lower(${competitors.familyName}) LIKE ${pattern})`;
      }))!;
    }
    const rows = await tx.select().from(competitors).where(and(eq(competitors.runnerDatabaseId, database.id), condition))
      .orderBy(desc(own), asc(competitors.familyName), asc(competitors.givenName), asc(competitors.id)).limit(RUNNER_SEARCH_LIMIT);
    return reply(rows.map(suggestion), []);
  });
}

/**
 * Avläsningspaketets uppslag: den egna klubbens och de tillagda klubbarnas löpare (den egna först, högst gränsen) och
 * Eventors organisationer (klubbar först). Undefined när tävlingen saknar klubb eller klubben saknar löpardatabas.
 */
export async function loadRunnerLookup(tx: DbExecutor, raceId: string): Promise<RunnerLookup | undefined> {
  const organisation = await raceOrganisation(tx, raceId);
  const database = organisation ? await databaseFor(tx, organisation.id) : undefined;
  if (!database) return undefined;
  const competitors = schema.runnerDatabaseCompetitors;
  const rows = await tx.select().from(competitors).where(and(eq(competitors.runnerDatabaseId, database.id),
    isNotNull(competitors.clubEventorId), inArray(competitors.clubEventorId, offlineClubIds(database))))
    .orderBy(desc(sql`${competitors.clubEventorId} = ${database.eventorOrganisationId}`), asc(competitors.familyName),
      asc(competitors.givenName), asc(competitors.id)).limit(RUNNER_LOOKUP_LIMITS.runners + 1);
  const clubs = schema.runnerDatabaseClubs;
  const clubRows = await tx.select().from(clubs).where(eq(clubs.runnerDatabaseId, database.id))
    .orderBy(desc(sql`${clubs.type} = 'CLUB'`), asc(clubs.name), asc(clubs.eventorId)).limit(RUNNER_LOOKUP_LIMITS.clubs);
  return runnerLookupSchema.parse({ organisationName: database.organisationName, refreshedAt: database.refreshedAt.toISOString(),
    wholeCountryOnServer: database.wholeCountry, truncated: rows.length > RUNNER_LOOKUP_LIMITS.runners,
    clubs: clubRows.map(club), runners: rows.slice(0, RUNNER_LOOKUP_LIMITS.runners).map(suggestion) });
}

/** Deltagare med ett resultat från en avläsning (för förslagen "Koppla brickan till …"). */
export async function loadReadOutEntryIds(tx: DbExecutor | Transaction, raceId: string): Promise<string[]> {
  const rows = await tx.selectDistinct({ entryId: schema.resultRevisions.entryId }).from(schema.resultRevisions)
    .where(and(eq(schema.resultRevisions.raceId, raceId), isNotNull(schema.resultRevisions.readoutId)))
    .orderBy(asc(schema.resultRevisions.entryId));
  return rows.map((row) => row.entryId);
}
