import { randomUUID } from "node:crypto";
import { and, asc, count, eq, gt, inArray, isNull, notInArray, sql } from "drizzle-orm";
import {
  MAP_PROJECT_CLUB_MEMBERS_LIMIT, MAP_PROJECT_JOIN_LINKS_MAX, MAP_PROJECT_JOIN_LINK_LIFETIME_DAYS, mapProjectClubMemberAddRequestSchema,
  mapProjectJoinLinkCreateRequestSchema, mapProjectJoinLinkRevokeRequestSchema, mapProjectJoinTokenRequestSchema,
  type MapProjectClubMembersResponse, type MapProjectJoinLinkInfo, type MapProjectJoinLinkView, type MapProjectRole
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import type { ClubFailure, ClubProof } from "./club-access";
import { addMapProjectMember, mapProjectJournal, mapProjectRoleOf, requireMapProject } from "./map-project-access";
import { newInvitationToken } from "./invitation-links";
import { sha256Hex } from "./serialization";
import type { DbExecutor } from "./snapshot";
import { authenticateUserAccountSessionForMutation } from "./user-account";

/**
 * Ägaren 2026-11-13: bjud in till ett kartprojekt utan e-post. Samma behörighet som e-postinbjudan (projektets ägare, och
 * klubbens administratörer och ägare när projektet hör till en klubb); ingen ny rolltyp.
 * (a) Klubbmedlemmar: ägaren som är medlem i en eller flera klubbar ser bara namnen på de konton som är medlemmar i samma klubb
 * (aldrig e-postadresser) och lägger till dem direkt som medlemmar i projektet.
 * (b) Länk: en nyckel (32 slumpade byte, bara sha256 sparas, som `invitation_link`) med en roll; var och en som öppnar den
 * inloggad blir medlem. Den gäller 14 dagar, kan användas av flera och kan tas bort. Den slutar gälla om den som skapade
 * länken inte längre får hantera medlemmar.
 */
const LIFETIME_MS = MAP_PROJECT_JOIN_LINK_LIFETIME_DAYS * 24 * 60 * 60 * 1000;
const RANK: Record<MapProjectRole, number> = { READ: 0, SUGGEST: 1, EDIT: 2, OWNER: 3 };
const joinLinks = schema.mapProjectJoinLinks;

/** Klubbarna kontot är medlem i (id och namn). */
async function clubsOf(tx: DbExecutor, accountId: string): Promise<{ clubId: string; name: string }[]> {
  return tx.select({ clubId: schema.clubs.id, name: schema.clubs.name }).from(schema.clubMembers)
    .innerJoin(schema.clubs, eq(schema.clubs.id, schema.clubMembers.clubId)).where(eq(schema.clubMembers.accountId, accountId)).limit(200);
}

/** Konton som får läggas till: inte spärrade, inte gäster. */
const usable = and(isNull(schema.userAccounts.blockedAt), isNull(schema.userAccounts.guestExpiresAt));

/**
 * Klubbmedlemmarna som ägaren kan lägga till: konton i samma klubb(ar) som ägaren, inte redan med i projektet, som namn
 * (sökt med `query`) och klubbens namn. Utan klubb blir listan tom.
 */
export async function listMapProjectClubMembers(db: Database, input: ClubProof & { projectId: string; query?: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; response: MapProjectClubMembersResponse }> {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "manage", false);
    if (access.status !== "ok") return access;
    const clubs = await clubsOf(tx, access.accountId);
    if (clubs.length === 0) return { status: "ok", response: { formatVersion: 1, clubs: [], members: [] } } as const;
    const query = (input.query ?? "").trim().slice(0, 100);
    const members = await tx.select({ accountId: schema.userAccounts.id, name: schema.userAccounts.displayName, clubName: schema.clubs.name })
      .from(schema.clubMembers).innerJoin(schema.userAccounts, eq(schema.userAccounts.id, schema.clubMembers.accountId))
      .innerJoin(schema.clubs, eq(schema.clubs.id, schema.clubMembers.clubId))
      .where(and(inArray(schema.clubMembers.clubId, clubs.map(club => club.clubId)), usable,
        notInArray(schema.userAccounts.id, [access.accountId]),
        sql`not exists (select 1 from map_project_member m where m.project_id = ${access.project.id}::uuid and m.account_id = ${schema.userAccounts.id})`,
        query ? sql`position(lower(${query}) in lower(${schema.userAccounts.displayName})) > 0` : undefined))
      .orderBy(asc(schema.userAccounts.displayName), asc(schema.userAccounts.id)).limit(MAP_PROJECT_CLUB_MEMBERS_LIMIT * 4);
    const byAccount = new Map<string, { accountId: string; name: string; clubNames: string[] }>();
    for (const row of members) {
      const entry = byAccount.get(row.accountId) ?? { accountId: row.accountId, name: row.name, clubNames: [] };
      if (!entry.clubNames.includes(row.clubName)) entry.clubNames.push(row.clubName);
      byAccount.set(row.accountId, entry);
    }
    return { status: "ok", response: { formatVersion: 1, clubs: clubs.map(club => club.name).sort((a, b) => a.localeCompare(b, "sv")),
      members: [...byAccount.values()].slice(0, MAP_PROJECT_CLUB_MEMBERS_LIMIT) } } as const;
  });
}

