import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import {
  COURSE_SETTING_DOCUMENT_MAX_BYTES, COURSE_SETTING_REVISIONS_KEPT, courseSettingDocumentSchema, courseSettingImportRequestSchema,
  courseSettingRestoreRequestSchema, courseSettingRevisionSchema, courseSettingRevisionsSchema, courseSettingSaveRequestSchema,
  courseSettingSavedSchema, courseSettingStateSchema, courseSettingTransferRequestSchema, type CourseSettingConflict,
  type CourseSettingDocumentDto, type CourseSettingRevision, type CourseSettingRevisions, type CourseSettingSaved, type CourseSettingState,
  type CourseSettingTransferProblem, type SyncPreviewResponse
} from "@o-tid/contracts";
import { writePpen, type CourseSettingDocument } from "@o-tid/course-setting";
import { schema, type Database } from "@o-tid/database";
import { courseSettingProjection } from "./course-setting-transfer";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { UUID_PATTERN as uuid } from "./serialization";
import { previewCourseFileProjectionAsAdmin } from "./source-sync";

/**
 * Steg 62 (ADR-0180 beslut 1, 4, 8): banläggningens dokument. Webbläsaren läser .ppen, ändrar och räknar; servern sparar
 * dokumentet med versionskontroll (två flikar skriver inte över varandra), behåller tidigare versioner och för över det
 * till tävlingens banor genom samma jämförelse som en banfil. Bara admin, aldrig publikt (banhemligheten, ADR-0176).
 *
 * Sparandet låser inte tävlingen (ADR-0177: avläsningen går före); två sparanden för samma tävling turas om med ett lås
 * per tävling. Autosparandet ger inte en tidigare version per sparande: en version behålls när den är minst tio minuter
 * äldre än den senast behållna, sparades av någon annan, eller ersätts av en inläst .ppen eller en återställning.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "too-large" };
type Conflict = { status: "version-conflict"; conflict: CourseSettingConflict };
type ReadProof = Omit<RaceSessionProof, "csrfCookie" | "csrfHeader">;
type Row = typeof schema.courseSettings.$inferSelect;
type Kind = "SAVE" | "IMPORT" | "RESTORE";

const REVISION_INTERVAL_MS = 10 * 60_000;
const documentBytes = (document: unknown) => Buffer.byteLength(JSON.stringify(document), "utf8");

async function adminRead<T>(db: Database, input: ReadProof, now: Date, read: (tx: Transaction, raceId: string) => Promise<T>): Promise<Failure | T> {
  if (!uuid.test(input.raceId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN" }, now, "share");
    if (auth.status !== "authenticated") return auth;
    return read(tx, auth.principal.raceId);
  }, { isolationLevel: "repeatable read" });
}

async function adminWrite<T>(db: Database, input: RaceSessionProof, now: Date, write: (tx: Transaction, raceId: string, actorId: string) => Promise<T>)
  : Promise<Failure | T> {
  if (!uuid.test(input.raceId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN", requireCsrf: true }, now, "share");
    if (auth.status !== "authenticated") return auth;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"course-setting:" + auth.principal.raceId}, 0))`);
    return write(tx, auth.principal.raceId, auth.principal.accountId);
  });
}

async function loadRow(tx: Transaction, raceId: string): Promise<Row | undefined> {
  const [row] = await tx.select().from(schema.courseSettings).where(eq(schema.courseSettings.raceId, raceId));
  return row;
}

async function actors(tx: Transaction, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await tx.select({ id: schema.userAccounts.id, displayName: schema.userAccounts.displayName }).from(schema.userAccounts)
    .where(sql`${schema.userAccounts.id} in (${sql.join(unique.map(id => sql`${id}`), sql`, `)})`);
  return new Map(rows.map(row => [row.id, row.displayName]));
}
const actor = (names: Map<string, string>, accountId: string) => ({ accountId, displayName: names.get(accountId) ?? null });

function conflict(row: Row | undefined, names: Map<string, string>): Conflict {
  return { status: "version-conflict", conflict: { formatVersion: 1, error: "VERSION_CONFLICT",
    current: row ? { version: row.version, updatedAt: row.updatedAt.toISOString(), updatedBy: actor(names, row.updatedBy) } : null } };
}

async function audit(tx: Transaction, raceId: string, actorId: string, action: string, after: Record<string, unknown>) {
  await tx.insert(schema.auditEvents).values({ raceId, entityType: "course_setting", entityId: raceId, action, actorKind: "USER_ACCOUNT",
    actorId, after });
}

/**
 * Sparar nästa version. Den ersatta versionen blir en tidigare version enligt regeln överst; högst
 * `COURSE_SETTING_REVISIONS_KEPT` behålls.
 */
