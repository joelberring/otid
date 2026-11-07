import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { CLUB_ROLE_RANK } from "@o-tid/domain";
import type { DbExecutor } from "./snapshot";

/** ADR-0194 beslut 1: klubbens roller (rangordnade) och journalen. Egen fil utan inloggningen (som training-group-invitations). */
export type ClubRole = "OWNER" | "ADMIN" | "LEADER" | "READER";

export async function clubJournal(tx: DbExecutor, input: { clubId: string; action: string; actorAccountId: string | null;
  details: Record<string, unknown>; now: Date }): Promise<void> {
  await tx.insert(schema.clubJournal).values({ id: randomUUID(), clubId: input.clubId, action: input.action, actorAccountId: input.actorAccountId,
    details: input.details, createdAt: input.now });
}

const invitations = schema.clubInvitations;
const open = and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt));

/**
 * ADR-0194 beslut 1 (som ADR-0188 beslut 6): kontots öppna inbjudningar blir medlemskap när adressen är bekräftad och kontot
 * inte spärrat. En inbjudan med högre roll höjer en befintlig medlem; en lägre sänker aldrig. Ger antalet som togs.
 */
export async function acceptClubInvitations(tx: DbExecutor, accountId: string, now: Date, clubId?: string): Promise<number> {
  const [account] = await tx.select({ email: schema.userAccounts.email, verifiedAt: schema.userAccounts.emailVerifiedAt,
    blockedAt: schema.userAccounts.blockedAt }).from(schema.userAccounts).where(eq(schema.userAccounts.id, accountId));
  if (!account || !account.verifiedAt || account.blockedAt) return 0;
  const pending = await tx.select({ id: invitations.id }).from(invitations)
    .where(and(eq(invitations.email, account.email), open, clubId ? eq(invitations.clubId, clubId) : undefined))
    .orderBy(asc(invitations.createdAt)).limit(200);
  let accepted = 0;
  for (const { id } of pending) {
    const [invitation] = await tx.update(invitations).set({ acceptedAt: now, acceptedAccountId: accountId })
      .where(and(eq(invitations.id, id), open)).returning();
    if (!invitation) continue;
    const [member] = await tx.select({ id: schema.clubMembers.id, role: schema.clubMembers.role }).from(schema.clubMembers)
      .where(and(eq(schema.clubMembers.clubId, invitation.clubId), eq(schema.clubMembers.accountId, accountId)));
    if (!member) {
      await tx.insert(schema.clubMembers).values({ id: randomUUID(), clubId: invitation.clubId, accountId, role: invitation.role, addedAt: now,
        addedBy: invitation.actorAccountId, requestId: invitation.requestId });
    } else if (CLUB_ROLE_RANK[invitation.role] > CLUB_ROLE_RANK[member.role]) {
      await tx.update(schema.clubMembers).set({ role: invitation.role }).where(eq(schema.clubMembers.id, member.id));
    }
    await clubJournal(tx, { clubId: invitation.clubId, action: "CLUB_INVITATION_ACCEPTED", actorAccountId: accountId,
      details: { invitationId: invitation.id, role: invitation.role }, now });
    accepted += 1;
  }
  return accepted;
}
