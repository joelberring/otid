import { and, asc, eq, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { localRaceDate, raceFinishedForArchive, swedishToday } from "@o-tid/domain";
import { clubMembership, clubRoleAtLeast } from "./club-access";
import { coursesArePublic } from "./course-secrecy";
import { liftInTransaction, liftOf, lockRaceClubArchive } from "./race-club-archive";
import { autoArchiveDefault, recordAutoArchiveProblem } from "./race-club-archive-auto-state";
import { activeEventAdministrationGrant } from "./race-session";
import type { DbExecutor } from "./snapshot";

/**
 * Ägaren 2026-11-12 (G (i), ADR-0209 tillägg 2026-11-12): den automatiska arkiveringen. Samma inlyft som Lägg i klubbarkivet
 * (`liftInTransaction`) när
 * - tävlingen har en arrangörsklubb med klubbyta och rutan är i (förval: på för en Träning),
 * - den är klar för arkivet (`raceFinishedForArchive`: dagen efter, eller när banorna är publika för att alla har gått i mål
 *   eller fått ett beslut, ADR-0176),
 * - den inte ligger i klubbens arkiv och aldrig har lagts där (`archived_at`, också efter Ta ur).
 *
 * Aktören är en som får göra det för hand (ADR-0209 beslut 8, oförändrat): tävlingens ägare om hen är administratör eller ägare i
 * klubbytan och fortfarande administratör i tävlingen, annars planens ansvarige på samma villkor. Finns ingen sparas `NO_ADMIN`
 * och inget skapas. Arkivposten blir alltså exakt den som aktören hade kunnat göra själv; ingen ny läsrätt.
 *
 * Utlöses efter en sparad avläsning och efter ett beslut (i samma transaktion, i en sparpunkt så att ett fel här aldrig stoppar
 * avläsningen) och av underhållsvarvet en gång i timmen för de senaste två veckornas tävlingar. Låset på tävlingens arkivering
 * och spärren gör det idempotent.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const auto = schema.raceClubArchiveAutos;
/** Underhållsvarvet tittar på tävlingar så här många dagar bakåt, och på högst så här många per varv. */
const MAINTENANCE_DAYS = 14;
const MAINTENANCE_LIMIT = 20;

/** Det billiga villkoret (en indexerad läsning): arrangörsklubbens klubbyta, rutan i, inte i arkivet och aldrig arkiverad. */
async function candidate(tx: DbExecutor, raceId: string) {
  const [row] = await tx.select({ raceType: schema.races.raceType, raceDate: schema.races.raceDate, eventId: schema.races.eventId,
    timeZone: schema.events.timeZone, clubId: schema.clubSettings.clubId, enabled: auto.enabled, archivedAt: auto.archivedAt, problem: auto.problem })
    .from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
    .innerJoin(schema.raceOrganisers, eq(schema.raceOrganisers.raceId, schema.races.id))
    .innerJoin(schema.clubSettings, eq(schema.clubSettings.organisationId, schema.raceOrganisers.organisationId))
    .leftJoin(auto, eq(auto.raceId, schema.races.id)).where(eq(schema.races.id, raceId)).limit(1);
  if (!row || row.archivedAt || !(row.enabled ?? autoArchiveDefault(row.raceType))) return undefined;
  if ((await liftOf(tx, raceId, row.clubId))) return undefined;
  return row;
}

/** Ägaren, annars den ansvarige i planen: den första som är administratör både i tävlingen och i klubbytan. */
async function archiveActor(tx: DbExecutor, input: { raceId: string; eventId: string; clubId: string }): Promise<string | undefined> {
  const owners = await tx.select({ accountId: schema.eventAdministrationGrants.accountId }).from(schema.eventAdministrationGrants)
    .where(and(eq(schema.eventAdministrationGrants.eventId, input.eventId), eq(schema.eventAdministrationGrants.role, "OWNER")))
    .orderBy(asc(schema.eventAdministrationGrants.grantedAt));
  const [planned] = await tx.select({ accountId: schema.clubPlanSessions.responsibleAccountId }).from(schema.clubPlanSessions)
    .where(and(eq(schema.clubPlanSessions.raceId, input.raceId), eq(schema.clubPlanSessions.clubId, input.clubId)))
    .orderBy(asc(schema.clubPlanSessions.createdAt)).limit(1);
  for (const accountId of new Set([...owners.map(row => row.accountId), planned?.accountId].filter((id): id is string => !!id))) {
    const [account] = await tx.select({ blockedAt: schema.userAccounts.blockedAt }).from(schema.userAccounts).where(eq(schema.userAccounts.id, accountId));
    if (!account || account.blockedAt) continue;
    const member = await clubMembership(tx, { accountId, clubId: input.clubId }, "none");
    if (!member || !clubRoleAtLeast(member.role, "ADMIN")) continue;
    if (!await activeEventAdministrationGrant(tx, { accountId, eventId: input.eventId, roles: ["OWNER", "ADMIN"] }, "none")) continue;
    return accountId;
  }
  return undefined;
}

export type AutoArchiveOutcome = "archived" | "none" | "no-admin";

/** Arkiverar tävlingen om villkoren håller; gör annars ingenting. Körs i anroparens transaktion. */
export async function maybeAutoArchive(tx: DbExecutor, raceId: string, now: Date): Promise<AutoArchiveOutcome> {
  const row = await candidate(tx, raceId);
  if (!row) return "none";
  const coursesPublic = await coursesArePublic(tx, raceId);
  if (!raceFinishedForArchive({ raceDate: row.raceDate, today: localRaceDate(now, row.timeZone), coursesPublic })) return "none";
  await lockRaceClubArchive(tx, raceId);
  // Efter låset: en samtidig arkivering (för hand eller automatiskt) har kanske hunnit före.
  if (!await candidate(tx, raceId)) return "none";
  const accountId = await archiveActor(tx, { raceId, eventId: row.eventId, clubId: row.clubId });
  if (!accountId) {
    if (row.problem !== "NO_ADMIN") await recordAutoArchiveProblem(tx, { raceId, problem: "NO_ADMIN", now });
    return "no-admin";
  }
  const lifted = await liftInTransaction(tx, { raceId, clubId: row.clubId, accountId, now, beforeFinished: false, automatic: true });
  return lifted.status === "lifted" ? "archived" : "none";
}

/**
 * Efter en sparad avläsning eller ett beslut, sist i samma transaktion. Det billiga villkoret prövas först; resten körs i en
 * sparpunkt, och ett fel där loggas (utan namn), sparas som `FAILED` och görs om av underhållsvarvet. Avläsningen sparas ändå.
 */
export async function autoArchiveAfterResult(tx: Transaction, raceId: string, now: Date): Promise<void> {
  if (!await candidate(tx, raceId)) return;
  try {
    await tx.transaction(savepoint => maybeAutoArchive(savepoint, raceId, now));
  } catch (error) {
    console.error(`Automatisk arkivering av tävlingen ${raceId} misslyckades: ${error instanceof Error ? error.message : String(error)}`);
    await recordAutoArchiveProblem(tx, { raceId, problem: "FAILED", now });
  }
}

/** Underhållsvarvet: tävlingarna från de senaste två veckorna som ingen läste ut helt (de blir klara dagen efter). */
export async function autoArchiveFinishedRaces(db: Database, now = new Date()): Promise<{ archived: number; noAdmin: number; failed: number }> {
  const today = swedishToday(now);
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - MAINTENANCE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const rows = (await db.execute<{ id: string }>(sql`select r.id from race r
    join race_organiser o on o.race_id = r.id
    join club_setting c on c.organisation_id = o.organisation_id
    left join race_club_archive_auto a on a.race_id = r.id
    where r.race_date >= ${from}::date and r.race_date < ${today}::date
      and a.archived_at is null and coalesce(a.enabled, r.race_type = 'TRAINING')
      and not exists (select 1 from race_club_archive x where x.race_id = r.id and x.club_id = c.club_id)
    order by (a.problem is not null), r.race_date desc, r.id limit ${MAINTENANCE_LIMIT}`)).rows;
  const counts = { archived: 0, noAdmin: 0, failed: 0 };
  for (const { id } of rows) {
    try {
      const outcome = await db.transaction(tx => maybeAutoArchive(tx, id, now));
      if (outcome === "archived") counts.archived += 1;
      if (outcome === "no-admin") counts.noAdmin += 1;
    } catch (error) {
      counts.failed += 1;
      console.error(`Automatisk arkivering av tävlingen ${id} misslyckades: ${error instanceof Error ? error.message : String(error)}`);
      await db.transaction(tx => recordAutoArchiveProblem(tx, { raceId: id, problem: "FAILED", now }));
    }
  }
  return counts;
}