async function store(tx: Transaction, input: { raceId: string; actorId: string; now: Date; current: Row | undefined; kind: Kind;
  document: CourseSettingDocumentDto; original?: { fileName: string; ppen: string } }): Promise<CourseSettingSaved> {
  const { raceId, actorId, now, current, kind, document } = input;
  const version = (current?.version ?? 0) + 1;
  if (current) {
    const [latest] = await tx.select({ createdAt: schema.courseSettingRevisions.createdAt, createdBy: schema.courseSettingRevisions.createdBy })
      .from(schema.courseSettingRevisions).where(eq(schema.courseSettingRevisions.raceId, raceId))
      .orderBy(desc(schema.courseSettingRevisions.version)).limit(1);
    const keep = kind !== "SAVE" || !latest || latest.createdBy !== current.updatedBy ||
      current.updatedAt.getTime() - latest.createdAt.getTime() >= REVISION_INTERVAL_MS;
    if (keep) {
      await tx.insert(schema.courseSettingRevisions).values({ raceId, version: current.version, kind, document: current.document,
        createdAt: current.updatedAt, createdBy: current.updatedBy }).onConflictDoNothing();
      const kept = tx.select({ version: schema.courseSettingRevisions.version }).from(schema.courseSettingRevisions)
        .where(eq(schema.courseSettingRevisions.raceId, raceId)).orderBy(desc(schema.courseSettingRevisions.version))
        .limit(COURSE_SETTING_REVISIONS_KEPT);
      await tx.delete(schema.courseSettingRevisions).where(and(eq(schema.courseSettingRevisions.raceId, raceId),
        notInArray(schema.courseSettingRevisions.version, kept)));
    }
  }
  const original = input.original ? { originalPpen: input.original.ppen, originalFileName: input.original.fileName, originalImportedAt: now } : {};
  const values = { document: document as Row["document"], version, updatedAt: now, updatedBy: actorId, ...original };
  await tx.insert(schema.courseSettings).values({ raceId, ...values })
    .onConflictDoUpdate({ target: schema.courseSettings.raceId, set: values });
  return courseSettingSavedSchema.parse({ formatVersion: 1, raceId, version, updatedAt: now.toISOString() });
}

async function loadMapFile(tx: Transaction, raceId: string) {
  const [row] = await tx.select({ sha256: schema.raceMapSources.sha256, fileName: schema.raceMapSources.fileName, scale: schema.raceMapSources.scale,
    bounds: schema.raceMapSources.bounds, georeference: schema.raceMapSources.georeference }).from(schema.raceMapSources)
    .where(eq(schema.raceMapSources.raceId, raceId));
  return row;
}

/** Editorns läge: dokumentet (null = inget än), den inlästa .ppen-filen och kartfilen som editorn ritar. */
export async function readCourseSettingAsAdmin(db: Database, input: ReadProof, now = new Date())
  : Promise<Failure | { status: "ok"; response: CourseSettingState }> {
  return adminRead(db, input, now, async (tx, raceId) => {
    const row = await loadRow(tx, raceId);
    const map = await loadMapFile(tx, raceId);
    const names = await actors(tx, row ? [row.updatedBy] : []);
    return { status: "ok" as const, response: courseSettingStateSchema.parse({ formatVersion: 1, raceId,
      setting: row ? { version: row.version, updatedAt: row.updatedAt.toISOString(), updatedBy: actor(names, row.updatedBy), document: row.document } : null,
      original: row?.originalFileName && row.originalImportedAt ? { fileName: row.originalFileName, importedAt: row.originalImportedAt.toISOString() } : null,
      mapFile: map ? { sha256: map.sha256, fileName: map.fileName, scale: map.scale, bounds: map.bounds, georeferenced: map.georeference !== null } : null }) };
  });
}

