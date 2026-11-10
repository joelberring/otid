import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  CLUB_ARCHIVE_MAP_MAX_BYTES, mapProjectCreateRequestSchema, mapProjectInviteRequestSchema, mapProjectMemberRemoveRequestSchema,
  mapProjectMemberRoleRequestSchema, mapProjectUpdateRequestSchema, mapProjectUploadMetadataSchema, type InvitationMailOutcome, type MapProjectList,
  type MapProjectMemberView, type MapProjectRole, type MapProjectSummary, type MapProjectView
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { MAP_READER_VERSION } from "@o-tid/map-file";
import { requireClubRole, type ClubFailure, type ClubProof } from "./club-access";
import { deliverPrepared, invitationSentTimes, prepareIfMail, replayedOutcome, type InvitationMailer } from "./invitation-links";
import {
  addMapProjectMember, mapProjectAllows, mapProjectBaseFileName, mapProjectCanArchive, mapProjectJournal, mapProjectRoleOf, openMapProjectInvitations,
  requireMapProject, type MapProjectRow
} from "./map-project-access";
import { clearAreaAssignee, mapProjectAreaViews } from "./map-project-areas";
import { openProposalCount } from "./map-project-proposals";
import { contentHead, contentLength, discardStagedMapContent, mapStorageQuota, storeMapContent, type MapContentInput } from "./map-content";
import { mapFileFormatOf } from "./race-map-source";
import { authenticateUserAccountSessionForMutation, authenticateUserAccountSessionForProtectedRead } from "./user-account";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0219: kartprojekten – lista, starta, läsa, byta namn, avsluta, arbetssättet och medlemmarna. Synken finns i
 * `map-project-sync.ts`, den nya kartversionen och exporten i `map-project-output.ts`, delområdena i `map-project-areas.ts` och
 * förslagen i `map-project-proposals.ts`. Behörigheten avgörs i `map-project-access.ts`.
 */
const LIST_LIMIT = 200;
const ROLE_ORDER: Record<MapProjectRole, number> = { OWNER: 0, EDIT: 1, SUGGEST: 2, READ: 3 };

async function summaries(tx: DbExecutor, rows: readonly MapProjectRow[], roles: ReadonlyMap<string, MapProjectRole>): Promise<MapProjectSummary[]> {
  if (rows.length === 0) return [];
  const ids = rows.map(row => row.id);
  const versionIds = [...new Set(rows.flatMap(row => row.baseVersionId ? [row.baseVersionId] : []))];
  const versions = new Map(versionIds.length === 0 ? [] : (await tx.select({ id: schema.clubMapVersions.id, mapId: schema.clubMapVersions.mapId,
    fileName: schema.clubMapVersions.fileName, format: schema.clubMapVersions.format, versionDate: schema.clubMapVersions.versionDate,
    mapName: schema.clubMaps.name })
    .from(schema.clubMapVersions).innerJoin(schema.clubMaps, eq(schema.clubMaps.id, schema.clubMapVersions.mapId))
    .where(inArray(schema.clubMapVersions.id, versionIds))).map(row => [row.id, row]));
  const clubIds = [...new Set(rows.flatMap(row => row.clubId ? [row.clubId] : []))];
  const clubs = new Map(clubIds.length === 0 ? [] : (await tx.select({ id: schema.clubs.id, name: schema.clubs.name }).from(schema.clubs)
    .where(inArray(schema.clubs.id, clubIds))).map(row => [row.id, row.name]));
  // Nya objekt som tagits bort igen och objekt som är tillbaka som i grundfilen räknas inte.
  const changed = new Map((await tx.select({ id: schema.mapProjectObjects.projectId, value: count() }).from(schema.mapProjectObjects)
    .where(and(inArray(schema.mapProjectObjects.projectId, ids),
      sql`not (${schema.mapProjectObjects.objectKey} like 'n:%' and ${schema.mapProjectObjects.state}->>'kind' = 'DELETED')`,
      sql`${schema.mapProjectObjects.state}->>'kind' <> 'UNCHANGED'`))
    .groupBy(schema.mapProjectObjects.projectId)).map(row => [row.id, row.value]));
  // Äldre resultat (0089) har bara kartversionen; nyare har sitt eget filnamn.
  const outputs = await tx.select({ id: schema.mapProjectOutputs.id, projectId: schema.mapProjectOutputs.projectId,
    versionId: schema.mapProjectOutputs.versionId, changes: schema.mapProjectOutputs.changes, createdAt: schema.mapProjectOutputs.createdAt,
    fileName: schema.mapProjectOutputs.fileName, versionFileName: schema.clubMapVersions.fileName })
    .from(schema.mapProjectOutputs).leftJoin(schema.clubMapVersions, eq(schema.clubMapVersions.id, schema.mapProjectOutputs.versionId))
    .where(inArray(schema.mapProjectOutputs.projectId, ids)).orderBy(asc(schema.mapProjectOutputs.createdAt));
  return rows.flatMap(row => {
    const version = row.baseVersionId ? versions.get(row.baseVersionId) : undefined;
    const role = roles.get(row.id);
    if (!role || (row.baseVersionId && !version)) return [];
    const base: MapProjectSummary["base"] = version
      ? { source: "ARCHIVE", versionId: version.id, mapId: version.mapId, mapName: version.mapName, fileName: version.fileName, format: version.format,
        versionDate: version.versionDate, sha256: row.baseSha256 }
      : { source: row.baseSource === "NEW" ? "NEW" : "UPLOAD", versionId: null, mapId: null, mapName: row.name, fileName: row.baseFileName ?? "",
        format: row.baseFormat, versionDate: null, sha256: row.baseSha256 };
    return [{ projectId: row.id, name: row.name, status: row.status, role,
      club: row.clubId ? { clubId: row.clubId, name: clubs.get(row.clubId) ?? "" } : null, base,
      createdAt: row.createdAt.toISOString(), closedAt: row.closedAt?.toISOString() ?? null, changedObjects: changed.get(row.id) ?? 0,
      outputs: outputs.filter(output => output.projectId === row.id).map(output => ({ outputId: output.id, versionId: output.versionId,
        fileName: output.fileName ?? output.versionFileName ?? "", changes: output.changes, createdAt: output.createdAt.toISOString() })) }];
  });
}

