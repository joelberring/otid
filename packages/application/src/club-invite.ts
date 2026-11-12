import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  clubInviteFromClubRequestSchema, type ClubInviteContext, type ClubInviteFromClubResponse, type ClubPickerMember, type ClubPickerResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { acceptClubInvitations, requireClubRole, type ClubProof } from "./club-access";
import { clubsOfMember } from "./club-affiliation-access";
import { confirmedMembersOf } from "./club-affiliations";
import { inviteClubMember } from "./clubs";
import type { InvitationMailer } from "./invitation-links";
import { grantRacePersonAsAdmin } from "./race-people";
import { requireRaceRole } from "./race-session";
import type { DbExecutor } from "./snapshot";
import { addGroupMember, requireGroupLeader } from "./training-groups";

/**
 * ADR-0209 beslut 3 ("Från klubben"): en sökbar lista med bekräftade medlemmar i den inloggades klubbar (och, i klubbytan,
 * klubbytans egna) som har O-Tid. Listan har namnen, aldrig adresserna. Att välja personer skapar inbjudningar för kontots
 * adress genom de befintliga vägarna (tävlingens personer och behörigheter, klubbytans medlemmar, träningsgruppen), så att
 * mejlet och godkännandet fungerar som förut. Inbjudningarna märks (`invitation_club_source`) så att listorna visar namnet i
 * stället för adressen. Bara den som får bjuda in i sammanhanget får listan.
 */
type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" };
type Kind = "RACE_PERSON" | "CLUB" | "TRAINING_GROUP";
const KIND: Record<ClubInviteContext["kind"], Kind> = { RACE: "RACE_PERSON", CLUB: "CLUB", TRAINING_GROUP: "TRAINING_GROUP" };

/** Kontrollerar att den inloggade får bjuda in i sammanhanget. */
async function inviter(tx: DbExecutor & Parameters<Parameters<Database["transaction"]>[0]>[0], proof: ClubProof, context: ClubInviteContext, now: Date)
  : Promise<Failure | { status: "ok"; accountId: string }> {
  if (context.kind === "RACE") {
    const auth = await requireRaceRole(tx, { raceId: context.id, sessionToken: proof.sessionToken, csrfCookie: proof.csrfCookie ?? null,
      csrfHeader: proof.csrfHeader ?? null, role: "ADMIN" }, now, "share");
    return auth.status === "authenticated" ? { status: "ok", accountId: auth.principal.accountId } : auth;
  }
  if (context.kind === "CLUB") {
    const member = await requireClubRole(tx, { ...proof, clubId: context.id }, "ADMIN", now, false);
    if (member.status === "ok") return { status: "ok", accountId: member.accountId };
    return member.status === "conflict" || member.status === "name-taken" ? { status: "forbidden" } : { status: member.status };
  }
  const leader = await requireGroupLeader(tx, { ...proof, groupId: context.id }, now, false);
  return leader.status === "ok" ? { status: "ok", accountId: leader.accountId }
    : leader.status === "conflict" ? { status: "forbidden" } : leader as Failure;
}

/** Adresserna som redan är med eller inbjudna i sammanhanget (bara på servern, för "redan med"). */
async function presentEmails(tx: DbExecutor, context: ClubInviteContext): Promise<Set<string>> {
  if (context.kind === "RACE") {
    const rows = (await tx.execute<{ email: string }>(sql`
      select a.email from race r join event_administration_grant g on g.event_id = r.event_id
        join user_account a on a.id = g.account_id
        where r.id = ${context.id} and not exists (select 1 from event_administration_grant_revocation v where v.grant_id = g.id)
      union select a.email from course_setting_grant c join user_account a on a.id = c.account_id where c.race_id = ${context.id}
      union select email from race_person_invitation where race_id = ${context.id} and accepted_at is null and revoked_at is null`)).rows;
    return new Set(rows.map(row => row.email));
  }
  if (context.kind === "CLUB") {
    const rows = (await tx.execute<{ email: string }>(sql`
      select a.email from club_member m join user_account a on a.id = m.account_id where m.club_id = ${context.id}
      union select email from club_invitation where club_id = ${context.id} and accepted_at is null and revoked_at is null`)).rows;
    return new Set(rows.map(row => row.email));
  }
  const rows = (await tx.execute<{ email: string }>(sql`
    select a.email from training_group_member m join user_account a on a.id = m.account_id where m.group_id = ${context.id}
    union select email from training_group_invitation where group_id = ${context.id} and accepted_at is null and revoked_at is null`)).rows;
  return new Set(rows.map(row => row.email));
}

