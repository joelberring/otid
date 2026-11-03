import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import {
  printJobRequestSchema, printJobSchema, printJobsSchema, type PrintJob, type PrintJobProblem, type PrintJobRequest, type PrintJobs
} from "@o-tid/contracts";
import { paperImageHashes, type CourseSettingDocument } from "@o-tid/course-setting";
import { schema, type Database } from "@o-tid/database";
import { courseSettingRead, courseSettingWrite, loadRow, type Failure, type ReadProof } from "./course-setting";
import { layoutTemplateFor, PrintJobError, printProfileFor, renderPrintJob } from "./course-setting-print-render";
import type { RaceSessionProof } from "./race-session";
import { sha256Hex } from "./serialization";
import { rowContent } from "./map-content";
import { paperImagesFor } from "./course-setting-paper";
import type { FontFiles } from "@o-tid/print-pdf";
import { PDF_CAPABILITIES } from "@o-tid/print-pdf";

/**
 * Steg 65 (ADR-0184, ADR-0177): PDF för tryck som jobb i en kö (`course_setting_print_job`). Webben gör bara det lätta:
 * kontrollerar förfrågan, lägger jobbet i kön, listar, lämnar ut PDF:en och tar bort. Allt tungt (kartfilen, arken,
 * PDF:en) görs av utskriftsarbetaren i en egen process med låg prioritet (`scripts/print-worker.ts`), ett jobb i taget,
 * med korta transaktioner och en egen liten databaspool. Avläsning och tävlingsarbete väntar därför aldrig på ett jobb.
 *
 * Bara admin (banläggningens ADMIN, dvs. tävlingens ägare och administratörer); PDF:erna är aldrig publika. Klara PDF:er
 * sparas `keepDays` dagar (högst `keepPerRace` per tävling) och rensas sedan; raden står kvar 30 dagar som historik.
 */
export const PRINT_JOB_LIMITS = {
  /** Väntande och pågående jobb per tävling. */
  activePerRace: 3,
  /** Sidor i en PDF. */
  maxPages: 2000,
  /** Största PDF (byte); större blir ett fel i jobbet. */
  maxBytes: 150_000_000,
  keepDays: 7,
  keepPerRace: 10,
  /** Rader (utan PDF) sparas så här länge. */
  historyDays: 30,
  /** Ett pågående jobb utan livstecken så här länge räknas som avbrutet. */
  staleMinutes: 15,
  /** Försök per jobb (ett avbrutet jobb görs om en gång). */
  maxAttempts: 2
} as const;

type Row = typeof schema.courseSettingPrintJobs.$inferSelect;
type Problem = { status: "problem"; problem: PrintJobProblem };
const problem = (code: PrintJobProblem["problem"], message: string): Problem => ({ status: "problem", problem: { formatVersion: 1, problem: code, message } });
const DAY_MS = 24 * 3600_000;

/** Raden utan PDF:en (listan läser aldrig ut PDF-kolumnen). */
const listColumns = {
  id: schema.courseSettingPrintJobs.id, kind: schema.courseSettingPrintJobs.kind, status: schema.courseSettingPrintJobs.status,
  label: schema.courseSettingPrintJobs.label, documentVersion: schema.courseSettingPrintJobs.documentVersion,
  createdAt: schema.courseSettingPrintJobs.createdAt, startedAt: schema.courseSettingPrintJobs.startedAt, finishedAt: schema.courseSettingPrintJobs.finishedAt,
  pages: schema.courseSettingPrintJobs.pages, byteLength: schema.courseSettingPrintJobs.byteLength, error: schema.courseSettingPrintJobs.error,
  report: schema.courseSettingPrintJobs.report
};
type ListRow = Pick<Row, keyof typeof listColumns>;

function dto(row: ListRow, position: number | null): PrintJob {
  return printJobSchema.parse({ id: row.id, kind: row.kind, status: row.status, label: row.label, documentVersion: row.documentVersion,
    createdAt: row.createdAt.toISOString(), startedAt: row.startedAt?.toISOString() ?? null, finishedAt: row.finishedAt?.toISOString() ?? null,
    pages: row.pages, byteLength: row.byteLength, error: row.error, plates: row.report?.plates ?? [], overprint: row.report?.overprint ?? false,
    notes: row.report?.notes ?? [], position });
}

