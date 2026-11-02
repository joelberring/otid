import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import {
  CLUB_ARCHIVE_COURSE_FILE_MAX_BYTES, CLUB_ARCHIVE_MAP_MAX_BYTES, CLUB_IMPORT_TOKEN_PATTERN, clubImportBatchRequestSchema, clubImportCheckRequestSchema,
  type ClubImportBatchResponse, type ClubImportCheckResponse, type ClubImportContentResponse, type ClubImportCourseFile
} from "@o-tid/contracts";
import { courseSummaries, readPpen } from "@o-tid/course-setting";
import { schema, type ClubCourseFileSummary, type Database } from "@o-tid/database";
import { decodeIofXml, parseIofXml } from "@o-tid/iof-xml";
import { clubJournal, clubMembership, clubRoleAtLeast, type ClubTransaction } from "./club-access";
import { importTokenHash } from "./clubs";
import { discardStagedMapContent, mapStorageQuota, stageMapContent, storeMapContent, type MapQuotaExceeded, type MapStorageQuota } from "./map-content";
import { mapFileFormatOf } from "./race-map-source";
import { UUID_PATTERN, sha256Hex } from "./serialization";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0194 beslut 6–7: importens anrop från ägarens dator. Nyckeln (inte en inloggning) i `Authorization: Bearer`; kontot som
 * skapade den måste fortfarande vara ägare eller administratör i klubben. Kartfilerna strömmas till kartinnehållet
 * (ADR-0189) och räknas mot kontots kvot; träningarna och banfilerna tas emot som JSON. Allt är idempotent.
 */
export type ImportFailure = { status: "unauthorized" | "invalid-request" | "not-found" };
type Importer = { status: "ok"; accountId: string; clubId: string; clubName: string };

/** Nyckeln ur `Authorization`, eller null. */
export function bearerToken(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return match && CLUB_IMPORT_TOKEN_PATTERN.test(match[1]!) ? match[1]! : null;
}

export async function authenticateImportToken(tx: DbExecutor, input: { token: string | null; clubId: string }, now: Date)
  : Promise<ImportFailure | Importer> {
  if (!input.token || !UUID_PATTERN.test(input.clubId)) return { status: "unauthorized" };
  const [row] = await tx.select({ id: schema.clubImportTokens.id, clubId: schema.clubImportTokens.clubId, accountId: schema.clubImportTokens.accountId,
    clubName: schema.clubs.name }).from(schema.clubImportTokens).innerJoin(schema.clubs, eq(schema.clubs.id, schema.clubImportTokens.clubId))
    .where(and(eq(schema.clubImportTokens.tokenSha256, importTokenHash(input.token)), isNull(schema.clubImportTokens.revokedAt),
      gt(schema.clubImportTokens.expiresAt, now)));
  if (!row || row.clubId !== input.clubId) return { status: "unauthorized" };
  const member = await clubMembership(tx, { accountId: row.accountId, clubId: row.clubId }, "share");
  if (!member || !clubRoleAtLeast(member.role, "ADMIN")) return { status: "unauthorized" };
  await tx.update(schema.clubImportTokens).set({ lastUsedAt: now }).where(eq(schema.clubImportTokens.id, row.id));
  return { status: "ok", accountId: row.accountId, clubId: row.clubId, clubName: row.clubName };
}

/**
 * Vilka kartfiler servern redan har för klubben (eller som kontot själv har laddat upp). Annat innehåll på servern nämns inte,
 * så att en nyckel inte kan användas för att fråga om andras kartor; en ny uppladdning av samma innehåll kostar ingenting.
 */
