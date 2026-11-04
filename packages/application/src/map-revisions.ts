import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import {
  mapRevisionCreateRequestSchema, mapRevisionStatusRequestSchema, type MapRevisionList, type MapRevisionLog, type MapRevisionParticipantView,
  type MapRevisionSummary, type MapRevisionView
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { MAP_READER_VERSION } from "@o-tid/map-file";
import { clubJournal, requireClubRole, type ClubFailure, type ClubProof, type ClubRole, type ClubTransaction } from "./club-access";
import { UUID_PATTERN } from "./serialization";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0208: kartrevideringen i klubbarkivet. En revidering bygger på en kartversion (exakt dess sha256) och samlar
 * ändringarna per objekt. Behörigheten finns bara här:
 * - ägare, administratör och Kartrevidering (`MAP_REVISER`, inbjuden som klubbens andra roller) ändrar;
 * - läsare ser revideringarna och vem som ändrat (klubbens medlemmar ser redan varandras namn);
 * - startar, avslutar och skapar ny kartversion gör ägare och administratörer.
 * En som inte är medlem får "not-found". Kartrevidering ser bara revideringarna (inte träningarna eller andra kartor).
 */
const validId = (id: string) => UUID_PATTERN.test(id);

export const canEditRevision = (role: ClubRole) => role === "OWNER" || role === "ADMIN" || role === "MAP_REVISER";
export const canManageRevision = (role: ClubRole) => role === "OWNER" || role === "ADMIN";

export type RevisionRow = typeof schema.mapRevisions.$inferSelect;

/** Medlemmen med revideringen (låst för uppdatering vid skrivning), eller felet. */
export async function requireRevision(tx: ClubTransaction, input: ClubProof & { clubId: string; revisionId: string }, now: Date,
  need: "view" | "edit" | "manage", lock: boolean)
  : Promise<ClubFailure | { status: "ok"; accountId: string; role: ClubRole; revision: RevisionRow }> {
  if (!validId(input.revisionId)) return { status: "not-found" };
  const member = await requireClubRole(tx, input, "MAP_REVISER", now, need !== "view");
  if (member.status !== "ok") return member;
  const query = tx.select().from(schema.mapRevisions)
    .where(and(eq(schema.mapRevisions.id, input.revisionId), eq(schema.mapRevisions.clubId, input.clubId)));
  const [revision] = lock ? await query.for("update") : await query;
  if (!revision) return { status: "not-found" };
  if (need === "edit" && !canEditRevision(member.role)) return { status: "forbidden" };
  if (need === "manage" && !canManageRevision(member.role)) return { status: "forbidden" };
  return { status: "ok", accountId: member.accountId, role: member.role, revision };
}

async function summaries(tx: DbExecutor, rows: readonly RevisionRow[]): Promise<MapRevisionSummary[]> {
  if (rows.length === 0) return [];
  const versionIds = [...new Set(rows.flatMap(row => [row.baseVersionId, ...(row.resultVersionId ? [row.resultVersionId] : [])]))];
  const versions = new Map((await tx.select({ id: schema.clubMapVersions.id, mapId: schema.clubMapVersions.mapId, fileName: schema.clubMapVersions.fileName,
    format: schema.clubMapVersions.format, versionDate: schema.clubMapVersions.versionDate, mapName: schema.clubMaps.name })
    .from(schema.clubMapVersions).innerJoin(schema.clubMaps, eq(schema.clubMaps.id, schema.clubMapVersions.mapId))
    .where(inArray(schema.clubMapVersions.id, versionIds))).map(row => [row.id, row]));
  const changed = new Map((await tx.select({ id: schema.mapRevisionObjects.revisionId, value: count() }).from(schema.mapRevisionObjects)
    .where(and(inArray(schema.mapRevisionObjects.revisionId, rows.map(row => row.id)),
      sql`not (${schema.mapRevisionObjects.objectKey} like 'n:%' and ${schema.mapRevisionObjects.state}->>'kind' = 'DELETED')`,
      sql`${schema.mapRevisionObjects.state}->>'kind' <> 'UNCHANGED'`))
    .groupBy(schema.mapRevisionObjects.revisionId)).map(row => [row.id, row.value]));
  return rows.flatMap(row => {
    const base = versions.get(row.baseVersionId);
    if (!base) return [];
    const result = row.resultVersionId ? versions.get(row.resultVersionId) : undefined;
    return [{ revisionId: row.id, title: row.title, status: row.status,
      base: { versionId: base.id, mapId: base.mapId, mapName: base.mapName, fileName: base.fileName, format: base.format, versionDate: base.versionDate },
      createdAt: row.createdAt.toISOString(), closedAt: row.closedAt?.toISOString() ?? null, changedObjects: changed.get(row.id) ?? 0,
      result: result ? { versionId: result.id, fileName: result.fileName } : null }];
  });
}

/** Klubbens revideringar, nyaste först (alla medlemmar). */
export async function listMapRevisions(db: Database, input: ClubProof & { clubId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; list: MapRevisionList }> {
  return db.transaction(async tx => {
    const member = await requireClubRole(tx, input, "MAP_REVISER", now, false);
    if (member.status !== "ok") return member;
    const rows = await tx.select().from(schema.mapRevisions).where(eq(schema.mapRevisions.clubId, input.clubId))
      .orderBy(desc(schema.mapRevisions.createdAt)).limit(200);
    return { status: "ok", list: { formatVersion: 1, revisions: await summaries(tx, rows) } } as const;
  });
}

/** Ny revidering av en kartversion (ägare och administratörer). Idempotent på `requestId`. */
export async function createMapRevision(db: Database, input: ClubProof & { clubId: string; request: unknown; sourceRaceId?: string | null }, now = new Date())
  : Promise<ClubFailure | { status: "created"; replayed: boolean; revision: MapRevisionSummary }> {
  const parsed = mapRevisionCreateRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  const { requestId, baseVersionId, title } = parsed.data;
  return db.transaction(async tx => {
    const member = await requireClubRole(tx, input, "ADMIN", now, true);
    if (member.status !== "ok") return member;
    const [prior] = await tx.select().from(schema.mapRevisions).where(eq(schema.mapRevisions.requestId, requestId));
    if (prior) {
      if (prior.clubId !== input.clubId || prior.baseVersionId !== baseVersionId) return { status: "conflict" } as const;
      return { status: "created", replayed: true, revision: (await summaries(tx, [prior]))[0]! } as const;
    }
    const [version] = await tx.select().from(schema.clubMapVersions)
      .where(and(eq(schema.clubMapVersions.id, baseVersionId), eq(schema.clubMapVersions.clubId, input.clubId)));
    if (!version) return { status: "not-found" } as const;
    const id = randomUUID();
    const [row] = await tx.insert(schema.mapRevisions).values({ id, clubId: input.clubId, baseVersionId, baseSha256: version.contentSha256,
      baseFormat: version.format, title, status: "OPEN", seq: 0, readerVersion: MAP_READER_VERSION, sourceRaceId: input.sourceRaceId ?? null,
      createdBy: member.accountId, createdAt: now, requestId }).returning();
    await clubJournal(tx, { clubId: input.clubId, action: "MAP_REVISION_STARTED", actorAccountId: member.accountId,
      details: { revisionId: id, baseVersionId }, now });
    return { status: "created", replayed: false, revision: (await summaries(tx, [row!]))[0]! } as const;
  });
}

/** Kontona som har ändrat, haft revideringen öppen eller får ändra, med namn (bara för revideringens deltagare). */
async function participants(tx: DbExecutor, revision: RevisionRow): Promise<MapRevisionParticipantView[]> {
  const edits = await tx.select({ accountId: schema.mapRevisionEdits.authorAccountId, value: count(),
    last: sql<Date>`max(${schema.mapRevisionEdits.editedAt})` })
    .from(schema.mapRevisionEdits).where(and(eq(schema.mapRevisionEdits.revisionId, revision.id), eq(schema.mapRevisionEdits.status, "APPLIED")))
    .groupBy(schema.mapRevisionEdits.authorAccountId);
  const seen = await tx.select().from(schema.mapRevisionParticipants).where(eq(schema.mapRevisionParticipants.revisionId, revision.id));
  const members = await tx.select({ accountId: schema.clubMembers.accountId, role: schema.clubMembers.role }).from(schema.clubMembers)
    .where(and(eq(schema.clubMembers.clubId, revision.clubId), inArray(schema.clubMembers.role, ["OWNER", "ADMIN", "MAP_REVISER"])));
  const ids = [...new Set([...edits.map(row => row.accountId), ...seen.map(row => row.accountId), ...members.map(row => row.accountId)])];
  if (ids.length === 0) return [];
  const names = new Map((await tx.select({ id: schema.userAccounts.id, name: schema.userAccounts.displayName }).from(schema.userAccounts)
    .where(inArray(schema.userAccounts.id, ids))).map(row => [row.id, row.name]));
  const roles = new Map((await tx.select({ accountId: schema.clubMembers.accountId, role: schema.clubMembers.role }).from(schema.clubMembers)
    .where(and(eq(schema.clubMembers.clubId, revision.clubId), inArray(schema.clubMembers.accountId, ids)))).map(row => [row.accountId, row.role]));
  return ids.map(accountId => {
    const edit = edits.find(row => row.accountId === accountId), visit = seen.find(row => row.accountId === accountId);
    const last = edit?.last ? new Date(edit.last) : undefined;
    return { accountId, displayName: names.get(accountId) ?? "Borttaget konto", role: roles.get(accountId) ?? null, edits: edit?.value ?? 0,
      lastSeenAt: visit?.lastSeenAt.toISOString() ?? null, lastEditAt: last ? last.toISOString() : null };
  }).sort((a, b) => b.edits - a.edits || a.displayName.localeCompare(b.displayName, "sv"));
}

/** Kartans senaste version, om den inte är revideringens grund (grundfilen har ändrats på annat håll). */
export async function newerVersion(tx: DbExecutor, revision: RevisionRow): Promise<MapRevisionView["newerVersion"]> {
  const [base] = await tx.select({ mapId: schema.clubMapVersions.mapId, versionDate: schema.clubMapVersions.versionDate,
    uploadedAt: schema.clubMapVersions.uploadedAt }).from(schema.clubMapVersions).where(eq(schema.clubMapVersions.id, revision.baseVersionId));
  if (!base) return null;
  const [latest] = await tx.select({ id: schema.clubMapVersions.id, fileName: schema.clubMapVersions.fileName, versionDate: schema.clubMapVersions.versionDate,
    uploadedAt: schema.clubMapVersions.uploadedAt }).from(schema.clubMapVersions)
    .where(and(eq(schema.clubMapVersions.mapId, base.mapId), sql`${schema.clubMapVersions.uploadedAt} > ${base.uploadedAt}`,
      revision.resultVersionId ? sql`${schema.clubMapVersions.id} <> ${revision.resultVersionId}` : undefined))
    .orderBy(desc(schema.clubMapVersions.uploadedAt)).limit(1);
  return latest ? { versionId: latest.id, fileName: latest.fileName, versionDate: latest.versionDate, uploadedAt: latest.uploadedAt.toISOString() } : null;
}

export async function readMapRevision(db: Database, input: ClubProof & { clubId: string; revisionId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; view: MapRevisionView }> {
  return db.transaction(async tx => {
    const access = await requireRevision(tx, input, now, "view", false);
    if (access.status !== "ok") return access;
    const { revision } = access;
    const [club] = await tx.select({ name: schema.clubs.name }).from(schema.clubs).where(eq(schema.clubs.id, input.clubId));
    const [content] = await tx.select({ byteLength: schema.clubMapVersions.byteLength }).from(schema.clubMapVersions)
      .where(eq(schema.clubMapVersions.id, revision.baseVersionId));
    const [summary] = await summaries(tx, [revision]);
    if (!club || !content || !summary) return { status: "not-found" } as const;
    return { status: "ok", view: { formatVersion: 1, clubId: input.clubId, clubName: club.name,
      revision: { ...summary, sha256: revision.baseSha256, byteLength: content.byteLength, readerVersion: revision.readerVersion },
      viewer: { accountId: access.accountId, role: access.role, canEdit: canEditRevision(access.role) && revision.status === "OPEN",
        canCreateVersion: canManageRevision(access.role) && revision.status === "OPEN" },
      participants: await participants(tx, revision), newerVersion: await newerVersion(tx, revision) } } as const;
  });
}

/** Avsluta eller öppna igen (ägare och administratörer). En revidering med en ny kartversion öppnas inte igen. */
export async function setMapRevisionStatus(db: Database, input: ClubProof & { clubId: string; revisionId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok" }> {
  const parsed = mapRevisionStatusRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const access = await requireRevision(tx, input, now, "manage", true);
    if (access.status !== "ok") return access;
    const next = parsed.data.status;
    if (access.revision.status === next) return { status: "ok" } as const;
    if (next === "OPEN" && access.revision.resultVersionId) return { status: "conflict" } as const;
    await tx.update(schema.mapRevisions).set(next === "CLOSED" ? { status: next, closedAt: now, closedBy: access.accountId }
      : { status: next, closedAt: null, closedBy: null }).where(eq(schema.mapRevisions.id, access.revision.id));
    await clubJournal(tx, { clubId: input.clubId, action: next === "CLOSED" ? "MAP_REVISION_CLOSED" : "MAP_REVISION_REOPENED",
      actorAccountId: access.accountId, details: { revisionId: access.revision.id }, now });
    return { status: "ok" } as const;
  });
}

/** Grundfilen (innehållets id för strömmen) för revideringens deltagare, också Kartrevidering. */
export async function readMapRevisionBase(db: Database, input: ClubProof & { clubId: string; revisionId: string; which?: "base" | "result" }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; fileName: string; format: "OCD" | "OMAP"; byteLength: number; contentId: string; sha256: string }> {
  return db.transaction(async tx => {
    const access = await requireRevision(tx, input, now, "view", false);
    if (access.status !== "ok") return access;
    const versionId = input.which === "result" ? access.revision.resultVersionId : access.revision.baseVersionId;
    if (!versionId) return { status: "not-found" } as const;
    const [row] = await tx.select({ fileName: schema.clubMapVersions.fileName, format: schema.clubMapVersions.format,
      byteLength: schema.clubMapVersions.byteLength, contentId: schema.mapContents.contentId, sha256: schema.clubMapVersions.contentSha256 })
      .from(schema.clubMapVersions).innerJoin(schema.mapContents, eq(schema.mapContents.sha256, schema.clubMapVersions.contentSha256))
      .where(eq(schema.clubMapVersions.id, versionId));
    return row ? { status: "ok", ...row } as const : { status: "not-found" } as const;
  });
}

/** Loggen (nyaste först, högst `limit`): vad som gjordes, av vem och när, och vilka försök som krockade. */
export async function readMapRevisionLog(db: Database, input: ClubProof & { clubId: string; revisionId: string; limit?: number }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; log: MapRevisionLog }> {
  const limit = Math.max(1, Math.min(5000, input.limit ?? 2000));
  return db.transaction(async tx => {
    const access = await requireRevision(tx, input, now, "view", false);
    if (access.status !== "ok") return access;
    const rows = await tx.select().from(schema.mapRevisionEdits).where(eq(schema.mapRevisionEdits.revisionId, access.revision.id))
      .orderBy(desc(schema.mapRevisionEdits.receivedAt), desc(schema.mapRevisionEdits.seq)).limit(limit + 1);
    return { status: "ok", log: { formatVersion: 1, truncated: rows.length > limit, entries: rows.slice(0, limit).map(row => ({ editId: row.editId,
      key: row.objectKey, kind: row.kind, status: row.status, authorId: row.authorAccountId, editedAt: row.editedAt.toISOString(),
      receivedAt: row.receivedAt.toISOString() })) } } as const;
  });
}
