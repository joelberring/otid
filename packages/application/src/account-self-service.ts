import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  accountDeleteRequestSchema,
  accountDisplayNameChangeSchema,
  accountPasswordChangeSchema,
  accountProfileSchema,
  eventDeleteRequestSchema,
  type AccountProfile
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";
import { activeEventAdministrationGrant } from "./race-session";
import { purgeRows } from "./purge";
import { readGoogleLink } from "./google-link";
import { clearAreaAssignee } from "./map-project-areas";
import {
  appendUserAccountPasswordVerifier,
  authenticateUserAccountSessionForMutation,
  authenticateUserAccountSessionForProtectedRead,
  currentUserAccountVerifier,
  issueUserAccountSession,
  revokeAllUserAccountSessions,
  sessionRemembered,
  userAccountPasswordMatches,
  type UserAccountLoginResult,
  type UserAccountSessionProof
} from "./user-account";

/**
 * Mitt konto (ADR-0172 beslut 2): byta namn och lösenord, ta bort kontot och ta bort en egen tävling.
 * Ett konto äger bara tävlingar det själv har skapat, så det är alltid ensam ägare. När kontot tas bort
 * tas därför dess tävlingar bort i samma transaktion; sidan visar vilka innan man bekräftar.
 */
type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" };

/** Event där kontot har en aktiv OWNER-grant. */
export async function ownedEvents(tx: DbExecutor, accountId: string) {
  const grants = await tx.select({ id: schema.eventAdministrationGrants.id, eventId: schema.eventAdministrationGrants.eventId })
    .from(schema.eventAdministrationGrants)
    .where(and(eq(schema.eventAdministrationGrants.accountId, accountId), eq(schema.eventAdministrationGrants.role, "OWNER")));
  const active: string[] = [];
  for (const grant of grants) {
    const [revocation] = await tx.select({ id: schema.eventAdministrationGrantRevocations.id })
      .from(schema.eventAdministrationGrantRevocations).where(eq(schema.eventAdministrationGrantRevocations.grantId, grant.id));
    if (!revocation) active.push(grant.eventId);
  }
  if (active.length === 0) return [];
  return tx.select({ eventId: schema.events.id, eventName: schema.events.name, startsOn: schema.events.startsOn })
    .from(schema.events).where(inArray(schema.events.id, active)).orderBy(asc(schema.events.startsOn), asc(schema.events.name));
}

/** Tar bort kontot och tävlingarna det äger. Används både av användaren och av superadmin. */
export async function deleteAccountWithOwnedEvents(tx: DbExecutor, accountId: string, now: Date): Promise<{ eventIds: string[] }> {
  const events = await ownedEvents(tx, accountId);
  await revokeAllUserAccountSessions(tx, accountId, now, "ACCOUNT_DELETED");
  await purgeRows(tx, "event", events.map((event) => event.eventId));
  // Egna kartprojekt (utan klubb) där kontot är ensam medlem tas bort med kontot; finns andra är kontot inte ensam ägare
  // (`soleOwnerships` vägrar då) och projektet lever vidare med dem.
  const solo = (await tx.execute<{ id: string }>(sql`select p.id from map_project p where p.club_id is null
    and exists (select 1 from map_project_member m where m.project_id = p.id and m.account_id = ${accountId})
    and not exists (select 1 from map_project_member m where m.project_id = p.id and m.account_id <> ${accountId})`)).rows.map(row => row.id);
  await purgeRows(tx, "map_project", solo);
  // Delområden som kontot fått har ingen nyckel till kontot (0091); de blir inte utdelade. Kontots förslag står kvar.
  await clearAreaAssignee(tx, accountId, now);
  await purgeRows(tx, "user_account", [accountId]);
  return { eventIds: events.map((event) => event.eventId) };
}

/**
 * Klubbar där kontot är ensam ägare, träningsgrupper där det är ensam ledare och egna kartprojekt där det är ensam ägare med
 * andra medlemmar (ändrat 2026-11-07). Att ta bort kontot vägras
 * då, som när en ägare tas bort ur klubben (`removeClubMember`) eller den sista ledaren ur gruppen; superadmin kan fortfarande
 * ta bort kontot. `lock` låser ägarnas rader så att två ägare inte kan lämna samtidigt.
 */
