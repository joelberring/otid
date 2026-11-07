import { and, eq } from "drizzle-orm";
import { clubAccessSettingsRequestSchema, type ClubAccessSettingsResponse } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";
import { acceptClubInvitations, clubJournal } from "./club-invitations";
import { applyEventorMemberships, clubLinkFacts, derivedClubMembership } from "./club-affiliation-access";
import { CLUB_ROLE_RANK, clubAreaAllowed, type ClubArea } from "@o-tid/domain";
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

export const clubRoleAtLeast = (role: ClubRole, minimum: ClubRole) => CLUB_ROLE_RANK[role] >= CLUB_ROLE_RANK[minimum];

/**
 * Kontots roll i klubben (raden i `club_member`), eller undefined. Bekräftad e-post krävs om någon annan lade till kontot.
 * ADR-0209 beslut 3: utan rad är en bekräftad tillhörighet läsare (när arkivet låter bekräftade medlemmar läsa).
 */
export async function clubMembership(tx: DbExecutor, input: { accountId: string; clubId: string }, lock: "none" | "share" | "update")
  : Promise<{ id: string; role: ClubRole; derived?: true } | undefined> {
  const query = tx.select({ id: schema.clubMembers.id, role: schema.clubMembers.role, addedBy: schema.clubMembers.addedBy })
    .from(schema.clubMembers).where(and(eq(schema.clubMembers.clubId, input.clubId), eq(schema.clubMembers.accountId, input.accountId)));
  const [row] = lock === "share" ? await query.for("share") : lock === "update" ? await query.for("update") : await query;
  if (!row) {
    const derived = await derivedClubMembership(tx, input.accountId, input.clubId);
    return derived ? { ...derived, derived: true } : undefined;
  }
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
  // ADR-0209 beslut B: adressen i klubbens medlemslista i Eventor gör kontot till bekräftad medlem.
  if (!member && await applyEventorMemberships(tx, accountId, now, proof.clubId) > 0) {
    member = await clubMembership(tx, { accountId, clubId: proof.clubId }, write ? "update" : "share");
  }
  if (!member) return { status: "not-found" };
  if (!clubRoleAtLeast(member.role, minimum)) return { status: "forbidden" };
  return { status: "ok", accountId, clubId: proof.clubId, role: member.role };
}

export { acceptClubInvitations, clubJournal };

/**
 * ADR-0209 beslut C: "Vem ser vad". Träningsarkivet (träningar, småbilder, banfiler) och kartbanken (kartfiler, Använd igen,
 * nedladdning) är för alla medlemmar eller bara för ledare och administratörer, som klubben väljer. Ägare och administratörer
 * ser och använder alltid allt. En medlem utan tillgång får 403 (klubben finns för hen).
 */
export async function requireClubArea(tx: ClubTransaction, proof: ClubProof & { clubId: string }, area: ClubArea, now: Date, write: boolean)
  : Promise<ClubFailure | { status: "ok"; accountId: string; clubId: string; role: ClubRole }> {
  const member = await requireClubRole(tx, proof, "READER", now, write);
  if (member.status !== "ok") return member;
  return clubAreaAllowed(member.role, (await clubLinkFacts(tx, proof.clubId)).access[area]) ? member : { status: "forbidden" };
}

/** Vad rollen får i arkivet, för vyerna (knapparna visas bara när servern skulle godta dem). */
export async function clubAreaAccess(tx: DbExecutor, clubId: string, role: ClubRole): Promise<{ archive: boolean; mapBank: boolean }> {
  const { access } = await clubLinkFacts(tx, clubId);
  return { archive: clubAreaAllowed(role, access.ARCHIVE), mapBank: clubAreaAllowed(role, access.MAP_BANK) };
}

/**
 * ADR-0209 beslut C: spara "Vem ser vad" (träningsarkivet och kartbanken för alla medlemmar eller bara ledare och
 * administratörer). Gäller klubbens arkiv oavsett Eventor, så den har en egen route (`…/clubs/[clubId]/access`, städrundan C4;
 * förut på tillhörighetsrutten). Bara ägare och administratörer. Journalförs.
 */
export async function setClubAccessSettings(db: Database, input: ClubProof & { clubId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; response: ClubAccessSettingsResponse }> {
  const parsed = clubAccessSettingsRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const actor = await requireClubRole(tx, input, "ADMIN", now, true);
    if (actor.status !== "ok") return actor;
    // Inloggningen och behörigheten prövas före kroppen (städrundan 2026-11-07): utloggad får 401, inte 400.
    if (!parsed.success) return { status: "invalid-request" } as const;
    const before = await clubLinkFacts(tx, input.clubId);
    const values = { archiveVisibility: parsed.data.archive, mapBankAccess: parsed.data.mapBank, updatedBy: actor.accountId, updatedAt: now };
    await tx.insert(schema.clubSettings).values({ clubId: input.clubId, ...values })
      .onConflictDoUpdate({ target: schema.clubSettings.clubId, set: values });
    if (before.access.ARCHIVE !== parsed.data.archive || before.access.MAP_BANK !== parsed.data.mapBank) {
      await clubJournal(tx, { clubId: input.clubId, action: "CLUB_ACCESS_CHANGED", actorAccountId: actor.accountId,
        details: { from: { archive: before.access.ARCHIVE, mapBank: before.access.MAP_BANK }, to: parsed.data }, now });
    }
    return { status: "ok", response: { formatVersion: 1, access: { archive: parsed.data.archive, mapBank: parsed.data.mapBank } } } as const;
  });
}
