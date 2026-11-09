import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import {
  geoJobCreateRequestSchema, geoWorkerFinishSchema, geoWorkerProgressSchema, GEO_OUTPUT_MAX_BYTES, GEO_OUTPUT_NAME, MAP_PROJECT_LAYER_MAX_BYTES,
  type GeoJobList, type GeoJobView, type GeoServerView
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import type { ClubFailure, ClubProof } from "./club-access";
import { imageDimensions } from "./image-dimensions";
import { contentHead, contentLength, mapStorageQuota, readMapContent, storeMapContent, type MapContentInput } from "./map-content";
import { mapProjectAllows, requireMapProject } from "./map-project-access";
import { allowedLaserUrl, fetchLaserFile, type LaserRuntime } from "./map-project-laser";
import type { LantmaterietFailure } from "./map-project-lantmateriet";
import { openMapSourceCredential } from "./map-source-credentials";
import { geoServerForToken, geoServerSettings, geoServerStateView, noteGeoServerJob } from "./geo-server";
import { UUID_PATTERN } from "./serialization";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0219 K5 (ägaren 2026-11-08): geo-arbetarens jobbkö. Webben lägger jobbet (Karttapullautin på laserrutor) och visar
 * läget; geo-arbetaren på en egen server hämtar jobbet, laserfilerna (genom servern, med kontots egna uppgifter till
 * Lantmäteriet) och skickar tillbaka resultatfilerna över HTTPS med sin nyckel. Bilden blir ett underlag i projektet; kurvor,
 * branter och formlinjer ligger kvar som filer som kan läsas in som kandidater (K4b). Resultaten räknas mot kontots kvot.
 */
const jobs = schema.mapProjectGeoJobs;
const outputs = schema.mapProjectGeoOutputs;
const ACTIVE = ["QUEUED", "RUNNING"] as const;
/** Ett jobb som inte hört av sig på så här länge räknas som avbrutet (arbetaren skickar livstecken varje minut). */
const STALE_MS = 10 * 60_000;
const MAX_ATTEMPTS = 2;
const ACTIVE_PER_ACCOUNT = 2;
const DEFAULT_TILES_PER_MONTH = 200;
const MEDIA_TYPES: ReadonlySet<string> = new Set(["image/png", "text/plain", "application/dxf"]);
/** Bilden och dess världsfil från arbetaren; blir ett underlag när jobbet är klart. */
export const GEO_MAP_IMAGE = "karta.png";
export const GEO_MAP_WORLD = "karta.pgw";
/** K5c del 2: fuktighetens bild och världsfil (blir ett eget underlag). */
export const GEO_MOISTURE_IMAGE = "fukt.png";
export const GEO_MOISTURE_WORLD = "fukt.pgw";

export type GeoJobFailure = ClubFailure | { status: "no-credential" } | { status: "busy" } | { status: "quota" };

export function geoTilesPerMonth(environment: Record<string, string | undefined> = process.env): number {
  // En tom variabel (som compose skickar när den inte är satt) ger förvalet, inte noll.
  const raw = environment.OTID_GEO_TILES_PER_MONTH?.trim();
  const value = Number(raw);
  return raw && Number.isInteger(value) && value >= 0 ? value : DEFAULT_TILES_PER_MONTH;
}

async function rows(tx: DbExecutor, projectId: string, jobId?: string) {
  const list = await tx.select({ job: jobs, creator: schema.userAccounts.displayName }).from(jobs)
    .leftJoin(schema.userAccounts, eq(schema.userAccounts.id, jobs.accountId))
    .where(and(eq(jobs.projectId, projectId), jobId ? eq(jobs.id, jobId) : undefined)).orderBy(desc(jobs.createdAt)).limit(50);
  const files = list.length ? await tx.select({ jobId: outputs.jobId, name: outputs.name, mediaType: outputs.mediaType, byteSize: outputs.byteSize })
    .from(outputs).where(inArray(outputs.jobId, list.map(row => row.job.id))).orderBy(asc(outputs.name)) : [];
  return list.map(row => ({ ...row, files: files.filter(file => file.jobId === row.job.id) }));
}
function toView(row: Awaited<ReturnType<typeof rows>>[number], viewer: string): GeoJobView {
  const job = row.job, request = job.request as { name?: string; tiles?: unknown[]; settings?: Record<string, number>;
    moisture?: GeoJobView["moisture"]; vegetation?: GeoJobView["vegetation"] };
  const progress = job.progress as GeoJobView["progress"] | null;
  return { jobId: job.id, name: request.name ?? "Karttapullautin", kind: job.kind, status: job.status, tiles: request.tiles?.length ?? 0,
    settings: request.settings ?? {}, progress: job.status === "RUNNING" ? progress : null, error: job.error,
    layerId: typeof job.result?.layerId === "string" ? job.result.layerId : null,
    moistureLayerId: typeof job.result?.moistureLayerId === "string" ? job.result.moistureLayerId : null, moisture: request.moisture ?? null,
    vegetation: request.vegetation ?? null, outputs: row.files.map(file => ({ name: file.name, mediaType: file.mediaType, byteSize: file.byteSize })),
    createdBy: { accountId: job.accountId, name: row.creator }, own: job.accountId === viewer, createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null };
}

export async function listGeoJobs(db: Database, input: ClubProof & { projectId: string }, server: GeoServerView, now = new Date())
  : Promise<ClubFailure | { status: "ok"; list: GeoJobList }> {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "view", false);
    if (access.status !== "ok") return access;
    return { status: "ok", list: { formatVersion: 1, jobs: (await rows(tx, access.project.id)).map(row => toView(row, access.accountId)), server } } as const;
  });
}