const KIND_LABEL = { PRESS: "Tryckeri (dekorfärger)", PROCESS: "Tryckeri (kartan i CMYK)", OFFICE: "Kontorsskrivare" } as const;

function labelFor(document: CourseSettingDocument, request: PrintJobRequest): string {
  const names = new Map(document.courses.map(course => [course.id, course.name]));
  const courses = [...new Set(request.items.map(item => item.course === "ALL_CONTROLS" ? "Alla kontroller" : names.get(item.course) ?? item.course))];
  const what = request.perRunner ? `${request.items.length} kartor per löpare${request.duplex ? " med baksidor" : ""}`
    : `${courses.slice(0, 4).join(", ")}${courses.length > 4 ? ` m.fl. (${courses.length})` : ""}`;
  return `${KIND_LABEL[request.kind]}: ${what}`.slice(0, 500);
}

/** Jobben för tävlingen, nyaste först (högst 30), med plats i kön för väntande. */
export async function listPrintJobsAsAdmin(db: Database, input: ReadProof, now = new Date()): Promise<Failure | { status: "ok"; response: PrintJobs }> {
  return courseSettingRead(db, input, now, async (tx, raceId) => {
    const rows = await tx.select(listColumns).from(schema.courseSettingPrintJobs).where(eq(schema.courseSettingPrintJobs.raceId, raceId))
      .orderBy(desc(schema.courseSettingPrintJobs.createdAt)).limit(30);
    const queued = await tx.select({ id: schema.courseSettingPrintJobs.id }).from(schema.courseSettingPrintJobs)
      .where(eq(schema.courseSettingPrintJobs.status, "QUEUED")).orderBy(asc(schema.courseSettingPrintJobs.createdAt)).limit(1000);
    const position = new Map(queued.map((row, index) => [row.id, index + 1]));
    return { status: "ok" as const, response: printJobsSchema.parse({ formatVersion: 1, raceId, jobs: rows.map(row => dto(row, position.get(row.id) ?? null)),
      keepDays: PRINT_JOB_LIMITS.keepDays, maxBytes: PRINT_JOB_LIMITS.maxBytes }) };
  }, "ADMIN");
}

/**
 * Nytt jobb från förhandsvisningen. Kontrollerar förfrågan, mallen och profilen (lätt) och att profilens krav går att
 * uppfylla (PDF/X och ICC kan PDF:en inte, då stoppar förhandskontrollen). Samma `requestId` två gånger ger samma jobb.
 */
export async function createPrintJobAsAdmin(db: Database, input: RaceSessionProof & { request: unknown }, now = new Date())
  : Promise<Failure | Problem | { status: "ok"; job: PrintJob; created: boolean }> {
  const parsed = printJobRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  const request = parsed.data;
  return courseSettingWrite(db, input, now, "ADMIN", async (tx, raceId, actorId) => {
    const [existing] = await tx.select(listColumns).from(schema.courseSettingPrintJobs)
      .where(and(eq(schema.courseSettingPrintJobs.raceId, raceId), eq(schema.courseSettingPrintJobs.requestId, request.requestId)));
    if (existing) return { status: "ok" as const, job: dto(existing, null), created: false };
    const row = await loadRow(tx, raceId);
    if (!row) return problem("NO_COURSE_SETTING", "Det finns ingen banläggning att skriva ut.");
    const document = row.document as unknown as CourseSettingDocument;
    let profile;
    try { profile = printProfileFor(document, request); } catch (error) { return problem("INVALID_PROFILE", (error as Error).message); }
    if (request.layout.kind === "TEMPLATE") {
      try { layoutTemplateFor(document, request.layout.template); } catch (error) { return problem("INVALID_TEMPLATE", (error as Error).message); }
    }
    const missing = [profile.requirements.pdfX && !PDF_CAPABILITIES.pdfX ? "PDF/X" : "", profile.requirements.icc && !PDF_CAPABILITIES.icc ? "ICC-profil" : ""]
      .filter(Boolean);
    if (missing.length > 0) return problem("PREFLIGHT_BLOCKED", `Profilen kräver ${missing.join(" och ")}, som PDF:en inte kan ge än (inte verifierat).`);
    const [active] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.courseSettingPrintJobs)
      .where(and(eq(schema.courseSettingPrintJobs.raceId, raceId), inArray(schema.courseSettingPrintJobs.status, ["QUEUED", "RUNNING"])));
    if ((active?.n ?? 0) >= PRINT_JOB_LIMITS.activePerRace) {
      return problem("TOO_MANY_JOBS", `Högst ${PRINT_JOB_LIMITS.activePerRace} PDF:er åt gången per tävling; vänta tills ett jobb är klart.`);
    }
    const id = randomUUID();
    const [created] = await tx.insert(schema.courseSettingPrintJobs).values({ id, raceId, requestId: request.requestId, kind: request.kind, status: "QUEUED",
      label: labelFor(document, request), request: request as unknown as Record<string, unknown>, document: row.document as unknown as Record<string, unknown>,
      documentVersion: row.version, createdAt: now, createdBy: actorId }).returning(listColumns);
    await tx.insert(schema.auditEvents).values({ raceId, entityType: "course_setting", entityId: raceId, action: "COURSE_SETTING_PRINT_JOB_CREATED",
      actorKind: "USER_ACCOUNT", actorId, after: { job: id, kind: request.kind, items: request.items.length, version: row.version } });
    return { status: "ok" as const, job: dto(created!, null), created: true };
  });
}