/** Sparar dokumentet om det bygger på den sparade versionen; annars konflikt med den aktuella versionen. */
export async function saveCourseSettingAsAdmin(db: Database, input: RaceSessionProof & { request: unknown }, now = new Date())
  : Promise<Failure | Conflict | { status: "ok"; response: CourseSettingSaved }> {
  const parsed = courseSettingSaveRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  if (documentBytes(parsed.data.document) > COURSE_SETTING_DOCUMENT_MAX_BYTES) return { status: "too-large" };
  return adminWrite(db, input, now, async (tx, raceId, actorId) => {
    const current = await loadRow(tx, raceId);
    if ((current?.version ?? 0) !== parsed.data.expectedVersion) return conflict(current, await actors(tx, current ? [current.updatedBy] : []));
    const response = await store(tx, { raceId, actorId, now, current, kind: "SAVE", document: parsed.data.document });
    if (!current) await audit(tx, raceId, actorId, "COURSE_SETTING_CREATED", { version: response.version });
    return { status: "ok" as const, response };
  });
}

/** Läser in en .ppen (läst i webbläsaren): ersätter dokumentet (det gamla blir en tidigare version) och sparar filen orörd. */
export async function importCourseSettingAsAdmin(db: Database, input: RaceSessionProof & { request: unknown }, now = new Date())
  : Promise<Failure | Conflict | { status: "ok"; response: CourseSettingSaved }> {
  const parsed = courseSettingImportRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  if (documentBytes(parsed.data.document) > COURSE_SETTING_DOCUMENT_MAX_BYTES) return { status: "too-large" };
  return adminWrite(db, input, now, async (tx, raceId, actorId) => {
    const current = await loadRow(tx, raceId);
    if ((current?.version ?? 0) !== parsed.data.expectedVersion) return conflict(current, await actors(tx, current ? [current.updatedBy] : []));
    const { fileName, ppen, document } = parsed.data;
    const response = await store(tx, { raceId, actorId, now, current, kind: "IMPORT", document, original: { fileName, ppen } });
    await audit(tx, raceId, actorId, "COURSE_SETTING_IMPORTED", { version: response.version, fileName, bytes: Buffer.byteLength(ppen, "utf8"),
      courses: document.courses.length, controls: Object.keys(document.controls).length });
    return { status: "ok" as const, response };
  });
}

/** Tidigare versioner, nyast först (utan dokumenten). */
export async function listCourseSettingRevisionsAsAdmin(db: Database, input: ReadProof, now = new Date())
  : Promise<Failure | { status: "ok"; response: CourseSettingRevisions }> {
  return adminRead(db, input, now, async (tx, raceId) => {
    const table = schema.courseSettingRevisions;
    const rows = await tx.select({ version: table.version, kind: table.kind, createdAt: table.createdAt, createdBy: table.createdBy,
      courses: sql<number>`jsonb_array_length(${table.document}->'courses')`,
      controls: sql<number>`(select count(*) from jsonb_object_keys(${table.document}->'controls'))::int` })
      .from(table).where(eq(table.raceId, raceId)).orderBy(desc(table.version)).limit(COURSE_SETTING_REVISIONS_KEPT);
    const names = await actors(tx, rows.map(row => row.createdBy));
    return { status: "ok" as const, response: courseSettingRevisionsSchema.parse({ formatVersion: 1, raceId,
      revisions: rows.map(row => ({ version: row.version, kind: row.kind, createdAt: row.createdAt.toISOString(), createdBy: actor(names, row.createdBy),
        courses: Number(row.courses), controls: Number(row.controls) })) }) };
  });
}

export async function readCourseSettingRevisionAsAdmin(db: Database, input: ReadProof & { version: number }, now = new Date())
  : Promise<Failure | { status: "ok"; response: CourseSettingRevision }> {
  if (!Number.isSafeInteger(input.version) || input.version < 1) return { status: "invalid-request" };
  return adminRead(db, input, now, async (tx, raceId) => {
    const [row] = await tx.select().from(schema.courseSettingRevisions).where(and(eq(schema.courseSettingRevisions.raceId, raceId),
      eq(schema.courseSettingRevisions.version, input.version)));
    if (!row) return { status: "not-found" as const };
    const names = await actors(tx, [row.createdBy]);
    return { status: "ok" as const, response: courseSettingRevisionSchema.parse({ formatVersion: 1, raceId, version: row.version, kind: row.kind,
      createdAt: row.createdAt.toISOString(), createdBy: actor(names, row.createdBy), document: row.document }) };
  });
}