/** Kontots projekt (som medlem, eller som administratör i projektets klubb), nyaste först. Tar inbjudningar först. */
export async function listMapProjects(db: Database, input: ClubProof, now = new Date()): Promise<ClubFailure | { status: "ok"; list: MapProjectList }> {
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForProtectedRead(tx, input, now);
    if (auth.status !== "authenticated") return auth;
    return { status: "ok", list: await listMapProjectsForAccount(tx, auth.principal.accountId) } as const;
  });
}

/** Kontots projekt (som medlem eller som administratör i projektets klubb), nyast först. Också för AI-kopplingen (K2). */
export async function listMapProjectsForAccount(tx: DbExecutor, accountId: string): Promise<MapProjectList> {
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
  return { formatVersion: 1, projects: await summaries(tx, projects, roles) };
}

/**
 * Nytt projekt från en kartversion i klubbens arkiv: alla som får läsa arkivet (medlemmar, också Eventor-bekräftade).
 * Projektet hör till klubben, så klubbens administratörer räknas som ägare. Idempotent på `requestId`.
 */
export async function createMapProject(db: Database, input: ClubProof & { request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "created"; replayed: boolean; projectId: string }> {
  const parsed = mapProjectCreateRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  const { requestId, clubId, baseVersionId, name } = parsed.data;
  return db.transaction(async tx => {
    const member = await requireClubRole(tx, { ...input, clubId }, "READER", now, true);
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
    await tx.insert(schema.mapProjects).values({ id: projectId, clubId, name, baseVersionId, baseSource: "ARCHIVE", baseSha256: version.contentSha256,
      baseFormat: version.format, readerVersion: MAP_READER_VERSION, status: "OPEN", seq: 0, createdBy: member.accountId, createdAt: now, requestId });
    await addMapProjectMember(tx, { projectId, accountId: member.accountId, role: "OWNER", addedBy: member.accountId, now });
    await mapProjectJournal(tx, { clubId }, { action: "MAP_PROJECT_CREATED", actorAccountId: member.accountId, details: { projectId, baseVersionId }, now });
    return { status: "created", replayed: false, projectId } as const;
  });
}

export type MapProjectUploadFailure = ClubFailure | { status: "quota" } | { status: "unsupported-file" } | { status: "too-large" };

/**
 * Nytt eget projekt från en uppladdad kartfil (OCAD eller Mapper; alla inloggade, ingen klubb). Filen räknas mot kontots kvot.
 * Idempotent på `requestId`. Det uppladdade innehållet tas bort om projektet inte skapas.
 */
export async function createMapProjectFromUpload(db: Database, input: ClubProof & { metadata: unknown; file: MapContentInput }, now = new Date())
  : Promise<MapProjectUploadFailure | { status: "created"; replayed: boolean; projectId: string }> {
  const parsed = mapProjectUploadMetadataSchema.safeParse(input.metadata);
  const result = await db.transaction(async (tx): Promise<MapProjectUploadFailure | { status: "created"; replayed: boolean; projectId: string }> => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...input, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    if (!parsed.success) return { status: "invalid-request" };
    const accountId = auth.principal.accountId;
    const { requestId, name, fileName } = parsed.data;
    const [prior] = await tx.select().from(schema.mapProjects).where(eq(schema.mapProjects.requestId, requestId));
    if (prior) {
      return prior.createdBy === accountId && prior.clubId === null ? { status: "created", replayed: true, projectId: prior.id } : { status: "conflict" };
    }
    if (contentLength(input.file) > CLUB_ARCHIVE_MAP_MAX_BYTES) return { status: "too-large" };
    const format = mapFileFormatOf(contentHead(input.file));
    if (format !== "OCD" && format !== "OMAP") return { status: "unsupported-file" };
    const stored = await storeMapContent(tx, input.file, accountId, now, mapStorageQuota());
    if (stored.status === "quota") return { status: "quota" };
    const projectId = randomUUID();
    await tx.insert(schema.mapProjects).values({ id: projectId, clubId: null, name, baseVersionId: null, baseFileName: fileName, baseSource: "UPLOAD", baseSha256: stored.sha256,
      baseFormat: format, readerVersion: MAP_READER_VERSION, status: "OPEN", seq: 0, createdBy: accountId, createdAt: now, requestId });
    await addMapProjectMember(tx, { projectId, accountId, role: "OWNER", addedBy: accountId, now });
    return { status: "created", replayed: false, projectId };
  });
  if (result.status !== "created" || result.replayed) {
    if (!(input.file instanceof Uint8Array)) await discardStagedMapContent(db, input.file.contentId);
  }
  return result;
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
    return { status: "ok", view: { ...summary, formatVersion: 1,
      viewer: { accountId, canEdit: mapProjectAllows(role, project, "edit"), canManage, canWriteVersion: canManage,
        canArchive: canManage && await mapProjectCanArchive(tx, accountId, project), canPropose: mapProjectAllows(role, project, "propose"),
        canDecide: canManage },
      mode: project.mode ?? "SHARED", area: project.area ?? null,
      recon: (project.recon as MapProjectView["recon"] | null) ?? null, leaderboard: project.leaderboard ?? null, areas: await mapProjectAreaViews(tx, project.id), openProposals: await openProposalCount(tx, project.id),
      storage: await mapProjectStorage(tx, project.id),
      readerVersion: project.readerVersion, seq: project.seq, members: await members(tx, project),
      invitations: open.map(row => ({ invitationId: row.id, email: row.email, role: row.role, createdAt: row.createdAt.toISOString(),
        sentAt: sent.get(row.id)?.toISOString() ?? null })) } } as const;
  });
}