/** PDF:en för ett klart jobb (bara admin). */
export async function readPrintJobPdfAsAdmin(db: Database, input: ReadProof & { jobId: string }, now = new Date())
  : Promise<Failure | { status: "ok"; pdf: Uint8Array; fileName: string }> {
  return courseSettingRead(db, input, now, async (tx, raceId) => {
    const [row] = await tx.select({ pdf: schema.courseSettingPrintJobs.pdf, status: schema.courseSettingPrintJobs.status, kind: schema.courseSettingPrintJobs.kind,
      createdAt: schema.courseSettingPrintJobs.createdAt }).from(schema.courseSettingPrintJobs)
      .where(and(eq(schema.courseSettingPrintJobs.raceId, raceId), eq(schema.courseSettingPrintJobs.id, input.jobId)));
    if (!row || row.status !== "DONE" || !row.pdf) return { status: "not-found" as const };
    const stamp = row.createdAt.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
    return { status: "ok" as const, pdf: row.pdf as Uint8Array, fileName: `banor-${row.kind === "OFFICE" ? "kontor" : "tryck"}-${stamp}.pdf` };
  }, "ADMIN");
}

/** Tar bort ett jobb (också ett väntande eller pågående: arbetaren slänger då sitt resultat). */
export async function deletePrintJobAsAdmin(db: Database, input: RaceSessionProof & { jobId: string }, now = new Date())
  : Promise<Failure | { status: "ok" }> {
  return courseSettingWrite(db, input, now, "ADMIN", async (tx, raceId) => {
    const removed = await tx.delete(schema.courseSettingPrintJobs)
      .where(and(eq(schema.courseSettingPrintJobs.raceId, raceId), eq(schema.courseSettingPrintJobs.id, input.jobId))).returning({ id: schema.courseSettingPrintJobs.id });
    return removed.length === 0 ? { status: "not-found" as const } : { status: "ok" as const };
  });
}

// Arbetarens sida (ingen inloggning: körs bara av utskriftsarbetaren på servern).

export interface ClaimedPrintJob { readonly id: string; readonly raceId: string; readonly attempts: number }

/**
 * Tar nästa väntande jobb (äldst först) med `FOR UPDATE SKIP LOCKED`, så att flera arbetare aldrig tar samma. Ett
 * pågående jobb utan livstecken på `staleMinutes` görs om (högst `maxAttempts` försök) eller markeras misslyckat.
 */