/** Återställer en tidigare version som ny version; den nuvarande blir en tidigare version. */
export async function restoreCourseSettingRevisionAsAdmin(db: Database, input: RaceSessionProof & { request: unknown }, now = new Date())
  : Promise<Failure | Conflict | { status: "ok"; response: CourseSettingSaved }> {
  const parsed = courseSettingRestoreRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  return adminWrite(db, input, now, async (tx, raceId, actorId) => {
    const current = await loadRow(tx, raceId);
    if (current?.version !== parsed.data.expectedVersion) return conflict(current, await actors(tx, current ? [current.updatedBy] : []));
    const [revision] = await tx.select({ document: schema.courseSettingRevisions.document }).from(schema.courseSettingRevisions)
      .where(and(eq(schema.courseSettingRevisions.raceId, raceId), eq(schema.courseSettingRevisions.version, parsed.data.revision)));
    if (!revision) return { status: "not-found" as const };
    const document = courseSettingDocumentSchema.parse(revision.document);
    const response = await store(tx, { raceId, actorId, now, current, kind: "RESTORE", document });
    await audit(tx, raceId, actorId, "COURSE_SETTING_RESTORED", { version: response.version, revision: parsed.data.revision });
    return { status: "ok" as const, response };
  });
}

/** Den senast inlästa .ppen-filen orörd (för nedladdning). */
export async function readCourseSettingOriginalAsAdmin(db: Database, input: ReadProof, now = new Date())
  : Promise<Failure | { status: "ok"; fileName: string; ppen: string }> {
  return adminRead(db, input, now, async (tx, raceId) => {
    const [row] = await tx.select({ fileName: schema.courseSettings.originalFileName, ppen: schema.courseSettings.originalPpen })
      .from(schema.courseSettings).where(eq(schema.courseSettings.raceId, raceId));
    if (!row?.fileName || row.ppen === null) return { status: "not-found" as const };
    return { status: "ok" as const, fileName: row.fileName, ppen: row.ppen };
  });
}

export type CourseSettingTransferResult = Failure | Conflict | { status: "problem"; problem: CourseSettingTransferProblem }
  | { status: "conflict" } | { status: "ok"; response: SyncPreviewResponse };

/**
 * "Överför till tävlingen": dokumentet i versionen som editorn visar blir en banfil (`courseSettingProjection`) och visas
 * som skillnader mot tävlingen. Godkännandet är banfilens (`applySyncAsAdmin`), med samma besked om avlästa löpare.
 */
export async function previewCourseSettingTransferAsAdmin(db: Database, input: RaceSessionProof & { request: unknown }, now = new Date())
  : Promise<CourseSettingTransferResult> {
  const parsed = courseSettingTransferRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  const read = await adminRead(db, input, now, async (tx, raceId) => {
    const row = await loadRow(tx, raceId);
    if (!row) return { status: "problem" as const, problem: { formatVersion: 1 as const, error: "NO_DOCUMENT" as const, controls: [] } };
    if (row.version !== parsed.data.version) return conflict(row, await actors(tx, [row.updatedBy]));
    const map = await loadMapFile(tx, raceId);
    return { status: "read" as const, row, georeference: map?.georeference ?? null };
  });
  if (read.status !== "read") return read;
  const document = read.row.document as unknown as CourseSettingDocument;
  const built = courseSettingProjection(document, { georeference: read.georeference ?? undefined });
  if ("problem" in built) return { status: "problem", problem: { formatVersion: 1, ...built.problem, controls: [...built.problem.controls] } };
  const title = document.event.title.trim();
  return previewCourseFileProjectionAsAdmin(db, input, built.projection, { original: writePpen(document),
    fileName: `${(title || "banlaggning").slice(0, 120)}.ppen`, sourceName: `Banläggningen, version ${read.row.version}` }, now);
}
