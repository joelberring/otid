import { runGeneralizeJob, runNormCheck, type GeneralizeJobRequest } from "./map-project-job-generalize";
import type { Box } from "./map-project-job-run";
import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { consumeAccountRequestAllowance } from "./account-throttle";
import type { CourseSettingDocument } from "@o-tid/course-setting";
import { readMapFile } from "@o-tid/map-file";
import type { RouteChoiceSettings } from "@o-tid/route-choice";
import { measureCourseLevels } from "./course-level";
import { renderCourse, type CourseRenderRequest } from "./course-render";
import { readMapContent, rowContent } from "./map-content";
import {
  loadProjectMap, runCheck, runCompare, runObjects, runOverview, runPropose, runRender, type CreateMapJobCanvas, type ProposalOperation
} from "./map-project-job-run";

/**
 * ADR-0219 (K2): kartjobbskön. Webben lägger ett jobb åt AI-kopplingen och väntar högst några sekunder på svaret;
 * utskriftsarbetaren (låg prioritet, barnprocess per jobb) tar jobben ett i taget och skriver resultatet. Resultaten är
 * tillfälliga (rensas efter en timme). `pg_notify('otid_map_job')` väcker arbetaren direkt.
 */
export const MAP_JOB_KINDS = ["OVERVIEW", "RENDER", "COMPARE", "OBJECTS", "CHECK", "PROPOSE", "COURSE_RENDER", "COURSE_LEVEL", "GENERALIZE"] as const;
export type MapJobKind = typeof MAP_JOB_KINDS[number];
export const MAP_JOB_CHANNEL = "otid_map_job";
/** Högst så många jobb per konto och minut, och samtidigt. */
const JOBS_PER_MINUTE = 30;
const CONCURRENT_PER_ACCOUNT = 2;
const RESULT_RETENTION_MS = 60 * 60_000;
const STALE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 2;

export type MapJobOutcome =
  | { status: "done"; result: unknown; image: Uint8Array | null }
  | { status: "failed"; error: string }
  | { status: "timeout" }
  | { status: "throttled" };

/**
 * Ägaren 2026-11-08: ett jobb som redan finns för samma tävling, slag och indata (`request.hash`) och inte misslyckats, så att
 * en lång mätning som inte hann klart kan hämtas med ett nytt anrop i stället för att räknas om.
 */
export async function reusableRaceJob(db: Database, input: { accountId: string; raceId: string; kind: MapJobKind; hash: string }): Promise<string | undefined> {
  const [row] = await db.select({ id: schema.mapProjectJobs.id }).from(schema.mapProjectJobs)
    .where(and(eq(schema.mapProjectJobs.raceId, input.raceId), eq(schema.mapProjectJobs.kind, input.kind), eq(schema.mapProjectJobs.accountId, input.accountId),
      inArray(schema.mapProjectJobs.status, ["QUEUED", "RUNNING", "DONE"]), sql`${schema.mapProjectJobs.request}->>'hash' = ${input.hash}`))
    .orderBy(sql`${schema.mapProjectJobs.createdAt} desc`).limit(1);
  return row?.id;
}

/** Väntar på ett jobb som redan finns (utan att ta bort det när tiden gått ut). */
export async function waitForMapJob(db: Database, id: string, options: { timeoutMs?: number; pollMs?: number } = {}): Promise<MapJobOutcome> {
  const deadline = Date.now() + (options.timeoutMs ?? 25_000);
  for (;;) {
    const [row] = await db.select({ status: schema.mapProjectJobs.status, result: schema.mapProjectJobs.result, image: schema.mapProjectJobs.image,
      error: schema.mapProjectJobs.error }).from(schema.mapProjectJobs).where(eq(schema.mapProjectJobs.id, id));
    if (row?.status === "DONE") return { status: "done", result: row.result, image: row.image ? new Uint8Array(row.image) : null };
    if (row?.status === "FAILED" || !row) return { status: "failed", error: row?.error ?? "Jobbet försvann" };
    if (Date.now() >= deadline) return { status: "timeout" };
    await new Promise(resolve => setTimeout(resolve, options.pollMs ?? 150));
  }
}

