import { and, eq } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";
import { acceptClubInvitations } from "./club-invitations";
import { UUID_PATTERN } from "./serialization";
import {
  authenticateUserAccountSessionForMutation, authenticateUserAccountSessionForProtectedRead, type UserAccountSessionProof
} from "./user-account";

/**
 * ADR-0194 beslut 1: klubbens roller och inbjudningarna per e-postadress. Det enda stället som avgör vem som får vad i klubben:
 * läsare läser och använder igen, administratörer ändrar, bjuder in och importerar, ägare dessutom ägarna. En som inte är medlem
 * får "not-found" (klubbens existens röjs inte).
 */
export type { ClubRole } from "./club-invitations";
import type { ClubRole } from "./club-invitations";
export type ClubTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type ClubFailure = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" | "name-taken" };
export type ClubProof = UserAccountSessionProof;

export const CLUB_ROLE_RANK: Record<ClubRole, number> = { READER: 0, ADMIN: 1, OWNER: 2 };
export const clubRoleAtLeast = (role: ClubRole, minimum: ClubRole) => CLUB_ROLE_RANK[role] >= CLUB_ROLE_RANK[minimum];

/** Kontots roll i klubben (raden i `club_member`), eller undefined. Bekräftad e-post krävs om någon annan lade till kontot. */
export async function clubMembership(tx: DbExecutor, input: { accountId: string; clubId: string }, lock: "none" | "share" | "update")
  : Promise<{ id: string; role: ClubRole } | undefined> {
  const query = tx.select({ id: schema.clubMembers.id, role: schema.clubMembers.role, addedBy: schema.clubMembers.addedBy })
    .from(schema.clubMembers).where(and(eq(schema.clubMembers.clubId, input.clubId), eq(schema.clubMembers.accountId, input.accountId)));
  const [row] = lock === "share" ? await query.for("share") : lock === "update" ? await query.for("update") : await query;
  if (!row) return undefined;
  if (row.addedBy !== input.accountId) {
    const [account] = await tx.select({ verifiedAt: schema.userAccounts.emailVerifiedAt, blockedAt: schema.userAccounts.blockedAt })
      .from(schema.userAccounts).where(eq(schema.userAccounts.id, input.accountId));
    if (!account?.verifiedAt || account.blockedAt) return undefined;
  }
  return { id: row.id, role: row.role };
}

/** Inloggad medlem med minst rollen `minimum`; annars felet. Läsningar tar inbjudningar till klubben först (som gruppsidan). */
export async function requireClubRole(tx: ClubTransaction, proof: ClubProof & { clubId: string }, minimum: ClubRole, now: Date, write: boolean)
  : Promise<ClubFailure | { status: "ok"; accountId: string; clubId: string; role: ClubRole }> {
  if (!UUID_PATTERN.test(proof.clubId)) return { status: "not-found" };
  const auth = write ? await authenticateUserAccountSessionForMutation(tx, { ...proof, requireCsrf: true }, now)
    : await authenticateUserAccountSessionForProtectedRead(tx, proof, now);
  if (auth.status !== "authenticated") return auth;
  const accountId = auth.principal.accountId;
  let member = await clubMembership(tx, { accountId, clubId: proof.clubId }, write ? "update" : "share");
  if (!member && await acceptClubInvitations(tx, accountId, now, proof.clubId) > 0) {
    member = await clubMembership(tx, { accountId, clubId: proof.clubId }, write ? "update" : "share");
  }
  if (!member) return { status: "not-found" };
  if (!clubRoleAtLeast(member.role, minimum)) return { status: "forbidden" };
  return { status: "ok", accountId, clubId: proof.clubId, role: member.role };
}

export { acceptClubInvitations, clubJournal } from "./club-invitations";
