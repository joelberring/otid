import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDatabase, migrate } from "@o-tid/database";
import { mapStorageUsage } from "../../src/map-content";
import { memoryArchiveStore, setMapArchiveStore } from "../../src/map-archive-store";
import { setMapStoreMode } from "../../src/map-store";
import { setMapCacheDir } from "../../src/map-cache";
import { createMapProjectFromUpload } from "../../src/map-projects";
import { lantmaterietRuntimeFromEnvironment } from "../../src/map-project-lantmateriet";
import { laserRuntimeFromEnvironment } from "../../src/map-project-laser";
import { claimGeoJob, createGeoJob, finishGeoJob, storeGeoOutput } from "../../src/map-project-geo-jobs";
import { createMapProjectLayer, listMapProjectLayers, readMapProjectLayerImage } from "../../src/map-project-layers";
import { saveMapSourceCredential } from "../../src/map-source-credentials";
import { projectRegenerableMissing, regenerateGeoJob } from "../../src/map-project-regenerate";
import { enforceRegenerableQuota, pickRegenerableEvictions, runRegenerableRound, type RegenerableRow } from "../../src/map-regenerable";
import { readOwnAccountStorage } from "../../src/account-storage";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerTestAccount } from "./accounts";

/**
 * PLAN.md steg M4 (ADR-0229 tillägg M4): recept för återskapbart underlag, kontots gräns för återskapbart (äldst använt bort
 * direkt, skydd för projekt öppnade de senaste 3 dygnen och projektets senaste klara laserkörning), «Återskapa» som inte räknas
 * mot laserkvoten och tar över underlagen, hämtade bilder som ersätts i samma underlag, regeln om orört och tävlingsdygnet.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0229m4_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const NOW = new Date("2026-11-22T12:00:00Z");
const DAY = 24 * 60 * 60_000;
const MB = 1024 * 1024;
const mapBytes = new Uint8Array(await readFile(new URL("../../../../fixtures/maps/kartfil.omap", import.meta.url)));
const environment = { OTID_EVENTOR_MASTER_KEY: randomBytes(32).toString("base64"), OTID_LM_STAC_HOJD_URL: "https://api.lantmateriet.se/stac-hojd/v1",
  OTID_GEO_TILES_PER_MONTH: "5" };
const LAZ = "https://dl1.lantmateriet.se/hojd/laser/skog/24A001_65775_6575_25.laz";
const tile = { id: "24A001_65775_6575_25", href: LAZ, bbox: [18, 59.29, 18.04, 59.31] as [number, number, number, number], epsg: 3006, datetime: "2024-05-01T00:00:00Z" };
const runtime = laserRuntimeFromEnvironment(lantmaterietRuntimeFromEnvironment(environment));
let cacheDir = "";
let store = memoryArchiveStore();

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
  cacheDir = await mkdtemp(join(tmpdir(), "otid-aterskapbart-"));
}, 60_000);
afterEach(() => { setMapStoreMode(undefined); setMapArchiveStore(undefined); setMapCacheDir(undefined); });
afterAll(async () => {
  await pool.end();
  await rm(cacheDir, { recursive: true, force: true });
  if (!/^otid_adr0229m4_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

function storeOn() {
  store = memoryArchiveStore();
  setMapArchiveStore(store);
  setMapStoreMode("on");
  setMapCacheDir(cacheDir);
  return store;
}
function png(width: number, height: number, seed: number, size = 64): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width); view.setUint32(20, height);
  for (let at = 32; at < size; at++) bytes[at] = (at * 7 + seed) % 251;
  return bytes;
}
const world = new TextEncoder().encode("1\n0\n0\n-1\n664730\n6576850\n");
const content = async (sha: string) => (await db.execute<{ stored_in: string; regenerable: boolean; recipe: Record<string, unknown> | null }>(sql`
  select stored_in, regenerable, recipe from map_content where sha256 = ${sha}`)).rows[0];
const outputsOf = async (jobId: string) => (await db.execute<{ name: string; sha: string }>(sql`select name, content_sha256 as sha
  from map_project_geo_output where job_id = ${jobId} order by name`)).rows;

async function setup(name: string) {
  const owner = await registerTestAccount(db, undefined, NOW);
  await saveMapSourceCredential(db, { ...owner.proof, request: { formatVersion: 1, method: "BASIC", id: "geotorget", secret: "hemligt" } }, environment, NOW);
  return { owner, project: await newProject(owner, name) };
}
async function newProject(owner: Awaited<ReturnType<typeof registerTestAccount>>, name: string) {
  const created = await createMapProjectFromUpload(db, { ...owner.proof, metadata: { formatVersion: 1, requestId: randomUUID(), name, fileName: `${name}.omap` },
    file: mapBytes }, NOW);
  if (created.status !== "created") throw new Error(created.status);
  return created.projectId;
}
/** En hel laserkörning: läggs, hämtas av arbetaren, bilden (`size` byte) och världsfilen skickas, klar. */
async function laserRun(owner: Awaited<ReturnType<typeof registerTestAccount>>, projectId: string, seed: number, size: number, age: Date | undefined,
  regenerates?: string) {
  const at = NOW;
  let jobId = regenerates;
  if (!jobId) {
    const created = await createGeoJob(db, { ...owner.proof, projectId, request: { formatVersion: 1, requestId: randomUUID(), kind: "PULLAUTIN",
      name: `Laser ${seed}`, tiles: [tile], settings: { contour_interval: 2.5 } } }, runtime, at);
    if (created.status !== "created") throw new Error(created.status);
    jobId = created.job.jobId;
  }
  const claimed = await claimGeoJob(db, "geo-1", at);
  if (!claimed) throw new Error("inget jobb");
  for (const [name, mediaType, file] of [["karta.png", "image/png", png(10, 10, seed, size)], ["karta.pgw", "text/plain", world]] as const) {
    expect(await storeGeoOutput(db, { jobId: claimed.jobId, worker: "geo-1", name, mediaType, file }, at)).toEqual({ status: "stored" });
  }
  const finished = await finishGeoJob(db, claimed.jobId, "geo-1", { status: "DONE", summary: { tiles: 1 } }, at);
  if (finished.status !== "ok") throw new Error(finished.status);
  // Körningen och dess innehåll som om de gjorts vid `age` (sessionen finns bara från NOW).
  if (age) {
    await db.execute(sql`update map_project_geo_job set finished_at = ${age}, started_at = ${age} where id = ${claimed.jobId}`);
    await db.execute(sql`update map_content set created_at = ${age}, last_used_at = ${age} where sha256 in (select content_sha256 from map_project_geo_output
      where job_id = ${claimed.jobId}) and created_at >= ${age}`);
  }
  return { jobId: claimed.jobId, layerId: finished.layerId };
}
const opened = (projectId: string, at: Date) => db.execute(sql`update map_project set last_opened_at = ${at} where id = ${projectId}`);

