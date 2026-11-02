import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";
import { acceptGroupInvitations } from "./training-group-invitations";

/**
 * ADR-0188 beslut 6: en behörighet som en administratör ger sparas för e-postadressen, oavsett om adressen har ett konto,
 * så att svaret aldrig avslöjar om det finns ett konto. Den blir en vanlig behörighet när ett konto med adressen och
 * bekräftad e-post (ADR-0186) loggar in, bekräftar adressen, öppnar Mina tävlingar eller tävlingen. Ett spärrat konto får
 * inget. Två samtidiga anrop tar inbjudan bara en gång (raden markeras först, med villkoret att den är öppen).
 */
export type InvitationRole = "ADMIN" | "FUNCTIONARY" | "COURSE_EDIT" | "COURSE_SUGGEST" | "COURSE_COMMENT" | "COURSE_MAP";
const COURSE_LEVELS = { COURSE_EDIT: "EDIT", COURSE_SUGGEST: "SUGGEST", COURSE_COMMENT: "COMMENT", COURSE_MAP: "MAP" } as const;
type CourseRole = keyof typeof COURSE_LEVELS;
const isCourseRole = (role: string): role is CourseRole => role in COURSE_LEVELS;

const invitations = schema.racePersonInvitations;
const open = and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt));

/** De öppna inbjudningarna på tävlingen (listan under Personer med behörighet). */
export async function openRacePersonInvitations(tx: DbExecutor, raceId: string) {
  return tx.select({ id: invitations.id, email: invitations.email, role: invitations.role, createdAt: invitations.createdAt })
    .from(invitations).where(and(eq(invitations.raceId, raceId), open)).orderBy(asc(invitations.createdAt), asc(invitations.id)).limit(1000);
}

/** Har kontot redan en gällande behörighet på eventet eller i banläggningen som täcker rollen? */
async function covered(tx: DbExecutor, input: { accountId: string; eventId: string; raceId: string; role: InvitationRole }): Promise<string | undefined> {
  const grants = await tx.select({ id: schema.eventAdministrationGrants.id, role: schema.eventAdministrationGrants.role })
    .from(schema.eventAdministrationGrants)
    .leftJoin(schema.eventAdministrationGrantRevocations, eq(schema.eventAdministrationGrantRevocations.grantId, schema.eventAdministrationGrants.id))
    .where(and(eq(schema.eventAdministrationGrants.accountId, input.accountId), eq(schema.eventAdministrationGrants.eventId, input.eventId),
      isNull(schema.eventAdministrationGrantRevocations.id)));
  const strong = grants.find(grant => grant.role === "OWNER" || grant.role === "ADMIN");
  if (strong) return strong.id;
  if (input.role === "FUNCTIONARY") return grants.find(grant => grant.role === "FUNCTIONARY")?.id;
  if (isCourseRole(input.role)) {
    const [course] = await tx.select({ id: schema.courseSettingGrants.id }).from(schema.courseSettingGrants)
      .where(and(eq(schema.courseSettingGrants.raceId, input.raceId), eq(schema.courseSettingGrants.accountId, input.accountId)));
    return course?.id;
  }
  return undefined;
}

/**
 * Gör kontots öppna inbjudningar till behörigheter (alla, eller bara på `raceId`). Kräver bekräftad e-post och ett konto
 * som inte är spärrat. Returnerar antalet som togs.
 */
export async function acceptRacePersonInvitations(tx: DbExecutor, accountId: string, now: Date, raceId?: string): Promise<number> {
  const [account] = await tx.select({ email: schema.userAccounts.email, verifiedAt: schema.userAccounts.emailVerifiedAt,
    blockedAt: schema.userAccounts.blockedAt }).from(schema.userAccounts).where(eq(schema.userAccounts.id, accountId));
  if (!account || !account.verifiedAt || account.blockedAt) return 0;
  // ADR-0189 beslut 9: träningsgruppernas inbjudningar tas samtidigt (inloggning, bekräftelse, Mina tävlingar, tävlingen; en
  // ledare i gruppen är administratör på gruppens tävlingar).
  let accepted = await acceptGroupInvitations(tx, accountId, now);
  const pending = await tx.select({ id: invitations.id }).from(invitations)
    .where(and(eq(invitations.email, account.email), open, raceId ? eq(invitations.raceId, raceId) : undefined))
    .orderBy(asc(invitations.createdAt)).limit(200);
  for (const { id } of pending) {
    // Ta raden först: en samtidig begäran som redan tagit den hoppas över.
    const [invitation] = await tx.update(invitations).set({ acceptedAt: now, acceptedAccountId: accountId })
      .where(and(eq(invitations.id, id), open)).returning();
    if (!invitation) continue;
    const role = invitation.role as InvitationRole;
    const existing = await covered(tx, { accountId, eventId: invitation.eventId, raceId: invitation.raceId, role });
    let grantId = existing;
    if (!existing && isCourseRole(role)) {
      grantId = randomUUID();
      await tx.insert(schema.courseSettingGrants).values({ id: grantId, raceId: invitation.raceId, accountId, level: COURSE_LEVELS[role],
        grantedAt: now, grantedBy: invitation.actorAccountId, requestId: invitation.requestId });
      await tx.insert(schema.auditEvents).values({ raceId: invitation.raceId, entityType: "course_setting_grant", entityId: grantId,
        action: "COURSE_SETTING_GRANTED", actorKind: "USER_ACCOUNT", actorId: invitation.actorAccountId, requestId: invitation.requestId,
        after: { grantId, targetAccountId: accountId, level: COURSE_LEVELS[role], grantedAt: now.toISOString(), invitationId: invitation.id } });
    } else if (!existing && (role === "ADMIN" || role === "FUNCTIONARY")) {
      // En funktionär som blir administratör får en ny rad; den svagare står kvar som förut.
      const [grant] = await tx.insert(schema.eventAdministrationGrants).values({ eventId: invitation.eventId, accountId, role, grantedAt: now })
        .returning({ id: schema.eventAdministrationGrants.id });
      if (!grant) throw new Error("Behörigheten kunde inte sparas");
      grantId = grant.id;
      await tx.insert(schema.eventAdministrationAccessRequests).values({ requestId: invitation.requestId,
        action: role === "ADMIN" ? "GRANT_ADMIN" : "GRANT_FUNCTIONARY", actorAccountId: invitation.actorAccountId,
        eventId: invitation.eventId, targetAccountId: accountId, grantId: grant.id, reason: null, createdAt: now });
      await tx.insert(schema.auditEvents).values({ raceId: invitation.raceId, entityType: "event_administration_grant", entityId: grant.id,
        action: role === "ADMIN" ? "EVENT_ADMIN_GRANTED" : "EVENT_FUNCTIONARY_GRANTED", actorKind: "USER_ACCOUNT",
        actorId: invitation.actorAccountId, requestId: invitation.requestId,
        after: { eventId: invitation.eventId, grantId: grant.id, targetAccountId: accountId, role, grantedAt: now.toISOString(),
          invitationId: invitation.id } });
    }
    await tx.update(invitations).set({ acceptedGrantId: grantId ?? null }).where(eq(invitations.id, invitation.id));
    accepted += 1;
  }
  return accepted;
}

