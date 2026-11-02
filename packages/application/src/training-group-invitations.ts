import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0189 beslut 9 (som ADR-0188 beslut 6 för tävlingens behörigheter): en ledare eller medlem som läggs till i en
 * träningsgrupp sparas för e-postadressen, oavsett om adressen har ett konto, så att svaret aldrig avslöjar om det finns ett
 * konto. Inbjudan blir ett medlemskap när ett konto med adressen och bekräftad e-post (ADR-0186) loggar in, bekräftar adressen,
 * öppnar Mina tävlingar eller gruppens sida. Ett spärrat konto får inget. Två samtidiga anrop tar inbjudan bara en gång.
 */
const invitations = schema.trainingGroupInvitations;
const open = and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt));

/** Gruppens öppna inbjudningar (listan Ledare och medlemmar). */
export async function openGroupInvitations(tx: DbExecutor, groupId: string) {
  return tx.select({ id: invitations.id, email: invitations.email, role: invitations.role, createdAt: invitations.createdAt })
    .from(invitations).where(and(eq(invitations.groupId, groupId), open)).orderBy(asc(invitations.createdAt), asc(invitations.id)).limit(2000);
}

/** Gör kontots öppna inbjudningar till medlemskap. Kräver bekräftad e-post och ett konto som inte är spärrat. Ger antalet. */
export async function acceptGroupInvitations(tx: DbExecutor, accountId: string, now: Date, groupId?: string): Promise<number> {
  const [account] = await tx.select({ email: schema.userAccounts.email, verifiedAt: schema.userAccounts.emailVerifiedAt,
    blockedAt: schema.userAccounts.blockedAt }).from(schema.userAccounts).where(eq(schema.userAccounts.id, accountId));
  if (!account || !account.verifiedAt || account.blockedAt) return 0;
  const pending = await tx.select({ id: invitations.id }).from(invitations)
    .where(and(eq(invitations.email, account.email), open, groupId ? eq(invitations.groupId, groupId) : undefined))
    .orderBy(asc(invitations.createdAt)).limit(200);
  let accepted = 0;
  for (const { id } of pending) {
    const [invitation] = await tx.update(invitations).set({ acceptedAt: now, acceptedAccountId: accountId })
      .where(and(eq(invitations.id, id), open)).returning();
    if (!invitation) continue;
    const [member] = await tx.select({ id: schema.trainingGroupMembers.id, role: schema.trainingGroupMembers.role })
      .from(schema.trainingGroupMembers).where(and(eq(schema.trainingGroupMembers.groupId, invitation.groupId),
        eq(schema.trainingGroupMembers.accountId, accountId)));
    if (!member) {
      await tx.insert(schema.trainingGroupMembers).values({ id: randomUUID(), groupId: invitation.groupId, accountId, role: invitation.role,
        addedAt: now, addedBy: invitation.actorAccountId, requestId: invitation.requestId });
    } else if (member.role === "MEMBER" && invitation.role === "LEADER") {
      // Ledare är mer än medlem: inbjudan som ledare gör en medlem till ledare.
      await tx.update(schema.trainingGroupMembers).set({ role: "LEADER" }).where(eq(schema.trainingGroupMembers.id, member.id));
    }
    accepted += 1;
  }
  return accepted;
}