/** Projektets storlek (ägaren 2026-11-10): filerna i `map_content` en gång var, och raderna med ändringar och foton. */
async function mapProjectStorage(tx: DbExecutor, projectId: string): Promise<{ mapFileBytes: number; totalBytes: number }> {
  const [row] = (await tx.execute<{ map_file: string | null; files: string | null; rows: string | null }>(sql`
    with project as (select base_sha256 from map_project where id = ${projectId}),
    shas as (
      select base_sha256 as sha from project
      union select content_sha256 from map_project_output where project_id = ${projectId} and content_sha256 is not null
      union select content_sha256 from map_project_layer where project_id = ${projectId}
      union select output.content_sha256 from map_project_geo_output output join map_project_geo_job job on job.id = output.job_id
        where job.project_id = ${projectId})
    select (select byte_length from map_content where sha256 = (select base_sha256 from project))::bigint as map_file,
      (select coalesce(sum(byte_length), 0) from map_content where sha256 in (select sha from shas))::bigint as files,
      ((select coalesce(sum(pg_column_size(state)), 0) from map_project_edit where project_id = ${projectId})
        + (select coalesce(sum(pg_column_size(photo)), 0) from map_project_note where project_id = ${projectId}))::bigint as rows`)).rows;
  return { mapFileBytes: Number(row?.map_file ?? 0), totalBytes: Number(row?.files ?? 0) + Number(row?.rows ?? 0) };
}

