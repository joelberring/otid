import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { clubSearchText } from "@o-tid/domain";
import { EventorAdapterError, eventorClient, isPlausibleEventorApiKey } from "@o-tid/eventor";
import { configured, confirmViaEventor, memberEmailHash, type Configured } from "./club-affiliation-access";
import { clubJournal, requireClubRole, type ClubFailure, type ClubProof } from "./club-access";
import { openEventorApiKey, sealEventorApiKey, type EventorServerConfiguration } from "./eventor-secret";
export { applyEventorMemberships, memberEmailHash } from "./club-affiliation-access";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0209 beslut A–B: klubbarkivets koppling till Eventor med klubbens egen API-nyckel (som bara en administratör i Eventor
 * kan skapa) och medlemslistan därifrån.
 *
 * - "Koppla till Eventor": servern frågar `GET /api/organisation/apiKey` med nyckeln och får klubben som nyckeln tillhör. Det är
 *   den bevisade kopplingen. Nyckeln sparas krypterad (AES-256-GCM med `OTID_EVENTOR_MASTER_KEY`, bunden till klubbarkivet) och
 *   når aldrig webbläsaren igen; bara de sista fyra tecknen visas. En klubb i Eventor hör till högst ett klubbarkiv.
 * - Medlemslistan (`GET /api/persons/organisations/{id}?includeContactDetails=true`) hämtas automatiskt högst en gång per dygn och
 *   med "Hämta medlemmar nu" (högst en gång i timmen). Bara Eventors person-id och en nyckelad hash (HMAC-SHA256 med en nyckel
 *   härledd ur masternyckeln) av varje normaliserad e-postadress sparas; allt annat lämnas redan i tolkningen.
 * - Ett konto med bekräftad adress vars hash finns i listan blir bekräftad medlem ("bekräftad via Eventor") när listan hämtas,
 *   när kontot öppnar Mina tävlingar eller klubben (efter inloggning och bekräftad adress). Slutar personen i klubben tar nästa
 *   hämtning bort det som Eventor gav; bekräftelser för hand står kvar.
 */
const SYNC_INTERVAL_MS = 24 * 3_600_000;
const MANUAL_INTERVAL_MS = 3_600_000;
const memberships = schema.accountClubMemberships;

export type ClubEventorProblem = "NOT_CONFIGURED" | "INVALID_KEY" | "REJECTED" | "UNAVAILABLE" | "ALREADY_LINKED" | "TOO_SOON" | "NOT_LINKED";

const keyContext = (clubId: string, keyId: string) => ({ raceId: `club:${clubId}`, keyId });

function problemOf(error: unknown): ClubEventorProblem {
  if (error instanceof EventorAdapterError) return error.code === "REJECTED" || error.code === "NOT_FOUND" ? "REJECTED" : "UNAVAILABLE";
  throw error;
}

// --- Kopplingen ----------------------------------------------------------------------------------------------------------------

export type ClubEventorLinkResult = ClubFailure | { status: "problem"; problem: ClubEventorProblem }
  | { status: "linked"; organisationName: string; renamed: boolean };

/** Användartestet 2026-11-12 (F): klubbytan får klubbens namn i Eventor (journalfört). Sant om namnet ändrades. */
async function renameToOrganisation(tx: DbExecutor, input: { clubId: string; name: string; actorId: string; now: Date }): Promise<boolean> {
  const name = input.name.trim().slice(0, 120);
  const [club] = await tx.select({ name: schema.clubs.name }).from(schema.clubs).where(eq(schema.clubs.id, input.clubId)).for("update");
  if (!club || !name || club.name === name) return false;
  await tx.update(schema.clubs).set({ name }).where(eq(schema.clubs.id, input.clubId));
  await clubJournal(tx, { clubId: input.clubId, action: "CLUB_RENAMED", actorAccountId: input.actorId, details: { from: club.name, to: name }, now: input.now });
  return true;
}