export async function soleOwnerships(tx: DbExecutor, accountId: string, lock = false)
  : Promise<{ kind: "CLUB" | "TRAINING_GROUP" | "MAP_PROJECT"; id: string; name: string }[]> {
  const result: { kind: "CLUB" | "TRAINING_GROUP" | "MAP_PROJECT"; id: string; name: string }[] = [];
  const members = schema.clubMembers;
  const clubs = await tx.select({ id: schema.clubs.id, name: schema.clubs.name }).from(members)
    .innerJoin(schema.clubs, eq(schema.clubs.id, members.clubId)).where(and(eq(members.accountId, accountId), eq(members.role, "OWNER")));
  if (clubs.length > 0) {
    const query = tx.select({ clubId: members.clubId }).from(members)
      .where(and(inArray(members.clubId, clubs.map(club => club.id)), eq(members.role, "OWNER")));
    const owners = lock ? await query.for("update") : await query;
    for (const club of clubs) if (owners.filter(row => row.clubId === club.id).length <= 1) result.push({ kind: "CLUB", ...club });
  }
  const leaders = schema.trainingGroupMembers;
  const groups = await tx.select({ id: schema.trainingGroups.id, name: schema.trainingGroups.name }).from(leaders)
    .innerJoin(schema.trainingGroups, eq(schema.trainingGroups.id, leaders.groupId)).where(and(eq(leaders.accountId, accountId), eq(leaders.role, "LEADER")));
  if (groups.length > 0) {
    const query = tx.select({ groupId: leaders.groupId }).from(leaders)
      .where(and(inArray(leaders.groupId, groups.map(group => group.id)), eq(leaders.role, "LEADER")));
    const rows = lock ? await query.for("update") : await query;
    for (const group of groups) if (rows.filter(row => row.groupId === group.id).length <= 1) result.push({ kind: "TRAINING_GROUP", ...group });
  }
  // Egna kartprojekt (utan klubb, ADR-0219 rättelsen) där kontot är ensam ägare och andra är medlemmar.
  const projects = (await tx.execute<{ id: string; name: string }>(sql`select p.id, p.name from map_project p
    join map_project_member m on m.project_id = p.id and m.account_id = ${accountId} and m.role = 'OWNER'
    where p.club_id is null
      and not exists (select 1 from map_project_member o where o.project_id = p.id and o.role = 'OWNER' and o.account_id <> ${accountId})
      and exists (select 1 from map_project_member o where o.project_id = p.id and o.account_id <> ${accountId})
    ${lock ? sql`for update of p` : sql``}`)).rows;
  for (const project of projects) result.push({ kind: "MAP_PROJECT", ...project });
  return result.sort((a, b) => a.name.localeCompare(b.name, "sv"));
}

export async function readAccountProfile(
  db: Database, proof: UserAccountSessionProof, now = new Date()
): Promise<Failure | { status: "ok"; response: AccountProfile }> {
  return db.transaction(async (tx) => {
    const auth = await authenticateUserAccountSessionForProtectedRead(tx, proof, now);
    if (auth.status !== "authenticated") return auth;
    const [account] = await tx.select().from(schema.userAccounts).where(eq(schema.userAccounts.id, auth.principal.accountId));
    if (!account) return { status: "unauthorized" } as const;
    const events = await ownedEvents(tx, account.id);
    const login = await readGoogleLink(tx, account.id, account.email);
    return { status: "ok", response: accountProfileSchema.parse({
      formatVersion: 1, accountId: account.id, email: account.email, displayName: account.displayName,
      superadmin: account.isSuperadmin, createdAt: account.createdAt.toISOString(), ownedEvents: events, ...login,
      soleOwnerOf: await soleOwnerships(tx, account.id)
    }) } as const;
  });
}

export async function changeAccountDisplayName(
  db: Database, proof: UserAccountSessionProof, request: unknown, now = new Date()
): Promise<Failure | { status: "changed"; displayName: string }> {
  const parsed = accountDisplayNameChangeSchema.safeParse(request);
  return db.transaction(async (tx) => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...proof, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    // Inloggningen och behörigheten prövas före kroppen (städrundan 2026-11-07): utloggad får 401, inte 400.
    if (!parsed.success) return { status: "invalid-request" } as const;
    await tx.update(schema.userAccounts).set({ displayName: parsed.data.displayName })
      .where(eq(schema.userAccounts.id, auth.principal.accountId));
    return { status: "changed", displayName: parsed.data.displayName } as const;
  });
}

