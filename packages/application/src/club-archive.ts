import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  clubArchiveEntryUpdateRequestSchema, clubCourseFileMapRequestSchema, type ClubArchiveCourseFileView, type ClubArchiveEntryStatus,
  type ClubArchiveEntryView, type ClubArchiveList, type ClubArchiveListItem, type ClubMapVersionView, type ClubMapView
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { versionYearSpan } from "@o-tid/domain";
import { clubAreaAccess, clubJournal, requireClubArea, requireClubRole, type ClubFailure, type ClubProof, type ClubTransaction } from "./club-access";
import { entryThumbnails, forgetEntryThumbnail, mapChecks } from "./club-archive-checks";
import { courseDataPoints, courseFileSummary } from "./club-archive-import";
import { leaderGroups } from "./club-maps";
import { mapMergeHistory } from "./club-map-merge";
import { versionOrder, versionYearOf } from "./club-map-version-order";
import { UUID_PATTERN } from "./serialization";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0194 beslut 2–3: arkivets listor och träningens sida, ändringar av träningen och banfilens karta, och originalfilerna.
 * Listan är hela arkivet (några hundra träningar); sökningen och filtren görs i webbläsaren.
 */
type MapRow = typeof schema.clubMaps.$inferSelect;
type VersionRow = typeof schema.clubMapVersions.$inferSelect;


/**
 * Kartorna med versionerna (senaste först) och hur många träningar som använder varje version. `merges: false` hoppar över
 * sammanslagningshistoriken (tom lista), för "Välj karta från klubbarkivet" som inte visar den.
 */
export async function clubMapViews(tx: DbExecutor, clubId: string, mapIds?: readonly string[], options: { merges?: boolean } = {})
  : Promise<ClubMapView[]> {
  return (await clubMapViewsByClub(tx, [clubId], mapIds, options)).get(clubId) ?? [];
}

/** Högst så många kartor per klubb. */
const MAX_CLUB_MAPS = 2000;

/**
 * Som `clubMapViews` för flera klubbar med samma frågor som för en (B5: "Välj karta från klubbarkivet" frågade förut per
 * klubb). Versionerna fördelas per karta en gång i stället för en genomgång av alla versioner per karta.
 */
export async function clubMapViewsByClub(tx: DbExecutor, clubIds: readonly string[], mapIds?: readonly string[], options: { merges?: boolean } = {})
  : Promise<Map<string, ClubMapView[]>> {
  const result = new Map<string, ClubMapView[]>();
  if (clubIds.length === 0 || (mapIds && mapIds.length === 0)) return result;
  const query = tx.select().from(schema.clubMaps).where(and(inArray(schema.clubMaps.clubId, [...clubIds]),
    mapIds ? inArray(schema.clubMaps.id, [...mapIds]) : undefined)).orderBy(asc(schema.clubMaps.clubId), asc(schema.clubMaps.name));
  const rows = clubIds.length === 1 ? await query.limit(MAX_CLUB_MAPS) : await query;
  const mapsOf = new Map<string, MapRow[]>();
  for (const map of rows) {
    const list = mapsOf.get(map.clubId) ?? [];
    if (list.length < MAX_CLUB_MAPS) list.push(map);
    mapsOf.set(map.clubId, list);
  }
  const maps = [...mapsOf.values()].flat();
  if (maps.length === 0) return result;
  const versions = await tx.select().from(schema.clubMapVersions).where(inArray(schema.clubMapVersions.mapId, maps.map(map => map.id)));
  const clubs = sql.join([...mapsOf.keys()].map(id => sql`${id}`), sql`, `);
  const uses = new Map((await tx.execute<{ version_id: string; trainings: string }>(sql`select version_id, count(distinct entry_id)::text as trainings from (
      select version_id, entry_id from club_archive_entry_map m join club_map_version v on v.id = m.version_id where v.club_id in (${clubs})
      union all select map_version_id, entry_id from club_archive_course_file where club_id in (${clubs}) and map_version_id is not null) u
    group by version_id`)).rows.map(row => [row.version_id, Number(row.trainings)]));
  const checks = await mapChecks(tx, versions.map(version => version.id));
  const versionsOf = new Map<string, VersionRow[]>();
  for (const version of versions) {
    const list = versionsOf.get(version.mapId);
    if (list) list.push(version); else versionsOf.set(version.mapId, [version]);
  }
  for (const [clubId, clubMaps] of mapsOf) {
    const merges = options.merges === false ? new Map<string, ClubMapView["merges"]>()
      : await mapMergeHistory(tx, clubId, clubMaps, clubMaps.flatMap(map => versionsOf.get(map.id) ?? []));
    // Svensk ordning (Å, Ä, Ö sist) oberoende av databasens sortering.
    result.set(clubId, [...clubMaps].sort((a, b) => a.name.localeCompare(b.name, "sv"))
      .map(map => mapView(map, [...versionsOf.get(map.id) ?? []].sort(versionOrder), uses, checks, merges.get(map.id) ?? [])));
  }
  return result;
}