/** "Byt namn till … (Eventor)": en kopplad klubbyta får den kopplade klubbens namn. Ägare och administratörer. */
export async function renameClubToEventor(db: Database, input: ClubProof & { clubId: string }, now = new Date())
  : Promise<ClubFailure | { status: "problem"; problem: "NOT_LINKED" } | { status: "renamed"; name: string }> {
  return db.transaction(async tx => {
    const actor = await requireClubRole(tx, input, "ADMIN", now, true);
    if (actor.status !== "ok") return actor;
    const [linked] = await tx.select({ name: schema.organisations.name }).from(schema.clubSettings)
      .innerJoin(schema.organisations, eq(schema.organisations.id, schema.clubSettings.organisationId))
      .where(and(eq(schema.clubSettings.clubId, input.clubId), isNotNull(schema.clubSettings.eventorKeyCiphertext)));
    if (!linked) return { status: "problem", problem: "NOT_LINKED" } as const;
    await renameToOrganisation(tx, { clubId: input.clubId, name: linked.name, actorId: actor.accountId, now });
    return { status: "renamed", name: linked.name.trim().slice(0, 120) } as const;
  });
}

/** "Koppla till Eventor" eller "Byt nyckel". Svaret säger bara klubben; nyckeln skickas aldrig tillbaka. */
export async function linkClubToEventor(db: Database, input: ClubProof & { clubId: string; apiKey: string; rename?: boolean | undefined;
  configuration?: EventorServerConfiguration; fetch?: typeof fetch }, now = new Date()): Promise<ClubEventorLinkResult> {
  // Behörigheten först (städrundan 2026-11-07): utloggad får 401 och den som inte är administratör 403/404, inte 422.
  const before = await db.transaction(tx => requireClubRole(tx, input, "ADMIN", now, true));
  if (before.status !== "ok") return before;
  const config = configured(input.configuration);
  if (!config) return { status: "problem", problem: "NOT_CONFIGURED" };
  const apiKey = input.apiKey.trim();
  if (!isPlausibleEventorApiKey(apiKey)) return { status: "problem", problem: "INVALID_KEY" };
  let organisation: { id: string; name: string };
  try {
    organisation = await eventorClient({ apiKey, ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}), ...(input.fetch ? { fetch: input.fetch } : {}) })
      .organisation();
  } catch (error) { return { status: "problem", problem: problemOf(error) }; }
  const linked = await db.transaction(async tx => {
    const actor = await requireClubRole(tx, input, "ADMIN", now, true);
    if (actor.status !== "ok") return actor;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`club-eventor:${organisation.id}`}, 0))`);
    const organisationId = await directoryOrganisation(tx, organisation, now);
    const [taken] = await tx.select({ clubId: schema.clubSettings.clubId }).from(schema.clubSettings)
      .where(and(eq(schema.clubSettings.organisationId, organisationId), sql`${schema.clubSettings.clubId} <> ${input.clubId}`));
    if (taken) return { status: "problem", problem: "ALREADY_LINKED" } as const;
    const [prior] = await tx.select({ organisationId: schema.clubSettings.organisationId }).from(schema.clubSettings)
      .where(eq(schema.clubSettings.clubId, input.clubId)).for("update");
    const sealed = sealEventorApiKey(apiKey, keyContext(input.clubId, config.keyId), config.masterKey);
    const values = { organisationId, eventorKeyId: sealed.keyId, eventorKeyIv: sealed.iv, eventorKeyTag: sealed.tag,
      eventorKeyCiphertext: sealed.ciphertext, eventorKeyHint: apiKey.slice(-4), linkedBy: actor.accountId, linkedAt: now,
      updatedBy: actor.accountId, updatedAt: now };
    await tx.insert(schema.clubSettings).values({ clubId: input.clubId, ...values })
      .onConflictDoUpdate({ target: schema.clubSettings.clubId, set: values });
    if (prior?.organisationId && prior.organisationId !== organisationId) await forgetEventorMembers(tx, input.clubId, now);
    await clubJournal(tx, { clubId: input.clubId, action: prior?.organisationId === organisationId ? "CLUB_EVENTOR_KEY_REPLACED" : "CLUB_EVENTOR_LINKED",
      actorAccountId: actor.accountId, details: { eventorOrganisationId: organisation.id }, now });
    const renamed = input.rename ? await renameToOrganisation(tx, { clubId: input.clubId, name: organisation.name, actorId: actor.accountId, now }) : false;
    return { status: "linked", organisationName: organisation.name, renamed } as const;
  });
  if (linked.status === "linked") {
    // Medlemslistan direkt; ett fel här ändrar inte kopplingen (det syns i "Senast hämtad").
    await syncClubEventorMembers(db, { clubId: input.clubId, configuration: config, ...(input.fetch ? { fetch: input.fetch } : {}) }, now);
  }
  return linked;
}

/** Klubben i listan (läggs till ur nyckelns svar om listan inte är hämtad än). */
async function directoryOrganisation(tx: DbExecutor, organisation: { id: string; name: string }, now: Date): Promise<string> {
  const [row] = await tx.select({ id: schema.organisations.id }).from(schema.organisations).where(eq(schema.organisations.eventorId, organisation.id));
  if (row) return row.id;
  const id = randomUUID();
  await tx.insert(schema.organisations).values({ id, eventorId: organisation.id, name: organisation.name.slice(0, 200), shortName: null, type: "CLUB",
    parentEventorId: null, country: null, searchText: clubSearchText(organisation.name), removedAt: null, updatedAt: now });
  return id;
}

/** "Ta bort kopplingen": nyckeln, medlemslistan och det som Eventor gav tas bort. Bekräftelser för hand står kvar. */
export async function unlinkClubFromEventor(db: Database, input: ClubProof & { clubId: string }, now = new Date())
  : Promise<ClubFailure | { status: "unlinked" }> {
  return db.transaction(async tx => {
    const actor = await requireClubRole(tx, input, "ADMIN", now, true);
    if (actor.status !== "ok") return actor;
    const [row] = await tx.update(schema.clubSettings).set({ organisationId: null, eventorKeyId: null, eventorKeyIv: null, eventorKeyTag: null,
      eventorKeyCiphertext: null, eventorKeyHint: null, linkedBy: null, linkedAt: null, updatedBy: actor.accountId, updatedAt: now })
      .where(and(eq(schema.clubSettings.clubId, input.clubId), isNotNull(schema.clubSettings.organisationId))).returning({ clubId: schema.clubSettings.clubId });
    if (!row) return { status: "not-found" } as const;
    await forgetEventorMembers(tx, input.clubId, now);
    await clubJournal(tx, { clubId: input.clubId, action: "CLUB_EVENTOR_UNLINKED", actorAccountId: actor.accountId, details: {}, now });
    return { status: "unlinked" } as const;
  });
}

/**
 * Superadmin (`node superadmin.mjs clubs unlink <eventor-id>`): kopplingen tas bort från klubbytan som har klubben, t.ex. när
 * fel klubbyta har kopplats och dess ägare inte svarar. Samma följder som "Ta bort kopplingen"; journalförs utan konto.
 */
export async function unlinkOrganisationByCommand(db: Database, eventorId: string, now = new Date()): Promise<"unlinked" | "not-linked"> {
  return db.transaction(async tx => {
    const [row] = await tx.select({ clubId: schema.clubSettings.clubId }).from(schema.clubSettings)
      .innerJoin(schema.organisations, eq(schema.organisations.id, schema.clubSettings.organisationId))
      .where(eq(schema.organisations.eventorId, eventorId)).for("update");
    if (!row) return "not-linked" as const;
    await tx.update(schema.clubSettings).set({ organisationId: null, eventorKeyId: null, eventorKeyIv: null, eventorKeyTag: null,
      eventorKeyCiphertext: null, eventorKeyHint: null, linkedBy: null, linkedAt: null, updatedAt: now }).where(eq(schema.clubSettings.clubId, row.clubId));
    await forgetEventorMembers(tx, row.clubId, now);
    await clubJournal(tx, { clubId: row.clubId, action: "CLUB_EVENTOR_UNLINKED_BY_COMMAND", actorAccountId: null, details: { eventorId }, now });
    return "unlinked" as const;
  });
}

async function forgetEventorMembers(tx: DbExecutor, clubId: string, now: Date): Promise<void> {
  await tx.delete(schema.clubEventorMembers).where(eq(schema.clubEventorMembers.clubId, clubId));
  await tx.delete(schema.clubEventorSyncs).where(eq(schema.clubEventorSyncs.clubId, clubId));
  await withdrawEventorConfirmations(tx, clubId, null, now);
}

/**
 * Tar tillbaka det som Eventor gav i arkivet (för alla, eller för konton som inte längre finns i listan): rader som listan
 * skapade tas bort, egna anmälningar blir väntande igen. Journalförs per konto. `keep` har listans hashar och konfigurationen
 * som de räknades med (ändrat 2026-11-07: förut lästes den ur miljön, och utan masternyckeln där togs alla bekräftelser bort).
 */
async function withdrawEventorConfirmations(tx: DbExecutor, clubId: string, keep: { hashes: ReadonlySet<string>; config: Configured } | null,
  now: Date): Promise<number> {
  const rows = await tx.select({ id: memberships.id, accountId: memberships.accountId, origin: memberships.origin, email: schema.userAccounts.email })
    .from(memberships).innerJoin(schema.userAccounts, eq(schema.userAccounts.id, memberships.accountId))
    .where(and(eq(memberships.clubId, clubId), eq(memberships.status, "CONFIRMED"), eq(memberships.confirmedVia, "EVENTOR")));
  let withdrawn = 0;
  for (const row of rows) {
    if (keep && keep.hashes.has(memberEmailHash(keep.config, row.email))) continue;
    if (row.origin === "EVENTOR") await tx.delete(memberships).where(eq(memberships.id, row.id));
    else await tx.update(memberships).set({ status: "PENDING", clubId: null, confirmedVia: null, decidedBy: null, decidedAt: null }).where(eq(memberships.id, row.id));
    await clubJournal(tx, { clubId, action: "CLUB_AFFILIATION_WITHDRAWN_BY_EVENTOR", actorAccountId: null, details: { membershipId: row.id,
      accountId: row.accountId }, now });
    withdrawn += 1;
  }
  return withdrawn;
}

// --- Medlemslistan -------------------------------------------------------------------------------------------------------------

export type ClubEventorSyncResult = { status: "problem"; problem: ClubEventorProblem }
  | { status: "synced"; members: number; confirmed: number; withdrawn: number };

/** Hämtar medlemslistan och bekräftar och tar bort. Anropas av kopplingen, "Hämta medlemmar nu" och underhållet. */
export async function syncClubEventorMembers(db: Database, input: { clubId: string; configuration?: EventorServerConfiguration;
  fetch?: typeof fetch; minimumIntervalMs?: number }, now = new Date()): Promise<ClubEventorSyncResult> {
  const config = configured(input.configuration);
  if (!config) return { status: "problem", problem: "NOT_CONFIGURED" };
  const [setting] = await db.select().from(schema.clubSettings).where(eq(schema.clubSettings.clubId, input.clubId));
  if (!setting?.organisationId || !setting.eventorKeyCiphertext) return { status: "problem", problem: "NOT_LINKED" };
  const [organisation] = await db.select({ eventorId: schema.organisations.eventorId }).from(schema.organisations)
    .where(eq(schema.organisations.id, setting.organisationId));
  const [last] = await db.select().from(schema.clubEventorSyncs).where(eq(schema.clubEventorSyncs.clubId, input.clubId));
  if (last && input.minimumIntervalMs && now.getTime() - last.attemptedAt.getTime() < input.minimumIntervalMs) return { status: "problem", problem: "TOO_SOON" };
  let apiKey: string;
  try {
    apiKey = openEventorApiKey({ keyId: setting.eventorKeyId!, iv: setting.eventorKeyIv!, tag: setting.eventorKeyTag!,
      ciphertext: setting.eventorKeyCiphertext }, keyContext(input.clubId, config.keyId), config.masterKey);
  } catch {
    await recordAttempt(db, input.clubId, now, "INVALID_KEY");
    return { status: "problem", problem: "INVALID_KEY" };
  }
  let members;
  try {
    members = await eventorClient({ apiKey, ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}), ...(input.fetch ? { fetch: input.fetch } : {}) })
      .organisationMembers(organisation!.eventorId, email => memberEmailHash(config, email));
  } catch (error) {
    const problem = problemOf(error);
    await recordAttempt(db, input.clubId, now, problem);
    return { status: "problem", problem };
  }
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`club-eventor-sync:${input.clubId}`}, 0))`);
    await tx.delete(schema.clubEventorMembers).where(eq(schema.clubEventorMembers.clubId, input.clubId));
    const rows = new Map<string, string>();
    for (const member of members) for (const hash of member.emailHashes) if (!rows.has(hash)) rows.set(hash, member.personId);
    const values = [...rows].map(([emailHmac, eventorPersonId]) => ({ clubId: input.clubId, emailHmac, eventorPersonId, keyId: config.keyId }));
    for (let at = 0; at < values.length; at += 1000) await tx.insert(schema.clubEventorMembers).values(values.slice(at, at + 1000));
    const withdrawn = await withdrawEventorConfirmations(tx, input.clubId, { hashes: new Set(rows.keys()), config }, now);
    const confirmed = await confirmMatchingAccounts(tx, { clubId: input.clubId, organisationId: setting.organisationId!, hashes: new Set(rows.keys()),
      config, now });
    await tx.insert(schema.clubEventorSyncs).values({ clubId: input.clubId, attemptedAt: now, syncedAt: now, members: members.length, problem: null })
      .onConflictDoUpdate({ target: schema.clubEventorSyncs.clubId, set: { attemptedAt: now, syncedAt: now, members: members.length, problem: null } });
    await clubJournal(tx, { clubId: input.clubId, action: "CLUB_EVENTOR_SYNCED", actorAccountId: null,
      details: { members: members.length, confirmed, withdrawn }, now });
    return { status: "synced", members: members.length, confirmed, withdrawn } as const;
  });
}

