import { and, eq, inArray } from "drizzle-orm";
import {
  clubEntryThumbnailRequestSchema, clubMapVersionCheckRequestSchema, CLUB_THUMBNAIL_MAX_BYTES, type ClubArchiveSummariesResponse,
  type ClubEntryThumbnailView, type ClubMapCheckView
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { clubJournal, requireClubArea, requireClubRole, type ClubFailure, type ClubProof } from "./club-access";
import { courseFileSummary } from "./club-archive-import";
import { imageDimensions } from "./image-dimensions";
import { UUID_PATTERN } from "./serialization";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0196: kontrollen av kartversionerna och de små bilderna i klubbarkivet. Kartorna ritas i en administratörs webbläsare
 * (servern ritar inga kartor, ADR-0179 beslut 2); servern sparar beskedet och bilden en gång och kontrollerar att bilden är
 * en PNG av angiven storlek. Bilderna är härledda och går alltid att rita om; de skrivs inte i klubbens journal. Läsare ser
 * dem, administratörer sparar dem.
 */
const validId = (id: string) => UUID_PATTERN.test(id);

type Png = { pngBase64: string; width: number; height: number };

/** PNG:n ur base64, eller undefined när den inte är en PNG av angiven storlek och högst 512 kB. */
function decodePng(image: Png): Buffer | undefined {
  const bytes = Buffer.from(image.pngBase64, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > CLUB_THUMBNAIL_MAX_BYTES) return undefined;
  const dimensions = imageDimensions(new Uint8Array(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 64)));
  if (!dimensions || dimensions.mediaType !== "image/png" || dimensions.width !== image.width || dimensions.height !== image.height) return undefined;
  return bytes;
}

/** Kontrollerna för versionerna (för kartornas vyer). */
export async function mapChecks(tx: DbExecutor, versionIds: readonly string[]): Promise<Map<string, ClubMapCheckView>> {
  if (versionIds.length === 0) return new Map();
  const rows = await tx.select({ versionId: schema.clubMapVersionChecks.versionId, status: schema.clubMapVersionChecks.status,
    detail: schema.clubMapVersionChecks.detail, fileVersion: schema.clubMapVersionChecks.fileVersion, readerVersion: schema.clubMapVersionChecks.readerVersion,
    checkedAt: schema.clubMapVersionChecks.checkedAt, width: schema.clubMapVersionChecks.thumbnailWidth })
    .from(schema.clubMapVersionChecks).where(inArray(schema.clubMapVersionChecks.versionId, [...versionIds]));
  return new Map(rows.map(row => [row.versionId, { status: row.status, detail: row.detail, fileVersion: row.fileVersion, readerVersion: row.readerVersion,
    checkedAt: row.checkedAt.toISOString(), thumbnail: row.width !== null }]));
}

/** Träningarnas bilder; `stale` när bilden ritades på en annan version än den träningen nu ritas av. */
export async function entryThumbnails(tx: DbExecutor, sources: ReadonlyMap<string, string | null>): Promise<Map<string, ClubEntryThumbnailView>> {
  if (sources.size === 0) return new Map();
  const rows = await tx.select({ entryId: schema.clubArchiveEntryThumbnails.entryId, status: schema.clubArchiveEntryThumbnails.status,
    detail: schema.clubArchiveEntryThumbnails.detail, readerVersion: schema.clubArchiveEntryThumbnails.readerVersion,
    courseName: schema.clubArchiveEntryThumbnails.courseName, createdAt: schema.clubArchiveEntryThumbnails.createdAt,
    mapVersionId: schema.clubArchiveEntryThumbnails.mapVersionId })
    .from(schema.clubArchiveEntryThumbnails).where(inArray(schema.clubArchiveEntryThumbnails.entryId, [...sources.keys()]));
  return new Map(rows.map(row => [row.entryId, { status: row.status, detail: row.detail, readerVersion: row.readerVersion, courseName: row.courseName,
    createdAt: row.createdAt.toISOString(), stale: row.mapVersionId !== (sources.get(row.entryId) ?? null) }]));
}

export async function saveClubMapVersionCheck(db: Database, input: ClubProof & { clubId: string; versionId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok" }> {
  const parsed = clubMapVersionCheckRequestSchema.safeParse(input.request);
  if (!parsed.success || !validId(input.versionId)) return { status: "invalid-request" };
  const check = parsed.data;
  const thumbnail = check.thumbnail ? decodePng(check.thumbnail) : null;
  if (thumbnail === undefined) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const member = await requireClubRole(tx, input, "ADMIN", now, true);
    if (member.status !== "ok") return member;
    const [version] = await tx.select({ id: schema.clubMapVersions.id }).from(schema.clubMapVersions)
      .where(and(eq(schema.clubMapVersions.id, input.versionId), eq(schema.clubMapVersions.clubId, input.clubId)));
    if (!version) return { status: "not-found" } as const;
    const values = { readerVersion: check.readerVersion, status: check.status, detail: check.detail, fileVersion: check.fileVersion,
      thumbnail, thumbnailWidth: check.thumbnail?.width ?? null, thumbnailHeight: check.thumbnail?.height ?? null, checkedAt: now };
    await tx.insert(schema.clubMapVersionChecks).values({ versionId: version.id, clubId: input.clubId, ...values })
      .onConflictDoUpdate({ target: schema.clubMapVersionChecks.versionId, set: values });
    return { status: "ok" } as const;
  });
}