export async function importCheck(db: Database, input: { token: string | null; clubId: string; request: unknown }, now = new Date())
  : Promise<ImportFailure | { status: "ok"; response: ClubImportCheckResponse }> {
  const parsed = clubImportCheckRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const importer = await authenticateImportToken(tx, input, now);
    if (importer.status !== "ok") return importer;
    const wanted = [...new Set(parsed.data.sha256)];
    if (wanted.length === 0) return { status: "ok", response: { formatVersion: 1, clubId: importer.clubId, clubName: importer.clubName, known: [] } } as const;
    const known = (await tx.execute<{ sha256: string }>(sql`select c.sha256 from map_content c where c.sha256 = any(${sql.param(wanted)}::text[])
      and (c.uploaded_by = ${importer.accountId}::uuid or exists (select 1 from club_map_version v where v.club_id = ${importer.clubId}::uuid
        and v.content_sha256 = c.sha256))`)).rows.map(row => row.sha256);
    return { status: "ok", response: { formatVersion: 1, clubId: importer.clubId, clubName: importer.clubName, known } } as const;
  });
}

export type ImportContentResult = ImportFailure | { status: "problem"; problem: "TOO_LARGE" | "HASH_MISMATCH" | "INVALID_MAP_FILE" | "EMPTY" }
  | { status: "quota"; quota: MapQuotaExceeded } | { status: "ok"; response: ClubImportContentResponse };

/**
 * En kartfil som ström: delarna skrivs till databasen medan sha256 räknas (ADR-0189 beslut 2), och innehållet sparas först när
 * hashen stämmer med adressen och filen ser ut som OCAD eller Mapper. Nyckeln kontrolleras före och efter strömmen.
 */
export async function importMapContent(db: Database, input: { token: string | null; clubId: string; sha256: string;
  body: AsyncIterable<Uint8Array>; quota?: MapStorageQuota }, now = new Date()): Promise<ImportContentResult> {
  if (!/^[a-f0-9]{64}$/.test(input.sha256)) return { status: "invalid-request" };
  const first = await db.transaction(tx => authenticateImportToken(tx, input, now));
  if (first.status !== "ok") return first;
  const staged = await stageMapContent(db, input.body, { maxBytes: CLUB_ARCHIVE_MAP_MAX_BYTES, now });
  if (staged.kind === "too-large") return { status: "problem", problem: "TOO_LARGE" };
  if (staged.kind === "empty") return { status: "problem", problem: "EMPTY" };
  try {
    if (staged.sha256 !== input.sha256) return { status: "problem", problem: "HASH_MISMATCH" };
    if (!mapFileFormatOf(staged.head)) return { status: "problem", problem: "INVALID_MAP_FILE" };
    return await db.transaction(async tx => {
      const importer = await authenticateImportToken(tx, input, now);
      if (importer.status !== "ok") return importer;
      const existed = (await tx.execute(sql`select 1 from map_content where sha256 = ${staged.sha256}`)).rows.length > 0;
      const stored = await storeMapContent(tx, staged, importer.accountId, now, input.quota ?? mapStorageQuota());
      if (stored.status === "quota") return { status: "quota", quota: stored.quota } as const;
      return { status: "ok", response: { formatVersion: 1, sha256: stored.sha256, byteLength: staged.byteLength,
        stored: existed ? "existing" : "new" } } as const;
    });
  } finally {
    await discardStagedMapContent(db, staged.contentId);
  }
}

/** Banfilens sammanfattning (banorna, kontroller, längd, skala). Ett fel i filen ger en tom lista och felet som text. */
export function courseFileSummary(kind: "PPEN" | "COURSE_DATA", bytes: Uint8Array): ClubCourseFileSummary {
  try {
    if (kind === "PPEN") {
      const { document } = readPpen(new TextDecoder("utf-8").decode(bytes));
      return { scale: document.event.mapScale, courses: courseSummaries(document).map(course => ({ name: course.name.slice(0, 120),
        controls: course.controlCount, lengthM: Number.isFinite(course.lengthMeters) ? Math.round(course.lengthMeters) : null })) };
    }
    const decoded = decodeIofXml(bytes);
    if ("issue" in decoded) return { scale: null, courses: [], problem: decoded.issue };
    const parsed = parseIofXml(decoded.xml);
    if (parsed.kind !== "CourseData") return { scale: null, courses: [], problem: "Inte en CourseData-fil" };
    return { scale: parsed.mapScale ?? null, courses: parsed.courses.map(course => ({ name: course.name.slice(0, 120),
      controls: course.controlCodes.length > 0 ? course.controlCodes.length : Math.max(0, ...(course.variants ?? []).map(variant => variant.controlCodes.length)),
      lengthM: course.lengthMeters ?? null })) };
  } catch (error) {
    return { scale: null, courses: [], problem: (error instanceof Error ? error.message : "Filen kunde inte läsas").slice(0, 300) };
  }
}