/**
 * Lägger en klubbmedlem till som medlem i projektet. Kontot måste vara medlem i en klubb som också ägaren är medlem i, annars
 * "not-found" (kontot röjs inte). Redan medlem ger "conflict".
 */
export async function addMapProjectClubMember(db: Database, input: ClubProof & { projectId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "added" }> {
  const parsed = mapProjectClubMemberAddRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "manage", true);
    if (access.status !== "ok") return access;
    if (!parsed.success) return { status: "invalid-request" } as const;
    const { accountId, role } = parsed.data;
    const clubs = await clubsOf(tx, access.accountId);
    const [shared] = clubs.length === 0 || accountId === access.accountId ? [] : await tx.select({ id: schema.userAccounts.id }).from(schema.clubMembers)
      .innerJoin(schema.userAccounts, eq(schema.userAccounts.id, schema.clubMembers.accountId))
      .where(and(eq(schema.clubMembers.accountId, accountId), inArray(schema.clubMembers.clubId, clubs.map(club => club.clubId)), usable)).limit(1);
    if (!shared) return { status: "not-found" } as const;
    const [member] = await tx.select({ role: schema.mapProjectMembers.role }).from(schema.mapProjectMembers)
      .where(and(eq(schema.mapProjectMembers.projectId, access.project.id), eq(schema.mapProjectMembers.accountId, accountId)));
    if (member) return { status: "conflict" } as const;
    await addMapProjectMember(tx, { projectId: access.project.id, accountId, role, addedBy: access.accountId, now });
    await mapProjectJournal(tx, access.project, { action: "MAP_PROJECT_MEMBER_ADDED", actorAccountId: access.accountId,
      details: { projectId: access.project.id, accountId, role, via: "CLUB" }, now });
    return { status: "added" } as const;
  });
}

/** Projektets öppna länkar (listan Medlemmar), de äldsta först. */
export async function openMapProjectJoinLinks(tx: DbExecutor, projectId: string, now: Date): Promise<MapProjectJoinLinkView[]> {
  const rows = await tx.select({ id: joinLinks.id, role: joinLinks.role, createdAt: joinLinks.createdAt, expiresAt: joinLinks.expiresAt })
    .from(joinLinks).where(and(eq(joinLinks.projectId, projectId), isNull(joinLinks.revokedAt), gt(joinLinks.expiresAt, now)))
    .orderBy(asc(joinLinks.createdAt), asc(joinLinks.id)).limit(MAP_PROJECT_JOIN_LINKS_MAX);
  return rows.map(row => ({ linkId: row.id, role: row.role, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString() }));
}

/** Skapar en länk med en roll (projektets ägare). Nyckeln ges bara här; högst 20 öppna länkar per projekt ("conflict"). */
export async function createMapProjectJoinLink(db: Database, input: ClubProof & { projectId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "created"; linkId: string; token: string; expiresAt: Date }> {
  const parsed = mapProjectJoinLinkCreateRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "manage", true);
    if (access.status !== "ok") return access;
    if (!parsed.success) return { status: "invalid-request" } as const;
    const projectId = access.project.id;
    const [open] = await tx.select({ value: count() }).from(joinLinks)
      .where(and(eq(joinLinks.projectId, projectId), isNull(joinLinks.revokedAt), gt(joinLinks.expiresAt, now)));
    if (Number(open?.value ?? 0) >= MAP_PROJECT_JOIN_LINKS_MAX) return { status: "conflict" } as const;
    const { token, tokenHash } = newInvitationToken();
    const linkId = randomUUID();
    const expiresAt = new Date(now.getTime() + LIFETIME_MS);
    await tx.insert(joinLinks).values({ id: linkId, projectId, tokenHash, role: parsed.data.role, issuedBy: access.accountId, createdAt: now, expiresAt });
    await mapProjectJournal(tx, access.project, { action: "MAP_PROJECT_JOIN_LINK_CREATED", actorAccountId: access.accountId,
      details: { projectId, linkId, role: parsed.data.role }, now });
    return { status: "created", linkId, token, expiresAt } as const;
  });
}

