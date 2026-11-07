import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  mapProjectCreateRequestSchema, mapProjectInviteRequestSchema, mapProjectMemberRemoveRequestSchema, mapProjectMemberRoleRequestSchema,
  mapProjectUpdateRequestSchema, type InvitationMailOutcome, type MapProjectList, type MapProjectMemberView, type MapProjectRole,
  type MapProjectSummary, type MapProjectView
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { MAP_READER_VERSION } from "@o-tid/map-file";
import { clubJournal, clubMembership, clubRoleAtLeast, requireClubRole, type ClubFailure, type ClubProof } from "./club-access";
import { deliverPrepared, invitationSentTimes, prepareIfMail, replayedOutcome, type InvitationMailer } from "./invitation-links";
import {
  addMapProjectMember, mapProjectAllows, mapProjectRoleOf, openMapProjectInvitations, requireMapProject,
  type MapProjectRow
} from "./map-project-access";
import { authenticateUserAccountSessionForProtectedRead } from "./user-account";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0219: kartprojekten – lista, starta, läsa, byta namn, avsluta och medlemmarna. Synken finns i `map-project-sync.ts`,
 * den nya kartversionen och exporten i `map-project-output.ts`. Behörigheten avgörs i `map-project-access.ts`.
 */
const LIST_LIMIT = 200;
const ROLE_ORDER: Record<MapProjectRole, number> = { OWNER: 0, EDIT: 1, READ: 2 };

async function summaries(tx: DbExecutor, rows: readonly MapProjectRow[], roles: ReadonlyMap<string, MapProjectRole>): Promise<MapProjectSummary[]> {
  if (rows.length === 0) return [];
  const ids = rows.map(row => row.id);
  const versions = new Map((await tx.select({ id: schema.clubMapVersions.id, mapId: schema.clubMapVersions.mapId, fileName: schema.clubMapVersions.fileName,
    format: schema.clubMapVersions.format, versionDate: schema.clubMapVersions.versionDate, mapName: schema.clubMaps.name })
    .from(schema.clubMapVersions).innerJoin(schema.clubMaps, eq(schema.clubMaps.id, schema.clubMapVersions.mapId))
    .where(inArray(schema.clubMapVersions.id, [...new Set(rows.map(row => row.baseVersionId))]))).map(row => [row.id, row]));
  const clubs = new Map((await tx.select({ id: schema.clubs.id, name: schema.clubs.name }).from(schema.clubs)
    .where(inArray(schema.clubs.id, [...new Set(rows.map(row => row.clubId))]))).map(row => [row.id, row.name]));
  // Nya objekt som tagits bort igen och objekt som är tillbaka som i grundfilen räknas inte.
  const changed = new Map((await tx.select({ id: schema.mapProjectObjects.projectId, value: count() }).from(schema.mapProjectObjects)
    .where(and(inArray(schema.mapProjectObjects.projectId, ids),
      sql`not (${schema.mapProjectObjects.objectKey} like 'n:%' and ${schema.mapProjectObjects.state}->>'kind' = 'DELETED')`,
      sql`${schema.mapProjectObjects.state}->>'kind' <> 'UNCHANGED'`))
    .groupBy(schema.mapProjectObjects.projectId)).map(row => [row.id, row.value]));
  const outputs = await tx.select({ projectId: schema.mapProjectOutputs.projectId, versionId: schema.mapProjectOutputs.versionId,
    changes: schema.mapProjectOutputs.changes, createdAt: schema.mapProjectOutputs.createdAt, fileName: schema.clubMapVersions.fileName })
    .from(schema.mapProjectOutputs).innerJoin(schema.clubMapVersions, eq(schema.clubMapVersions.id, schema.mapProjectOutputs.versionId))
    .where(inArray(schema.mapProjectOutputs.projectId, ids)).orderBy(asc(schema.mapProjectOutputs.createdAt));
  return rows.flatMap(row => {
    const base = versions.get(row.baseVersionId);
    const role = roles.get(row.id);
    if (!base || !role) return [];
    return [{ projectId: row.id, name: row.name, status: row.status, role, club: { clubId: row.clubId, name: clubs.get(row.clubId) ?? "" },
      base: { versionId: base.id, mapId: base.mapId, mapName: base.mapName, fileName: base.fileName, format: base.format,
        versionDate: base.versionDate, sha256: row.baseSha256 },
      createdAt: row.createdAt.toISOString(), closedAt: row.closedAt?.toISOString() ?? null, changedObjects: changed.get(row.id) ?? 0,
      outputs: outputs.filter(output => output.projectId === row.id).map(output => ({ versionId: output.versionId, fileName: output.fileName,
        changes: output.changes, createdAt: output.createdAt.toISOString() })) }];
  });
}

