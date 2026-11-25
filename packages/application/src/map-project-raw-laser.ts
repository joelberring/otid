import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { geoWorkerRawLaserSchema, RAW_LASER_DAYS, type GeoRawLaserView } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { PRESIGN_MAX_SECONDS, RAW_LASER_PREFIX, rawLaserAvailable, rawLaserStore, type RawLaserStore } from "./raw-laser-store";
import { UUID_PATTERN } from "./serialization";
import type { DbExecutor } from "./snapshot";

/**
 * PLAN.md M6 (ägaren 2026-11-22): rå laserdata (LAZ) sparas aldrig efter körningen, utom när användaren kryssat i «Spara även
 * rå laserdata åt mig». Då packar geo-arbetaren laserfilerna som körningen använde (klippta till körningens ruta, annars hela
 * rutorna) i en zip och laddar upp den direkt till förrådets objektlagring under `raw-laser/<id>/` med en försignerad länk.
 * Den som lade körningen får en försignerad hämtningslänk (7 dygn) i körningen och i ett mejl. Filen räknas inte mot någon
 * kvot (den är inget kartinnehåll) och tas bort av städningen när de 7 dygnen gått (`removeExpiredRawLaser`).
 */
const raws = schema.mapProjectRawLaser;
const jobs = schema.mapProjectGeoJobs;
const DAY_MS = 86_400_000;
/** Geo-arbetarens uppladdningslänk gäller så länge (en stor zip över en långsam förbindelse). */
const UPLOAD_SECONDS = 3 * 3600;
/** En zip som inte blivit klar inom så lång tid räknas som misslyckad och tas bort. */
const PENDING_MS = 6 * 3600_000;

type Job = typeof jobs.$inferSelect;
interface RawRequest { name?: string; rawLaser?: boolean; split?: { group?: string }; merge?: { group?: string } }

/** Körningen som zip-filen hör till: omgången för en delad körning (etapperna tas bort när de lagts ihop), annars jobbet. */
export const rawLaserRunKey = (job: Pick<Job, "id" | "request">): string => {
  const request = job.request as RawRequest;
  const group = request.split?.group ?? request.merge?.group;
  return group && UUID_PATTERN.test(group) ? group : job.id;
};

/** Filnamnet som användaren får: körningens namn och dagen, bara säkra tecken. */
export function rawLaserFileName(name: string | undefined, now: Date): string {
  const base = (name ?? "laserdata").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `ra-laserdata-${base || "korning"}-${now.toISOString().slice(0, 10)}.zip`;
}

export type RawLaserStep =
  | { status: "upload"; url: string; key: string }
  | { status: "ready"; mail: RawLaserMail | undefined }
  | { status: "recorded" }
  | { status: "not-found" } | { status: "invalid-request" } | { status: "unavailable" } | { status: "missing" };

/** Mejlet till den som lade körningen (skickas efter svaret, av webben). */
export interface RawLaserMail {
  readonly to: string; readonly displayName: string; readonly runName: string; readonly url: string;
  readonly byteSize: number; readonly expiresAt: Date;
}

/**
 * Geo-arbetarens anrop `POST /api/geo-worker/jobs/:id/raw-laser`: «start» skriver raden (eller tar den från ett tidigare
 * försök) och ger en uppladdningslänk; «done» kontrollerar objektets längd i objektlagringen, gör filen klar och ger mejlet;
 * «failed» sparar felet (körningen fortsätter ändå).
 */
