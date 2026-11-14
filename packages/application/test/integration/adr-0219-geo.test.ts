import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { and, eq, sql } from "drizzle-orm";
import { createMapProjectFromUpload, inviteMapProjectMember, readMapProject } from "../../src/map-projects";
import { lantmaterietRuntimeFromEnvironment } from "../../src/map-project-lantmateriet";
import { laserCollectionOf, laserRuntimeFromEnvironment, searchMapProjectLaser } from "../../src/map-project-laser";
import {
  authenticateGeoWorker, claimGeoJob, createGeoJob, finishGeoJob, geoTilesPerMonth, heartbeatGeoJob, listGeoJobs, openGeoJobLaser, readGeoOutput,
  removeGeoJob, storeGeoOutput
, GEO_JOB_COUNTS, pruneGeoJobs , splitClip } from "../../src/map-project-geo-jobs";
import { mergeGeoStages, readGeoStageOutput } from "../../src/map-project-geo-merge";
import { listMapProjectLayers } from "../../src/map-project-layers";
import { fetchMapProjectMoisture, moistureRequestBox } from "../../src/map-project-moisture";
import { saveMapSourceCredential } from "../../src/map-source-credentials";
import { createDwgJob, readGeoJobInput } from "../../src/map-project-geo-dwg";
import { readAccountStorageAsSuperadmin, readOwnAccountStorage } from "../../src/account-storage";
import { registerTestAccount } from "./accounts";