/** Nytt lösenord: alla sessioner spärras och den här enheten får en ny inloggning. */
export async function changeAccountPassword(
  db: Database, proof: UserAccountSessionProof, request: unknown, now = new Date()
): Promise<Failure | { status: "wrong-password" } | Extract<UserAccountLoginResult, { status: "authenticated" }>> {
  const parsed = accountPasswordChangeSchema.safeParse(request);
  return db.transaction(async (tx) => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...proof, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    // Inloggningen och behörigheten prövas före kroppen (städrundan 2026-11-07): utloggad får 401, inte 400.
    if (!parsed.success) return { status: "invalid-request" } as const;
    const [account] = await tx.select().from(schema.userAccounts).where(eq(schema.userAccounts.id, auth.principal.accountId));
    const verifier = await currentUserAccountVerifier(tx, auth.principal.accountId);
    if (!account || !verifier) return { status: "unauthorized" } as const;
    if (!await userAccountPasswordMatches(verifier, parsed.data.currentPassword)) return { status: "wrong-password" } as const;
    const version = await appendUserAccountPasswordVerifier(tx, {
      accountId: account.id, password: parsed.data.newPassword, previousVersion: verifier.version
    }, now);
    // ADR-0205 tillägg: enheten behåller sitt slag av inloggning (kort utan "Kom ihåg mig").
    const remember = await sessionRemembered(tx, auth.principal.sessionId);
    await revokeAllUserAccountSessions(tx, account.id, now, "PASSWORD_CHANGED");
    return issueUserAccountSession(tx, account, version, now, { remember });
  });
}

export async function deleteOwnAccount(
  db: Database, proof: UserAccountSessionProof, request: unknown, now = new Date()
): Promise<Failure | { status: "wrong-password" | "deleted" } | { status: "sole-owner"; soleOwnerOf: Awaited<ReturnType<typeof soleOwnerships>> }> {
  const parsed = accountDeleteRequestSchema.safeParse(request);
  return db.transaction(async (tx) => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...proof, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    // Inloggningen och behörigheten prövas före kroppen (städrundan 2026-11-07): utloggad får 401, inte 400.
    if (!parsed.success) return { status: "invalid-request" } as const;
    const verifier = await currentUserAccountVerifier(tx, auth.principal.accountId);
    if (!await userAccountPasswordMatches(verifier, parsed.data.password)) return { status: "wrong-password" } as const;
    const soleOwnerOf = await soleOwnerships(tx, auth.principal.accountId, true);
    if (soleOwnerOf.length > 0) return { status: "sole-owner", soleOwnerOf } as const;
    await deleteAccountWithOwnedEvents(tx, auth.principal.accountId, now);
    return { status: "deleted" } as const;
  });
}

/** Ägaren tar bort sin tävling (eventet med alla lopp och all data) genom att skriva tävlingens namn. */
export async function deleteEventAsOwner(
  db: Database, proof: UserAccountSessionProof & { raceId: string }, request: unknown, now = new Date()
): Promise<Failure | { status: "not-found" | "confirmation-mismatch" | "deleted"; eventId?: string }> {
  const parsed = eventDeleteRequestSchema.safeParse(request);
  return db.transaction(async (tx) => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...proof, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    // Inloggningen och behörigheten prövas före kroppen (städrundan 2026-11-07): utloggad får 401, inte 400.
    if (!parsed.success || !/^[0-9a-f-]{36}$/.test(proof.raceId)) return { status: "invalid-request" } as const;
    const [race] = await tx.select({ eventId: schema.races.eventId, eventName: schema.events.name })
      .from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
      .where(eq(schema.races.id, proof.raceId));
    if (!race) return { status: "not-found" } as const;
    const owner = await activeEventAdministrationGrant(tx, {
      accountId: auth.principal.accountId, eventId: race.eventId, ownerOnly: true
    }, "update");
    if (!owner) return { status: "not-found" } as const;
    if (parsed.data.confirmation.trim() !== race.eventName.trim()) return { status: "confirmation-mismatch" } as const;
    await purgeRows(tx, "event", [race.eventId]);
    return { status: "deleted", eventId: race.eventId } as const;
  });
}
