import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  accountClubAddRequestSchema, accountClubRemoveRequestSchema, accountClubStepRequestSchema, clubAffiliationDecisionRequestSchema,
  clubAccessSettingsRequestSchema, type AccountClubMembershipView, type AccountClubsResponse, type ClubAffiliationPerson,
  type ClubAffiliationView
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { clubSearchText, normalizeClubSearch } from "@o-tid/domain";
import { clubLinkFacts } from "./club-affiliation-access";
import { applyEventorMemberships } from "./club-affiliation-access";
import { clubEventorStatus } from "./club-eventor";
import { clubJournal, requireClubRole, type ClubFailure, type ClubProof } from "./club-access";
import { organisationById, organisationSummary } from "./organisations";
import type { DbExecutor } from "./snapshot";
import { authenticateUserAccountSessionForMutation, authenticateUserAccountSessionForProtectedRead } from "./user-account";

/**
 * ADR-0209 beslut 2–3: kontots klubbar (Mina klubbar) och klubbarkivets bekräftelser. En egen anmälan ger ingenting; ett
 * klubbarkiv som är kopplat till klubben i Eventor (med klubbens nyckel, `club-eventor.ts`) bekräftar automatiskt dem vars
 * adress finns i medlemslistan, och ägare och administratörer bekräftar eller avböjer resten. Bekräftade medlemmar är
 * medlemmar i arkivet ("Vem ser vad" avgör vad de ser) och syns för varandra med namn i "Från klubben". Ingen ser någon annans e-postadress, och den som inte är med i klubben ser ingen lista.
 */
const memberships = schema.accountClubMemberships;
type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" };

// --- Mina klubbar ---------------------------------------------------------------------------------------------------------------

async function accountMemberships(tx: DbExecutor, accountId: string): Promise<AccountClubMembershipView[]> {
  const rows = await tx.select({ membership: memberships, organisation: schema.organisations, clubName: schema.clubs.name,
    spaceClubId: schema.clubSettings.clubId })
    .from(memberships).leftJoin(schema.organisations, eq(schema.organisations.id, memberships.organisationId))
    .leftJoin(schema.clubs, eq(schema.clubs.id, memberships.clubId))
    .leftJoin(schema.clubSettings, eq(schema.clubSettings.organisationId, memberships.organisationId))
    .where(eq(memberships.accountId, accountId)).orderBy(asc(memberships.createdAt)).limit(50);
  return rows.map(({ membership, organisation, clubName, spaceClubId }) => ({ membershipId: membership.id,
    organisation: organisation ? organisationSummary(organisation) : null, freeText: membership.freeText, status: membership.status,
    // Arkivets namn bara för den bekräftade; en avböjd eller väntande får inte veta vilket arkiv som finns.
    clubName: membership.status === "CONFIRMED" ? clubName : null, clubId: membership.status === "CONFIRMED" ? membership.clubId : null,
    via: membership.status === "CONFIRMED" ? membership.confirmedVia : null, spaceExists: spaceClubId !== null,
    createdAt: membership.createdAt.toISOString() }));
}

async function answered(tx: DbExecutor, accountId: string): Promise<boolean> {
  const [row] = await tx.select({ id: schema.accountClubPrompts.accountId }).from(schema.accountClubPrompts)
    .where(eq(schema.accountClubPrompts.accountId, accountId));
  return !!row;
}

async function markAnswered(tx: DbExecutor, accountId: string, now: Date): Promise<void> {
  await tx.insert(schema.accountClubPrompts).values({ accountId, answeredAt: now }).onConflictDoNothing();
}

export async function readAccountClubs(db: Database, proof: ClubProof, now = new Date()): Promise<Failure | { status: "ok"; response: AccountClubsResponse }> {
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForProtectedRead(tx, proof, now);
    if (auth.status !== "authenticated") return { status: "unauthorized" } as const;
    const accountId = auth.principal.accountId;
    await applyEventorMemberships(tx, accountId, now);
    const list = await accountMemberships(tx, accountId);
    return { status: "ok", response: { formatVersion: 1, memberships: list, promptAnswered: list.length > 0 || await answered(tx, accountId) } } as const;
  });
}

