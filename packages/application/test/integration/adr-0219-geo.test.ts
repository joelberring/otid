import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { eq } from "drizzle-orm";
import { createMapProjectFromUpload, inviteMapProjectMember, readMapProject } from "../../src/map-projects";
import { lantmaterietRuntimeFromEnvironment } from "../../src/map-project-lantmateriet";
import { laserCollectionOf, laserRuntimeFromEnvironment, searchMapProjectLaser } from "../../src/map-project-laser";
import {
  authenticateGeoWorker, claimGeoJob, createGeoJob, finishGeoJob, geoTilesPerMonth, heartbeatGeoJob, listGeoJobs, openGeoJobLaser, readGeoOutput,
  removeGeoJob, storeGeoOutput
} from "../../src/map-project-geo-jobs";
import { listMapProjectLayers } from "../../src/map-project-layers";
import { fetchMapProjectMoisture, moistureRequestBox } from "../../src/map-project-moisture";
import { saveMapSourceCredential } from "../../src/map-source-credentials";
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
    const request = () => ({ formatVersion: 1, requestId: randomUUID(), kind: "PULLAUTIN", name: "Laser norr", tiles: [tile], settings: { contour_interval: 2.5 } });
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
    const created = await createGeoJob(db, { ...owner.proof, projectId, request: request() }, runtime, NOW);
    if (created.status !== "created") throw new Error(created.status);
    expect(created.job).toMatchObject({ name: "Laser norr", status: "QUEUED", tiles: 1, settings: { contour_interval: 2.5 } });

    // Kvoten: en tom variabel (compose) ger förvalet.
    expect([geoTilesPerMonth({ OTID_GEO_TILES_PER_MONTH: "" }), geoTilesPerMonth({}), geoTilesPerMonth({ OTID_GEO_TILES_PER_MONTH: "0" })]).toEqual([200, 200, 0]);
    // Geo-arbetarens nyckel.
    const token = "t".repeat(40);
    expect(await authenticateGeoWorker(db, `Bearer ${token}`, "geo-1", { OTID_GEO_WORKER_TOKEN: token })).toBe("geo-1");
    expect(await authenticateGeoWorker(db, `Bearer ${token}`, "../x", { OTID_GEO_WORKER_TOKEN: token })).toBeUndefined();
    expect(await authenticateGeoWorker(db, `Bearer ${"u".repeat(40)}`, "geo-1", { OTID_GEO_WORKER_TOKEN: token })).toBeUndefined();
    expect(await authenticateGeoWorker(db, `Bearer ${token}`, "geo-1", {})).toBeUndefined();

    const claimed = await claimGeoJob(db, "geo-1", NOW);
    expect(claimed).toMatchObject({ jobId: created.job.jobId, tiles: [{ index: 0, id: tile.id, epsg: 3006 }], settings: { contour_interval: 2.5 } });
    expect(JSON.stringify(claimed)).not.toContain("lantmateriet.se");
    expect(await claimGeoJob(db, "geo-2", NOW)).toBeUndefined();
    expect(await heartbeatGeoJob(db, created.job.jobId, "geo-1", { step: "Hämtar laserdata", done: 0, total: 1 }, NOW)).toBe("running");
    expect(await heartbeatGeoJob(db, created.job.jobId, "geo-2", {}, NOW)).toBe("stop");
    const laser = await openGeoJobLaser(db, created.job.jobId, "geo-1", 0, runtime);
    if (laser.status !== "ok") throw new Error(laser.status);
    expect(new Uint8Array(await laser.response.arrayBuffer())).toEqual(new Uint8Array([76, 65, 83, 70, 1, 2, 3]));
    expect((await openGeoJobLaser(db, created.job.jobId, "geo-2", 0, runtime)).status).toBe("not-found");
    expect((await openGeoJobLaser(db, created.job.jobId, "geo-1", 5, runtime)).status).toBe("not-found");
    expect((await listGeoJobs(db, { ...reader.proof, projectId }, server, NOW))).toMatchObject({ status: "ok",
      list: { jobs: [{ status: "RUNNING", progress: { step: "Hämtar laserdata", done: 0, total: 1 }, own: false }] } });

    const world = "0.5\n0\n0\n-0.5\n675000.25\n6580499.75\n";
    for (const [name, mediaType, file] of [["karta.png", "image/png", png(1000, 1000)], ["karta.pgw", "text/plain", new TextEncoder().encode(world)],
      ["kurvor.dxf", "application/dxf", new TextEncoder().encode("0\nEOF\n")]] as const) {
      expect(await storeGeoOutput(db, { jobId: created.job.jobId, worker: "geo-1", name, mediaType, file }, NOW)).toEqual({ status: "stored" });
    }
    expect((await storeGeoOutput(db, { jobId: created.job.jobId, worker: "geo-1", name: "../etc", mediaType: "text/plain", file: new Uint8Array([1]) }, NOW)).status)
      .toBe("invalid-request");
    const finished = await finishGeoJob(db, created.job.jobId, "geo-1", { status: "DONE", summary: { tiles: 1 } }, NOW);
    if (finished.status !== "ok" || !finished.layerId) throw new Error("Inget underlag");
    const layers = await listMapProjectLayers(db, { ...reader.proof, projectId }, NOW);
    expect(layers).toMatchObject({ status: "ok", list: { layers: [{ layerId: finished.layerId, name: "Laser norr", crs: 3006, width: 1000, height: 1000,
      transform: { a: 0.5, b: 0, c: 675000.25, d: 0, e: -0.5, f: 6580499.75 } }] } });
    const listed = await listGeoJobs(db, { ...reader.proof, projectId }, server, NOW);
    expect(listed).toMatchObject({ status: "ok", list: { jobs: [{ status: "DONE", layerId: finished.layerId, progress: null,
      outputs: [{ name: "karta.pgw" }, { name: "karta.png" }, { name: "kurvor.dxf", mediaType: "application/dxf" }] }] } });
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
    expect((await listMapProjectLayers(db, { ...owner.proof, projectId }, NOW))).toMatchObject({ list: { layers: [{ layerId: finished.layerId }] } });
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
    expect(row).toMatchObject({ status: "FAILED", error: "Geo-arbetaren slutade svara" });
  });
});