export async function claimPrintJob(db: Database, worker: string, now = new Date()): Promise<ClaimedPrintJob | undefined> {
  const stale = new Date(now.getTime() - PRINT_JOB_LIMITS.staleMinutes * 60_000);
  await db.update(schema.courseSettingPrintJobs).set({ status: "FAILED", finishedAt: now, error: "Jobbet avbröts (servern startades om eller jobbet tog för lång tid)." })
    .where(and(eq(schema.courseSettingPrintJobs.status, "RUNNING"), lt(schema.courseSettingPrintJobs.heartbeatAt, stale),
      sql`${schema.courseSettingPrintJobs.attempts} >= ${PRINT_JOB_LIMITS.maxAttempts}`));
  await db.update(schema.courseSettingPrintJobs).set({ status: "QUEUED", worker: null })
    .where(and(eq(schema.courseSettingPrintJobs.status, "RUNNING"), lt(schema.courseSettingPrintJobs.heartbeatAt, stale)));
  const result = await db.execute<{ id: string; race_id: string; attempts: number }>(sql`
    update course_setting_print_job set status = 'RUNNING', started_at = ${now}, heartbeat_at = ${now}, attempts = attempts + 1, worker = ${worker}
    where id = (select id from course_setting_print_job where status = 'QUEUED' order by created_at, id for update skip locked limit 1)
    returning id, race_id, attempts`);
  const row = result.rows[0];
  return row ? { id: row.id, raceId: row.race_id, attempts: row.attempts } : undefined;
}

/** Livstecken medan jobbet körs (en arbetare som dött syns på att det uteblir). */
export async function heartbeatPrintJob(db: Database, id: string, worker: string, now = new Date()): Promise<boolean> {
  const updated = await db.update(schema.courseSettingPrintJobs).set({ heartbeatAt: now })
    .where(and(eq(schema.courseSettingPrintJobs.id, id), eq(schema.courseSettingPrintJobs.status, "RUNNING"), eq(schema.courseSettingPrintJobs.worker, worker)))
    .returning({ id: schema.courseSettingPrintJobs.id });
  return updated.length > 0;
}

/**
 * ADR-0186: jobbet avbröts av arbetaren (tidsgränsen passerades eller barnprocessen dog). FAILED med texten, bara om jobbet
 * fortfarande är arbetarens. Kön går vidare med nästa jobb.
 */
export async function failPrintJob(db: Database, id: string, worker: string, message: string, now = new Date()): Promise<boolean> {
  const updated = await db.update(schema.courseSettingPrintJobs).set({ status: "FAILED", finishedAt: now, error: message.slice(0, 2000) })
    .where(and(eq(schema.courseSettingPrintJobs.id, id), eq(schema.courseSettingPrintJobs.status, "RUNNING"), eq(schema.courseSettingPrintJobs.worker, worker)))
    .returning({ id: schema.courseSettingPrintJobs.id });
  return updated.length > 0;
}

export interface PrintWorkerOptions {
  readonly fonts: FontFiles;
  readonly worker: string;
  readonly maxBytes?: number | undefined;
  readonly now?: () => Date;
}

/**
 * Kör ett taget jobb: läser jobbet och kartfilen (en kort fråga), skriver PDF:en utan transaktion och sparar resultatet
 * (en kort uppdatering, bara om jobbet fortfarande är arbetarens). Ett fel i jobbet blir FAILED med texten.
 */
