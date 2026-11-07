import { and, asc, eq, isNull } from "drizzle-orm";
import type { MapProjectRole } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { clubJournal, clubMembership, clubRoleAtLeast, type ClubFailure, type ClubProof } from "./club-access";
import { UUID_PATTERN } from "./serialization";
import type { DbExecutor } from "./snapshot";
import { authenticateUserAccountSessionForMutation, authenticateUserAccountSessionForProtectedRead } from "./user-account";

/**
 * ADR-0219 beslut 2–3: behörigheten i kartprojekten finns bara här.
 * - Ägare (`OWNER`) hanterar medlemmar, byter namn, avslutar och öppnar igen; Ändra (`EDIT`) ändrar kartan; Läsa (`READ`) ser
 *   kartan, ändringarna och vem som gjort dem.
 * - Ett projekt ägs av sina medlemmar; klubben är valfri (rättelsen 2026-11-07). Hör projektet till en klubb har klubbens
 *   administratörer och ägare samma rätt som projektets ägare, så att det aldrig blir utan någon som kan hantera det. Ett eget
 *   projekt kan inte bli utan ägare: den sista ägaren kan inte lämna och inte ta bort sitt konto medan andra är med
 *   (`soleOwnerships`); är ägaren ensam tas projektet bort med kontot.
 * - En som inte är medlem får "not-found" (projektets existens röjs inte).
 * Inbjudningar till projektet tas när projektet öppnas, som för klubbar och grupper.
 */
export type MapProjectTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type MapProjectRow = typeof schema.mapProjects.$inferSelect;
export type MapProjectNeed = "view" | "edit" | "manage";

const RANK: Record<MapProjectRole, number> = { READ: 0, EDIT: 1, OWNER: 2 };
export const mapProjectRoleAtLeast = (role: MapProjectRole, minimum: MapProjectRole) => RANK[role] >= RANK[minimum];
const higher = (a: MapProjectRole | undefined, b: MapProjectRole | undefined) => !a ? b : !b ? a : RANK[a] >= RANK[b] ? a : b;

const invitations = schema.mapProjectInvitations;
const open = and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt));

/** Projektets öppna inbjudningar (listan Medlemmar). */
export async function openMapProjectInvitations(tx: DbExecutor, projectId: string) {
  return tx.select({ id: invitations.id, email: invitations.email, role: invitations.role, createdAt: invitations.createdAt })
    .from(invitations).where(and(eq(invitations.projectId, projectId), open)).orderBy(asc(invitations.createdAt), asc(invitations.id)).limit(2000);
}

/**
 * Gör kontots öppna inbjudningar till medlemskap (alla, eller bara projektet `projectId`). Kräver bekräftad e-post och ett konto
 * som inte är spärrat. En högre roll ersätter en lägre, aldrig tvärtom. Ger antalet.
 */
export async function acceptMapProjectInvitations(tx: DbExecutor, accountId: string, now: Date, projectId?: string): Promise<number> {
  const [account] = await tx.select({ email: schema.userAccounts.email, verifiedAt: schema.userAccounts.emailVerifiedAt,
    blockedAt: schema.userAccounts.blockedAt }).from(schema.userAccounts).where(eq(schema.userAccounts.id, accountId));
  if (!account || !account.verifiedAt || account.blockedAt) return 0;
  const pending = await tx.select({ id: invitations.id }).from(invitations)
    .where(and(eq(invitations.email, account.email), open, projectId ? eq(invitations.projectId, projectId) : undefined))
    .orderBy(asc(invitations.createdAt)).limit(200);
  let accepted = 0;
  for (const { id } of pending) {
    const [invitation] = await tx.update(invitations).set({ acceptedAt: now, acceptedAccountId: accountId })
      .where(and(eq(invitations.id, id), open)).returning();
    if (!invitation) continue;
    const members = schema.mapProjectMembers;
    const [member] = await tx.select({ role: members.role }).from(members)
      .where(and(eq(members.projectId, invitation.projectId), eq(members.accountId, accountId)));
    if (!member) {
      await tx.insert(members).values({ projectId: invitation.projectId, accountId, role: invitation.role, addedBy: invitation.actorAccountId,
        addedAt: now });
    } else if (higher(member.role, invitation.role) !== member.role) {
      await tx.update(members).set({ role: invitation.role }).where(and(eq(members.projectId, invitation.projectId), eq(members.accountId, accountId)));
    }
    accepted += 1;
  }
  return accepted;
}