async function recordAttempt(db: Database, clubId: string, now: Date, problem: string): Promise<void> {
  await db.insert(schema.clubEventorSyncs).values({ clubId, attemptedAt: now, syncedAt: null, members: 0, problem })
    .onConflictDoUpdate({ target: schema.clubEventorSyncs.clubId, set: { attemptedAt: now, problem } });
}

/** Konton med bekräftad adress vars hash finns i listan (sökningen görs per konto: adresserna hashas med serverns nyckel). */
async function confirmMatchingAccounts(tx: DbExecutor, input: { clubId: string; organisationId: string; hashes: ReadonlySet<string>;
  config: Configured; now: Date }): Promise<number> {
  if (input.hashes.size === 0) return 0;
  const accounts = await tx.select({ id: schema.userAccounts.id, email: schema.userAccounts.email }).from(schema.userAccounts)
    .where(and(isNotNull(schema.userAccounts.emailVerifiedAt), isNull(schema.userAccounts.blockedAt)));
  let confirmed = 0;
  for (const account of accounts) {
    if (!input.hashes.has(memberEmailHash(input.config, account.email))) continue;
    if (await confirmViaEventor(tx, { accountId: account.id, clubId: input.clubId, organisationId: input.organisationId, now: input.now })) confirmed += 1;
  }
  return confirmed;
}