/** Byt namn, avsluta eller öppna igen, byt arbetssätt eller rekningens inställningar (projektets ägare). */
export async function updateMapProject(db: Database, input: ClubProof & { projectId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok" }> {
  const parsed = mapProjectUpdateRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "manage", true);
    if (access.status !== "ok") return access;
    if (!parsed.success) return { status: "invalid-request" } as const;
    const { name, status, mode, recon, leaderboard } = parsed.data;
    const closing = status && status !== access.project.status ? status : undefined;
    // Gemensamt lagras som null (rader från före 0091 har null).
    await tx.update(schema.mapProjects).set({ ...(name ? { name } : {}), ...(mode ? { mode: mode === "SHARED" ? null : mode } : {}),
      ...(recon !== undefined ? { recon } : {}), ...(leaderboard !== undefined ? { leaderboard } : {}),
      ...(closing === "CLOSED" ? { status: "CLOSED", closedAt: now, closedBy: access.accountId } : {}),
      ...(closing === "OPEN" ? { status: "OPEN", closedAt: null, closedBy: null } : {}) }).where(eq(schema.mapProjects.id, access.project.id));
    await mapProjectJournal(tx, access.project, { action: closing === "CLOSED" ? "MAP_PROJECT_CLOSED" : closing === "OPEN"
      ? "MAP_PROJECT_REOPENED" : name ? "MAP_PROJECT_RENAMED" : mode ? "MAP_PROJECT_MODE_CHANGED" : recon !== undefined ? "MAP_PROJECT_RECON_CHANGED"
      : "MAP_PROJECT_LEADERBOARD_CHANGED", actorAccountId: access.accountId,
      details: { projectId: access.project.id, ...(mode ? { mode } : {}) }, now });
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
    await mapProjectJournal(tx, access.project, { action: "MAP_PROJECT_MEMBER_INVITED", actorAccountId: access.accountId,
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
    await mapProjectJournal(tx, access.project, { action: "MAP_PROJECT_MEMBER_ROLE_CHANGED", actorAccountId: access.accountId,
      details: { projectId: access.project.id, accountId: member.accountId, from: member.role, to: parsed.data.role }, now });
    return { status: "ok" } as const;
  });
}

/**
 * Ta bort en medlem eller en öppen inbjudan (projektets ägare; var och en kan också lämna själv). Den sista ägaren kan inte tas
 * bort. Medlemmens ändringar och förslag står kvar i projektet; delområden som medlemmen fått blir inte utdelade.
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
      await mapProjectJournal(tx, access.project, { action: "MAP_PROJECT_INVITATION_REVOKED", actorAccountId: access.accountId,
        details: { projectId, invitationId: row.id }, now });
      return { status: "removed" } as const;
    }
    const members = schema.mapProjectMembers;
    const where = and(eq(members.projectId, projectId), eq(members.accountId, parsed.data.accountId!));
    const [member] = await tx.select().from(members).where(where).for("update");
    if (!member) return { status: "not-found" } as const;
    if (member.role === "OWNER" && await ownerCount(tx, projectId) <= 1) return { status: "conflict" } as const;
    await tx.delete(members).where(where);
    await clearAreaAssignee(tx, member.accountId, now, projectId);
    await mapProjectJournal(tx, access.project, { action: "MAP_PROJECT_MEMBER_REMOVED", actorAccountId: access.accountId,
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
    const { project } = access;
    const [content] = await tx.select({ byteLength: schema.mapContents.byteLength, contentId: schema.mapContents.contentId,
      sha256: schema.mapContents.sha256 }).from(schema.mapContents).where(eq(schema.mapContents.sha256, project.baseSha256));
    const fileName = await mapProjectBaseFileName(tx, project);
    return content && fileName ? { status: "ok", fileName, format: project.baseFormat, ...content } as const : { status: "not-found" } as const;
  });
}