/** Kontots projekt (som medlem eller som administratör i projektets klubb), nyaste först. Tar inbjudningar först. */
export async function listMapProjects(db: Database, input: ClubProof, now = new Date()): Promise<ClubFailure | { status: "ok"; list: MapProjectList }> {
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForProtectedRead(tx, input, now);
    if (auth.status !== "authenticated") return auth;
    const accountId = auth.principal.accountId;
    const rows = (await tx.execute<{ id: string }>(sql`select p.id from map_project p where exists (
        select 1 from map_project_member m where m.project_id = p.id and m.account_id = ${accountId})
      or exists (select 1 from club_member c where c.club_id = p.club_id and c.account_id = ${accountId} and c.role in ('OWNER', 'ADMIN'))
      order by p.created_at desc limit ${LIST_LIMIT}`)).rows.map(row => row.id);
    const projects = rows.length ? await tx.select().from(schema.mapProjects).where(inArray(schema.mapProjects.id, rows))
      .orderBy(desc(schema.mapProjects.createdAt)) : [];
    const roles = new Map<string, MapProjectRole>();
    for (const project of projects) {
      const role = await mapProjectRoleOf(tx, accountId, project);
      if (role) roles.set(project.id, role);
    }
    return { status: "ok", list: { formatVersion: 1, projects: await summaries(tx, projects, roles) } } as const;
  });
}

/** Nytt projekt från en kartversion i klubbens arkiv (klubbens administratörer och ägare). Idempotent på `requestId`. */
export async function createMapProject(db: Database, input: ClubProof & { request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "created"; replayed: boolean; projectId: string }> {
  const parsed = mapProjectCreateRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  const { requestId, clubId, baseVersionId, name } = parsed.data;
  return db.transaction(async tx => {
    const member = await requireClubRole(tx, { ...input, clubId }, "ADMIN", now, true);
    if (member.status !== "ok") return member;
    const [prior] = await tx.select().from(schema.mapProjects).where(eq(schema.mapProjects.requestId, requestId));
    if (prior) {
      if (prior.clubId !== clubId || prior.baseVersionId !== baseVersionId) return { status: "conflict" } as const;
      return { status: "created", replayed: true, projectId: prior.id } as const;
    }
    const [version] = await tx.select().from(schema.clubMapVersions)
      .where(and(eq(schema.clubMapVersions.id, baseVersionId), eq(schema.clubMapVersions.clubId, clubId)));
    if (!version) return { status: "not-found" } as const;
    const projectId = randomUUID();
    await tx.insert(schema.mapProjects).values({ id: projectId, clubId, name, baseVersionId, baseSha256: version.contentSha256,
      baseFormat: version.format, readerVersion: MAP_READER_VERSION, status: "OPEN", seq: 0, createdBy: member.accountId, createdAt: now, requestId });
    await addMapProjectMember(tx, { projectId, accountId: member.accountId, role: "OWNER", addedBy: member.accountId, now });
    await clubJournal(tx, { clubId, action: "MAP_PROJECT_CREATED", actorAccountId: member.accountId, details: { projectId, baseVersionId }, now });
    return { status: "created", replayed: false, projectId } as const;
  });
}

async function members(tx: DbExecutor, project: MapProjectRow): Promise<MapProjectMemberView[]> {
  const rows = await tx.select({ accountId: schema.mapProjectMembers.accountId, role: schema.mapProjectMembers.role,
    lastSeenAt: schema.mapProjectMembers.lastSeenAt, name: schema.userAccounts.displayName })
    .from(schema.mapProjectMembers).innerJoin(schema.userAccounts, eq(schema.userAccounts.id, schema.mapProjectMembers.accountId))
    .where(eq(schema.mapProjectMembers.projectId, project.id)).limit(2000);
  const edits = new Map((await tx.select({ accountId: schema.mapProjectEdits.authorAccountId, value: count() }).from(schema.mapProjectEdits)
    .where(and(eq(schema.mapProjectEdits.projectId, project.id), eq(schema.mapProjectEdits.status, "APPLIED")))
    .groupBy(schema.mapProjectEdits.authorAccountId)).map(row => [row.accountId, row.value]));
  return rows.map(row => ({ accountId: row.accountId, name: row.name, role: row.role, lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    edits: edits.get(row.accountId) ?? 0 }))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name, "sv"));
}