/** Lägger till en klubb (ur listan eller fritext) som väntar på bekräftelse. Samma klubb två gånger ger 409. */
async function addMembership(tx: DbExecutor, accountId: string, input: { organisationId: string | null; freeText: string | null }, now: Date)
  : Promise<"added" | "exists" | "not-found"> {
  if (input.organisationId) {
    const organisation = await organisationById(tx, input.organisationId);
    if (!organisation || organisation.removedAt) return "not-found";
  }
  const freeText = input.freeText?.replace(/\s+/gu, " ").trim() ?? null;
  const [prior] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.accountId, accountId),
    input.organisationId ? eq(memberships.organisationId, input.organisationId) : sql`lower(btrim(${memberships.freeText})) = lower(${freeText})`));
  if (prior) return "exists";
  const count = await tx.select({ id: memberships.id }).from(memberships).where(eq(memberships.accountId, accountId)).limit(20);
  if (count.length >= 20) return "exists";
  await tx.insert(memberships).values({ id: randomUUID(), accountId, organisationId: input.organisationId, freeText, clubId: null, status: "PENDING",
    createdAt: now });
  return "added";
}

export async function addAccountClub(db: Database, input: ClubProof & { request: unknown }, now = new Date())
  : Promise<Failure | { status: "added"; response: AccountClubsResponse }> {
  const parsed = accountClubAddRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...input, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return { status: "unauthorized" } as const;
    const accountId = auth.principal.accountId;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`account-club:${accountId}`}, 0))`);
    const added = await addMembership(tx, accountId, parsed.data, now);
    if (added === "not-found") return { status: "not-found" } as const;
    if (added === "exists") return { status: "conflict" } as const;
    await markAnswered(tx, accountId, now);
    // ADR-0209 beslut E: finns adressen i klubbens medlemslista syns "Du är med" direkt.
    await applyEventorMemberships(tx, accountId, now);
    return { status: "added", response: { formatVersion: 1, memberships: await accountMemberships(tx, accountId), promptAnswered: true } } as const;
  });
}

/** Steget efter registreringen: klubbarna på en gång, eller inga (Hoppa över). Redan tillagda hoppas över. */
export async function answerAccountClubStep(db: Database, input: ClubProof & { request: unknown }, now = new Date())
  : Promise<Failure | { status: "ok"; response: AccountClubsResponse }> {
  const parsed = accountClubStepRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...input, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return { status: "unauthorized" } as const;
    const accountId = auth.principal.accountId;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`account-club:${accountId}`}, 0))`);
    for (const organisationId of new Set(parsed.data.organisationIds)) {
      if (await addMembership(tx, accountId, { organisationId, freeText: null }, now) === "not-found") throw new NotFoundRollback();
    }
    if (parsed.data.freeText) await addMembership(tx, accountId, { organisationId: null, freeText: parsed.data.freeText }, now);
    await markAnswered(tx, accountId, now);
    await applyEventorMemberships(tx, accountId, now);
    return { status: "ok", response: { formatVersion: 1, memberships: await accountMemberships(tx, accountId), promptAnswered: true } } as const;
  }).catch((error: unknown) => {
    if (error instanceof NotFoundRollback) return { status: "not-found" } as const;
    throw error;
  });
}

class NotFoundRollback extends Error {}

/** Tar bort en egen klubb. En bekräftad tillhörighet tar med sig läsarrätten i arkivet (den är härledd), och arkivet journalför det. */
export async function removeAccountClub(db: Database, input: ClubProof & { request: unknown }, now = new Date())
  : Promise<Failure | { status: "removed"; response: AccountClubsResponse }> {
  const parsed = accountClubRemoveRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...input, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return { status: "unauthorized" } as const;
    const accountId = auth.principal.accountId;
    const [row] = await tx.delete(memberships).where(and(eq(memberships.id, parsed.data.membershipId), eq(memberships.accountId, accountId))).returning();
    if (!row) return { status: "not-found" } as const;
    if (row.clubId && row.status === "CONFIRMED") {
      await clubJournal(tx, { clubId: row.clubId, action: "CLUB_AFFILIATION_LEFT", actorAccountId: accountId,
        details: { membershipId: row.id, accountId }, now });
    }
    return { status: "removed", response: { formatVersion: 1, memberships: await accountMemberships(tx, accountId), promptAnswered: true } } as const;
  });
}

// --- Klubbarkivet: Klubben i Eventor och bekräftelser --------------------------------------------------------------------------------

/**
 * Fritexter som liknar klubbens namn: den Eventor-kopplade klubbens namn, kortnamn eller initialer (normaliserade, lika). Bara
 * för en klubbyta som är kopplad med klubbens nyckel: arkivets namn väljer vem som helst, så det röjer ingen (städrundan
 * 2026-11-07).
 */
