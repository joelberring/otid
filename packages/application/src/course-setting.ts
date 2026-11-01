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
import { requireCourseSettingAccess, type CourseSettingPrincipal, type CourseSettingRequirement } from "./course-setting-access";
import type { RaceSessionProof } from "./race-session";
import { UUID_PATTERN as uuid } from "./serialization";
import { previewCourseFileProjectionAsAdmin } from "./source-sync";

/**
 * Steg 62 (ADR-0180 beslut 1, 4, 8): banläggningens dokument. Webbläsaren läser .ppen, ändrar och räknar; servern sparar
 * dokumentet med versionskontroll (två flikar skriver inte över varandra), behåller tidigare versioner och för över det
 * till tävlingens banor genom samma jämförelse som en banfil. Aldrig publikt (banhemligheten, ADR-0176).
 *
 * Steg 66 (ADR-0181 beslut 5): behörigheten är banläggningens (`requireCourseSettingAccess`): läsa kräver COMMENT, spara,
 * läsa in och återställa EDIT, överföra till tävlingen ADMIN. Funktionsnamnen (…AsAdmin) är kvar från steg 62.
 *
 * Sparandet låser inte tävlingen (ADR-0177: avläsningen går före); två sparanden för samma tävling turas om med ett lås
 * per tävling. Autosparandet ger inte en tidigare version per sparande: en version behålls när den är minst tio minuter
 * äldre än den senast behållna, sparades av någon annan, kom från en inläsning eller återställning, eller ersätts av en
 * inläst .ppen eller en återställning.
 */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "too-large" };
export type Conflict = { status: "version-conflict"; conflict: CourseSettingConflict };
export type ReadProof = Omit<RaceSessionProof, "csrfCookie" | "csrfHeader">;
export type Row = typeof schema.courseSettings.$inferSelect;
type Kind = "SAVE" | "IMPORT" | "RESTORE";
/** Versioner vars ändringar (`course_setting_change`) behålls för att se konflikter. */
const CHANGES_KEPT = 500;

const REVISION_INTERVAL_MS = 10 * 60_000;
export const documentBytes = (document: unknown) => Buffer.byteLength(JSON.stringify(document), "utf8");

/** Läsning med banläggningens behörighet (förval COMMENT). */
export async function courseSettingRead<T>(db: Database, input: ReadProof, now: Date,
  read: (tx: Transaction, raceId: string, principal: CourseSettingPrincipal) => Promise<T>, required: CourseSettingRequirement = "COMMENT")
  : Promise<Failure | T> {
  if (!uuid.test(input.raceId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await requireCourseSettingAccess(tx, { ...input, required }, now, "share");
    if (auth.status !== "authenticated") return auth;
    return read(tx, auth.principal.raceId, auth.principal);
  }, { isolationLevel: "repeatable read" });
}