async function versionIdsBySha(tx: DbExecutor, clubId: string, shas: readonly string[]): Promise<Map<string, string>> {
  if (shas.length === 0) return new Map();
  const rows = await tx.select({ id: schema.clubMapVersions.id, sha: schema.clubMapVersions.contentSha256 }).from(schema.clubMapVersions)
    .where(and(eq(schema.clubMapVersions.clubId, clubId), inArray(schema.clubMapVersions.contentSha256, [...new Set(shas)])));
  return new Map(rows.map(row => [row.sha, row.id]));
}

async function insertCourseFile(tx: ClubTransaction, input: { clubId: string; entryId: string; file: ClubImportCourseFile; versions: Map<string, string>;
  now: Date }): Promise<boolean | "invalid"> {
  const bytes = Buffer.from(input.file.contentBase64, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > CLUB_ARCHIVE_COURSE_FILE_MAX_BYTES || sha256Hex(bytes) !== input.file.sha256) return "invalid";
  const versionId = input.file.mapSha256 ? input.versions.get(input.file.mapSha256) ?? null : null;
  // En karta som klienten löste men som inte finns i klubben räknas som saknad.
  const resolution = versionId ? (input.file.resolution === "NAME" ? "NAME" : "FOLDER")
    : input.file.resolution === "NONE" ? "NONE" : "MISSING";
  const inserted = await tx.insert(schema.clubArchiveCourseFiles).values({ id: randomUUID(), entryId: input.entryId, clubId: input.clubId,
    kind: input.file.kind, fileName: input.file.fileName, content: bytes, sha256: input.file.sha256, byteLength: bytes.byteLength,
    summary: courseFileSummary(input.file.kind, bytes), mapVersionId: versionId, mapReference: input.file.mapReference, mapResolution: resolution,
    createdAt: input.now }).onConflictDoNothing().returning({ id: schema.clubArchiveCourseFiles.id });
  return inserted.length > 0;
}

class InvalidBatch extends Error {}

/**
 * Kartornas versioner och träningarna i en omgång, i en transaktion. En karta känns igen på importens nyckel (namnet utan datum
 * och version), en version på innehållet (finns den redan i klubben, kanske flyttad till en annan karta av ägaren, lämnas den),
 * en träning på källans sökväg (en befintlig träning ändras inte, men banfiler och kartor som saknas läggs till).
 */