function mapView(map: MapRow, versions: VersionRow[], uses: Map<string, number>, checks: Map<string, ClubMapVersionView["check"] & object>,
  merges: ClubMapView["merges"]): ClubMapView {
  const views: ClubMapVersionView[] = versions.map(version => {
    const year = versionYearOf(version);
    return { versionId: version.id, mapId: version.mapId, fileName: version.fileName,
      format: version.format, byteLength: version.byteLength, versionDate: version.versionDate, note: version.note,
      uploadedAt: version.uploadedAt.toISOString(), sourcePath: version.sourcePath, contentSha256: version.contentSha256,
      trainings: uses.get(version.id) ?? 0, check: checks.get(version.id) ?? null, year: year.year, yearSource: year.source, maker: version.maker };
  });
  return { mapId: map.id, name: map.name, ownership: map.ownership, ownerKind: map.ownerKind, ownerName: map.ownerName, agreement: map.agreement,
    validUntil: map.validUntil, contact: map.contact, trainingOnly: map.trainingOnly, feePerPrint: map.feePerPrint,
    noPublicDisplay: map.noPublicDisplay, versions: views, latestVersionId: views[0]?.versionId ?? null,
    trainings: views.reduce((sum, version) => sum + version.trainings, 0), description: map.description, maker: map.maker,
    years: versionYearSpan(views.map(version => version.year)), merges };
}

type StoredSummary = typeof schema.clubArchiveCourseFiles.$inferSelect["summary"];

/**
 * ADR-0196: banfilens sammanfattning räknas ur filen själv och beror aldrig på kartan. En sammanfattning utan banor (sparad
 * innan läsaren klarade filen, t.ex. IOF XML 2.0.3) räknas om ur innehållet när den visas; "Kontrollera alla kartor igen"
 * sparar den nya.
 */
async function freshSummaries(tx: DbExecutor, files: readonly { id: string; kind: "PPEN" | "COURSE_DATA"; summary: StoredSummary }[])
  : Promise<Map<string, StoredSummary>> {
  const stale = files.filter(file => file.summary.courses.length === 0);
  if (stale.length === 0) return new Map();
  const rows = await tx.select({ id: schema.clubArchiveCourseFiles.id, kind: schema.clubArchiveCourseFiles.kind, content: schema.clubArchiveCourseFiles.content })
    .from(schema.clubArchiveCourseFiles).where(inArray(schema.clubArchiveCourseFiles.id, stale.map(file => file.id)));
  return new Map(rows.map(row => [row.id, courseFileSummary(row.kind, new Uint8Array(row.content))]));
}

const statusOf = (courseFiles: readonly { mapVersionId: string | null; mapResolution: string }[], folderMaps: number): ClubArchiveEntryStatus =>
  courseFiles.length === 0 ? "MAP_ONLY" : courseFiles.some(file => file.mapVersionId === null) ? "MAP_MISSING"
    : courseFiles.some(file => file.mapResolution === "NAME") && folderMaps === 0 ? "COURSES_ONLY" : "COMPLETE";