/** "Hämta medlemmar nu": administratörer, högst en gång i timmen. */
export async function syncClubEventorMembersAsAdmin(db: Database, input: ClubProof & { clubId: string; configuration?: EventorServerConfiguration;
  fetch?: typeof fetch }, now = new Date()): Promise<ClubFailure | ClubEventorSyncResult> {
  const actor = await db.transaction(tx => requireClubRole(tx, input, "ADMIN", now, true));
  if (actor.status !== "ok") return actor;
  return syncClubEventorMembers(db, { clubId: input.clubId, ...(input.configuration ? { configuration: input.configuration } : {}),
    ...(input.fetch ? { fetch: input.fetch } : {}), minimumIntervalMs: MANUAL_INTERVAL_MS }, now);
}

/** Underhållet: kopplade klubbar vars lista är äldre än ett dygn (eller aldrig hämtad), högst tio per varv. */
export async function syncDueClubEventorMembers(db: Database, now = new Date(), configuration?: EventorServerConfiguration)
  : Promise<{ synced: number; failed: number }> {
  if (!configured(configuration)) return { synced: 0, failed: 0 };
  const due = await db.select({ clubId: schema.clubSettings.clubId }).from(schema.clubSettings)
    .leftJoin(schema.clubEventorSyncs, eq(schema.clubEventorSyncs.clubId, schema.clubSettings.clubId))
    .where(and(isNotNull(schema.clubSettings.organisationId), or(isNull(schema.clubEventorSyncs.attemptedAt),
      lt(schema.clubEventorSyncs.attemptedAt, new Date(now.getTime() - SYNC_INTERVAL_MS))))).limit(10);
  let synced = 0, failed = 0;
  for (const { clubId } of due) {
    const result = await syncClubEventorMembers(db, { clubId, ...(configuration ? { configuration } : {}) }, now);
    if (result.status === "synced") synced += 1; else failed += 1;
  }
  return { synced, failed };
}