export async function readMapProject(db: Database, input: ClubProof & { projectId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; view: MapProjectView }> {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "view", false);
    if (access.status !== "ok") return access;
    const { project, role, accountId } = access;
    const [summary] = await summaries(tx, [project], new Map([[project.id, role]]));
    if (!summary) return { status: "not-found" } as const;
    const canManage = mapProjectAllows(role, project, "manage");
    const open = canManage ? await openMapProjectInvitations(tx, project.id) : [];
    const sent = await invitationSentTimes(tx, "MAP_PROJECT", open.map(row => row.id));
    const club = await clubMembership(tx, { accountId, clubId: project.clubId }, "none");
    return { status: "ok", view: { ...summary, formatVersion: 1,
      viewer: { accountId, canEdit: mapProjectAllows(role, project, "edit"), canManage, canWriteVersion: canManage && !!club && clubRoleAtLeast(club.role, "ADMIN") },
      readerVersion: project.readerVersion, seq: project.seq, members: await members(tx, project),
      invitations: open.map(row => ({ invitationId: row.id, email: row.email, role: row.role, createdAt: row.createdAt.toISOString(),
        sentAt: sent.get(row.id)?.toISOString() ?? null })) } } as const;
  });
}

/** Byt namn, avsluta eller öppna igen (projektets ägare). */
export async function updateMapProject(db: Database, input: ClubProof & { projectId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok" }> {
  const parsed = mapProjectUpdateRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "manage", true);
    if (access.status !== "ok") return access;
    if (!parsed.success) return { status: "invalid-request" } as const;
    const { name, status } = parsed.data;
    const closing = status && status !== access.project.status ? status : undefined;
    await tx.update(schema.mapProjects).set({ ...(name ? { name } : {}),
      ...(closing === "CLOSED" ? { status: "CLOSED", closedAt: now, closedBy: access.accountId } : {}),
      ...(closing === "OPEN" ? { status: "OPEN", closedAt: null, closedBy: null } : {}) }).where(eq(schema.mapProjects.id, access.project.id));
    await clubJournal(tx, { clubId: access.project.clubId, action: closing === "CLOSED" ? "MAP_PROJECT_CLOSED" : closing === "OPEN"
      ? "MAP_PROJECT_REOPENED" : "MAP_PROJECT_RENAMED", actorAccountId: access.accountId, details: { projectId: access.project.id }, now });
    return { status: "ok" } as const;
  });
}