/** Skrivning med banläggningens behörighet; två skrivningar för samma tävling turas om (lås per tävling, inte tävlingen). */
export async function courseSettingWrite<T>(db: Database, input: RaceSessionProof, now: Date, required: CourseSettingRequirement,
  write: (tx: Transaction, raceId: string, actorId: string, principal: CourseSettingPrincipal) => Promise<T>): Promise<Failure | T> {
  if (!uuid.test(input.raceId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await requireCourseSettingAccess(tx, { ...input, required, requireCsrf: true }, now, "share");
    if (auth.status !== "authenticated") return auth;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"course-setting:" + auth.principal.raceId}, 0))`);
    return write(tx, auth.principal.raceId, auth.principal.accountId, auth.principal);
  });
}

const adminRead = <T>(db: Database, input: ReadProof, now: Date, read: (tx: Transaction, raceId: string) => Promise<T>) =>
  courseSettingRead(db, input, now, read, "ADMIN");

export async function loadRow(tx: Transaction, raceId: string): Promise<Row | undefined> {
  const [row] = await tx.select().from(schema.courseSettings).where(eq(schema.courseSettings.raceId, raceId));
  return row;
}

export async function actors(tx: Transaction, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await tx.select({ id: schema.userAccounts.id, displayName: schema.userAccounts.displayName }).from(schema.userAccounts)
    .where(sql`${schema.userAccounts.id} in (${sql.join(unique.map(id => sql`${id}`), sql`, `)})`);
  return new Map(rows.map(row => [row.id, row.displayName]));
}
export const actor = (names: Map<string, string>, accountId: string) => ({ accountId, displayName: names.get(accountId) ?? null });

export function conflict(row: Row | undefined, names: Map<string, string>): Conflict {
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
export async function store(tx: Transaction, input: { raceId: string; actorId: string; now: Date; current: Row | undefined; kind: Kind;
  document: CourseSettingDocumentDto; original?: { fileName: string; ppen: string };
  /** Steg 66: vad versionen ändrade (förval: hela dokumentet) och sparningens id och svar. */
  change?: { touches: readonly string[]; requestId: string; result: (version: number) => Record<string, unknown> } }): Promise<CourseSettingSaved> {
  const { raceId, actorId, now, current, kind, document } = input;
  const version = (current?.version ?? 0) + 1;
  if (current) {
    const table = schema.courseSettingRevisions;
    const [latest] = await tx.select({ version: table.version, kind: table.kind, createdAt: table.createdAt, createdBy: table.createdBy })
      .from(table).where(eq(table.raceId, raceId)).orderBy(desc(table.version)).limit(1);
    // Versionen som en inläsning eller återställning gav behålls alltid (den går att gå tillbaka till).
    const keep = kind !== "SAVE" || !latest || latest.createdBy !== current.updatedBy ||
      (latest.kind !== "SAVE" && latest.version === current.version - 1) ||
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
  const changes = schema.courseSettingChanges;
  await tx.insert(changes).values({ raceId, version, touches: input.change ? [...new Set(input.change.touches)] : "ALL", createdAt: now,
    createdBy: actorId, requestId: input.change?.requestId ?? null, result: input.change?.result(version) ?? null });
  if (version > CHANGES_KEPT) await tx.delete(changes).where(and(eq(changes.raceId, raceId), sql`${changes.version} <= ${version - CHANGES_KEPT}`));
  return courseSettingSavedSchema.parse({ formatVersion: 1, raceId, version, updatedAt: now.toISOString() });
}

export async function loadMapFile(tx: Transaction, raceId: string) {
  const [row] = await tx.select({ sha256: schema.raceMapSources.sha256, fileName: schema.raceMapSources.fileName, scale: schema.raceMapSources.scale,
    bounds: schema.raceMapSources.bounds, georeference: schema.raceMapSources.georeference }).from(schema.raceMapSources)
    .where(eq(schema.raceMapSources.raceId, raceId));
  return row;
}

/** Editorns läge: dokumentet (null = inget än), den inlästa .ppen-filen, kartfilen som editorn ritar och behörigheten. */
export async function readCourseSettingAsAdmin(db: Database, input: ReadProof, now = new Date())
  : Promise<Failure | { status: "ok"; response: CourseSettingState }> {
  return courseSettingRead(db, input, now, async (tx, raceId, principal) => {
    const row = await loadRow(tx, raceId);
    const map = await loadMapFile(tx, raceId);
    const names = await actors(tx, row ? [row.updatedBy] : []);
    return { status: "ok" as const, response: courseSettingStateSchema.parse({ formatVersion: 1, raceId,
      access: { accountId: principal.accountId, displayName: principal.displayName || null, level: principal.level, admin: principal.admin },
      setting: row ? { version: row.version, updatedAt: row.updatedAt.toISOString(), updatedBy: actor(names, row.updatedBy), mode: row.mode,
        document: row.document } : null,
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
  return courseSettingWrite(db, input, now, "EDIT", async (tx, raceId, actorId) => {
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
  return courseSettingWrite(db, input, now, "EDIT", async (tx, raceId, actorId) => {
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
  return courseSettingRead(db, input, now, async (tx, raceId) => {
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
  return courseSettingRead(db, input, now, async (tx, raceId) => {
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
  return courseSettingWrite(db, input, now, "EDIT", async (tx, raceId, actorId) => {
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
  return courseSettingRead(db, input, now, async (tx, raceId) => {
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