/** Nytt jobb (Föreslå eller mer, projektet öppet, uppgifter till Lantmäteriet sparade). Idempotent på `requestId`. */
export async function createGeoJob(db: Database, input: ClubProof & { projectId: string; request: unknown }, runtime: LaserRuntime, now = new Date())
  : Promise<GeoJobFailure | { status: "created"; replayed: boolean; job: GeoJobView }> {
  const parsed = geoJobCreateRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "propose", true);
    if (access.status !== "ok") return access;
    if (!parsed.success || parsed.data.tiles.some(tile => !allowedLaserUrl(tile.href, runtime))) return { status: "invalid-request" } as const;
    const request = parsed.data;
    const [prior] = await tx.select().from(jobs).where(eq(jobs.requestId, request.requestId));
    if (prior) {
      if (prior.projectId !== access.project.id || prior.accountId !== access.accountId) return { status: "conflict" } as const;
      return { status: "created", replayed: true, job: toView((await rows(tx, access.project.id, prior.id))[0]!, access.accountId) } as const;
    }
    const [credential] = await tx.select({ accountId: schema.mapSourceCredentials.accountId }).from(schema.mapSourceCredentials)
      .where(and(eq(schema.mapSourceCredentials.accountId, access.accountId), eq(schema.mapSourceCredentials.provider, "LANTMATERIET")));
    if (!credential) return { status: "no-credential" } as const;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"geo-job:" + access.accountId}, 0))`);
    const [{ active } = { active: 0 }] = await tx.select({ active: sql<number>`count(*)::int` }).from(jobs)
      .where(and(eq(jobs.accountId, access.accountId), inArray(jobs.status, [...ACTIVE])));
    if (active >= ACTIVE_PER_ACCOUNT) return { status: "busy" } as const;
    // Kvoten räknar rutor i jobb som väntar eller har körts (även avbrutna och misslyckade efter start: servern har haft dem).
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [{ tiles } = { tiles: 0 }] = await tx.select({ tiles: sql<number>`coalesce(sum(jsonb_array_length(${jobs.request}->'tiles')), 0)::int` }).from(jobs)
      .where(and(eq(jobs.accountId, access.accountId), gte(jobs.createdAt, month), sql`(${jobs.status} = 'QUEUED' or ${jobs.startedAt} is not null)`));
    if (tiles + request.tiles.length > geoTilesPerMonth(runtime.environment)) return { status: "quota" } as const;
    const id = randomUUID();
    await tx.insert(jobs).values({ id, projectId: access.project.id, accountId: access.accountId, kind: "PULLAUTIN", status: "QUEUED",
      request: { name: request.name, tiles: request.tiles, settings: request.settings, ...(request.moisture ? { moisture: request.moisture } : {}),
        ...(request.vegetation ? { vegetation: request.vegetation } : {}) },
      createdAt: now, requestId: request.requestId });
    return { status: "created", replayed: false, job: toView((await rows(tx, access.project.id, id))[0]!, access.accountId) } as const;
  });
}

/** Avbryter ett väntande eller pågående jobb, eller tar bort ett färdigt med dess filer (den som lade det och ägarna). */
export async function removeGeoJob(db: Database, input: ClubProof & { projectId: string; jobId: string }, now = new Date())
  : Promise<ClubFailure | { status: "cancelled" } | { status: "deleted" }> {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "view", true);
    if (access.status !== "ok") return access;
    if (!UUID_PATTERN.test(input.jobId)) return { status: "not-found" } as const;
    const [job] = await tx.select().from(jobs).where(and(eq(jobs.id, input.jobId), eq(jobs.projectId, access.project.id))).for("update");
    if (!job) return { status: "not-found" } as const;
    if (job.accountId !== access.accountId && !mapProjectAllows(access.role, access.project, "manage")) return { status: "forbidden" } as const;
    if (job.status === "QUEUED" || job.status === "RUNNING") {
      await tx.update(jobs).set({ status: "CANCELLED", finishedAt: now, error: "Avbrutet" }).where(eq(jobs.id, job.id));
      return { status: "cancelled" } as const;
    }
    await tx.delete(jobs).where(eq(jobs.id, job.id));
    return { status: "deleted" } as const;
  });
}

/** En resultatfil för den som ser projektet (kurvorna läses in som kandidater i webbläsaren). */
export async function readGeoOutput(db: Database, input: ClubProof & { projectId: string; jobId: string; name: string }, now = new Date())
  : Promise<ClubFailure | { status: "ok"; bytes: Buffer; mediaType: string }> {
  return db.transaction(async tx => {
    const access = await requireMapProject(tx, input, now, "view", false);
    if (access.status !== "ok") return access;
    if (!UUID_PATTERN.test(input.jobId) || !GEO_OUTPUT_NAME.test(input.name)) return { status: "not-found" } as const;
    const [file] = await tx.select({ sha: outputs.contentSha256, mediaType: outputs.mediaType }).from(outputs).innerJoin(jobs, eq(jobs.id, outputs.jobId))
      .where(and(eq(outputs.jobId, input.jobId), eq(outputs.name, input.name), eq(jobs.projectId, access.project.id)));
    const bytes = file ? await readMapContent(tx, file.sha) : undefined;
    return bytes ? { status: "ok", bytes, mediaType: file!.mediaType } as const : { status: "not-found" } as const;
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Geo-arbetarens sida (nyckeln prövas av anropet; jobbet måste vara arbetarens och pågå).

const digest = (value: string) => createHash("sha256").update(value).digest();
/**
 * Geo-arbetarens nyckel: driftens `OTID_GEO_WORKER_TOKEN` (minst 32 tecken; arbetarens namn ur anropet) eller nyckeln till en
 * geo-server som O-Tid startat (K5b; serverns namn). Ger arbetarens namn eller inget.
 */
export async function authenticateGeoWorker(db: Database, authorization: string | null, name: string | null,
  environment: Record<string, string | undefined> = process.env, now = new Date()): Promise<string | undefined> {
  const given = authorization?.match(/^Bearer (\S{32,512})$/)?.[1];
  if (!given) return undefined;
  const expected = environment.OTID_GEO_WORKER_TOKEN?.trim();
  if (expected && expected.length >= 32 && timingSafeEqual(digest(expected), digest(given))) return name && /^[A-Za-z0-9_.:-]{1,80}$/.test(name) ? name : undefined;
  return geoServerForToken(db, given, now);
}

export interface ClaimedGeoJob {
  readonly jobId: string; readonly kind: "PULLAUTIN" | "DWG"; readonly attempt: number;
  readonly tiles: readonly { readonly index: number; readonly id: string; readonly epsg: number | null }[];
  readonly settings: Readonly<Record<string, number>>;
  readonly moisture: { readonly channelHa: number; readonly wetMeters: number; readonly moistMeters: number } | null;
  readonly vegetation: { readonly minAreaM2: number } | null;
}

export async function claimGeoJob(db: Database, worker: string, now = new Date()): Promise<ClaimedGeoJob | undefined> {
  const stale = new Date(now.getTime() - STALE_MS);
  await db.update(jobs).set({ status: "FAILED", finishedAt: now, error: "Geo-arbetaren slutade svara" })
    .where(and(eq(jobs.status, "RUNNING"), lt(jobs.heartbeatAt, stale), sql`${jobs.attempts} >= ${MAX_ATTEMPTS}`));
  await db.update(jobs).set({ status: "QUEUED", worker: null }).where(and(eq(jobs.status, "RUNNING"), lt(jobs.heartbeatAt, stale)));
  const result = await db.execute<{ id: string; kind: "PULLAUTIN" | "DWG"; request: { tiles?: { id: string; epsg: number | null }[]; settings?: Record<string, number>;
    moisture?: ClaimedGeoJob["moisture"]; vegetation?: ClaimedGeoJob["vegetation"] }; attempts: number }>(sql`
    update map_project_geo_job set status = 'RUNNING', started_at = ${now}, heartbeat_at = ${now}, attempts = attempts + 1, worker = ${worker},
      progress = null
    where id = (select id from map_project_geo_job where status = 'QUEUED' order by created_at, id for update skip locked limit 1)
    returning id, kind, request, attempts`);
  const row = result.rows[0];
  if (!row) return undefined;
  await noteGeoServerJob(db, worker, now);
  // Filer från ett tidigare försök tas bort, så att resultatet bara kommer från ett försök (indata står kvar).
  await db.delete(outputs).where(and(eq(outputs.jobId, row.id), sql`${outputs.name} not like 'indata.%'`));
  return { jobId: row.id, kind: row.kind, attempt: row.attempts, settings: row.request.settings ?? {}, moisture: row.request.moisture ?? null,
    vegetation: row.request.vegetation ?? null, tiles: (row.request.tiles ?? []).map((tile, index) => ({ index, id: tile.id, epsg: tile.epsg ?? null })) };
}

async function runningJob(db: DbExecutor, jobId: string, worker: string) {
  if (!UUID_PATTERN.test(jobId)) return undefined;
  const [job] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.worker, worker)));
  return job;
}

/** Livstecken med förloppet; svaret säger om jobbet fortfarande ska köras (det kan ha avbrutits). */
export async function heartbeatGeoJob(db: Database, jobId: string, worker: string, progress: unknown, now = new Date())
  : Promise<"running" | "stop"> {
  const parsed = geoWorkerProgressSchema.safeParse(progress);
  const updated = await db.update(jobs).set({ heartbeatAt: now, ...(parsed.success ? { progress: parsed.data } : {}) })
    .where(and(eq(jobs.id, jobId), eq(jobs.worker, worker), eq(jobs.status, "RUNNING"))).returning({ id: jobs.id });
  return updated.length ? "running" : "stop";
}

/** Laserfilen för jobbets ruta, hämtad med jobbkontots uppgifter (de lämnar aldrig servern). */
export async function openGeoJobLaser(db: Database, jobId: string, worker: string, index: number, runtime: LaserRuntime)
  : Promise<LantmaterietFailure | { status: "ok"; response: Response }> {
  const job = await runningJob(db, jobId, worker);
  if (!job || job.status !== "RUNNING") return { status: "not-found" };
  const tile = (job.request as { tiles?: { href: string }[] }).tiles?.[index];
  if (!tile) return { status: "not-found" };
  const secret = await openMapSourceCredential(db, job.accountId, runtime.environment);
  if (!secret) return { status: "no-credential" };
  return fetchLaserFile(secret, tile.href, runtime);
}

export async function storeGeoOutput(db: Database, input: { jobId: string; worker: string; name: string; mediaType: string; file: MapContentInput },
  now = new Date()): Promise<{ status: "stored" } | { status: "not-found" } | { status: "invalid-request" } | { status: "quota" } | { status: "too-large" }> {
  if (!GEO_OUTPUT_NAME.test(input.name) || !MEDIA_TYPES.has(input.mediaType)) return { status: "invalid-request" };
  if (contentLength(input.file) > GEO_OUTPUT_MAX_BYTES) return { status: "too-large" };
  return db.transaction(async tx => {
    const job = await runningJob(tx, input.jobId, input.worker);
    if (!job || job.status !== "RUNNING") return { status: "not-found" } as const;
    const stored = await storeMapContent(tx, input.file, job.accountId, now, mapStorageQuota());
    if (stored.status === "quota") return { status: "quota" } as const;
    await tx.insert(outputs).values({ jobId: job.id, name: input.name, contentSha256: stored.sha256, mediaType: input.mediaType,
      byteSize: contentLength(input.file), createdAt: now })
      .onConflictDoUpdate({ target: [outputs.jobId, outputs.name], set: { contentSha256: stored.sha256, mediaType: input.mediaType,
        byteSize: contentLength(input.file), createdAt: now } });
    return { status: "stored" } as const;
  });
}

/** Världsfilens sex tal (A, D, B, E, C, F). */
export function parseWorld(text: string): { a: number; b: number; c: number; d: number; e: number; f: number } | undefined {
  const numbers = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(Number);
  if (numbers.length < 6 || numbers.slice(0, 6).some(value => !Number.isFinite(value))) return undefined;
  const [a, d, b, e, c, f] = numbers as [number, number, number, number, number, number];
  return Math.abs(a * e - b * d) > 1e-18 ? { a, b, c, d, e, f } : undefined;
}

/** Ett underlag av en bild och dess världsfil bland jobbets filer (i rutornas koordinatsystem), eller inget. */
async function layerFrom(tx: DbExecutor, job: typeof jobs.$inferSelect, files: (typeof outputs.$inferSelect)[], imageName: string, worldName: string,
  name: string, opacity: number, requestId: string, now: Date): Promise<string | null> {
  const image = files.find(file => file.name === imageName), world = files.find(file => file.name === worldName);
  if (!image || !world || image.byteSize > MAP_PROJECT_LAYER_MAX_BYTES) return null;
  const [head, worldBytes] = await Promise.all([readMapContent(tx, image.contentSha256), readMapContent(tx, world.contentSha256)]);
  const dimensions = head ? imageDimensions(contentHead(new Uint8Array(head))) : undefined;
  const transform = worldBytes ? parseWorld(worldBytes.toString("utf8")) : undefined;
  if (!dimensions || !transform || dimensions.width > 30_000 || dimensions.height > 30_000) return null;
  const request = job.request as { tiles?: { epsg?: number | null }[] };
  const [{ value: sort } = { value: 0 }] = await tx.select({ value: sql<number>`count(*)::int` }).from(schema.mapProjectLayers)
    .where(eq(schema.mapProjectLayers.projectId, job.projectId));
  const id = randomUUID();
  await tx.insert(schema.mapProjectLayers).values({ id, projectId: job.projectId, name, contentSha256: image.contentSha256, mediaType: dimensions.mediaType,
    width: dimensions.width, height: dimensions.height, crs: request.tiles?.[0]?.epsg ?? 3006, transform, opacity, sort, createdBy: job.accountId,
    createdAt: now, requestId }).onConflictDoNothing();
  return id;
}

/**
 * Jobbet är klart eller misslyckades. När det är klart blir bilden (med världsfilen) ett underlag i projektet, i rutornas
 * koordinatsystem (Lantmäteriets laser är SWEREF 99 TM om inget annat anges).
 */
export async function finishGeoJob(db: Database, jobId: string, worker: string, body: unknown, now = new Date())
  : Promise<{ status: "ok"; layerId: string | null } | { status: "not-found" } | { status: "invalid-request" }> {
  const parsed = geoWorkerFinishSchema.safeParse(body);
  if (!parsed.success) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const job = await runningJob(tx, jobId, worker);
    if (!job || job.status !== "RUNNING") return { status: "not-found" } as const;
    if (parsed.data.status === "FAILED") {
      await tx.update(jobs).set({ status: "FAILED", finishedAt: now, error: parsed.data.error, progress: null }).where(eq(jobs.id, job.id));
      await noteGeoServerJob(tx, worker, now);
      return { status: "ok", layerId: null } as const;
    }
    const files = await tx.select().from(outputs).where(eq(outputs.jobId, job.id));
    const request = job.request as { name?: string; tiles?: { epsg?: number | null }[] };
    const name = (request.name ?? "Karttapullautin").slice(0, 80);
    const layerId = await layerFrom(tx, job, files, GEO_MAP_IMAGE, GEO_MAP_WORLD, name, 0.6, job.id, now);
    const moistureLayerId = await layerFrom(tx, job, files, GEO_MOISTURE_IMAGE, GEO_MOISTURE_WORLD, `${name.slice(0, 66)} – fuktighet`, 0.7, randomUUID(), now);
    await noteGeoServerJob(tx, worker, now);
    await tx.update(jobs).set({ status: "DONE", finishedAt: now, progress: null, error: null,
      result: { layerId, moistureLayerId, ...(parsed.data.summary ? { summary: parsed.data.summary } : {}) } }).where(eq(jobs.id, job.id));
    return { status: "ok", layerId } as const;
  });
}

/**
 * Geo-serverns läge som användaren ser det. Utan nyckel och utan Hetzner är geo-arbetaren inte inställd; ett jobb som
 * nyss hörts av betyder att servern är igång. Med den automatiska starten (K5b) gäller läget som den senast skrev.
 */
export async function geoServerView(db: DbExecutor, environment: Record<string, string | undefined> = process.env, now = new Date()): Promise<GeoServerView> {
  if (geoServerSettings(environment)) return geoServerStateView(db);
  if (!environment.OTID_GEO_WORKER_TOKEN?.trim()) return { state: "NOT_CONFIGURED", detail: null };
  const [row] = await db.select({ value: sql<number>`count(*)::int` }).from(jobs)
    .where(and(eq(jobs.status, "RUNNING"), gte(jobs.heartbeatAt, new Date(now.getTime() - 3 * 60_000))));
  return { state: (row?.value ?? 0) > 0 ? "READY" : "OFF", detail: null };
}