/** Bjud in med e-post (projektets ägare). Svaret säger aldrig om adressen har ett konto. */
export async function inviteMapProjectMember(db: Database, input: ClubProof & { projectId: string; request: unknown }, now = new Date(),
  mailer?: InvitationMailer): Promise<ClubFailure | { status: "invited"; replayed: boolean; invitationId: string; mail: InvitationMailOutcome }> {
  const parsed = mapProjectInviteRequestSchema.safeParse(input.request);
  const result = await db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "manage", true);
    if (access.status !== "ok") return access;
    if (!parsed.success) return { status: "invalid-request" } as const;
    const { requestId, email, role } = parsed.data;
    const projectId = access.project.id;
    const table = schema.mapProjectInvitations;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`map-project-invitation:${projectId}:${email}`}, 0))`);
    const [prior] = await tx.select().from(table).where(eq(table.requestId, requestId));
    if (prior) {
      if (prior.projectId !== projectId || prior.email !== email || prior.role !== role) return { status: "conflict" } as const;
      return { status: "invited", replayed: true, invitationId: prior.id, prepared: undefined } as const;
    }
    const [openInvitation] = await tx.select({ id: table.id }).from(table)
      .where(and(eq(table.projectId, projectId), eq(table.email, email), isNull(table.acceptedAt), isNull(table.revokedAt)));
    const [existing] = await tx.select({ id: schema.mapProjectMembers.accountId }).from(schema.mapProjectMembers)
      .innerJoin(schema.userAccounts, eq(schema.userAccounts.id, schema.mapProjectMembers.accountId))
      .where(and(eq(schema.mapProjectMembers.projectId, projectId), eq(schema.userAccounts.email, email)));
    if (openInvitation || existing) return { status: "conflict" } as const;
    const invitationId = randomUUID();
    await tx.insert(table).values({ id: invitationId, requestId, projectId, email, role, actorAccountId: access.accountId, createdAt: now });
    await clubJournal(tx, { clubId: access.project.clubId, action: "MAP_PROJECT_MEMBER_INVITED", actorAccountId: access.accountId,
      details: { projectId, invitationId, role }, now });
    const prepared = await prepareIfMail(tx, mailer, { kind: "MAP_PROJECT", invitationId }, access.accountId, now);
    return { status: "invited", replayed: false, invitationId, prepared } as const;
  });
  if (result.status !== "invited") return result;
  const { prepared, ...invited } = result;
  const mail = invited.replayed ? await replayedOutcome(db, { kind: "MAP_PROJECT", invitationId: invited.invitationId })
    : (await deliverPrepared(db, prepared, mailer, now)).outcome;
  return { ...invited, mail };
}

async function ownerCount(tx: DbExecutor, projectId: string): Promise<number> {
  const [row] = await tx.select({ value: count() }).from(schema.mapProjectMembers)
    .where(and(eq(schema.mapProjectMembers.projectId, projectId), eq(schema.mapProjectMembers.role, "OWNER")));
  return Number(row?.value ?? 0);
}

/** Byt roll (projektets ägare). Den sista ägaren kan inte bli något annat. */
export async function setMapProjectMemberRole(db: Database, input: ClubProof & { projectId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok" }> {
  const parsed = mapProjectMemberRoleRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "manage", true);
    if (access.status !== "ok") return access;
    if (!parsed.success) return { status: "invalid-request" } as const;
    const members = schema.mapProjectMembers;
    const where = and(eq(members.projectId, access.project.id), eq(members.accountId, parsed.data.accountId));
    const [member] = await tx.select().from(members).where(where).for("update");
    if (!member) return { status: "not-found" } as const;
    if (member.role === "OWNER" && parsed.data.role !== "OWNER" && await ownerCount(tx, access.project.id) <= 1) return { status: "conflict" } as const;
    await tx.update(members).set({ role: parsed.data.role }).where(where);
    await clubJournal(tx, { clubId: access.project.clubId, action: "MAP_PROJECT_MEMBER_ROLE_CHANGED", actorAccountId: access.accountId,
      details: { projectId: access.project.id, accountId: member.accountId, from: member.role, to: parsed.data.role }, now });
    return { status: "ok" } as const;
  });
}

/**
 * Ta bort en medlem eller en öppen inbjudan (projektets ägare; var och en kan också lämna själv). Den sista ägaren kan inte tas
 * bort. Medlemmens ändringar står kvar i projektet.
 */
export async function removeMapProjectMember(db: Database, input: ClubProof & { projectId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "removed" }> {
  const parsed = mapProjectMemberRemoveRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "view", true);
    if (access.status !== "ok") return access;
    if (!parsed.success) return { status: "invalid-request" } as const;
    const projectId = access.project.id;
    const leaving = parsed.data.accountId === access.accountId;
    if (!leaving && !mapProjectAllows(access.role, access.project, "manage")) return { status: "forbidden" } as const;
    if (parsed.data.invitationId) {
      const table = schema.mapProjectInvitations;
      const [row] = await tx.update(table).set({ revokedAt: now }).where(and(eq(table.id, parsed.data.invitationId), eq(table.projectId, projectId),
        isNull(table.acceptedAt), isNull(table.revokedAt))).returning({ id: table.id });
      if (!row) return { status: "not-found" } as const;
      await clubJournal(tx, { clubId: access.project.clubId, action: "MAP_PROJECT_INVITATION_REVOKED", actorAccountId: access.accountId,
        details: { projectId, invitationId: row.id }, now });
      return { status: "removed" } as const;
    }
    const members = schema.mapProjectMembers;
    const where = and(eq(members.projectId, projectId), eq(members.accountId, parsed.data.accountId!));
    const [member] = await tx.select().from(members).where(where).for("update");
    if (!member) return { status: "not-found" } as const;
    if (member.role === "OWNER" && await ownerCount(tx, projectId) <= 1) return { status: "conflict" } as const;
    await tx.delete(members).where(where);
    await clubJournal(tx, { clubId: access.project.clubId, action: "MAP_PROJECT_MEMBER_REMOVED", actorAccountId: access.accountId,
      details: { projectId, accountId: member.accountId, role: member.role }, now });
    return { status: "removed" } as const;
  });
}

/** Grundfilen (innehållets id för strömmen) för projektets medlemmar. */
export async function readMapProjectSource(db: Database, input: ClubProof & { projectId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; fileName: string; format: "OCD" | "OMAP"; byteLength: number; contentId: string; sha256: string }> {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "view", false);
    if (access.status !== "ok") return access;
    const [row] = await tx.select({ fileName: schema.clubMapVersions.fileName, format: schema.clubMapVersions.format,
      byteLength: schema.mapContents.byteLength, contentId: schema.mapContents.contentId, sha256: schema.mapContents.sha256 })
      .from(schema.clubMapVersions).innerJoin(schema.mapContents, eq(schema.mapContents.sha256, access.project.baseSha256))
      .where(eq(schema.clubMapVersions.id, access.project.baseVersionId));
    return row ? { status: "ok", ...row } as const : { status: "not-found" } as const;
  });
}