export async function saveClubEntryThumbnail(db: Database, input: ClubProof & { clubId: string; entryId: string; request: unknown }, now = new Date())
  : Promise<ClubFailure | { status: "ok" }> {
  const parsed = clubEntryThumbnailRequestSchema.safeParse(input.request);
  if (!parsed.success || !validId(input.entryId)) return { status: "invalid-request" };
  const thumbnail = parsed.data;
  const image = thumbnail.image ? decodePng(thumbnail.image) : null;
  if (image === undefined) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const member = await requireClubRole(tx, input, "ADMIN", now, true);
    if (member.status !== "ok") return member;
    const [entry] = await tx.select({ id: schema.clubArchiveEntries.id }).from(schema.clubArchiveEntries)
      .where(and(eq(schema.clubArchiveEntries.id, input.entryId), eq(schema.clubArchiveEntries.clubId, input.clubId)));
    const [version] = await tx.select({ id: schema.clubMapVersions.id }).from(schema.clubMapVersions)
      .where(and(eq(schema.clubMapVersions.id, thumbnail.mapVersionId), eq(schema.clubMapVersions.clubId, input.clubId)));
    if (!entry || !version) return { status: "not-found" } as const;
    const values = { readerVersion: thumbnail.readerVersion, status: thumbnail.status, detail: thumbnail.detail, mapVersionId: version.id,
      courseName: thumbnail.courseName, image, width: thumbnail.image?.width ?? null, height: thumbnail.image?.height ?? null, createdAt: now };
    await tx.insert(schema.clubArchiveEntryThumbnails).values({ entryId: entry.id, clubId: input.clubId, ...values })
      .onConflictDoUpdate({ target: schema.clubArchiveEntryThumbnails.entryId, set: values });
    return { status: "ok" } as const;
  });
}

export type ThumbnailRead = ClubFailure | { status: "ok"; png: Buffer; etag: string };

export async function readClubMapVersionThumbnail(db: Database, input: ClubProof & { clubId: string; versionId: string }, now = new Date())
  : Promise<ThumbnailRead> {
  if (!validId(input.versionId)) return { status: "not-found" };
  return db.transaction(async tx => {
    const member = await requireClubArea(tx, input, "ARCHIVE", now, false);
    if (member.status !== "ok") return member;
    const [row] = await tx.select({ png: schema.clubMapVersionChecks.thumbnail, checkedAt: schema.clubMapVersionChecks.checkedAt })
      .from(schema.clubMapVersionChecks)
      .where(and(eq(schema.clubMapVersionChecks.versionId, input.versionId), eq(schema.clubMapVersionChecks.clubId, input.clubId)));
    return row?.png ? { status: "ok", png: row.png, etag: `"${input.versionId}-${row.checkedAt.getTime()}"` } as const : { status: "not-found" } as const;
  });
}

export async function readClubEntryThumbnail(db: Database, input: ClubProof & { clubId: string; entryId: string }, now = new Date()): Promise<ThumbnailRead> {
  if (!validId(input.entryId)) return { status: "not-found" };
  return db.transaction(async tx => {
    const member = await requireClubArea(tx, input, "ARCHIVE", now, false);
    if (member.status !== "ok") return member;
    const [row] = await tx.select({ png: schema.clubArchiveEntryThumbnails.image, createdAt: schema.clubArchiveEntryThumbnails.createdAt })
      .from(schema.clubArchiveEntryThumbnails)
      .where(and(eq(schema.clubArchiveEntryThumbnails.entryId, input.entryId), eq(schema.clubArchiveEntryThumbnails.clubId, input.clubId)));
    return row?.png ? { status: "ok", png: row.png, etag: `"${input.entryId}-${row.createdAt.getTime()}"` } as const : { status: "not-found" } as const;
  });
}

/**
 * "Kontrollera alla kartor igen" (servern): banfilernas sammanfattningar räknas om ur filerna med dagens läsare och sparas när
 * de har ändrats (t.ex. IOF XML 2.0.3 som inte gick att läsa vid importen). Bara sammanfattningen skrivs; filen är orörd.
 */
export async function refreshClubCourseSummaries(db: Database, input: ClubProof & { clubId: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; response: ClubArchiveSummariesResponse }> {
  return db.transaction(async tx => {
    const member = await requireClubRole(tx, input, "ADMIN", now, true);
    if (member.status !== "ok") return member;
    const ids = await tx.select({ id: schema.clubArchiveCourseFiles.id }).from(schema.clubArchiveCourseFiles)
      .where(eq(schema.clubArchiveCourseFiles.clubId, input.clubId)).limit(20_000);
    let updated = 0;
    // En fil i taget (högst 5 MB var), så att minnet inte växer med arkivet.
    for (const { id } of ids) {
      const [row] = await tx.select({ kind: schema.clubArchiveCourseFiles.kind, content: schema.clubArchiveCourseFiles.content,
        summary: schema.clubArchiveCourseFiles.summary }).from(schema.clubArchiveCourseFiles).where(eq(schema.clubArchiveCourseFiles.id, id));
      if (!row) continue;
      const summary = courseFileSummary(row.kind, new Uint8Array(row.content));
      if (canonical(summary) === canonical(row.summary)) continue;
      await tx.update(schema.clubArchiveCourseFiles).set({ summary }).where(eq(schema.clubArchiveCourseFiles.id, id));
      updated++;
    }
    await clubJournal(tx, { clubId: input.clubId, action: "CLUB_ARCHIVE_RECHECKED", actorAccountId: member.accountId,
      details: { courseFiles: ids.length, updated }, now });
    return { status: "ok", response: { formatVersion: 1, courseFiles: ids.length, updated } } as const;
  });
}

/** JSON med sorterade nycklar (jsonb sparar nycklarna i en egen ordning). */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Träningens bild ritas om när dess underlag ändras (banfilens karta byts, träningen tas bort). */
export async function forgetEntryThumbnail(tx: DbExecutor, entryId: string): Promise<void> {
  await tx.delete(schema.clubArchiveEntryThumbnails).where(eq(schema.clubArchiveEntryThumbnails.entryId, entryId));
}