/** Tar bort en länk (projektets ägare). Den som redan gått med står kvar som medlem. */
export async function revokeMapProjectJoinLink(db: Database, input: ClubProof & { projectId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "removed" }> {
  const parsed = mapProjectJoinLinkRevokeRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "manage", true);
    if (access.status !== "ok") return access;
    if (!parsed.success) return { status: "invalid-request" } as const;
    const [row] = await tx.update(joinLinks).set({ revokedAt: now })
      .where(and(eq(joinLinks.id, parsed.data.linkId), eq(joinLinks.projectId, access.project.id), isNull(joinLinks.revokedAt))).returning({ id: joinLinks.id });
    if (!row) return { status: "not-found" } as const;
    await mapProjectJournal(tx, access.project, { action: "MAP_PROJECT_JOIN_LINK_REVOKED", actorAccountId: access.accountId,
      details: { projectId: access.project.id, linkId: row.id }, now });
    return { status: "removed" } as const;
  });
}

type LoadedLink = { link: typeof joinLinks.$inferSelect; project: typeof schema.mapProjects.$inferSelect };

/** Länken om den gäller: känd, inte borttagen, inte gammal, och den som skapade den får fortfarande hantera medlemmarna. */
async function loadValidLink(tx: DbExecutor, token: string, now: Date): Promise<LoadedLink | undefined> {
  const [link] = await tx.select().from(joinLinks).where(eq(joinLinks.tokenHash, sha256Hex(token)));
  if (!link || link.revokedAt || link.expiresAt.getTime() <= now.getTime()) return undefined;
  const [project] = await tx.select().from(schema.mapProjects).where(eq(schema.mapProjects.id, link.projectId));
  if (!project || await mapProjectRoleOf(tx, link.issuedBy, project) !== "OWNER") return undefined;
  return { link, project };
}

/**
 * Länksidan (utan inloggning): vad länken gäller. "invalid" för okänd, borttagen, gammal eller sådan vars avsändare inte längre
 * får hantera projektet (samma svar).
 */
export async function readMapProjectJoinLink(db: Database, token: string, now = new Date()): Promise<MapProjectJoinLinkInfo> {
  return db.transaction(async tx => {
    const found = await loadValidLink(tx, token, now);
    if (!found) return { formatVersion: 1, status: "invalid" } as const;
    const [issuer] = await tx.select({ displayName: schema.userAccounts.displayName }).from(schema.userAccounts)
      .where(eq(schema.userAccounts.id, found.link.issuedBy));
    return { formatVersion: 1, status: "valid", projectName: found.project.name,
      role: found.link.role as "EDIT" | "SUGGEST" | "READ", inviterName: issuer?.displayName ?? null, expiresAt: found.link.expiresAt.toISOString() } as const;
  });
}

/**
 * Går med med länken (inloggad, bekräftad e-post, inget gäst- eller spärrat konto). Den som redan är medlem får rollen höjd
 * om länkens är högre, aldrig sänkt. Ogiltig länk ger "not-found".
 */
export async function acceptMapProjectJoinLink(db: Database, input: ClubProof & { request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "joined"; projectId: string; role: MapProjectRole; alreadyMember: boolean }> {
  const parsed = mapProjectJoinTokenRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...input, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    const accountId = auth.principal.accountId;
    const [account] = await tx.select({ verifiedAt: schema.userAccounts.emailVerifiedAt, blockedAt: schema.userAccounts.blockedAt,
      guestExpiresAt: schema.userAccounts.guestExpiresAt }).from(schema.userAccounts).where(eq(schema.userAccounts.id, accountId));
    if (!account || account.blockedAt || account.guestExpiresAt || !account.verifiedAt) return { status: "forbidden" } as const;
    const found = await loadValidLink(tx, parsed.data.token, now);
    if (!found) return { status: "not-found" } as const;
    const { link, project } = found;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`map-project-join:${project.id}:${accountId}`}, 0))`);
    const members = schema.mapProjectMembers;
    const where = and(eq(members.projectId, project.id), eq(members.accountId, accountId));
    const [member] = await tx.select({ role: members.role }).from(members).where(where).for("update");
    if (member) {
      if (RANK[link.role] <= RANK[member.role]) return { status: "joined", projectId: project.id, role: member.role, alreadyMember: true } as const;
      await tx.update(members).set({ role: link.role }).where(where);
    } else await addMapProjectMember(tx, { projectId: project.id, accountId, role: link.role, addedBy: link.issuedBy, now });
    await mapProjectJournal(tx, project, { action: "MAP_PROJECT_MEMBER_JOINED", actorAccountId: accountId,
      details: { projectId: project.id, linkId: link.id, role: link.role }, now });
    return { status: "joined", projectId: project.id, role: link.role, alreadyMember: !!member } as const;
  });
}