/** Lägger jobbet och väntar på svaret (pollar raden). Ett jobb som fortfarande väntar i kön när tiden gått ut tas bort. */
/** Ett jobb gäller ett kartprojekt (`projectId`) eller, för COURSE_RENDER, en tävlings banläggning (`raceId`, migration 0101). */
export async function runMapJobAndWait(db: Database, input: { accountId: string; kind: MapJobKind; request: Record<string, unknown> }
  & ({ projectId: string; raceId?: undefined } | { raceId: string; projectId?: undefined }),
  options: { timeoutMs?: number; pollMs?: number; now?: () => Date } = {}): Promise<MapJobOutcome> {
  const clock = options.now ?? (() => new Date());
  const id = randomUUID();
  const queued = await db.transaction(async tx => {
    const now = clock();
    if (!await consumeAccountRequestAllowance(tx, { scope: "MCP_JOB_ACCOUNT", key: input.accountId, limit: JOBS_PER_MINUTE, windowMs: 60_000 }, now)) return false;
    const [{ running } = { running: 0 }] = await tx.select({ running: sql<number>`count(*)::int` }).from(schema.mapProjectJobs)
      .where(and(eq(schema.mapProjectJobs.accountId, input.accountId), inArray(schema.mapProjectJobs.status, ["QUEUED", "RUNNING"]),
        gt(schema.mapProjectJobs.createdAt, new Date(now.getTime() - STALE_MS))));
    if (running >= CONCURRENT_PER_ACCOUNT) return false;
    await tx.insert(schema.mapProjectJobs).values({ id, projectId: input.projectId ?? null, raceId: input.raceId ?? null, accountId: input.accountId, kind: input.kind, request: input.request,
      status: "QUEUED", createdAt: now });
    await tx.execute(sql`select pg_notify(${MAP_JOB_CHANNEL}, '')`);
    return true;
  });
  if (!queued) return { status: "throttled" };
  const deadline = Date.now() + (options.timeoutMs ?? 25_000);
  const pollMs = options.pollMs ?? 150;
  for (;;) {
    const [row] = await db.select({ status: schema.mapProjectJobs.status, result: schema.mapProjectJobs.result, image: schema.mapProjectJobs.image,
      error: schema.mapProjectJobs.error }).from(schema.mapProjectJobs).where(eq(schema.mapProjectJobs.id, id));
    if (row?.status === "DONE") return { status: "done", result: row.result, image: row.image ? new Uint8Array(row.image) : null };
    if (row?.status === "FAILED" || !row) return { status: "failed", error: row?.error ?? "Jobbet försvann" };
    if (Date.now() >= deadline) {
      await db.update(schema.mapProjectJobs).set({ status: "FAILED", finishedAt: clock(), error: "Tog för lång tid" })
        .where(and(eq(schema.mapProjectJobs.id, id), eq(schema.mapProjectJobs.status, "QUEUED")));
      return { status: "timeout" };
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}

export interface ClaimedMapJob { id: string; projectId: string | null; raceId: string | null; kind: string; request: Record<string, unknown>; attempts: number }

/** Arbetaren tar nästa jobb (äldst först). Jobb vars arbetare dött läggs tillbaka (eller misslyckas efter två försök). */
export async function claimMapJob(db: Database, worker: string, now = new Date()): Promise<ClaimedMapJob | undefined> {
  const stale = new Date(now.getTime() - STALE_MS);
  await db.update(schema.mapProjectJobs).set({ status: "FAILED", finishedAt: now, error: "Jobbet avbröts (arbetaren startades om)" })
    .where(and(eq(schema.mapProjectJobs.status, "RUNNING"), lt(schema.mapProjectJobs.heartbeatAt, stale), sql`${schema.mapProjectJobs.attempts} >= ${MAX_ATTEMPTS}`));
  await db.update(schema.mapProjectJobs).set({ status: "QUEUED", worker: null })
    .where(and(eq(schema.mapProjectJobs.status, "RUNNING"), lt(schema.mapProjectJobs.heartbeatAt, stale)));
  const result = await db.execute<{ id: string; project_id: string | null; race_id: string | null; kind: string; request: Record<string, unknown>; attempts: number }>(sql`
    update map_project_job set status = 'RUNNING', started_at = ${now}, heartbeat_at = ${now}, attempts = attempts + 1, worker = ${worker}
    where id = (select id from map_project_job where status = 'QUEUED' order by created_at, id for update skip locked limit 1)
    returning id, project_id, race_id, kind, request, attempts`);
  const row = result.rows[0];
  return row ? { id: row.id, projectId: row.project_id, raceId: row.race_id, kind: row.kind, request: row.request, attempts: row.attempts } : undefined;
}

async function finish(db: Database, id: string, worker: string, values: { status: MapJobFinished; result?: unknown; image?: Uint8Array | null; error?: string },
  now: Date): Promise<boolean> {
  const updated = await db.update(schema.mapProjectJobs).set({ status: values.status, finishedAt: now, result: values.result ?? null,
    image: values.image ? Buffer.from(values.image) : null, error: values.error?.slice(0, 2000) ?? null })
    .where(and(eq(schema.mapProjectJobs.id, id), eq(schema.mapProjectJobs.status, "RUNNING"), eq(schema.mapProjectJobs.worker, worker)))
    .returning({ id: schema.mapProjectJobs.id });
  return updated.length > 0;
}
type MapJobFinished = "DONE" | "FAILED";

export const failMapJob = (db: Database, id: string, worker: string, error: string, now = new Date()) =>
  finish(db, id, worker, { status: "FAILED", error }, now);

/** Färdiga jobb äldre än en timme tas bort (resultaten kan göras om). */
export async function cleanupMapJobs(db: Database, now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - RESULT_RETENTION_MS);
  const deleted = await db.delete(schema.mapProjectJobs).where(or(lt(schema.mapProjectJobs.finishedAt, before),
    and(eq(schema.mapProjectJobs.status, "QUEUED"), lt(schema.mapProjectJobs.createdAt, before)))).returning({ id: schema.mapProjectJobs.id });
  return deleted.length;
}

/** Barnprocessen: läser grundfilen och projektets objekt, gör jobbet och skriver resultatet. */
export async function runMapJob(db: Database, job: ClaimedMapJob, deps: { worker: string; createCanvas: CreateMapJobCanvas }, now = new Date())
  : Promise<"DONE" | "FAILED"> {
  if (job.kind === "COURSE_RENDER" || job.kind === "COURSE_LEVEL") return runCourseRenderJob(db, job, deps, now);
  if (!job.projectId) { await failMapJob(db, job.id, deps.worker, "Jobbet saknar kartprojekt"); return "FAILED"; }
  const [project] = await db.select({ baseSha256: schema.mapProjects.baseSha256, baseFormat: schema.mapProjects.baseFormat, area: schema.mapProjects.area })
    .from(schema.mapProjects).where(eq(schema.mapProjects.id, job.projectId));
  if (!project) { await failMapJob(db, job.id, deps.worker, "Projektet finns inte"); return "FAILED"; }
  const bytes = await readMapContent(db, project.baseSha256);
  if (!bytes) { await failMapJob(db, job.id, deps.worker, "Grundfilen saknas"); return "FAILED"; }
  const rows = await db.select({ objectKey: schema.mapProjectObjects.objectKey, ref: schema.mapProjectObjects.ref, state: schema.mapProjectObjects.state,
    lastEditId: schema.mapProjectObjects.lastEditId }).from(schema.mapProjectObjects).where(eq(schema.mapProjectObjects.projectId, job.projectId));
  const loaded = loadProjectMap(new Uint8Array(bytes), project.baseFormat === "OCD" ? "grund.ocd" : "grund.omap", project.baseSha256, rows);
  const request = job.request;
  const area = project.area ?? null;
  let output: { result: unknown; image?: Uint8Array | null } | { error: string };
  switch (job.kind as MapJobKind) {
    case "OVERVIEW": output = { result: runOverview(loaded, area) }; break;
    case "RENDER": { const rendered = runRender(loaded, request, area, deps.createCanvas); output = { result: rendered.meta, image: rendered.png }; break; }
    case "COMPARE": { const rendered = runCompare(loaded, request, area, deps.createCanvas); output = { result: rendered.meta, image: rendered.png }; break; }
    case "OBJECTS": output = { result: runObjects(loaded, request) }; break;
    // K6 del 2: den grundläggande kontrollen och normkontrollen (samma regler som editorn).
    case "CHECK": output = { result: { ...runCheck(loaded, request), norm: runNormCheck(loaded, request.area as Box | undefined) } }; break;
    case "GENERALIZE": output = { result: runGeneralizeJob(loaded, request as GeneralizeJobRequest, now) }; break;
    case "PROPOSE": {
      const proposed = runPropose(loaded, (request.operations ?? []) as ProposalOperation[], now);
      output = proposed.status === "ok" ? { result: { edits: proposed.edits } } : { result: { errors: proposed.errors } };
      break;
    }
    default: output = { error: `Okänt jobb ${job.kind}` };
  }
  if ("error" in output) { await failMapJob(db, job.id, deps.worker, output.error); return "FAILED"; }
  await finish(db, job.id, deps.worker, { status: "DONE", result: output.result, image: output.image ?? null }, now);
  return "DONE";
}

export async function heartbeatMapJob(db: Database, id: string, worker: string, now = new Date()): Promise<void> {
  await db.update(schema.mapProjectJobs).set({ heartbeatAt: now })
    .where(and(eq(schema.mapProjectJobs.id, id), eq(schema.mapProjectJobs.status, "RUNNING"), eq(schema.mapProjectJobs.worker, worker)));
}

/** Barnprocessen hämtar jobbet som huvudprocessen tagit (bara om det fortfarande är arbetarens). */
export async function loadClaimedMapJob(db: Database, id: string, worker: string): Promise<ClaimedMapJob | undefined> {
  const [job] = await db.select().from(schema.mapProjectJobs).where(and(eq(schema.mapProjectJobs.id, id), eq(schema.mapProjectJobs.worker, worker),
    eq(schema.mapProjectJobs.status, "RUNNING")));
  return job ? { id: job.id, projectId: job.projectId, raceId: job.raceId, kind: job.kind, request: job.request, attempts: job.attempts } : undefined;
}

/**
 * Ägaren 2026-11-08: en bild av en bana (AI-banläggningsassistenten). Dokumentet följer med jobbet (som utskriftsjobben);
 * tävlingens kartfil läses här. Utan kartfil ritas bara banan.
 */
async function runCourseRenderJob(db: Database, job: ClaimedMapJob, deps: { worker: string; createCanvas: CreateMapJobCanvas }, now: Date)
  : Promise<"DONE" | "FAILED"> {
  if (!job.raceId) { await failMapJob(db, job.id, deps.worker, "Jobbet saknar tävling"); return "FAILED"; }
  const request = job.request as { document?: unknown; course?: unknown; widthPx?: unknown; grid?: unknown; area?: unknown };
  const [source] = await db.select({ inline: schema.raceMapSources.file, contentSha256: schema.raceMapSources.contentSha256, fileName: schema.raceMapSources.fileName })
    .from(schema.raceMapSources).where(eq(schema.raceMapSources.raceId, job.raceId));
  const file = source ? await rowContent(db, source) : undefined;
  try {
    if (job.kind === "COURSE_LEVEL") {
      if (!file || !source) { await failMapJob(db, job.id, deps.worker, "Tävlingen har ingen kartfil; nivån kan inte mätas"); return "FAILED"; }
      const map = readMapFile(new Uint8Array(file), source.fileName);
      const result = measureCourseLevels(map, request.document as CourseSettingDocument, (job.request.settings ?? { version: 1 }) as RouteChoiceSettings,
        typeof request.course === "string" ? request.course : undefined);
      await finish(db, job.id, deps.worker, { status: "DONE", result: { courses: result }, image: null }, now);
      return "DONE";
    }
    const rendered = renderCourse(file && source ? { bytes: new Uint8Array(file), fileName: source.fileName } : null,
      request.document as CourseSettingDocument, { course: typeof request.course === "string" ? request.course : "", widthPx: typeof request.widthPx === "number" ? request.widthPx : undefined,
        grid: request.grid !== false, area: request.area as CourseRenderRequest["area"] }, deps.createCanvas);
    await finish(db, job.id, deps.worker, { status: "DONE", result: rendered.meta, image: rendered.png }, now);
    return "DONE";
  } catch (error) {
    await failMapJob(db, job.id, deps.worker, error instanceof Error ? error.message : String(error));
    return "FAILED";
  }
}