async function listItems(tx: DbExecutor, clubId: string, entryIds?: readonly string[]): Promise<ClubArchiveListItem[]> {
  const entries = await tx.select().from(schema.clubArchiveEntries).where(and(eq(schema.clubArchiveEntries.clubId, clubId),
    entryIds ? inArray(schema.clubArchiveEntries.id, [...entryIds]) : undefined))
    .orderBy(sql`${schema.clubArchiveEntries.trainingDate} desc nulls last`, desc(schema.clubArchiveEntries.year), asc(schema.clubArchiveEntries.title))
    .limit(5000);
  if (entries.length === 0) return [];
  const ids = entries.map(entry => entry.id);
  const stored = await tx.select({ id: schema.clubArchiveCourseFiles.id, kind: schema.clubArchiveCourseFiles.kind,
    entryId: schema.clubArchiveCourseFiles.entryId, fileName: schema.clubArchiveCourseFiles.fileName, summary: schema.clubArchiveCourseFiles.summary,
    mapVersionId: schema.clubArchiveCourseFiles.mapVersionId, mapResolution: schema.clubArchiveCourseFiles.mapResolution })
    .from(schema.clubArchiveCourseFiles).where(inArray(schema.clubArchiveCourseFiles.entryId, ids));
  const fresh = await freshSummaries(tx, stored);
  const files = stored.map(file => ({ ...file, summary: fresh.get(file.id) ?? file.summary }));
  const folder = await tx.select({ entryId: schema.clubArchiveEntryMaps.entryId, versionId: schema.clubArchiveEntryMaps.versionId })
    .from(schema.clubArchiveEntryMaps).where(inArray(schema.clubArchiveEntryMaps.entryId, ids));
  const versionIds = [...new Set([...folder.map(row => row.versionId), ...files.flatMap(file => file.mapVersionId ? [file.mapVersionId] : [])])];
  const versionMaps = versionIds.length === 0 ? [] : await tx.select({ versionId: schema.clubMapVersions.id, mapId: schema.clubMaps.id, name: schema.clubMaps.name,
    fileName: schema.clubMapVersions.fileName, versionDate: schema.clubMapVersions.versionDate })
    .from(schema.clubMapVersions).innerJoin(schema.clubMaps, eq(schema.clubMaps.id, schema.clubMapVersions.mapId))
    .where(inArray(schema.clubMapVersions.id, versionIds));
  const mapOf = new Map(versionMaps.map(row => [row.versionId, { mapId: row.mapId, name: row.name }]));
  const versionOf = new Map(versionMaps.map(row => [row.versionId, row]));
  // ADR-0196: bilden ritas av första banfilen (i namnordning) som har en karta, annars den nyaste kartan i mappen.
  const sources = new Map(entries.map(entry => {
    const withMap = files.filter(file => file.entryId === entry.id && file.mapVersionId && versionOf.has(file.mapVersionId))
      .sort((a, b) => a.fileName.localeCompare(b.fileName, "sv") || a.id.localeCompare(b.id))[0];
    const inFolder = folder.filter(row => row.entryId === entry.id && versionOf.has(row.versionId)).map(row => versionOf.get(row.versionId)!)
      .sort((a, b) => (b.versionDate ?? "").localeCompare(a.versionDate ?? "") || a.versionId.localeCompare(b.versionId))[0];
    const versionId = withMap?.mapVersionId ?? inFolder?.versionId ?? null;
    return [entry.id, versionId ? { versionId, fileName: versionOf.get(versionId)!.fileName, courseFileId: withMap?.id ?? null } : null] as const;
  }));
  const thumbnails = await entryThumbnails(tx, new Map([...sources].map(([entryId, source]) => [entryId, source?.versionId ?? null])));
  return entries.map(entry => {
    const own = files.filter(file => file.entryId === entry.id);
    const folderMaps = folder.filter(row => row.entryId === entry.id);
    const maps = new Map<string, { mapId: string; name: string }>();
    for (const versionId of [...folderMaps.map(row => row.versionId), ...own.flatMap(file => file.mapVersionId ? [file.mapVersionId] : [])]) {
      const map = mapOf.get(versionId);
      if (map) maps.set(map.mapId, map);
    }
    return { entryId: entry.id, trainingDate: entry.trainingDate, year: entry.year, place: entry.place, title: entry.title, leader: entry.leader,
      tags: entry.tags, courseNames: own.flatMap(file => file.summary.courses.map(course => course.name)).slice(0, 40), courseFiles: own.length,
      maps: [...maps.values()], status: statusOf(own, folderMaps.length), thumbnail: thumbnails.get(entry.id) ?? null,
      thumbnailSource: sources.get(entry.id) ?? null };
  });
}