interface Candidate extends ClubPickerMember { accountId: string; email: string }

/** Bekräftade medlemmar i den inloggades klubbar (och klubbytans egna i klubbytan), utan den inloggade, en rad per konto. */
async function candidates(tx: DbExecutor, accountId: string, context: ClubInviteContext): Promise<{ members: Candidate[]; clubs: string[] }> {
  const clubIds = new Set(await clubsOfMember(tx, accountId));
  if (context.kind === "CLUB") clubIds.add(context.id);
  const rows = await confirmedMembersOf(tx, [...clubIds]);
  const accounts = rows.length === 0 ? [] : await tx.select({ id: schema.userAccounts.id, email: schema.userAccounts.email })
    .from(schema.userAccounts).where(and(inArray(schema.userAccounts.id, [...new Set(rows.map(row => row.accountId))]), isNull(schema.userAccounts.blockedAt)));
  const emails = new Map(accounts.map(account => [account.id, account.email]));
  const present = await presentEmails(tx, context);
  const seen = new Set<string>();
  const members: Candidate[] = [];
  for (const row of rows) {
    const email = emails.get(row.accountId);
    if (row.accountId === accountId || !email || seen.has(row.accountId)) continue;
    seen.add(row.accountId);
    members.push({ ref: row.membershipId, displayName: row.displayName, clubName: row.clubName, already: present.has(email), accountId: row.accountId, email });
  }
  return { members, clubs: [...new Set(rows.map(row => row.clubName))].sort((a, b) => a.localeCompare(b, "sv")) };
}

export async function readClubPicker(db: Database, input: ClubProof & { context: ClubInviteContext }, now = new Date())
  : Promise<Failure | { status: "ok"; response: ClubPickerResponse }> {
  return db.transaction(async tx => {
    const actor = await inviter(tx, input, input.context, now);
    if (actor.status !== "ok") return actor;
    const { members, clubs } = await candidates(tx, actor.accountId, input.context);
    return { status: "ok", response: { formatVersion: 1, clubs,
      members: members.map(({ ref, displayName, clubName, already }) => ({ ref, displayName, clubName, already })) } } as const;
  });
}