describe("ADR-0229 M4: återskapbart underlag", () => {
  it("äldst använt bort först tills kontot är under gränsen; det skyddade ger beskedet i stället", () => {
    const row = (sha256: string, byteLength: number, options: Partial<RegenerableRow> = {}): RegenerableRow => ({ sha256, byteLength, storedIn: "STORE",
      usedAt: NOW, projectName: "P", label: sha256, source: "LASER", recent: false, protected: false, ...options });
    const rows = [row("a", 4), row("b", 4, { protected: true }), row("c", 4), row("d", 4, { storedIn: "DB" }), row("e", 4)];
    expect(pickRegenerableEvictions(rows, 12).map(picked => picked.sha256)).toEqual(["a", "c"]);
    expect(pickRegenerableEvictions(rows, 20)).toEqual([]);
    expect(pickRegenerableEvictions(rows, 0).map(picked => picked.sha256)).toEqual(["a", "c", "e"]);
  });

  it("laserns resultat får recept och räknas mot gränsen för återskapbart; det äldsta tas bort direkt, det skyddade står kvar", async () => {
    storeOn();
    const { owner, project } = await setup("Norr");
    const old = new Date(NOW.getTime() - 20 * DAY);
    // Tre körningar: den äldsta och den mellersta får tas bort, den senaste klara är skyddad.
    const first = await laserRun(owner, project, 1, 600_000, old);
    const files = await outputsOf(first.jobId);
    const image = files.find(file => file.name === "karta.png")!;
    expect(await content(image.sha)).toMatchObject({ stored_in: "STORE", regenerable: true,
      recipe: { source: "LASER", jobId: first.jobId, output: "karta.png", tiles: 1, scannedAt: "2024-05-01" } });
    // Återskapbart räknas inte mot kartlagringens gräns (bara grundfilen).
    expect((await mapStorageUsage(db, owner.accountId)).accountBytes).toBe(mapBytes.byteLength);
    const second = await laserRun(owner, project, 2, 600_000, new Date(old.getTime() + DAY));
    const third = await laserRun(owner, project, 3, 600_000, new Date(NOW.getTime() - 15 * DAY));
    await opened(project, old);
    await db.execute(sql`update user_account set regenerable_quota_mb = 1 where id = ${owner.accountId}`);

    const enforced = await enforceRegenerableQuota(db, owner.accountId, NOW, store);
    expect(enforced).toMatchObject({ evicted: 2, overLimitProjects: [] });
    const firstImage = (await outputsOf(first.jobId)).find(file => file.name === "karta.png")!.sha;
    expect(await content(firstImage)).toMatchObject({ stored_in: "GONE", regenerable: true });
    expect(store.objects.has(firstImage)).toBe(false);
    expect((await content((await outputsOf(second.jobId)).find(file => file.name === "karta.png")!.sha))?.stored_in).toBe("GONE");
    expect((await content((await outputsOf(third.jobId)).find(file => file.name === "karta.png")!.sha))?.stored_in).toBe("STORE");
    // Bilden finns inte; listan säger att den saknas och har receptet.
    const layers = await listMapProjectLayers(db, { ...owner.proof, projectId: project }, NOW);
    if (layers.status !== "ok") throw new Error(layers.status);
    expect(layers.list.layers.find(layer => layer.layerId === first.layerId)).toMatchObject({ missing: true, recipe: { source: "LASER" } });
    expect((await readMapProjectLayerImage(db, { ...owner.proof, projectId: project, layerId: first.layerId! }, NOW)).status).toBe("not-found");

    // Kontosidan: gränsen, det skyddade och vad som tas bort härnäst (inget: den senaste körningen är skyddad).
    const storage = await readOwnAccountStorage(db, owner.proof, NOW);
    if (storage.status !== "ok") throw new Error(storage.status);
    expect(storage.response.regenerable).toMatchObject({ limitBytes: MB, next: [], idleDays: 90 });
    expect(storage.response.regenerable!.goneBytes).toBe(1_200_000);

    // Ett projekt öppnat de senaste 3 dygnen skyddar allt i det; räcker skyddet inte säger O-Tid det i stället.
    const fresh = await newProject(owner, "Söder");
    await laserRun(owner, fresh, 4, 600_000, new Date(NOW.getTime() - 10 * DAY));
    await laserRun(owner, fresh, 5, 600_000, new Date(NOW.getTime() - 9 * DAY));
    await opened(fresh, new Date(NOW.getTime() - DAY));
    const again = await enforceRegenerableQuota(db, owner.accountId, NOW, store);
    expect(again.evicted).toBe(0);
    expect(again.overLimitProjects.sort()).toEqual(["Norr", "Söder"]);
    const missing = await projectRegenerableMissing(db, { ...owner.proof, projectId: project }, NOW);
    if (missing.status !== "ok") throw new Error(missing.status);
    expect(missing.missing.laserRuns.map(run => run.jobId).sort()).toEqual([first.jobId, second.jobId].sort());
    expect(missing.missing.overLimitProjects.sort()).toEqual(["Norr", "Söder"]);
    await db.execute(sql`update user_account set regenerable_quota_mb = null where id = ${owner.accountId}`);

    // «Återskapa»: körs om utan att räknas mot laserkvoten (månadens fem rutor är slut) och tar över underlaget.
    const regenerated = await regenerateGeoJob(db, { ...owner.proof, projectId: project, jobId: first.jobId }, runtime, NOW);
    if (regenerated.status !== "queued") throw new Error(regenerated.status);
    expect(await regenerateGeoJob(db, { ...owner.proof, projectId: project, jobId: first.jobId }, runtime, NOW))
      .toEqual({ status: "queued", jobId: regenerated.jobId, replayed: true });
    expect((await createGeoJob(db, { ...owner.proof, projectId: project, request: { formatVersion: 1, requestId: randomUUID(), kind: "PULLAUTIN",
      name: "Ny", tiles: [tile], settings: {} } }, runtime, NOW)).status).toBe("quota");
    const rerun = await laserRun(owner, project, 1, 600_000, undefined, regenerated.jobId);
    expect(rerun.layerId).toBe(first.layerId);
    expect((await db.execute(sql`select 1 from map_project_geo_job where id = ${first.jobId}`)).rows).toHaveLength(0);
    const after = await listMapProjectLayers(db, { ...owner.proof, projectId: project }, NOW);
    if (after.status !== "ok") throw new Error(after.status);
    expect(after.list.layers.filter(layer => layer.name === "Laser 1")).toHaveLength(1);
    expect(after.list.layers.find(layer => layer.layerId === first.layerId)).toMatchObject({ missing: false });
    // Samma bytes: innehållet fick tillbaka sin plats i förrådet.
    expect((await content(firstImage))?.stored_in).toBe("STORE");
    expect(store.objects.has(firstImage)).toBe(true);
  });

  it("en hämtad bild har recept, ersätts i samma underlag när den återskapas, och det orörda tas bort ur förrådet", async () => {
    storeOn();
    const { owner, project } = await setup("Bilder");
    const recipe = { source: "SLU_MOISTURE", request: { formatVersion: 1, box: { south: 59.29, west: 18, north: 59.31, east: 18.04 } } };
    const metadata = { formatVersion: 1, requestId: randomUUID(), name: "Markfuktighet", crs: 3006, transform: { a: 2, b: 0, c: 664730, d: 0, e: -2, f: 6576850 } };
    const created = await createMapProjectLayer(db, { ...owner.proof, projectId: project, metadata: { ...metadata, recipe }, file: png(20, 20, 9) },
      NOW);
    if (created.status !== "created") throw new Error(created.status);
    expect(created.layer.recipe).toMatchObject(recipe);
    expect(await content(created.layer.sha256)).toMatchObject({ regenerable: true, recipe: { source: "SLU_MOISTURE" } });
    // Ett eget underlag (utan recept) är inte återskapbart.
    const own = await createMapProjectLayer(db, { ...owner.proof, projectId: project, metadata: { ...metadata, requestId: randomUUID(), name: "Eget" },
      file: png(20, 20, 10) }, NOW);
    if (own.status !== "created") throw new Error(own.status);
    expect(await content(own.layer.sha256)).toMatchObject({ regenerable: false, recipe: null });
    await opened(project, new Date(NOW.getTime() - 100 * DAY));
    await db.execute(sql`update map_content set last_used_at = ${new Date(NOW.getTime() - 100 * DAY)}, created_at = ${new Date(NOW.getTime() - 100 * DAY)}
      where sha256 in (${created.layer.sha256}, ${own.layer.sha256})`);

    // Orört i 90 dagar: bort ur förrådet; det egna står kvar.
    const round = await runRegenerableRound(db, store, NOW);
    expect(round.idle).toBeGreaterThanOrEqual(1);
    expect((await content(created.layer.sha256))?.stored_in).toBe("GONE");
    expect((await content(own.layer.sha256))?.stored_in).toBe("STORE");
    const missing = await projectRegenerableMissing(db, { ...owner.proof, projectId: project }, NOW);
    if (missing.status !== "ok") throw new Error(missing.status);
    expect(missing.missing.layers).toMatchObject([{ layerId: created.layer.layerId, source: "SLU_MOISTURE" }]);

    // Webbläsaren hämtar om bilden och ersätter den i samma underlag (namn och genomskinlighet står kvar).
    const replaced = await createMapProjectLayer(db, { ...owner.proof, projectId: project, metadata: { ...metadata, requestId: randomUUID(), name: "Annat namn",
      recipe, replaces: created.layer.layerId }, file: png(20, 20, 11) }, NOW);
    if (replaced.status !== "created") throw new Error(replaced.status);
    expect(replaced.layer).toMatchObject({ layerId: created.layer.layerId, name: "Markfuktighet", missing: false });
    expect(replaced.layer.sha256).not.toBe(created.layer.sha256);
    expect(await content(replaced.layer.sha256)).toMatchObject({ stored_in: "STORE", regenerable: true });
    // Ett underlag vars bild finns ersätts inte.
    const twice = await createMapProjectLayer(db, { ...owner.proof, projectId: project, metadata: { ...metadata, requestId: randomUUID(), recipe,
      replaces: created.layer.layerId }, file: png(20, 20, 12) }, NOW);
    expect(twice).toMatchObject({ status: "created", replayed: true, layer: { sha256: replaced.layer.sha256 } });
  });

  it("på tävlingsdygnet tas ingenting bort automatiskt", async () => {
    storeOn();
    const { owner, project } = await setup("Tävlingsdag");
    const run1 = await laserRun(owner, project, 21, 600_000, new Date(NOW.getTime() - 200 * DAY));
    await laserRun(owner, project, 22, 600_000, new Date(NOW.getTime() - 199 * DAY));
    await opened(project, new Date(NOW.getTime() - 199 * DAY));
    await db.execute(sql`update user_account set regenerable_quota_mb = 1 where id = ${owner.accountId}`);
    const event = await createOrganizerEvent(db, { ...owner.proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
      readBody: async () => ({ formatVersion: 1, eventName: "Tävling", raceName: "I dag", raceDate: "2026-11-22", timeZone: "Europe/Stockholm", raceType: "STANDARD" }) });
    if (event.status !== "created") throw new Error(event.status);
    expect(await enforceRegenerableQuota(db, owner.accountId, NOW, store)).toMatchObject({ evicted: 0, skipped: "RACE_DAY" });
    expect(await runRegenerableRound(db, store, NOW)).toMatchObject({ raceDay: true, evicted: 0, idle: 0 });
    expect((await content((await outputsOf(run1.jobId)).find(file => file.name === "karta.png")!.sha))?.stored_in).toBe("STORE");
  });
});