export async function readClubArchive(db: Database, input: ClubProof & { clubId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; list: ClubArchiveList }> {
  return db.transaction(async tx => {
    const member = await requireClubRole(tx, input, "READER", now, false);
    if (member.status !== "ok") return member;
    const [club] = await tx.select({ name: schema.clubs.name }).from(schema.clubs).where(eq(schema.clubs.id, input.clubId));
    if (!club) return { status: "not-found" } as const;
    // ADR-0209 beslut C: utan tillgång till träningsarkivet är listan tom (klubben och medlemmarna syns ändå).
    const access = await clubAreaAccess(tx, input.clubId, member.role);
    return { status: "ok", list: { formatVersion: 1, clubId: input.clubId, clubName: club.name, viewer: { role: member.role, access },
      entries: access.archive ? await listItems(tx, input.clubId) : [], maps: access.archive ? await clubMapViews(tx, input.clubId) : [] } } as const;
  });
}

async function entryView(tx: ClubTransaction, clubId: string, entryId: string): Promise<Omit<ClubArchiveEntryView, "clubName" | "viewer" | "groups" | "sourceRace"> | undefined> {
  const [item] = await listItems(tx, clubId, [entryId]);
  const [entry] = await tx.select().from(schema.clubArchiveEntries).where(and(eq(schema.clubArchiveEntries.id, entryId), eq(schema.clubArchiveEntries.clubId, clubId)));
  if (!item || !entry) return undefined;
  const storedFiles = await tx.select({ id: schema.clubArchiveCourseFiles.id, kind: schema.clubArchiveCourseFiles.kind, fileName: schema.clubArchiveCourseFiles.fileName,
    byteLength: schema.clubArchiveCourseFiles.byteLength, summary: schema.clubArchiveCourseFiles.summary, mapVersionId: schema.clubArchiveCourseFiles.mapVersionId,
    mapReference: schema.clubArchiveCourseFiles.mapReference, mapResolution: schema.clubArchiveCourseFiles.mapResolution })
    .from(schema.clubArchiveCourseFiles).where(eq(schema.clubArchiveCourseFiles.entryId, entryId)).orderBy(asc(schema.clubArchiveCourseFiles.fileName));
  const fresh = await freshSummaries(tx, storedFiles);
  const files = storedFiles.map(file => ({ ...file, summary: fresh.get(file.id) ?? file.summary }));
  const folder = await tx.select({ versionId: schema.clubArchiveEntryMaps.versionId }).from(schema.clubArchiveEntryMaps)
    .where(eq(schema.clubArchiveEntryMaps.entryId, entryId));
  const versionIds = [...new Set([...folder.map(row => row.versionId), ...files.flatMap(file => file.mapVersionId ? [file.mapVersionId] : [])])];
  const mapIds = versionIds.length === 0 ? [] : [...new Set((await tx.select({ mapId: schema.clubMapVersions.mapId }).from(schema.clubMapVersions)
    .where(inArray(schema.clubMapVersions.id, versionIds))).map(row => row.mapId))];
  const maps = await clubMapViews(tx, clubId, mapIds);
  const versions = new Map(maps.flatMap(map => map.versions.map(version => [version.versionId, { map, version }] as const)));
  const courseDataIds = files.filter(file => file.kind === "COURSE_DATA").map(file => file.id);
  const contents = new Map(courseDataIds.length === 0 ? [] : (await tx.select({ id: schema.clubArchiveCourseFiles.id, content: schema.clubArchiveCourseFiles.content })
    .from(schema.clubArchiveCourseFiles).where(inArray(schema.clubArchiveCourseFiles.id, courseDataIds))).map(row => [row.id, row.content]));
  const courseFiles: ClubArchiveCourseFileView[] = files.map(file => {
    const found = file.mapVersionId ? versions.get(file.mapVersionId) : undefined;
    return { courseFileId: file.id, kind: file.kind, fileName: file.fileName, byteLength: file.byteLength, courses: [...file.summary.courses],
      scale: file.summary.scale, problem: file.summary.problem ?? null, mapReference: file.mapReference, resolution: file.mapResolution,
      mapVersion: found ? { versionId: found.version.versionId, mapId: found.map.mapId, mapName: found.map.name, fileName: found.version.fileName,
        versionDate: found.version.versionDate, latest: found.map.latestVersionId === found.version.versionId } : null,
      courseData: file.kind === "COURSE_DATA" ? courseDataPoints(contents.get(file.id) ?? new Uint8Array()) : null };
  });
  return { formatVersion: 1, clubId, entry: { ...item, notes: entry.notes, sourcePath: entry.sourcePath }, courseFiles, maps,
    folderVersionIds: folder.map(row => row.versionId) };
}

export async function readClubArchiveEntry(db: Database, input: ClubProof & { clubId: string; entryId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; view: ClubArchiveEntryView }> {
  if (!UUID_PATTERN.test(input.entryId)) return { status: "not-found" };
  return db.transaction(async tx => {
    const member = await requireClubArea(tx, input, "ARCHIVE", now, false);
    if (member.status !== "ok") return member;
    const [club] = await tx.select({ name: schema.clubs.name }).from(schema.clubs).where(eq(schema.clubs.id, input.clubId));
    const view = await entryView(tx, input.clubId, input.entryId);
    if (!view || !club) return { status: "not-found" } as const;
    return { status: "ok", view: { ...view, clubName: club.name, viewer: { role: member.role, access: await clubAreaAccess(tx, input.clubId, member.role) },
      sourceRace: await liftedRaceOf(tx, input.clubId, input.entryId), groups: await leaderGroups(tx, member.accountId) } } as const;
  });
}

export async function updateClubArchiveEntry(db: Database, input: ClubProof & { clubId: string; entryId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok" }> {
  const parsed = clubArchiveEntryUpdateRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const member = await requireClubRole(tx, input, "ADMIN", now, true);
    if (member.status !== "ok") return member;
    // Inloggningen och behörigheten prövas före kroppen (städrundan 2026-11-07): utloggad får 401, inte 400.
    if (!parsed.success || !UUID_PATTERN.test(input.entryId)) return { status: "invalid-request" } as const;
    const data = parsed.data;
    const [row] = await tx.update(schema.clubArchiveEntries).set({ trainingDate: data.trainingDate,
      year: data.trainingDate ? Number(data.trainingDate.slice(0, 4)) : sql`${schema.clubArchiveEntries.year}`, place: data.place, title: data.title,
      leader: data.leader, tags: [...new Set(data.tags)], notes: data.notes, updatedAt: now })
      .where(and(eq(schema.clubArchiveEntries.id, input.entryId), eq(schema.clubArchiveEntries.clubId, input.clubId))).returning({ id: schema.clubArchiveEntries.id });
    if (!row) return { status: "not-found" } as const;
    await clubJournal(tx, { clubId: input.clubId, action: "CLUB_ARCHIVE_ENTRY_UPDATED", actorAccountId: member.accountId, details: { entryId: row.id }, now });
    return { status: "ok" } as const;
  });
}

/** Tar bort träningen ur arkivet (banfilerna med den). Kartversionerna står kvar. */
export async function deleteClubArchiveEntry(db: Database, input: ClubProof & { clubId: string; entryId: string }, now = new Date())
  : Promise<ClubFailure | { status: "deleted" }> {
  if (!UUID_PATTERN.test(input.entryId)) return { status: "not-found" };
  return db.transaction(async tx => {
    const member = await requireClubRole(tx, input, "ADMIN", now, true);
    if (member.status !== "ok") return member;
    const [entry] = await tx.select({ id: schema.clubArchiveEntries.id, title: schema.clubArchiveEntries.title }).from(schema.clubArchiveEntries)
      .where(and(eq(schema.clubArchiveEntries.id, input.entryId), eq(schema.clubArchiveEntries.clubId, input.clubId))).for("update");
    if (!entry) return { status: "not-found" } as const;
    await forgetEntryThumbnail(tx, entry.id);
    // ADR-0209: en tävling som lagts i arkivet är inte längre där.
    await tx.delete(schema.raceClubArchives).where(eq(schema.raceClubArchives.entryId, entry.id));
    await tx.delete(schema.clubArchiveCourseFiles).where(eq(schema.clubArchiveCourseFiles.entryId, entry.id));
    await tx.delete(schema.clubArchiveEntryMaps).where(eq(schema.clubArchiveEntryMaps.entryId, entry.id));
    await tx.delete(schema.clubArchiveEntries).where(eq(schema.clubArchiveEntries.id, entry.id));
    await clubJournal(tx, { clubId: input.clubId, action: "CLUB_ARCHIVE_ENTRY_DELETED", actorAccountId: member.accountId, details: { entryId: entry.id }, now });
    return { status: "deleted" } as const;
  });
}

/** Banfilen orörd ("Ladda ner original"), för den som ser träningsarkivet (ADR-0209 beslut C). */
export async function readClubCourseFile(db: Database, input: ClubProof & { clubId: string; courseFileId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; fileName: string; kind: "PPEN" | "COURSE_DATA"; content: Buffer }> {
  if (!UUID_PATTERN.test(input.courseFileId)) return { status: "not-found" };
  return db.transaction(async tx => {
    const member = await requireClubArea(tx, input, "ARCHIVE", now, false);
    if (member.status !== "ok") return member;
    const [row] = await tx.select({ fileName: schema.clubArchiveCourseFiles.fileName, kind: schema.clubArchiveCourseFiles.kind,
      content: schema.clubArchiveCourseFiles.content }).from(schema.clubArchiveCourseFiles)
      .where(and(eq(schema.clubArchiveCourseFiles.id, input.courseFileId), eq(schema.clubArchiveCourseFiles.clubId, input.clubId)));
    return row ? { status: "ok", ...row } as const : { status: "not-found" } as const;
  });
}

/** Banfilens karta vald för hand (en version i klubben), eller ingen. */
export async function setClubCourseFileMap(db: Database, input: ClubProof & { clubId: string; courseFileId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok" }> {
  const parsed = clubCourseFileMapRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const member = await requireClubRole(tx, input, "ADMIN", now, true);
    if (member.status !== "ok") return member;
    // Inloggningen och behörigheten prövas före kroppen (städrundan 2026-11-07): utloggad får 401, inte 400.
    if (!parsed.success || !UUID_PATTERN.test(input.courseFileId)) return { status: "invalid-request" } as const;
    if (parsed.data.mapVersionId) {
      const [version] = await tx.select({ id: schema.clubMapVersions.id }).from(schema.clubMapVersions)
        .where(and(eq(schema.clubMapVersions.id, parsed.data.mapVersionId), eq(schema.clubMapVersions.clubId, input.clubId)));
      if (!version) return { status: "not-found" } as const;
    }
    const [row] = await tx.update(schema.clubArchiveCourseFiles).set({ mapVersionId: parsed.data.mapVersionId,
      mapResolution: parsed.data.mapVersionId ? "MANUAL" : "MISSING" })
      .where(and(eq(schema.clubArchiveCourseFiles.id, input.courseFileId), eq(schema.clubArchiveCourseFiles.clubId, input.clubId)))
      .returning({ id: schema.clubArchiveCourseFiles.id, entryId: schema.clubArchiveCourseFiles.entryId });
    if (!row) return { status: "not-found" } as const;
    // Träningens bild kan ha ritats på den gamla kartan (ADR-0196).
    await forgetEntryThumbnail(tx, row.entryId);
    await clubJournal(tx, { clubId: input.clubId, action: "CLUB_COURSE_FILE_MAP_SET", actorAccountId: member.accountId,
      details: { courseFileId: row.id, mapVersionId: parsed.data.mapVersionId }, now });
    return { status: "ok" } as const;
  });
}

/** ADR-0209 beslut 4: tävlingen som träningen kom från ("Från tävlingen …"), eller null. */
async function liftedRaceOf(tx: DbExecutor, clubId: string, entryId: string) {
  const [row] = await tx.select({ raceId: schema.raceClubArchives.raceId, name: schema.raceClubArchives.raceName, date: schema.raceClubArchives.raceDate,
    shortCode: schema.races.shortCode, publishedAt: schema.races.publishedAt }).from(schema.raceClubArchives)
    .leftJoin(schema.races, eq(schema.races.id, schema.raceClubArchives.raceId))
    .where(and(eq(schema.raceClubArchives.clubId, clubId), eq(schema.raceClubArchives.entryId, entryId)));
  if (!row) return null;
  return { raceId: row.raceId, name: row.name, date: row.date, exists: row.shortCode !== null,
    publicPath: row.shortCode && row.publishedAt ? `/t/${row.shortCode}` : null };
}