export async function importBatch(db: Database, input: { token: string | null; clubId: string; request: unknown }, now = new Date())
  : Promise<ImportFailure | { status: "ok"; response: ClubImportBatchResponse }> {
  const parsed = clubImportBatchRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  const batch = parsed.data;
  return db.transaction(async tx => {
    const importer = await authenticateImportToken(tx, input, now);
    if (importer.status !== "ok") return importer;
    const clubId = importer.clubId;
    // Importerna i en klubb körs en i taget (två körningar samtidigt ska inte göra två kartor av samma namn).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`club-import:${clubId}`}, 0))`);
    const response: ClubImportBatchResponse = { formatVersion: 1, maps: { created: 0, versionsAdded: 0 },
      entries: { created: 0, existing: 0, courseFilesAdded: 0 }, missingContent: [] };
    for (const map of batch.maps) {
      const existingVersions = await versionIdsBySha(tx, clubId, map.versions.map(version => version.sha256));
      const fresh = map.versions.filter(version => !existingVersions.has(version.sha256));
      if (fresh.length === 0) continue;
      const present = new Set((await tx.select({ sha: schema.mapContents.sha256 }).from(schema.mapContents)
        .where(inArray(schema.mapContents.sha256, fresh.map(version => version.sha256)))).map(row => row.sha));
      const missing = fresh.filter(version => !present.has(version.sha256));
      response.missingContent.push(...missing.map(version => version.sha256));
      const toAdd = fresh.filter(version => present.has(version.sha256));
      if (toAdd.length === 0) continue;
      let [target] = await tx.select({ id: schema.clubMaps.id }).from(schema.clubMaps)
        .where(and(eq(schema.clubMaps.clubId, clubId), eq(schema.clubMaps.importKey, map.importKey))).limit(1);
      if (!target) {
        target = { id: randomUUID() };
        await tx.insert(schema.clubMaps).values({ id: target.id, clubId, name: map.name, ownership: "CLUB", ownerKind: "CLUB", trainingOnly: false,
          feePerPrint: false, noPublicDisplay: false, importKey: map.importKey, createdAt: now, createdBy: importer.accountId, updatedAt: now });
        response.maps.created++;
      }
      for (const version of toAdd) {
        const content = await tx.select({ byteLength: schema.mapContents.byteLength }).from(schema.mapContents).where(eq(schema.mapContents.sha256, version.sha256));
        const inserted = await tx.insert(schema.clubMapVersions).values({ id: randomUUID(), clubId, mapId: target.id, contentSha256: version.sha256,
          fileName: version.fileName, format: version.format, byteLength: content[0]!.byteLength, versionDate: version.versionDate, note: null,
          uploadedBy: importer.accountId, uploadedAt: now, sourcePath: version.sourcePath }).onConflictDoNothing().returning({ id: schema.clubMapVersions.id });
        response.maps.versionsAdded += inserted.length;
      }
    }
    for (const entry of batch.entries) {
      const shas = [...entry.mapSha256, ...entry.courseFiles.flatMap(file => file.mapSha256 ? [file.mapSha256] : [])];
      const versions = await versionIdsBySha(tx, clubId, shas);
      response.missingContent.push(...shas.filter(sha => !versions.has(sha)));
      let [row] = await tx.select({ id: schema.clubArchiveEntries.id }).from(schema.clubArchiveEntries)
        .where(and(eq(schema.clubArchiveEntries.clubId, clubId), eq(schema.clubArchiveEntries.importKey, entry.importKey)));
      if (row) response.entries.existing++;
      else {
        row = { id: randomUUID() };
        await tx.insert(schema.clubArchiveEntries).values({ id: row.id, clubId, trainingDate: entry.trainingDate, year: entry.year, place: entry.place,
          title: entry.title, leader: entry.leader, tags: [...new Set(entry.tags)], notes: null, sourcePath: entry.sourcePath, importKey: entry.importKey,
          createdAt: now, createdBy: importer.accountId, updatedAt: now });
        response.entries.created++;
      }
      for (const sha of entry.mapSha256) {
        const versionId = versions.get(sha);
        if (versionId) await tx.insert(schema.clubArchiveEntryMaps).values({ entryId: row.id, versionId }).onConflictDoNothing();
      }
      for (const file of entry.courseFiles) {
        const added = await insertCourseFile(tx, { clubId, entryId: row.id, file, versions, now });
        if (added === "invalid") throw new InvalidBatch();
        if (added) response.entries.courseFilesAdded++;
      }
    }
    response.missingContent = [...new Set(response.missingContent)];
    if (response.maps.versionsAdded + response.entries.created + response.entries.courseFilesAdded > 0) {
      await clubJournal(tx, { clubId, action: "CLUB_ARCHIVE_IMPORTED", actorAccountId: importer.accountId,
        details: { maps: response.maps, entries: response.entries }, now });
    }
    return { status: "ok", response } as const;
  }).catch((error: unknown) => {
    if (error instanceof InvalidBatch) return { status: "invalid-request" } as const;
    throw error;
  });
}
