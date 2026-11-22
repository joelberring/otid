import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { createMapProjectFromUpload } from "../../src/map-projects";
import { lantmaterietRuntimeFromEnvironment } from "../../src/map-project-lantmateriet";
import { laserRuntimeFromEnvironment } from "../../src/map-project-laser";
import { claimGeoJob, createGeoJob, finishGeoJob, listGeoJobs, removeGeoJob } from "../../src/map-project-geo-jobs";
import { markRawLaserMailed, recordRawLaserStep, removeExpiredRawLaser } from "../../src/map-project-raw-laser";
import { memoryArchiveStore, setMapArchiveStore } from "../../src/map-archive-store";
import { setMapStoreMode } from "../../src/map-store";
import { setMapCacheDir } from "../../src/map-cache";
import { memoryRawLaserStore, setRawLaserStore } from "../../src/raw-laser-store";
import { saveMapSourceCredential } from "../../src/map-source-credentials";
import { registerTestAccount } from "./accounts";

/**
 * PLAN.md M6 (migration 0140): «Spara även rå laserdata åt mig». Jobbet bär valet bara när förrådet är på; geo-arbetaren får
 * en försignerad uppladdningslänk, filen kontrolleras i objektlagringen, länken (7 dygn) visas bara för den som lade körningen,
 * mejlet ges en gång, filen räknas inte mot kvoten och städningen tar bort den efter 7 dygn – också när jobbet tagits bort.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0229r_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const NOW = new Date("2026-11-22T12:00:00Z");
const DAY = 86_400_000;
const mapBytes = new Uint8Array(await readFile(new URL("../../../../fixtures/maps/kartfil.omap", import.meta.url)));
const environment = { OTID_EVENTOR_MASTER_KEY: randomBytes(32).toString("base64"), OTID_LM_STAC_HOJD_URL: "https://api.lantmateriet.se/stac-hojd/v1" };
const runtime = laserRuntimeFromEnvironment(lantmaterietRuntimeFromEnvironment(environment));
const LAZ = "https://dl1.lantmateriet.se/hojd/laser/skog/24A001_65775_6575_25.laz";
const tile = { id: "24A001_65775_6575_25", href: LAZ, bbox: [18, 59.29, 18.04, 59.31] as [number, number, number, number], epsg: 3006 };

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0229r_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});
afterEach(() => { setMapStoreMode(undefined); setMapArchiveStore(undefined); setMapCacheDir(undefined); setRawLaserStore(undefined); });

async function storeOn() {
  const raw = memoryRawLaserStore();
  setMapArchiveStore(memoryArchiveStore()); setMapStoreMode("on"); setMapCacheDir(await mkdtemp(join(tmpdir(), "otid-raw-cache-"))); setRawLaserStore(raw);
  return raw;
}

async function project() {
  const owner = await registerTestAccount(db, undefined, NOW);
  const created = await createMapProjectFromUpload(db, { ...owner.proof, metadata: { formatVersion: 1, requestId: randomUUID(), name: "Rå", fileName: "Rå.omap" }, file: mapBytes }, NOW);
  if (created.status !== "created") throw new Error(created.status);
  await saveMapSourceCredential(db, { ...owner.proof, request: { formatVersion: 1, method: "BASIC", id: "geotorget", secret: "hemligt" } }, environment, NOW);
  return { owner, projectId: created.projectId };
}
const request = (rawLaser: boolean) => ({ formatVersion: 1, requestId: randomUUID(), kind: "PULLAUTIN", name: "Kungshatt", tiles: [tile], settings: {},
  clip: { minX: 664730, minY: 6576450, maxX: 665130, maxY: 6576850 }, rawLaser });
const server = { state: "OFF" as const, detail: null };

describe("PLAN.md M6: rå laserdata", () => {
  it("utan förrådet finns inte valet och jobbet bär det inte", async () => {
    const { owner, projectId } = await project();
    const created = await createGeoJob(db, { ...owner.proof, projectId, request: request(true) }, runtime, NOW);
    if (created.status !== "created") throw new Error(created.status);
    const listed = await listGeoJobs(db, { ...owner.proof, projectId }, server, NOW);
    expect(listed).toMatchObject({ status: "ok", list: { rawLaserAvailable: false } });
    const claimed = await claimGeoJob(db, "geo-r1", NOW);
    expect(claimed?.jobId).toBe(created.job.jobId);
    expect(claimed?.rawLaser).toBeUndefined();
    await storeOn();
    expect((await recordRawLaserStep(db, { jobId: created.job.jobId, worker: "geo-r1", body: { step: "start", byteLength: 10, files: 1 } }, NOW)).status).toBe("not-found");
    await finishGeoJob(db, created.job.jobId, "geo-r1", { status: "FAILED", error: "slut" }, NOW);
  });

  it("laddas upp med en länk, visas för den som lade körningen, mejlas en gång och tas bort efter 7 dygn", async () => {
    const raw = await storeOn();
    const { owner, projectId } = await project();
    const created = await createGeoJob(db, { ...owner.proof, projectId, request: request(true) }, runtime, NOW);
    if (created.status !== "created") throw new Error(created.status);
    expect(created.job.rawLaserRequested).toBe(true);
    const claimed = await claimGeoJob(db, "geo-r2", NOW);
    expect(claimed).toMatchObject({ jobId: created.job.jobId, rawLaser: true });
    const jobId = created.job.jobId;
    // Fel arbetare, fel steg och för stor fil.
    expect((await recordRawLaserStep(db, { jobId, worker: "geo-x", body: { step: "start", byteLength: 10, files: 1 } }, NOW)).status).toBe("not-found");
    expect((await recordRawLaserStep(db, { jobId, worker: "geo-r2", body: { step: "start", byteLength: 5 * 1024 ** 3, files: 1 } }, NOW)).status).toBe("invalid-request");
    expect((await recordRawLaserStep(db, { jobId, worker: "geo-r2", body: { step: "done" } }, NOW)).status).toBe("not-found");

    const start = await recordRawLaserStep(db, { jobId, worker: "geo-r2", body: { step: "start", byteLength: 1234, files: 2 } }, NOW);
    if (start.status !== "upload") throw new Error(start.status);
    expect(start.key).toMatch(/^raw-laser\/[0-9a-f-]{36}\/laserdata\.zip$/);
    expect(start.url).toContain("memory://put/raw-laser/");
    const pending = await listGeoJobs(db, { ...owner.proof, projectId }, server, NOW);
    if (pending.status !== "ok") throw new Error(pending.status);
    expect(pending.list.rawLaserAvailable).toBe(true);
    expect(pending.list.jobs[0]!.rawLaser).toEqual([expect.objectContaining({ status: "PENDING", url: null })]);

    // Filen har inte kommit fram: «done» säger att den saknas, och ett nytt försök börjar om.
    expect((await recordRawLaserStep(db, { jobId, worker: "geo-r2", body: { step: "done" } }, NOW)).status).toBe("missing");
    const again = await recordRawLaserStep(db, { jobId, worker: "geo-r2", body: { step: "start", byteLength: 1234, files: 2 } }, NOW);
    if (again.status !== "upload") throw new Error(again.status);
    expect(again.key).toBe(start.key);
    raw.objects.set(start.key, 1234);
    const ready = await recordRawLaserStep(db, { jobId, worker: "geo-r2", body: { step: "done" } }, NOW);
    if (ready.status !== "ready") throw new Error(ready.status);
    expect(ready.mail).toMatchObject({ to: owner.email, runName: "Kungshatt", byteSize: 1234, expiresAt: new Date(NOW.getTime() + 7 * DAY) });
    expect(ready.mail!.url).toContain("s=604800");
    await markRawLaserMailed(db, jobId, NOW);
    await finishGeoJob(db, jobId, "geo-r2", { status: "DONE", summary: { tiles: 1 } }, NOW);

    const listed = await listGeoJobs(db, { ...owner.proof, projectId }, server, new Date(NOW.getTime() + DAY));
    if (listed.status !== "ok") throw new Error(listed.status);
    const [file] = listed.list.jobs[0]!.rawLaser!;
    expect(file).toMatchObject({ status: "READY", byteSize: 1234, expiresAt: new Date(NOW.getTime() + 7 * DAY).toISOString(), fileName: "ra-laserdata-Kungshatt-2026-11-22.zip" });
    expect(file!.url).toContain(`s=${6 * 86400}`);
    // Räknas inte mot kontots lagring (inget kartinnehåll).
    const [{ count } = { count: 0 }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.mapProjectGeoOutputs)
      .where(eq(schema.mapProjectGeoOutputs.jobId, jobId));
    expect(count).toBe(0);

    // Jobbet tas bort: filen finns kvar tills de 7 dygnen gått, sedan tar städningen den.
    expect((await removeGeoJob(db, { ...owner.proof, projectId, jobId }, NOW)).status).toBe("deleted");
    expect((await removeExpiredRawLaser(db, raw, new Date(NOW.getTime() + 6 * DAY))).removed).toBe(0);
    expect(raw.objects.has(start.key)).toBe(true);
    expect(await removeExpiredRawLaser(db, raw, new Date(NOW.getTime() + 7 * DAY + 60_000))).toEqual({ removed: 1, errors: [] });
    expect(raw.objects.has(start.key)).toBe(false);
    const [row] = await db.select().from(schema.mapProjectRawLaser).where(eq(schema.mapProjectRawLaser.objectKey, start.key));
    expect(row).toMatchObject({ status: "REMOVED", jobId: null, mailedAt: NOW });
  });

  it("en zip som aldrig blev klar tas bort efter 6 timmar, och ett fel syns i körningen", async () => {
    const raw = await storeOn();
    const { owner, projectId } = await project();
    const created = await createGeoJob(db, { ...owner.proof, projectId, request: request(true) }, runtime, NOW);
    if (created.status !== "created") throw new Error(created.status);
    await claimGeoJob(db, "geo-r3", NOW);
    const start = await recordRawLaserStep(db, { jobId: created.job.jobId, worker: "geo-r3", body: { step: "start", byteLength: 99, files: 1 } }, NOW);
    if (start.status !== "upload") throw new Error(start.status);
    raw.objects.set(start.key, 50);
    expect((await removeExpiredRawLaser(db, raw, new Date(NOW.getTime() + 5 * 3600_000))).removed).toBe(0);
    expect((await removeExpiredRawLaser(db, raw, new Date(NOW.getTime() + 7 * 3600_000))).removed).toBe(1);
    expect(raw.objects.size).toBe(0);
    await finishGeoJob(db, created.job.jobId, "geo-r3", { status: "FAILED", error: "x" }, NOW);
    const other = await createGeoJob(db, { ...owner.proof, projectId, request: request(true) }, runtime, NOW);
    if (other.status !== "created") throw new Error(other.status);
    await claimGeoJob(db, "geo-r4", NOW);
    await recordRawLaserStep(db, { jobId: other.job.jobId, worker: "geo-r4", body: { step: "start", byteLength: 99, files: 1 } }, NOW);
    expect((await recordRawLaserStep(db, { jobId: other.job.jobId, worker: "geo-r4", body: { step: "failed", error: "Rå laserdata: uppladdningen gav 403" } }, NOW)).status)
      .toBe("recorded");
    const listed = await listGeoJobs(db, { ...owner.proof, projectId }, server, NOW);
    if (listed.status !== "ok") throw new Error(listed.status);
    expect(listed.list.jobs.find(job => job.jobId === other.job.jobId)!.rawLaser).toEqual([expect.objectContaining({ status: "FAILED", error: "Rå laserdata: uppladdningen gav 403", url: null })]);
  });
});