function freeTextCandidates(organisation: { name: string; shortName: string | null } | undefined): string[] {
  if (!organisation) return [];
  return [...new Set(clubSearchText(organisation.name, organisation.shortName).split(" ").filter(key => key.length >= 3))];
}

async function affiliationView(tx: DbExecutor, clubId: string): Promise<ClubAffiliationView | undefined> {
  const [club] = await tx.select({ name: schema.clubs.name }).from(schema.clubs).where(eq(schema.clubs.id, clubId));
  if (!club) return undefined;
  const link = await clubLinkFacts(tx, clubId);
  const organisation = link.organisationId ? await organisationById(tx, link.organisationId) : undefined;
  const person = (row: { id: string; displayName: string; freeText: string | null; at: Date | null; createdAt: Date;
    via?: "MANUAL" | "EVENTOR" | null }): ClubAffiliationPerson =>
    ({ membershipId: row.id, displayName: row.displayName, freeText: row.freeText, since: (row.at ?? row.createdAt).toISOString(),
      via: row.via ?? null });
  const columns = { id: memberships.id, displayName: schema.userAccounts.displayName, freeText: memberships.freeText, at: memberships.decidedAt,
    createdAt: memberships.createdAt, organisationId: memberships.organisationId, via: memberships.confirmedVia };
  // Väntar: anmälda till den kopplade klubben, och fritexter (utan arkiv) som liknar den kopplade klubbens namn.
  const pendingDirectory = link.organisationId ? await tx.select(columns).from(memberships)
    .innerJoin(schema.userAccounts, eq(schema.userAccounts.id, memberships.accountId))
    .where(and(eq(memberships.organisationId, link.organisationId), eq(memberships.status, "PENDING"), isNull(schema.userAccounts.blockedAt)))
    .orderBy(asc(memberships.createdAt)).limit(500) : [];
  const keys = freeTextCandidates(link.organisationId ? organisation : undefined);
  const freeRows = keys.length === 0 ? [] : await tx.select(columns).from(memberships)
    .innerJoin(schema.userAccounts, eq(schema.userAccounts.id, memberships.accountId))
    .where(and(isNotNull(memberships.freeText), eq(memberships.status, "PENDING"), isNull(schema.userAccounts.blockedAt)))
    .orderBy(asc(memberships.createdAt)).limit(2000);
  const pendingFree = freeRows.filter(row => keys.includes(normalizeClubSearch(row.freeText ?? ""))).slice(0, 200);
  const confirmed = await tx.select(columns).from(memberships).innerJoin(schema.userAccounts, eq(schema.userAccounts.id, memberships.accountId))
    .where(and(eq(memberships.clubId, clubId), eq(memberships.status, "CONFIRMED"))).orderBy(asc(schema.userAccounts.displayName)).limit(2000);
  return { formatVersion: 1, clubId, organisation: organisation ? organisationSummary(organisation) : null,
    eventor: await clubEventorStatus(tx, clubId), access: { archive: link.access.ARCHIVE, mapBank: link.access.MAP_BANK }, pending: [...pendingDirectory, ...pendingFree].map(person),
    confirmed: confirmed.filter(row => row.organisationId === null || row.organisationId === link.organisationId).map(person) };
}

/** Mina tävlingar (ADR-0205 tillägg, ägaren 2026-11-04): hur många som väntar på bekräftelse i klubbytan ("3 väntar på bekräftelse"). */
export async function pendingClubAffiliations(tx: DbExecutor, clubId: string): Promise<number> {
  return (await affiliationView(tx, clubId))?.pending.length ?? 0;
}