export async function runPrintJob(db: Database, job: ClaimedPrintJob, options: PrintWorkerOptions): Promise<"DONE" | "FAILED" | "GONE"> {
  const clock = options.now ?? (() => new Date());
  const [row] = await db.select({ request: schema.courseSettingPrintJobs.request, document: schema.courseSettingPrintJobs.document })
    .from(schema.courseSettingPrintJobs).where(and(eq(schema.courseSettingPrintJobs.id, job.id), eq(schema.courseSettingPrintJobs.status, "RUNNING")));
  if (!row) return "GONE";
  const [source] = await db.select({ inline: schema.raceMapSources.file, contentSha256: schema.raceMapSources.contentSha256,
    fileName: schema.raceMapSources.fileName, bounds: schema.raceMapSources.bounds })
    .from(schema.raceMapSources).where(eq(schema.raceMapSources.raceId, job.raceId));
  // ADR-0189: filen ur innehållslagret (eller den gamla kolumnen); utskriftsrollen läser båda.
  const sourceFile = source ? await rowContent(db, source) : undefined;
  const map = source && sourceFile ? { file: sourceFile, fileName: source.fileName, bounds: source.bounds } : undefined;
  const [race] = await db.select({ name: schema.races.name }).from(schema.races).where(eq(schema.races.id, job.raceId));
  const started = performance.now();
  const finish = async (values: Partial<typeof schema.courseSettingPrintJobs.$inferInsert>) => {
    const updated = await db.update(schema.courseSettingPrintJobs).set({ ...values, finishedAt: clock() })
      .where(and(eq(schema.courseSettingPrintJobs.id, job.id), eq(schema.courseSettingPrintJobs.status, "RUNNING"), eq(schema.courseSettingPrintJobs.worker, options.worker)))
      .returning({ id: schema.courseSettingPrintJobs.id });
    return updated.length > 0;
  };
  try {
    const request = printJobRequestSchema.parse(row.request);
    const document = row.document as unknown as CourseSettingDocument;
    const paperImages = await paperImagesFor(db, paperImageHashes(document));
    const result = await renderPrintJob({ paperImages, document, request, fonts: options.fonts, maxPages: PRINT_JOB_LIMITS.maxPages,
      title: [race?.name, document.event.title.replace(/\|/g, " ")].filter(Boolean).join(" – ") || "O-Tid banor", now: clock(),
      map: map ? { bytes: new Uint8Array(map.file), fileName: map.fileName, bounds: map.bounds } : null });
    const maxBytes = options.maxBytes ?? PRINT_JOB_LIMITS.maxBytes;
    if (result.bytes.byteLength > maxBytes) {
      return await finish({ status: "FAILED", error: `PDF:en blev ${Math.round(result.bytes.byteLength / 1e6)} MB; högst ${Math.round(maxBytes / 1e6)} MB. Dela upp utskriften.` })
        ? "FAILED" : "GONE";
    }
    const notes = [...result.preflight, ...result.notes, ...(map ? [] : ["Tävlingen har ingen kartfil: PDF:en har bara banpåtrycket."])].slice(0, 200);
    const saved = await finish({ status: "DONE", pdf: Buffer.from(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength),
      byteLength: result.bytes.byteLength, pages: result.pages, sha256: sha256Hex(result.bytes), error: null,
      report: { plates: [...result.plates], overprint: result.overprint, notes, mapForms: result.mapForms, milliseconds: Math.round(performance.now() - started) } });
    return saved ? "DONE" : "GONE";
  } catch (error) {
    const known = error instanceof PrintJobError || (error instanceof Error && error.name === "CourseSettingEditError");
    const message = known ? (error as Error).message : "PDF:en kunde inte skrivas (internt fel, se serverns logg).";
    if (!known) console.error("Utskriftsjobbet misslyckades", job.id, error);
    return await finish({ status: "FAILED", error: message.slice(0, 2000) }) ? "FAILED" : "GONE";
  }
}

/** Rensar gamla PDF:er (efter `keepDays`, och fler än `keepPerRace` per tävling) och gamla rader (efter `historyDays`). */
export async function cleanupPrintJobs(db: Database, now = new Date()): Promise<{ expired: number; deleted: number }> {
  const before = new Date(now.getTime() - PRINT_JOB_LIMITS.keepDays * DAY_MS);
  const old = await db.update(schema.courseSettingPrintJobs).set({ status: "EXPIRED", pdf: null })
    .where(and(eq(schema.courseSettingPrintJobs.status, "DONE"), lt(schema.courseSettingPrintJobs.finishedAt, before))).returning({ id: schema.courseSettingPrintJobs.id });
  const extra = await db.execute<{ id: string }>(sql`
    update course_setting_print_job set status = 'EXPIRED', pdf = null
    where id in (select id from (select id, row_number() over (partition by race_id order by finished_at desc, id) as n
      from course_setting_print_job where status = 'DONE') ranked where n > ${PRINT_JOB_LIMITS.keepPerRace})
    returning id`);
  const deleted = await db.delete(schema.courseSettingPrintJobs)
    .where(and(inArray(schema.courseSettingPrintJobs.status, ["DONE", "FAILED", "EXPIRED"]),
      lt(schema.courseSettingPrintJobs.createdAt, new Date(now.getTime() - PRINT_JOB_LIMITS.historyDays * DAY_MS))))
    .returning({ id: schema.courseSettingPrintJobs.id });
  return { expired: old.length + extra.rows.length, deleted: deleted.length };
}