/** Behörigheten gäller tävlingen (administratör, funktionär) eller bara banläggningen. */
export type InvitationKind = "EVENT" | "COURSE";
export const invitationKind = (role: InvitationRole): InvitationKind => isCourseRole(role) ? "COURSE" : "EVENT";

/** Finns det en öppen inbjudan av samma slag till adressen på tävlingen? (Samma adress läggs inte till två gånger.) */
export async function hasOpenInvitation(tx: DbExecutor, raceId: string, email: string, kind: InvitationKind): Promise<boolean> {
  const rows = await tx.select({ role: invitations.role }).from(invitations)
    .where(and(eq(invitations.raceId, raceId), eq(invitations.email, email), open)).limit(20);
  return rows.some(row => invitationKind(row.role) === kind);
}

/**
 * Har adressen redan en gällande behörighet av samma slag på tävlingen? Den syns då redan i listan under Personer med
 * behörighet, så svaret avslöjar inget nytt om kontot. Ägare och administratörer har redan banläggningen.
 */
export async function alreadyGranted(tx: DbExecutor, input: { eventId: string; raceId: string; email: string; kind: InvitationKind }): Promise<boolean> {
  const [account] = await tx.select({ id: schema.userAccounts.id }).from(schema.userAccounts).where(eq(schema.userAccounts.email, input.email));
  if (!account) return false;
  const grants = await tx.select({ role: schema.eventAdministrationGrants.role }).from(schema.eventAdministrationGrants)
    .leftJoin(schema.eventAdministrationGrantRevocations, eq(schema.eventAdministrationGrantRevocations.grantId, schema.eventAdministrationGrants.id))
    .where(and(eq(schema.eventAdministrationGrants.accountId, account.id), eq(schema.eventAdministrationGrants.eventId, input.eventId),
      isNull(schema.eventAdministrationGrantRevocations.id)));
  if (input.kind === "EVENT") return grants.length > 0;
  if (grants.some(grant => grant.role === "OWNER" || grant.role === "ADMIN")) return true;
  const [course] = await tx.select({ id: schema.courseSettingGrants.id }).from(schema.courseSettingGrants)
    .where(and(eq(schema.courseSettingGrants.raceId, input.raceId), eq(schema.courseSettingGrants.accountId, account.id)));
  return Boolean(course);
}

/** Tar bort en öppen inbjudan (Ta bort i listan). Undefined om den inte finns eller redan är tagen. */
export async function revokeRacePersonInvitation(tx: DbExecutor, input: { raceId: string; invitationId: string; actorAccountId: string;
  requestId: string; now: Date }) {
  const [row] = await tx.update(invitations).set({ revokedAt: input.now })
    .where(and(eq(invitations.id, input.invitationId), eq(invitations.raceId, input.raceId), open)).returning();
  if (!row) return undefined;
  await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "race_person_invitation", entityId: row.id,
    action: "RACE_PERSON_INVITATION_REVOKED", actorKind: "USER_ACCOUNT", actorId: input.actorAccountId, requestId: input.requestId,
    createdAt: input.now, after: { invitationId: row.id, role: row.role, revokedAt: input.now.toISOString() } });
  return row;
}

/** Låser inbjudningarna för samma adress på tävlingen (två samtidiga "Lägg till" ger en rad). */
export async function lockInvitationEmail(tx: DbExecutor, raceId: string, email: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`race-person-invitation:${raceId}:${email}`}, 0))`);
}