/** Kontots roll i projektet: medlemskapet, eller ägare för administratörer och ägare i projektets klubb. Undefined = ingen. */
export async function mapProjectRoleOf(tx: DbExecutor, accountId: string, project: Pick<MapProjectRow, "id" | "clubId">)
  : Promise<MapProjectRole | undefined> {
  const [member] = await tx.select({ role: schema.mapProjectMembers.role }).from(schema.mapProjectMembers)
    .where(and(eq(schema.mapProjectMembers.projectId, project.id), eq(schema.mapProjectMembers.accountId, accountId)));
  const club = project.clubId ? await clubMembership(tx, { accountId, clubId: project.clubId }, "none") : undefined;
  return higher(member?.role, club && clubRoleAtLeast(club.role, "ADMIN") ? "OWNER" : undefined);
}

/** Får kontot lägga projektets resultat i klubbarkivet (projektet hör till en klubb och kontot är administratör där)? */
export async function mapProjectCanArchive(tx: DbExecutor, accountId: string, project: Pick<MapProjectRow, "clubId">): Promise<boolean> {
  if (!project.clubId) return false;
  const club = await clubMembership(tx, { accountId, clubId: project.clubId }, "none");
  return !!club && clubRoleAtLeast(club.role, "ADMIN");
}

/** Vad rollen får i projektet (Ändra bara när projektet är öppet). */
export function mapProjectAllows(role: MapProjectRole, project: Pick<MapProjectRow, "status">, need: MapProjectNeed): boolean {
  if (need === "view") return true;
  if (need === "edit") return project.status === "OPEN" && mapProjectRoleAtLeast(role, "EDIT");
  return role === "OWNER";
}

/** Inloggad medlem med projektet (låst för uppdatering när `write`), eller felet. */
export async function requireMapProject(tx: MapProjectTransaction, proof: ClubProof & { projectId: string }, now: Date, need: MapProjectNeed,
  write: boolean): Promise<ClubFailure | { status: "ok"; accountId: string; role: MapProjectRole; project: MapProjectRow }> {
  if (!UUID_PATTERN.test(proof.projectId)) return { status: "not-found" };
  const auth = write ? await authenticateUserAccountSessionForMutation(tx, { ...proof, requireCsrf: true }, now)
    : await authenticateUserAccountSessionForProtectedRead(tx, proof, now);
  if (auth.status !== "authenticated") return auth;
  const accountId = auth.principal.accountId;
  const query = tx.select().from(schema.mapProjects).where(eq(schema.mapProjects.id, proof.projectId));
  const [project] = write ? await query.for("update") : await query;
  if (!project) return { status: "not-found" };
  let role = await mapProjectRoleOf(tx, accountId, project);
  if (!role && await acceptMapProjectInvitations(tx, accountId, now, project.id) > 0) role = await mapProjectRoleOf(tx, accountId, project);
  if (!role) return { status: "not-found" };
  if (!mapProjectAllows(role, project, need)) return { status: "forbidden" };
  return { status: "ok", accountId, role, project };
}

/** Kontot blir medlem direkt (projektets skapare). */
export async function addMapProjectMember(tx: DbExecutor, input: { projectId: string; accountId: string; role: MapProjectRole; addedBy: string;
  now: Date }): Promise<void> {
  await tx.insert(schema.mapProjectMembers).values({ projectId: input.projectId, accountId: input.accountId, role: input.role,
    addedBy: input.addedBy, addedAt: input.now }).onConflictDoNothing();
}

/**
 * Händelsen i klubbens journal när projektet hör till en klubb. Ett eget projekt har ingen journal utöver ändringsloggen
 * (`map_project_edit`) och medlemslistan.
 */
export async function mapProjectJournal(tx: DbExecutor, project: Pick<MapProjectRow, "clubId">, entry: { action: string; actorAccountId: string;
  details: Record<string, unknown>; now: Date }): Promise<void> {
  if (project.clubId) await clubJournal(tx, { clubId: project.clubId, ...entry });
}

/** Grundfilens namn: kartversionens i arkivet eller projektets eget. */
export async function mapProjectBaseFileName(tx: DbExecutor, project: MapProjectRow): Promise<string | undefined> {
  if (!project.baseVersionId) return project.baseFileName ?? undefined;
  const [version] = await tx.select({ fileName: schema.clubMapVersions.fileName }).from(schema.clubMapVersions)
    .where(eq(schema.clubMapVersions.id, project.baseVersionId));
  return version?.fileName;
}