export async function recordRawLaserStep(db: Database, input: { jobId: string; worker: string; body: unknown }, now = new Date(),
  env: Partial<Record<string, string | undefined>> = process.env): Promise<RawLaserStep> {
  const parsed = geoWorkerRawLaserSchema.safeParse(input.body);
  if (!parsed.success || !UUID_PATTERN.test(input.jobId)) return { status: "invalid-request" };
  const [job] = await db.select().from(jobs).where(and(eq(jobs.id, input.jobId), eq(jobs.worker, input.worker), eq(jobs.status, "RUNNING")));
  if (!job || (job.request as RawRequest).rawLaser !== true) return { status: "not-found" };
  const store = rawLaserStore(env);
  const body = parsed.data;
  if (body.step === "start") {
    if (!store || !rawLaserAvailable(env)) return { status: "unavailable" };
    const fileName = rawLaserFileName((job.request as RawRequest).name, now);
    const [existing] = await db.select().from(raws).where(eq(raws.jobId, job.id));
    const id = existing?.id ?? randomUUID(), key = existing?.objectKey ?? `${RAW_LASER_PREFIX}${id}/laserdata.zip`;
    const values = { status: "PENDING" as const, byteSize: body.byteLength, files: body.files, error: null, createdAt: now,
      expiresAt: new Date(now.getTime() + RAW_LASER_DAYS * DAY_MS), readyAt: null };
    if (existing) await db.update(raws).set(values).where(eq(raws.id, id));
    else await db.insert(raws).values({ id, jobId: job.id, runKey: rawLaserRunKey(job), projectId: job.projectId, accountId: job.accountId, objectKey: key, fileName, ...values });
    return { status: "upload", url: store.uploadUrl(key, UPLOAD_SECONDS, now), key };
  }
  const [row] = await db.select().from(raws).where(and(eq(raws.jobId, job.id), eq(raws.status, "PENDING")));
  if (!row) return { status: "not-found" };
  if (body.step === "failed") {
    await db.update(raws).set({ status: "FAILED", error: body.error.slice(0, 500) }).where(eq(raws.id, row.id));
    return { status: "recorded" };
  }
  if (!store) return { status: "unavailable" };
  const size = await store.size(row.objectKey);
  if (size === undefined || size !== row.byteSize) {
    await db.update(raws).set({ status: "FAILED", error: "Zip-filen kom inte fram till förrådet" }).where(eq(raws.id, row.id));
    // Ett objekt med fel längd tas bort direkt (städningen tar det annars när de 7 dygnen gått).
    if (size !== undefined) await store.remove(row.objectKey);
    return { status: "missing" };
  }
  // Sju dygn från det att filen blev klar; länken signeras för samma tid.
  const expiresAt = new Date(now.getTime() + RAW_LASER_DAYS * DAY_MS);
  await db.update(raws).set({ status: "READY", readyAt: now, expiresAt }).where(eq(raws.id, row.id));
  const [account] = row.accountId ? await db.select({ email: schema.userAccounts.email, name: schema.userAccounts.displayName,
    verified: schema.userAccounts.emailVerifiedAt, blocked: schema.userAccounts.blockedAt }).from(schema.userAccounts)
    .where(eq(schema.userAccounts.id, row.accountId)) : [];
  if (!account?.verified || account.blocked || row.mailedAt) return { status: "ready", mail: undefined };
  return { status: "ready", mail: { to: account.email, displayName: account.name, runName: (job.request as RawRequest).name ?? "Laserkörning",
    url: downloadUrl(store, row, expiresAt, now)!, byteSize: row.byteSize ?? size, expiresAt } };
}

/** Mejlet har gått iväg (för att inte skicka det igen om geo-arbetaren frågar två gånger). */
export async function markRawLaserMailed(db: DbExecutor, jobId: string, now = new Date()): Promise<void> {
  await db.update(raws).set({ mailedAt: now }).where(eq(raws.jobId, jobId));
}

function downloadUrl(store: RawLaserStore, row: Pick<typeof raws.$inferSelect, "objectKey" | "fileName">, expiresAt: Date, now: Date): string | null {
  const seconds = Math.min(PRESIGN_MAX_SECONDS, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
  return seconds >= 60 ? store.downloadUrl(row.objectKey, row.fileName, seconds, now) : null;
}

/**
 * Zip-filerna för jobben i listan, efter körning (en delad körnings etapper och sammanläggning delar omgång). Länken ges bara
 * till den som lade körningen; andra i projektet ser att filen finns.
 */
export async function rawLaserViews(tx: DbExecutor, list: readonly Pick<Job, "id" | "request">[], viewer: string, now = new Date(),
  env: Partial<Record<string, string | undefined>> = process.env): Promise<Map<string, GeoRawLaserView[]>> {
  const keys = [...new Set(list.map(rawLaserRunKey))];
  const out = new Map<string, GeoRawLaserView[]>();
  if (keys.length === 0) return out;
  const found = await tx.select().from(raws).where(and(inArray(raws.runKey, keys), inArray(raws.status, ["PENDING", "READY", "FAILED"]),
    sql`${raws.expiresAt} > ${now}`)).orderBy(raws.createdAt);
  if (found.length === 0) return out;
  const store = rawLaserStore(env);
  for (const job of list) {
    const key = rawLaserRunKey(job);
    const rows = found.filter(row => row.runKey === key);
    if (rows.length) out.set(job.id, rows.map(row => ({ status: row.status as GeoRawLaserView["status"], fileName: row.fileName,
      byteSize: row.byteSize, expiresAt: row.expiresAt.toISOString(), error: row.error,
      url: row.status === "READY" && store && row.accountId === viewer ? downloadUrl(store, row, row.expiresAt, now) : null })));
  }
  return out;
}

export interface RawLaserCleanup { readonly removed: number; readonly errors: readonly string[] }

/**
 * Städningen (förrådets löpare, en gång i timmen): zip-filer vars 7 dygn gått och sådana som aldrig blev klara (6 h) tas
 * bort ur objektlagringen; raden står kvar som REMOVED. Ett fel prövas igen nästa varv.
 */
export async function removeExpiredRawLaser(db: Database, store: RawLaserStore, now = new Date()): Promise<RawLaserCleanup> {
  const cutoff = new Date(now.getTime() - PENDING_MS);
  const isDue = and(isNull(raws.removedAt), or(
    lt(raws.expiresAt, now),
    and(inArray(raws.status, ["PENDING", "FAILED"]), lt(raws.createdAt, cutoff))));
  const due = await db.select({ id: raws.id, key: raws.objectKey }).from(raws).where(isDue).limit(500);
  let removed = 0;
  const errors: string[] = [];
  for (const row of due) {
    try {
      await store.remove(row.key);
      const updated = await db.update(raws).set({ status: "REMOVED", removedAt: now }).where(and(eq(raws.id, row.id), isDue)).returning({ id: raws.id });
      if (updated.length > 0) removed += 1;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { removed, errors };
}