/**
 * ADR-0219 K5 (migration 0103): geo-arbetarens jobb. Laserrutorna söks hos Lantmäteriet med kontots uppgifter; jobbet läggs,
 * hämtas av geo-arbetaren, laserfilen går genom servern med jobbkontots uppgifter, resultatfilerna sparas och bilden blir ett
 * underlag. Avbrutna jobb stoppar arbetaren; färdiga tas bort med filerna. Tjänsterna är falska (en egen fetch).
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0219g_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const NOW = new Date("2026-11-08T12:00:00Z");
const mapBytes = new Uint8Array(await readFile(new URL("../../../../fixtures/maps/kartfil.omap", import.meta.url)));
const environment = { OTID_EVENTOR_MASTER_KEY: randomBytes(32).toString("base64"), OTID_LM_STAC_HOJD_URL: "https://api.lantmateriet.se/stac-hojd/v1",
  OTID_GEO_TILES_PER_MONTH: "5" };
const BOX = { south: 59.29, west: 18.0, north: 59.31, east: 18.04 };
const LAZ = "https://dl1.lantmateriet.se/hojd/laser/skog/24A001_65775_6575_25.laz";

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0219g_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

function png(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}

function fakeLantmateriet() {
  const calls: { url: string; auth: string | null; body: string | null }[] = [];
  const fetcher = (async (input: string | URL, init: RequestInit = {}) => {
    const target = String(input), auth = new Headers(init.headers).get("authorization");
    calls.push({ url: target, auth, body: typeof init.body === "string" ? init.body : null });
    if (target.endsWith("/collections")) return Response.json({ collections: [{ id: "ortofoto", title: "Ortofoto" }, { id: "laserdata-skog", title: "Laserdata skog" }] });
    if (target.endsWith("/search")) return Response.json({ features: [{ id: "24A001_65775_6575_25", collection: "laserdata-skog", bbox: [18, 59.29, 18.04, 59.31],
      properties: { datetime: "2024-05-01T00:00:00Z", "proj:epsg": 3006 }, assets: { data: { href: LAZ, type: "application/vnd.laszip", "file:size": 1234 } } },
    { id: "elak", properties: {}, assets: { data: { href: "https://elak.example/x.laz" } } }] });
    if (target === LAZ) return new Response(new Uint8Array([76, 65, 83, 70, 1, 2, 3]), { status: 200, headers: { "content-length": "7" } });
    return new Response("nej", { status: 404 });
  }) as typeof fetch;
  return { calls, runtime: { ...laserRuntimeFromEnvironment(lantmaterietRuntimeFromEnvironment(environment)), fetch: fetcher } };
}

async function project() {
  const owner = await registerTestAccount(db, undefined, NOW);
  const created = await createMapProjectFromUpload(db, { ...owner.proof, metadata: { formatVersion: 1, requestId: randomUUID(), name: "Laser",
    fileName: "Laser.omap" }, file: mapBytes }, NOW);
  if (created.status !== "created") throw new Error(created.status);
  const reader = await registerTestAccount(db, undefined, NOW);
  await inviteMapProjectMember(db, { ...owner.proof, projectId: created.projectId, request: { formatVersion: 1, requestId: randomUUID(), email: reader.email, role: "READ" } }, NOW);
  await readMapProject(db, { ...reader.proof, projectId: created.projectId }, NOW);
  return { owner, reader, projectId: created.projectId };
}
const server = { state: "OFF" as const, detail: null };

describe("ADR-0219 K5: geo-arbetaren", () => {
  it("söker laserrutor, lägger jobbet, arbetaren hämtar laser genom servern och resultatet blir ett underlag", async () => {
    const { owner, reader, projectId } = await project();
    const { calls, runtime } = fakeLantmateriet();
    const tile = { id: "24A001_65775_6575_25", href: LAZ, bbox: [18, 59.29, 18.04, 59.31] as [number, number, number, number], epsg: 3006 };
    const request = () => ({ formatVersion: 1, requestId: randomUUID(), kind: "PULLAUTIN", name: "Laser norr", tiles: [tile], settings: { contour_interval: 2.5 },
      clip: { minX: 664730, minY: 6576450, maxX: 665130, maxY: 6576850 },
      // G8: Lantmäteriets marktäcke läses också (zip-filen hämtas genom servern som laserfilerna).
      extras: [{ kind: "LAND_COVER", id: "marktacke_kn0125", href: LAZ }],
      moisture: { channelHa: 1, wetMeters: 0.5, moistMeters: 1 }, vegetation: { minAreaM2: 300 } });
    // Utan uppgifter till Lantmäteriet går varken sökning eller jobb.
    expect((await searchMapProjectLaser(db, { ...owner.proof, projectId, request: { formatVersion: 1, box: BOX } }, runtime, NOW)).status).toBe("no-credential");
    expect((await createGeoJob(db, { ...owner.proof, projectId, request: request() }, runtime, NOW)).status).toBe("no-credential");
    await saveMapSourceCredential(db, { ...owner.proof, request: { formatVersion: 1, method: "BASIC", id: "geotorget-anna", secret: "hemligt" } }, environment, NOW);

    const found = await searchMapProjectLaser(db, { ...owner.proof, projectId, request: { formatVersion: 1, box: BOX } }, runtime, NOW);
    expect(found).toMatchObject({ status: "ok", collection: "laserdata-skog", items: [{ id: tile.id, href: LAZ, epsg: 3006, bytes: 1234 }] });
    expect(JSON.parse(calls.find(call => call.url.endsWith("/search"))!.body!) as unknown).toMatchObject({ collections: ["laserdata-skog"], bbox: [18, 59.29, 18.04, 59.31] });
    expect(calls.every(call => call.auth === `Basic ${Buffer.from("geotorget-anna:hemligt").toString("base64")}`)).toBe(true);
    expect(laserCollectionOf({ collections: [{ id: "markhojdmodell" }] })).toBeUndefined();

    // Läsa får inte lägga jobb; en ruta utanför Lantmäteriet och okända inställningar avvisas.
    expect((await createGeoJob(db, { ...reader.proof, projectId, request: request() }, runtime, NOW)).status).toBe("forbidden");
    expect((await createGeoJob(db, { ...owner.proof, projectId, request: { ...request(), tiles: [{ ...tile, href: "https://elak.example/x.laz" }] } }, runtime, NOW)).status)
      .toBe("invalid-request");
    expect((await createGeoJob(db, { ...owner.proof, projectId, request: { ...request(), settings: { rm_rf: 1 } } }, runtime, NOW)).status).toBe("invalid-request");
    // Grundkartan G1: en klippruta som är tom eller orimligt stor avvisas.
    for (const clip of [{ minX: 10, minY: 10, maxX: 10, maxY: 500 }, { minX: 0, minY: 0, maxX: 50_000, maxY: 500 }]) {
      expect((await createGeoJob(db, { ...owner.proof, projectId, request: { ...request(), clip } }, runtime, NOW)).status).toBe("invalid-request");
    }
    const created = await createGeoJob(db, { ...owner.proof, projectId, request: request() }, runtime, NOW);
    if (created.status !== "created") throw new Error(created.status);
    expect(created.job).toMatchObject({ name: "Laser norr", status: "QUEUED", tiles: 1, settings: { contour_interval: 2.5 }, extras: ["LAND_COVER"],
      clip: { minX: 664730, minY: 6576450, maxX: 665130, maxY: 6576850 } });

    // Kvoten: en tom variabel (compose) ger förvalet.
    expect([geoTilesPerMonth({ OTID_GEO_TILES_PER_MONTH: "" }), geoTilesPerMonth({}), geoTilesPerMonth({ OTID_GEO_TILES_PER_MONTH: "0" })]).toEqual([200, 200, 0]);
    // Geo-arbetarens nyckel.
    const token = "t".repeat(40);
    expect(await authenticateGeoWorker(db, `Bearer ${token}`, "geo-1", { OTID_GEO_WORKER_TOKEN: token })).toBe("geo-1");
    expect(await authenticateGeoWorker(db, `Bearer ${token}`, "../x", { OTID_GEO_WORKER_TOKEN: token })).toBeUndefined();
    expect(await authenticateGeoWorker(db, `Bearer ${"u".repeat(40)}`, "geo-1", { OTID_GEO_WORKER_TOKEN: token })).toBeUndefined();
    expect(await authenticateGeoWorker(db, `Bearer ${token}`, "geo-1", {})).toBeUndefined();

    const claimed = await claimGeoJob(db, "geo-1", NOW);
    expect(claimed).toMatchObject({ jobId: created.job.jobId, tiles: [{ index: 0, id: tile.id, epsg: 3006 }], settings: { contour_interval: 2.5 },
      clip: { minX: 664730, minY: 6576450, maxX: 665130, maxY: 6576850 }, extras: [{ index: 0, kind: "LAND_COVER" }],
      moisture: { channelHa: 1, wetMeters: 0.5, moistMeters: 1 }, vegetation: { minAreaM2: 300 } });
    // En vektorprodukt på en annan adress än Lantmäteriets avvisas.
    expect((await createGeoJob(db, { ...owner.proof, projectId, request: { ...request(), extras: [{ kind: "BUILDINGS", id: "x", href: "https://example.org/byggnad.zip" }] } },
      runtime, NOW)).status).toBe("invalid-request");
    // Fuktigt lägre än blött avvisas.
    expect((await createGeoJob(db, { ...owner.proof, projectId, request: { ...request(), moisture: { channelHa: 1, wetMeters: 2, moistMeters: 1 } } }, runtime, NOW)).status)
      .toBe("invalid-request");
    expect((await createGeoJob(db, { ...owner.proof, projectId, request: { ...request(), vegetation: { minAreaM2: 10 } } }, runtime, NOW)).status)
      .toBe("invalid-request");
    expect(JSON.stringify(claimed)).not.toContain("lantmateriet.se");
    expect(await claimGeoJob(db, "geo-2", NOW)).toBeUndefined();
    expect(await heartbeatGeoJob(db, created.job.jobId, "geo-1", { step: "Hämtar laserdata", done: 0, total: 1 }, NOW)).toBe("running");
    expect(await heartbeatGeoJob(db, created.job.jobId, "geo-2", {}, NOW)).toBe("stop");
    const laser = await openGeoJobLaser(db, created.job.jobId, "geo-1", 0, runtime);
    if (laser.status !== "ok") throw new Error(laser.status);
    expect(new Uint8Array(await laser.response.arrayBuffer())).toEqual(new Uint8Array([76, 65, 83, 70, 1, 2, 3]));
    expect((await openGeoJobLaser(db, created.job.jobId, "geo-2", 0, runtime)).status).toBe("not-found");
    expect((await openGeoJobLaser(db, created.job.jobId, "geo-1", 5, runtime)).status).toBe("not-found");
    expect((await openGeoJobLaser(db, created.job.jobId, "geo-1", 0, runtime, true)).status).toBe("ok");
    expect((await openGeoJobLaser(db, created.job.jobId, "geo-1", 1, runtime, true)).status).toBe("not-found");
    expect((await listGeoJobs(db, { ...reader.proof, projectId }, server, NOW))).toMatchObject({ status: "ok",
      list: { jobs: [{ status: "RUNNING", progress: { step: "Hämtar laserdata", done: 0, total: 1 }, own: false }], queue: { running: 1, waiting: 0, users: 1, ahead: {} } } });

    const world = "0.5\n0\n0\n-0.5\n675000.25\n6580499.75\n";
    for (const [name, mediaType, file] of [["karta.png", "image/png", png(1000, 1000)], ["karta.pgw", "text/plain", new TextEncoder().encode(world)],
      ["kurvor.dxf", "application/dxf", new TextEncoder().encode("0\nEOF\n")], ["fukt.png", "image/png", png(500, 500)],
      ["fukt.pgw", "text/plain", new TextEncoder().encode("2\n0\n0\n-2\n675001\n6580499\n")]] as const) {
      expect(await storeGeoOutput(db, { jobId: created.job.jobId, worker: "geo-1", name, mediaType, file }, NOW)).toEqual({ status: "stored" });
    }
    expect((await storeGeoOutput(db, { jobId: created.job.jobId, worker: "geo-1", name: "../etc", mediaType: "text/plain", file: new Uint8Array([1]) }, NOW)).status)
      .toBe("invalid-request");
    const finished = await finishGeoJob(db, created.job.jobId, "geo-1", { status: "DONE", summary: { tiles: 1 } }, NOW);
    if (finished.status !== "ok" || !finished.layerId) throw new Error("Inget underlag");
    const layers = await listMapProjectLayers(db, { ...reader.proof, projectId }, NOW);
    expect(layers).toMatchObject({ status: "ok", list: { layers: [{ layerId: finished.layerId, name: "Laser norr", crs: 3006, width: 1000, height: 1000,
      transform: { a: 0.5, b: 0, c: 675000.25, d: 0, e: -0.5, f: 6580499.75 } }, { name: "Laser norr – fuktighet", width: 500, opacity: 0.7 }] } });
    const listed = await listGeoJobs(db, { ...reader.proof, projectId }, server, NOW);
    expect(listed).toMatchObject({ status: "ok", list: { jobs: [{ status: "DONE", layerId: finished.layerId, progress: null,
      moistureLayerId: expect.any(String) as unknown,
      outputs: [{ name: "fukt.pgw" }, { name: "fukt.png" }, { name: "karta.pgw" }, { name: "karta.png" }, { name: "kurvor.dxf", mediaType: "application/dxf" }] }],
      queue: { running: 0, waiting: 0 } } });
    const dxf = await readGeoOutput(db, { ...reader.proof, projectId, jobId: created.job.jobId, name: "kurvor.dxf" }, NOW);
    expect(dxf).toMatchObject({ status: "ok", mediaType: "application/dxf" });
    // Klart jobb tar inte emot mer.
    expect((await finishGeoJob(db, created.job.jobId, "geo-1", { status: "DONE" }, NOW)).status).toBe("not-found");

    // Kvoten per månad (5 rutor i testet) och högst två aktiva jobb per konto.
    const second = await createGeoJob(db, { ...owner.proof, projectId, request: { ...request(), tiles: [tile, { ...tile, id: "b" }] } }, runtime, NOW);
    const third = await createGeoJob(db, { ...owner.proof, projectId, request: request() }, runtime, new Date(NOW.getTime() + 1000));
    expect([second.status, third.status]).toEqual(["created", "created"]);
    expect((await createGeoJob(db, { ...owner.proof, projectId, request: request() }, runtime, NOW)).status).toBe("busy");
    if (second.status !== "created" || third.status !== "created") throw new Error("Inga jobb");
    // Läsa kan inte avbryta någon annans jobb; ägaren avbryter, och arbetaren får besked att sluta.
    expect((await removeGeoJob(db, { ...reader.proof, projectId, jobId: second.job.jobId }, NOW)).status).toBe("forbidden");
    const next = await claimGeoJob(db, "geo-1", NOW);
    expect(next?.jobId).toBe(second.job.jobId);
    expect(await removeGeoJob(db, { ...owner.proof, projectId, jobId: second.job.jobId }, NOW)).toEqual({ status: "cancelled" });
    expect(await heartbeatGeoJob(db, second.job.jobId, "geo-1", {}, NOW)).toBe("stop");
    expect((await storeGeoOutput(db, { jobId: second.job.jobId, worker: "geo-1", name: "karta.png", mediaType: "image/png", file: png(10, 10) }, NOW)).status)
      .toBe("not-found");
    expect((await createGeoJob(db, { ...owner.proof, projectId, request: { ...request(), tiles: [tile, tile] } }, runtime, NOW)).status).toBe("quota");
    // Kontots egen gräns (superadmin, migration 0118) går före förvalet: höjd släpps körningen igenom, sänkt till noll nekas den.
    await db.update(schema.userAccounts).set({ geoTilesPerMonth: 50 }).where(eq(schema.userAccounts.id, owner.accountId));
    const raised = await createGeoJob(db, { ...owner.proof, projectId, request: { ...request(), tiles: [tile, tile] } }, runtime, NOW);
    if (raised.status !== "created") throw new Error(`Höjd gräns: ${raised.status}`);
    await removeGeoJob(db, { ...owner.proof, projectId, jobId: raised.job.jobId }, NOW);
    await db.update(schema.userAccounts).set({ geoTilesPerMonth: 0 }).where(eq(schema.userAccounts.id, owner.accountId));
    expect((await createGeoJob(db, { ...owner.proof, projectId, request: request() }, runtime, NOW)).status).toBe("quota");
    await db.update(schema.userAccounts).set({ geoTilesPerMonth: null }).where(eq(schema.userAccounts.id, owner.accountId));
    await removeGeoJob(db, { ...owner.proof, projectId, jobId: third.job.jobId }, NOW);

    // Ett misslyckat jobb visar förklaringen; ett färdigt tas bort med sina filer (underlaget ligger kvar).
    const failing = await createGeoJob(db, { ...owner.proof, projectId, request: request() }, runtime, NOW);
    if (failing.status !== "created") throw new Error(failing.status);
    await claimGeoJob(db, "geo-1", NOW);
    await finishGeoJob(db, failing.job.jobId, "geo-1", { status: "FAILED", error: "Karttapullautin avslutades med kod 1" }, NOW);
    const afterFailure = await listGeoJobs(db, { ...owner.proof, projectId }, server, NOW);
    if (afterFailure.status !== "ok") throw new Error(afterFailure.status);
    expect(afterFailure.list.jobs.find(job => job.jobId === failing.job.jobId)).toMatchObject({ status: "FAILED", error: "Karttapullautin avslutades med kod 1" });
    expect(await removeGeoJob(db, { ...owner.proof, projectId, jobId: created.job.jobId }, NOW)).toEqual({ status: "deleted" });
    expect(await db.select().from(schema.mapProjectGeoOutputs).where(eq(schema.mapProjectGeoOutputs.jobId, created.job.jobId))).toEqual([]);
    expect((await listMapProjectLayers(db, { ...owner.proof, projectId }, NOW))).toMatchObject({ list: { layers: [{ layerId: finished.layerId },
      { name: "Laser norr – fuktighet" }] } });
  });

  it("L2–L3: lagringen per projekt, rensning av äldre körningar, misslyckade körningars filer och serverns fel utanför kvoten", async () => {
    const { owner, reader, projectId } = await project();
    const { runtime } = fakeLantmateriet();
    const tile = { id: "24A001_65775_6575_25", href: LAZ, bbox: [18, 59.29, 18.04, 59.31] as [number, number, number, number], epsg: 3006 };
    const request = (name: string) => ({ formatVersion: 1, requestId: randomUUID(), kind: "PULLAUTIN", name, tiles: [tile], settings: {} });
    await saveMapSourceCredential(db, { ...owner.proof, request: { formatVersion: 1, method: "BASIC", id: "geotorget-anna", secret: "hemligt" } }, environment, NOW);
    const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
    // Varje körning får egna bildbyte, så att innehållet inte delas mellan körningarna.
    const image = (seed: number) => { const bytes = png(100, 100); bytes[40] = seed; return bytes; };
    const run = async (name: string, seed: number, at: Date, outcome: "DONE" | "FAILED", error = "Karttapullautin avslutades med kod 1") => {
      const created = await createGeoJob(db, { ...owner.proof, projectId, request: request(name) }, runtime, at);
      if (created.status !== "created") throw new Error(created.status);
      await claimGeoJob(db, "geo-1", at);
      for (const [file, mediaType, body] of [["karta.png", "image/png", image(seed)], ["karta.pgw", "text/plain", new TextEncoder().encode("1\n0\n0\n-1\n675000\n6580000\n")],
        ["kurvor.dxf", "application/dxf", new TextEncoder().encode(`0\nEOF ${seed}\n`)]] as const) {
        expect(await storeGeoOutput(db, { jobId: created.job.jobId, worker: "geo-1", name: file, mediaType, file: body }, at)).toEqual({ status: "stored" });
      }
      await finishGeoJob(db, created.job.jobId, "geo-1", outcome === "DONE" ? { status: "DONE" } : { status: "FAILED", error }, at);
      return created.job.jobId;
    };
    const outputsOf = (jobId: string) => db.select({ name: schema.mapProjectGeoOutputs.name }).from(schema.mapProjectGeoOutputs)
      .where(eq(schema.mapProjectGeoOutputs.jobId, jobId));

    const first = await run("Första", 1, later(1), "DONE");
    // En misslyckad körning lämnar inga resultatfiler; föll den på servern räknas dess rutor inte mot kvoten (5 i testets miljö).
    const broken = await run("Trasig", 2, later(2), "FAILED");
    const full = await run("Full lagring", 3, later(3), "FAILED", "karta.png kunde inte skickas (422)");
    expect(await outputsOf(broken)).toEqual([]);
    expect(await outputsOf(full)).toEqual([]);
    const counted = async () => (await db.execute<{ tiles: number }>(sql`select coalesce(sum(jsonb_array_length(request->'tiles')), 0)::int as tiles
      from map_project_geo_job where account_id = ${owner.accountId}::uuid and ${GEO_JOB_COUNTS}`)).rows[0]!.tiles;
    expect(await counted()).toBe(2);
    const second = await run("Andra", 4, later(4), "DONE");

    // Uppdelningen: två klara körningars filer. En läsare har inget eget innehåll i projektet.
    const before = await readOwnAccountStorage(db, owner.proof, later(5));
    if (before.status !== "ok") throw new Error(before.status);
    const mine = before.response.projects.find(row => row.projectId === projectId)!;
    // Grundfilen är samma innehåll som ett tidigare test laddade upp, så den räknas till det kontot (innehåll sparas en gång).
    expect(mine).toMatchObject({ name: "Laser", layerBytes: 0, outputBytes: 0, baseBytes: 0, prunableRuns: 3 });
    expect(mine.geoBytes).toBeGreaterThan(2 * 64);
    expect(mine.totalBytes).toBe(mine.geoBytes + mine.baseBytes);
    expect(before.response.usedBytes).toBe(mine.totalBytes + before.response.otherBytes);
    const readers = await readOwnAccountStorage(db, reader.proof, later(5));
    expect(readers).toMatchObject({ status: "ok", response: { usedBytes: 0, projects: [], otherBytes: 0 } });
    expect(await readAccountStorageAsSuperadmin(db, reader.proof, owner.accountId, later(5))).toEqual({ status: "forbidden" });
    // L4: projektet märks som använt när någon med behörighet rör det, högst en gång i timmen. Att läsa kontots lagring räknas inte.
    const opened = async () => (await db.select({ at: schema.mapProjects.lastOpenedAt }).from(schema.mapProjects).where(eq(schema.mapProjects.id, projectId)))[0]!.at;
    const firstTouch = await opened();
    expect(firstTouch).toBeInstanceOf(Date);
    expect(mine.lastOpenedAt).toBe(firstTouch!.toISOString());
    await listGeoJobs(db, { ...reader.proof, projectId }, server, new Date(firstTouch!.getTime() + 59 * 60_000));
    expect(await opened()).toEqual(firstTouch);
    await listGeoJobs(db, { ...reader.proof, projectId }, server, new Date(firstTouch!.getTime() + 61 * 60_000));
    expect(await opened()).toEqual(new Date(firstTouch!.getTime() + 61 * 60_000));
    expect((await listGeoJobs(db, { ...(await registerTestAccount(db, undefined, NOW)).proof, projectId }, server, new Date(firstTouch!.getTime() + 62 * 60_000))).status).toBe("not-found");
    expect(await opened()).toEqual(new Date(firstTouch!.getTime() + 61 * 60_000));

    // Rensningen: läsaren har inga egna körningar att ta; ägaren tar allt utom den senaste klara, med de äldres underlag.
    expect(await pruneGeoJobs(db, { ...reader.proof, projectId }, later(6))).toEqual({ status: "pruned", removedRuns: 0, removedLayers: 0 });
    expect(await pruneGeoJobs(db, { ...owner.proof, projectId }, later(6))).toEqual({ status: "pruned", removedRuns: 3, removedLayers: 1 });
    const left = await listGeoJobs(db, { ...owner.proof, projectId }, server, later(7));
    if (left.status !== "ok") throw new Error(left.status);
    expect(left.list.jobs.map(job => job.jobId)).toEqual([second]);
    expect(left.list.jobs.some(job => job.jobId === first)).toBe(false);
    expect((await listMapProjectLayers(db, { ...owner.proof, projectId }, later(7)))).toMatchObject({ list: { layers: [{ name: "Andra" }] } });
    const after = await readOwnAccountStorage(db, owner.proof, later(7));
    if (after.status !== "ok") throw new Error(after.status);
    expect(after.response.projects.find(row => row.projectId === projectId)).toMatchObject({ prunableRuns: 0 });
    expect(await pruneGeoJobs(db, { ...owner.proof, projectId }, later(8))).toEqual({ status: "pruned", removedRuns: 0, removedLayers: 0 });
  });

  it("ett område som är större än servern klarar delas i etapper som körs efter varandra", async () => {
    // Hela Järflotta 2026-11-13: 4,5 × 6,8 km (30 km²) dog två gånger; gränsen 16 km² ger två remsor tvärs över den längre sidan.
    const island = { minX: 665753, minY: 6521287, maxX: 670237, maxY: 6528073 };
    expect(splitClip(island, 16)).toEqual([{ ...island, maxY: 6524680 }, { ...island, minY: 6524680 }]);
    expect(splitClip(island, 0)).toEqual([island]);
    expect(splitClip({ minX: 0, minY: 0, maxX: 9000, maxY: 3000 }, 10).map(part => [part.minX, part.maxX])).toEqual([[0, 3000], [3000, 6000], [6000, 9000]]);
    expect(splitClip({ minX: 0, minY: 0, maxX: 4000, maxY: 4000 }, 16)).toHaveLength(1);

    const { owner, projectId } = await project();
    const { runtime } = fakeLantmateriet();
    await saveMapSourceCredential(db, { ...owner.proof, request: { formatVersion: 1, method: "BASIC", id: "geotorget-anna", secret: "hemligt" } }, environment, NOW);
    const south = { id: "20C029_65200_6650_25", href: LAZ, bbox: [17.86, 58.79, 17.95, 58.82] as [number, number, number, number], epsg: 3006 };
    const north = { id: "20C029_65250_6650_25", href: LAZ.replace(".laz", "-n.laz"), bbox: [17.86, 58.84, 17.95, 58.87] as [number, number, number, number], epsg: 3006 };
    const request = (name: string, clip?: typeof island) => ({ formatVersion: 1, requestId: randomUUID(), kind: "PULLAUTIN", name, tiles: [south, north], settings: {}, ...(clip ? { clip } : {}) });

    const whole = request("Hela ön", island);
    const created = await createGeoJob(db, { ...owner.proof, projectId, request: whole }, runtime, NOW);
    if (created.status !== "created") throw new Error(created.status);
    expect(created.split).toEqual({ total: 2 });
    expect(created.job.name).toBe("Hela ön – etapp 1 av 2");
    const queued = await db.select({ name: sql<string>`request->>'name'`, clip: sql<typeof island>`request->'clip'`, tiles: sql<number>`jsonb_array_length(request->'tiles')`,
      tile: sql<string>`request->'tiles'->0->>'id'`, split: sql<{ index: number; total: number }>`request->'split'` })
      .from(schema.mapProjectGeoJobs).where(eq(schema.mapProjectGeoJobs.projectId, projectId)).orderBy(schema.mapProjectGeoJobs.createdAt);
    // Varje etapp får sin halva av klipprutan och bara rutorna som når den.
    expect(queued).toMatchObject([
      { name: "Hela ön – etapp 1 av 2", clip: { ...island, maxY: 6524680 }, tiles: 1, tile: south.id, split: { index: 1, total: 2 } },
      { name: "Hela ön – etapp 2 av 2", clip: { ...island, minY: 6524680 }, tiles: 1, tile: north.id, split: { index: 2, total: 2 } }]);
    // «Ta bort äldre körningar» ser etapperna som en körning: när båda är klara behålls båda.
    for (let stage = 0; stage < queued.length; stage += 1) {
      const claimed = await claimGeoJob(db, "geo-1", NOW);
      await finishGeoJob(db, claimed!.jobId, "geo-1", { status: "DONE" }, new Date(NOW.getTime() + 60_000));
    }
    expect(await pruneGeoJobs(db, { ...owner.proof, projectId }, new Date(NOW.getTime() + 120_000))).toEqual({ status: "pruned", removedRuns: 0, removedLayers: 0 });
    const storage = await readOwnAccountStorage(db, owner.proof, new Date(NOW.getTime() + 120_000));
    if (storage.status !== "ok") throw new Error(storage.status);
    expect(storage.response.projects.find(row => row.projectId === projectId)?.prunableRuns ?? 0).toBe(0);
    // Samma begäran igen ger samma svar, och etapperna räknas som en körning mot gränsen för samtidiga körningar (två).
    expect(await createGeoJob(db, { ...owner.proof, projectId, request: whole }, runtime, NOW)).toMatchObject({ status: "created", replayed: true, split: { total: 2 } });
    // Utan klippruta, eller med delningen avstängd, blir det en körning som förut.
    const plain = await createGeoJob(db, { ...owner.proof, projectId, request: request("Utan ruta") }, runtime, NOW);
    expect(plain).toMatchObject({ status: "created", job: { name: "Utan ruta" } });
    expect(plain.status === "created" && plain.split).toBeUndefined();
    expect((await createGeoJob(db, { ...owner.proof, projectId, request: { ...request("Två"), tiles: [south] } }, runtime, NOW)).status).toBe("created");
    expect((await createGeoJob(db, { ...owner.proof, projectId, request: request("En till") }, runtime, NOW)).status).toBe("busy");
    for (const row of await db.select({ id: schema.mapProjectGeoJobs.id }).from(schema.mapProjectGeoJobs).where(eq(schema.mapProjectGeoJobs.projectId, projectId))) {
      await removeGeoJob(db, { ...owner.proof, projectId, jobId: row.id }, NOW);
    }
    const off = { ...runtime, environment: { ...runtime.environment, OTID_GEO_SPLIT_KM2: "0" } };
    const single = await createGeoJob(db, { ...owner.proof, projectId, request: request("Odelad", island) }, off, NOW);
    expect(single).toMatchObject({ status: "created", job: { name: "Odelad" } });
    expect(single.status === "created" && single.split).toBeUndefined();
  });

  it("lägger ihop etapperna på geo-servern: sista etappen köar sammanläggningen, som ersätter etapperna", async () => {
    // Ägaren 2026-11-14: «det verkade som den andra tråden inte gjorde ihopläsningen på servern. jag skulle vilja att det var så».
    const island = { minX: 664000, minY: 6522000, maxX: 668000, maxY: 6527360 };
    // Kön är gemensam för alla projekt: det som de tidigare testerna lämnat kvar ska inte hämtas här.
    await db.update(schema.mapProjectGeoJobs).set({ status: "CANCELLED" }).where(sql`status in ('QUEUED', 'RUNNING')`);
    const { owner, reader, projectId } = await project();
    const { runtime } = fakeLantmateriet();
    await saveMapSourceCredential(db, { ...owner.proof, request: { formatVersion: 1, method: "BASIC", id: "geotorget-anna", secret: "hemligt" } }, environment, NOW);
    const south = { id: "20C029_65200_6650_25", href: LAZ, bbox: [17.86, 58.79, 17.95, 58.82] as [number, number, number, number], epsg: 3006, datetime: "2021-04-12T00:00:00Z" };
    const north = { ...south, id: "20C029_65250_6650_25", href: LAZ.replace(".laz", "-n.laz"), bbox: [17.86, 58.84, 17.95, 58.87] as [number, number, number, number] };
    const created = await createGeoJob(db, { ...owner.proof, projectId, request: { formatVersion: 1, requestId: randomUUID(), kind: "PULLAUTIN", name: "Hela ön",
      tiles: [south, north], settings: { contour_interval: 5 }, clip: island, moisture: { channelHa: 1, wetMeters: 0.5, moistMeters: 1 } } }, runtime, NOW);
    expect(created).toMatchObject({ status: "created", split: { total: 2 } });
    const world = new TextEncoder().encode("2\n0\n0\n-2\n664001\n6527359\n"), text = (value: string) => new TextEncoder().encode(value);
    const stageIds: string[] = [];
    for (let stage = 0; stage < 2; stage += 1) {
      const claimed = await claimGeoJob(db, "geo-1", NOW);
      expect([claimed?.merge, claimed?.stage]).toEqual([undefined, true]);
      stageIds.push(claimed!.jobId);
      for (const [name, mediaType, file] of [["karta.png", "image/png", png(100 + stage, 100)], ["karta.pgw", "text/plain", world],
        ["kurvor.dxf", "application/dxf", text(`0\nEOF\n${stage}`)]] as const) {
        expect(await storeGeoOutput(db, { jobId: claimed!.jobId, worker: "geo-1", name, mediaType, file }, NOW)).toEqual({ status: "stored" });
      }
      // Ingen sammanläggning förrän den sista etappen är klar.
      expect((await db.select().from(schema.mapProjectGeoJobs).where(and(eq(schema.mapProjectGeoJobs.projectId, projectId), sql`request->'merge' is not null`))).length).toBe(0);
      await finishGeoJob(db, claimed!.jobId, "geo-1", { status: "DONE" }, new Date(NOW.getTime() + 60_000));
    }
    const later = new Date(NOW.getTime() + 120_000);
    const waiting = await listGeoJobs(db, { ...reader.proof, projectId }, server, later);
    if (waiting.status !== "ok") throw new Error(waiting.status);
    expect(waiting.list.jobs.map(job => [job.name, job.status, job.tiles, job.mergedStages])).toEqual([["Hela ön", "QUEUED", 0, 2],
      ["Hela ön – etapp 2 av 2", "DONE", 1, undefined], ["Hela ön – etapp 1 av 2", "DONE", 1, undefined]]);
    // Sammanläggningen räknas inte som en körning mot gränsen för samtidiga, och den köas bara en gång.
    expect(await mergeGeoStages(db, { ...owner.proof, projectId, jobId: stageIds[0]! }, later)).toEqual({ status: "conflict" });
    expect((await mergeGeoStages(db, { ...reader.proof, projectId, jobId: stageIds[0]! }, later)).status).toBe("forbidden");

    const merging = await claimGeoJob(db, "geo-1", later);
    expect(merging?.stage).toBeUndefined();
    expect(merging).toMatchObject({ tiles: [], clip: island, settings: { contour_interval: 5 }, merge: { stages: [
      { jobId: stageIds[0], clip: { ...island, maxY: 6524680 }, outputs: ["karta.pgw", "karta.png", "kurvor.dxf"] },
      { jobId: stageIds[1], clip: { ...island, minY: 6524680 }, outputs: ["karta.pgw", "karta.png", "kurvor.dxf"] }] } });
    // Etappernas filer går bara till arbetaren som kör sammanläggningen, och bara för jobbets egna etapper.
    expect((await readGeoStageOutput(db, merging!.jobId, "geo-1", stageIds[1]!, "kurvor.dxf"))?.toString("utf8")).toBe("0\nEOF\n1");
    expect(await readGeoStageOutput(db, merging!.jobId, "geo-2", stageIds[1]!, "kurvor.dxf")).toBeUndefined();
    expect(await readGeoStageOutput(db, merging!.jobId, "geo-1", merging!.jobId, "kurvor.dxf")).toBeUndefined();
    expect(await readGeoStageOutput(db, stageIds[0]!, "geo-1", stageIds[1]!, "kurvor.dxf")).toBeUndefined();
    // Geo-arbetaren 33 skickar kartbilden som WebP (migration 0122); underlaget får den typen.
    const webp = new Uint8Array(40);
    webp.set(new TextEncoder().encode("RIFF"), 0); webp.set(new TextEncoder().encode("WEBPVP8X"), 8);
    new DataView(webp.buffer).setUint16(24, 99, true); new DataView(webp.buffer).setUint16(27, 199, true);
    expect((await storeGeoOutput(db, { jobId: merging!.jobId, worker: "geo-1", name: "karta.webp", mediaType: "image/gif", file: webp }, later)).status).toBe("invalid-request");
    for (const [name, mediaType, file] of [["karta.webp", "image/webp", webp], ["karta.pgw", "text/plain", world], ["kurvor.dxf", "application/dxf", text("0\nEOF\n")]] as const) {
      expect(await storeGeoOutput(db, { jobId: merging!.jobId, worker: "geo-1", name, mediaType, file }, later)).toEqual({ status: "stored" });
    }
    const finished = await finishGeoJob(db, merging!.jobId, "geo-1", { status: "DONE", summary: { worker: 32, mergedStages: 2 } }, later);
    if (finished.status !== "ok" || !finished.layerId) throw new Error("Inget underlag");
    // Kvar är en körning med etappernas rutor (kvoten räknar dem där) och ett underlag; etapperna och deras underlag är borta.
    const done = await listGeoJobs(db, { ...reader.proof, projectId }, server, later);
    if (done.status !== "ok") throw new Error(done.status);
    expect(done.list.jobs).toMatchObject([{ jobId: merging!.jobId, name: "Hela ön", status: "DONE", tiles: 2, mergedStages: 2, scannedAt: "2021-04-12", clip: island,
      layerId: finished.layerId, moisture: { channelHa: 1 }, outputs: [{ name: "karta.pgw" }, { name: "karta.webp", mediaType: "image/webp" }, { name: "kurvor.dxf" }] }]);
    expect(done.list.jobs).toHaveLength(1);
    const layers = await listMapProjectLayers(db, { ...reader.proof, projectId }, later);
    expect(layers.status === "ok" && layers.list.layers.map(layer => [layer.name, layer.width, layer.height, layer.crs, layer.mediaType])).toEqual([["Hela ön", 100, 200, 3006, "image/webp"]]);
    expect(await mergeGeoStages(db, { ...owner.proof, projectId, jobId: merging!.jobId }, later)).toEqual({ status: "conflict" });

    // Går sammanläggningen fel står etapperna kvar som förut, och den kan köas igen.
    const again = await createGeoJob(db, { ...owner.proof, projectId, request: { formatVersion: 1, requestId: randomUUID(), kind: "PULLAUTIN", name: "Hela ön igen",
      tiles: [south, north], settings: {}, clip: island } }, runtime, later);
    expect(again.status).toBe("created");
    const stages: string[] = [];
    for (let stage = 0; stage < 2; stage += 1) {
      const claimed = await claimGeoJob(db, "geo-1", later);
      stages.push(claimed!.jobId);
      await finishGeoJob(db, claimed!.jobId, "geo-1", { status: "DONE" }, later);
    }
    const failing = await claimGeoJob(db, "geo-1", later);
    await finishGeoJob(db, failing!.jobId, "geo-1", { status: "FAILED", error: "karta.png kunde inte hämtas från etappen (500)" }, later);
    const after = await listGeoJobs(db, { ...owner.proof, projectId }, server, later);
    expect(after.status === "ok" && after.list.jobs.map(job => `${job.name}: ${job.status}`).sort()).toEqual(["Hela ön igen – etapp 1 av 2: DONE",
      "Hela ön igen – etapp 2 av 2: DONE", "Hela ön igen: FAILED", "Hela ön: DONE"]);
    expect(await mergeGeoStages(db, { ...owner.proof, projectId, jobId: stages[1]! }, later)).toMatchObject({ status: "queued" });
  });

  it("K5c: SLU:s markfuktighet för rutan i SWEREF 99 TM, med världsfilen", async () => {
    const { owner, reader, projectId } = await project();
    const box = moistureRequestBox(BOX);
    expect(box.width).toBeLessThanOrEqual(4000);
    expect(box.minE).toBeGreaterThan(600_000);
    expect(box.minN).toBeGreaterThan(6_500_000);
    const world = box.world.trim().split("\n").map(Number);
    expect(world[0]).toBeCloseTo((box.maxE - box.minE) / box.width);
    const calls: string[] = [];
    const runtime = { wmsUrl: "https://geodata.skogsstyrelsen.se/wms", layer: undefined, fetch: (async (target: string) => {
      calls.push(target);
      if (target.includes("GetCapabilities")) return new Response("<WMT_MS_Capabilities><Capability><Layer><Title>Alla</Title><Layer queryable=\"1\"><Name>Markfuktighet_SLU_2_0</Name></Layer></Layer></Capability></WMT_MS_Capabilities>");
      return new Response(new Uint8Array(png(box.width, box.height)), { headers: { "content-type": "image/png" } });
    }) as typeof fetch };
    const result = await fetchMapProjectMoisture(db, { ...owner.proof, projectId, request: { formatVersion: 1, box: BOX } }, runtime, NOW);
    expect(result).toMatchObject({ status: "ok", crs: 3006, world: box.world });
    const query = new URL(calls[1]!).searchParams;
    expect(Object.fromEntries(["LAYERS", "SRS", "VERSION", "BBOX", "WIDTH"].map(key => [key, query.get(key)]))).toEqual({ LAYERS: "Markfuktighet_SLU_2_0",
      SRS: "EPSG:3006", VERSION: "1.1.1", BBOX: [box.minE, box.minN, box.maxE, box.maxN].join(","), WIDTH: String(box.width) });
    expect((await fetchMapProjectMoisture(db, { ...reader.proof, projectId, request: { formatVersion: 1, box: BOX } }, runtime, NOW)).status).toBe("forbidden");
    const html = { ...runtime, fetch: (async () => new Response("<html>fel</html>")) as typeof fetch, layer: "x" };
    expect(await fetchMapProjectMoisture(db, { ...owner.proof, projectId, request: { formatVersion: 1, box: BOX } }, html, NOW))
      .toEqual({ status: "unavailable", detail: "format" });
  });

  it("ett jobb vars arbetare tystnat läggs tillbaka i kön, och efter två försök misslyckas det", async () => {
    const { owner, projectId } = await project();
    const { runtime } = fakeLantmateriet();
    await saveMapSourceCredential(db, { ...owner.proof, request: { formatVersion: 1, method: "BASIC", id: "a", secret: "b" } }, environment, NOW);
    const created = await createGeoJob(db, { ...owner.proof, projectId, request: { formatVersion: 1, requestId: randomUUID(), kind: "PULLAUTIN", name: "Tyst",
      tiles: [{ id: "x", href: LAZ, bbox: null, epsg: null }], settings: {} } }, runtime, NOW);
    if (created.status !== "created") throw new Error(created.status);
    // Andra testets jobb kan ligga före i kön; ta bort dem.
    await db.update(schema.mapProjectGeoJobs).set({ status: "CANCELLED" }).where(eq(schema.mapProjectGeoJobs.status, "QUEUED"));
    await db.update(schema.mapProjectGeoJobs).set({ status: "QUEUED" }).where(eq(schema.mapProjectGeoJobs.id, created.job.jobId));
    expect((await claimGeoJob(db, "geo-1", NOW))?.attempt).toBe(1);
    const later = new Date(NOW.getTime() + 11 * 60_000);
    expect((await claimGeoJob(db, "geo-2", later))?.attempt).toBe(2);
    const muchLater = new Date(NOW.getTime() + 22 * 60_000);
    expect(await claimGeoJob(db, "geo-3", muchLater)).toBeUndefined();
    const [row] = await db.select().from(schema.mapProjectGeoJobs).where(eq(schema.mapProjectGeoJobs.id, created.job.jobId));
    expect(row).toMatchObject({ status: "FAILED", error: expect.stringContaining("minnet inte räckte") as unknown });
  });
  it("K6b: en DWG-ritning blir ett jobb för geo-arbetaren, som hämtar ritningen och lämnar en DXF", async () => {
    const { owner, reader, projectId } = await project();
    const dwg = new Uint8Array(Buffer.concat([Buffer.from("AC1015"), randomBytes(64)]));
    const requestId = randomUUID();
    expect((await createDwgJob(db, { ...owner.proof, projectId, requestId: randomUUID(), fileName: "fel.dwg", file: new Uint8Array(Buffer.from("hej")) }, NOW)).status)
      .toBe("unsupported-file");
    expect((await createDwgJob(db, { ...reader.proof, projectId, requestId: randomUUID(), fileName: "a.dwg", file: dwg }, NOW)).status).toBe("forbidden");
    const created = await createDwgJob(db, { ...owner.proof, projectId, requestId, fileName: "Baskarta.dwg", file: dwg }, NOW);
    if (created.status !== "created") throw new Error(created.status);
    expect(await createDwgJob(db, { ...owner.proof, projectId, requestId, fileName: "Baskarta.dwg", file: dwg }, NOW)).toMatchObject({ jobId: created.jobId, replayed: true });
    // Ingen annan arbetare eller ett jobb som inte pågår ger ritningen.
    expect(await readGeoJobInput(db, created.jobId, "geo-dwg")).toBeUndefined();
    let claimed = await claimGeoJob(db, "geo-dwg", NOW);
    while (claimed && claimed.jobId !== created.jobId) {
      await finishGeoJob(db, claimed.jobId, "geo-dwg", { status: "FAILED", error: "inte i det här testet" }, NOW);
      claimed = await claimGeoJob(db, "geo-dwg", NOW);
    }
    expect(claimed).toMatchObject({ jobId: created.jobId, kind: "DWG", tiles: [] });
    expect(new Uint8Array((await readGeoJobInput(db, created.jobId, "geo-dwg"))!)).toEqual(dwg);
    expect(await readGeoJobInput(db, created.jobId, "geo-annan")).toBeUndefined();
    expect((await storeGeoOutput(db, { jobId: created.jobId, worker: "geo-dwg", name: "ritning.dxf", mediaType: "application/dxf",
      file: new Uint8Array(Buffer.from("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF")) }, NOW)).status).toBe("stored");
    expect(await finishGeoJob(db, created.jobId, "geo-dwg", { status: "DONE", summary: { bytes: 30 } }, NOW)).toEqual({ status: "ok", layerId: null });
    const list = await listGeoJobs(db, { ...owner.proof, projectId }, server, NOW);
    expect(list.status === "ok" && list.list.jobs.find(job => job.jobId === created.jobId)).toMatchObject({ kind: "DWG", name: "Baskarta", status: "DONE",
      outputs: [{ name: "indata.dwg" }, { name: "ritning.dxf" }] });
    expect((await readGeoOutput(db, { ...reader.proof, projectId, jobId: created.jobId, name: "ritning.dxf" }, NOW)).status).toBe("ok");
  });
});