/** En lagrad klubbnyckel (för att hämta klubblistan när driften inte har satt `OTID_EVENTOR_API_KEY`). */
export async function anyStoredClubEventorKey(db: Database, configuration?: EventorServerConfiguration): Promise<string | undefined> {
  const config = configured(configuration);
  if (!config) return undefined;
  const rows = await db.select().from(schema.clubSettings).where(and(isNotNull(schema.clubSettings.eventorKeyCiphertext),
    eq(schema.clubSettings.eventorKeyId, config.keyId))).limit(5);
  for (const row of rows) {
    try {
      return openEventorApiKey({ keyId: row.eventorKeyId!, iv: row.eventorKeyIv!, tag: row.eventorKeyTag!, ciphertext: row.eventorKeyCiphertext! },
        keyContext(row.clubId, config.keyId), config.masterKey);
    } catch { continue; } // En nyckel sparad med en annan masternyckel går inte att läsa; nästa provas.
  }
  return undefined;
}

/** Siffrorna som administratören ser: medlemmar i Eventor och hur många av dem som har O-Tid och är bekräftade. */
export async function clubEventorStatus(tx: DbExecutor, clubId: string) {
  const [setting] = await tx.select({ organisationId: schema.clubSettings.organisationId, hint: schema.clubSettings.eventorKeyHint,
    linkedAt: schema.clubSettings.linkedAt }).from(schema.clubSettings).where(eq(schema.clubSettings.clubId, clubId));
  const [sync] = await tx.select().from(schema.clubEventorSyncs).where(eq(schema.clubEventorSyncs.clubId, clubId));
  const [viaEventor] = (await tx.execute<{ count: string }>(sql`select count(*)::text as count from account_club_membership
    where club_id = ${clubId} and status = 'CONFIRMED' and confirmed_via = 'EVENTOR'`)).rows;
  return { linked: !!setting?.organisationId, keyHint: setting?.hint ?? null, linkedAt: setting?.linkedAt?.toISOString() ?? null,
    members: sync?.members ?? 0, confirmedViaEventor: Number(viaEventor?.count ?? 0), syncedAt: sync?.syncedAt?.toISOString() ?? null,
    problem: sync?.problem ?? null };
}