/** Klubben i Eventor och bekräftelserna: bara ägare och administratörer (läsare får 403, andra 404). */
export async function readClubAffiliation(db: Database, input: ClubProof & { clubId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; view: ClubAffiliationView }> {
  return db.transaction(async tx => {
    const actor = await requireClubRole(tx, input, "ADMIN", now, false);
    if (actor.status !== "ok") return actor;
    const view = await affiliationView(tx, input.clubId);
    return view ? { status: "ok", view } as const : { status: "not-found" } as const;
  });
}

/** "Vem ser vad": träningsarkivet och kartbanken för alla medlemmar eller bara ledare och administratörer. Journalförs. */
export async function setClubAccessSettings(db: Database, input: ClubProof & { clubId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; view: ClubAffiliationView }> {
  const parsed = clubAccessSettingsRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const actor = await requireClubRole(tx, input, "ADMIN", now, true);
    if (actor.status !== "ok") return actor;
    const before = await clubLinkFacts(tx, input.clubId);
    const values = { archiveVisibility: parsed.data.archive, mapBankAccess: parsed.data.mapBank, updatedBy: actor.accountId, updatedAt: now };
    await tx.insert(schema.clubSettings).values({ clubId: input.clubId, ...values })
      .onConflictDoUpdate({ target: schema.clubSettings.clubId, set: values });
    if (before.access.ARCHIVE !== parsed.data.archive || before.access.MAP_BANK !== parsed.data.mapBank) {
      await clubJournal(tx, { clubId: input.clubId, action: "CLUB_ACCESS_CHANGED", actorAccountId: actor.accountId,
        details: { from: { archive: before.access.ARCHIVE, mapBank: before.access.MAP_BANK }, to: parsed.data }, now });
    }
    return { status: "ok", view: (await affiliationView(tx, input.clubId))! } as const;
  });
}

/**
 * Bekräfta, avböj eller ta bort (en bekräftad). Bara tillhörigheter som arkivet ser: väntande till den kopplade klubben,
 * fritext som liknar namnet (matchas till arkivet), eller arkivets egna bekräftade. Journalförs.
 */
export async function decideClubAffiliation(db: Database, input: ClubProof & { clubId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; view: ClubAffiliationView }> {
  const parsed = clubAffiliationDecisionRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const actor = await requireClubRole(tx, input, "ADMIN", now, true);
    if (actor.status !== "ok") return actor;
    const view = await affiliationView(tx, input.clubId);
    if (!view) return { status: "not-found" } as const;
    const { membershipId, decision } = parsed.data;
    const visible = decision === "REMOVE" ? view.confirmed : view.pending;
    if (!visible.some(person => person.membershipId === membershipId)) return { status: "not-found" } as const;
    const [row] = await tx.update(memberships).set({ status: decision === "CONFIRM" ? "CONFIRMED" : "DECLINED", clubId: input.clubId,
      confirmedVia: decision === "CONFIRM" ? "MANUAL" : null, decidedBy: actor.accountId, decidedAt: now }).where(and(eq(memberships.id, membershipId),
      decision === "REMOVE" ? and(eq(memberships.status, "CONFIRMED"), eq(memberships.clubId, input.clubId)) : eq(memberships.status, "PENDING")))
      .returning({ id: memberships.id, accountId: memberships.accountId, freeText: memberships.freeText });
    if (!row) return { status: "conflict" } as const;
    await clubJournal(tx, { clubId: input.clubId, action: decision === "CONFIRM" ? "CLUB_AFFILIATION_CONFIRMED"
      : decision === "DECLINE" ? "CLUB_AFFILIATION_DECLINED" : "CLUB_AFFILIATION_REMOVED", actorAccountId: actor.accountId,
    details: { membershipId: row.id, accountId: row.accountId, freeText: row.freeText !== null }, now });
    return { status: "ok", view: (await affiliationView(tx, input.clubId))! } as const;
  });
}

/** Bekräftade medlemmar i arkiven (för väljaren): namnet och vilket arkiv; aldrig adressen. */
export async function confirmedMembersOf(tx: DbExecutor, clubIds: readonly string[]) {
  if (clubIds.length === 0) return [];
  const rows = await tx.select({ membershipId: memberships.id, accountId: memberships.accountId, clubId: memberships.clubId,
    organisationId: memberships.organisationId, displayName: schema.userAccounts.displayName, clubName: schema.clubs.name,
    verifiedAt: schema.userAccounts.emailVerifiedAt })
    .from(memberships).innerJoin(schema.userAccounts, eq(schema.userAccounts.id, memberships.accountId))
    .innerJoin(schema.clubs, eq(schema.clubs.id, memberships.clubId))
    .where(and(inArray(memberships.clubId, [...clubIds]), eq(memberships.status, "CONFIRMED"), isNull(schema.userAccounts.blockedAt),
      isNotNull(schema.userAccounts.emailVerifiedAt)))
    .orderBy(asc(schema.userAccounts.displayName)).limit(5000);
  const links = new Map<string, string | null>();
  for (const clubId of new Set(rows.map(row => row.clubId!))) links.set(clubId, (await clubLinkFacts(tx, clubId)).organisationId);
  return rows.filter(row => row.organisationId === null || row.organisationId === links.get(row.clubId!));
}