/** Ett bestämt request-id per person (samma begäran igen ger samma inbjudningar). */
function personRequestId(requestId: string, ref: string): string {
  const hex = createHash("sha256").update(`club-invite:${requestId}:${ref}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${(8 + (parseInt(hex[16]!, 16) % 4)).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Bjuder in de valda. Varje person går genom den vanliga vägen (egen transaktion, som när någon skriver adressen) och får
 * inbjudningsmejlet när e-post finns (`mailer`, ADR-0206). Adressen stannar på servern: svaret har bara antalen.
 */
export async function inviteFromClub(db: Database, input: ClubProof & { request: unknown }, now = new Date(), mailer?: InvitationMailer)
  : Promise<Failure | { status: "ok"; response: ClubInviteFromClubResponse }> {
  const parsed = clubInviteFromClubRequestSchema.safeParse(input.request);
  // Rollen hör till sammanhanget (kontraktet, `invitationRoleFits`).
  if (!parsed.success) return { status: "invalid-request" };
  const { context, role, requestId } = parsed.data;
  const chosen = await db.transaction(async tx => {
    const actor = await inviter(tx, input, context, now);
    if (actor.status !== "ok") return actor;
    const { members } = await candidates(tx, actor.accountId, context);
    const byRef = new Map(members.map(member => [member.ref, member]));
    // En ref utanför listan (annan klubb, borttagen, eller den inloggade själv) ger 404 för hela begäran.
    if (parsed.data.refs.some(ref => !byRef.has(ref))) return { status: "not-found" } as const;
    return { status: "ok", accountId: actor.accountId, people: parsed.data.refs.map(ref => byRef.get(ref)!) } as const;
  });
  if (chosen.status !== "ok") return chosen;
  let invited = 0, already = 0, failed = 0;
  for (const person of chosen.people) {
    if (person.already) { already += 1; continue; }
    const id = personRequestId(requestId, person.ref);
    const created = await createInvitation(db, input, context, { requestId: id, email: person.email, role }, now, mailer);
    if (created === "conflict") { already += 1; continue; }
    if (!created) { failed += 1; continue; }
    await db.insert(schema.invitationClubSources).values({ id: randomUUID(), kind: KIND[context.kind], invitationId: created.id, contextId: context.id,
      accountId: person.accountId, createdBy: chosen.accountId, createdAt: now }).onConflictDoNothing();
    // Användartestet 2026-11-12 (E): i klubbytan gäller rollen direkt för en person som valts i listan. Hen är en bekräftad medlem
    // med bekräftad adress som den som bjuder in redan ser vid namn, så inget konto röjs (ADR-0188 beslut 6, ADR-0206 tillägg
    // 2026-11-12). En inskriven adress väntar som förut på inloggningen.
    if (context.kind === "CLUB") await db.transaction(tx => acceptClubInvitations(tx, person.accountId, now, context.id));
    invited += 1;
  }
  return { status: "ok", response: { formatVersion: 1, invited, already, failed } };
}

async function createInvitation(db: Database, proof: ClubProof, context: ClubInviteContext,
  intent: { requestId: string; email: string; role: string }, now: Date, mailer: InvitationMailer | undefined)
  : Promise<{ id: string } | "conflict" | undefined> {
  if (context.kind === "RACE") {
    const result = await grantRacePersonAsAdmin(db, { raceId: context.id, sessionToken: proof.sessionToken, csrfCookie: proof.csrfCookie ?? null,
      csrfHeader: proof.csrfHeader ?? null, idempotencyKey: `race-person-grant:${intent.requestId}`,
      readBody: async () => ({ formatVersion: 1, ...intent }) }, now, mailer);
    return result.status === "granted" ? { id: result.response.invitation.invitationId } : result.status === "conflict" ? "conflict" : undefined;
  }
  if (context.kind === "CLUB") {
    const result = await inviteClubMember(db, { ...proof, clubId: context.id, request: { formatVersion: 1, ...intent } }, now, mailer);
    return result.status === "invited" ? { id: result.invitationId } : result.status === "conflict" ? "conflict" : undefined;
  }
  const result = await addGroupMember(db, { ...proof, groupId: context.id, request: { formatVersion: 1, ...intent } }, now, mailer);
  return result.status === "added" ? { id: result.member.memberId } : result.status === "conflict" ? "conflict" : undefined;
}

/**
 * Konton och inbjudningar i sammanhanget som kom "Från klubben": listorna visar namnet i stället för adressen (den som bjöd in
 * ser aldrig adressen, inte heller efter att personen tagit inbjudan).
 */
export async function clubSourcedInContext(tx: DbExecutor, kind: Kind, contextId: string): Promise<{ accounts: Map<string, string>; invitations: Map<string, string> }> {
  const rows = await tx.select({ invitationId: schema.invitationClubSources.invitationId, accountId: schema.invitationClubSources.accountId,
    displayName: schema.userAccounts.displayName }).from(schema.invitationClubSources)
    .innerJoin(schema.userAccounts, eq(schema.userAccounts.id, schema.invitationClubSources.accountId))
    .where(and(eq(schema.invitationClubSources.kind, kind), eq(schema.invitationClubSources.contextId, contextId))).limit(5000);
  return { accounts: new Map(rows.map(row => [row.accountId, row.displayName])), invitations: new Map(rows.map(row => [row.invitationId, row.displayName])) };
}
