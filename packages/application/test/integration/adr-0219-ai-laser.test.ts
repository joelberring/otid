import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GEO_CLIP_MARGIN_M, GEO_WORKER_VERSION } from "@o-tid/contracts";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { mapPointToProjected, readMapFile } from "@o-tid/map-file";
import { laserClip, objectBox } from "@o-tid/map-revision";
import { createMapJobCanvas } from "../../../../scripts/map-job-canvas";
import { createMapProjectArea } from "../../src/map-project-areas";
import { claimGeoJob, finishGeoJob, storeGeoOutput } from "../../src/map-project-geo-jobs";
import { claimMapJob, runMapJob } from "../../src/map-project-jobs";
import { lantmaterietRuntimeFromEnvironment } from "../../src/map-project-lantmateriet";
import { laserRuntimeFromEnvironment } from "../../src/map-project-laser";
import { createMapProjectFromUpload, inviteMapProjectMember, readMapProject, updateMapProject } from "../../src/map-projects";
import { saveMapSourceCredential } from "../../src/map-source-credentials";
import { handleMcpMessage } from "../../src/mcp";
import { registerTestAccount } from "./accounts";

/**
 * Ägaren 2026-11-13 (etapp 1 av «AI:n tar fram ett kartblad själv»): AI-kopplingens laserverktyg. start_laser_job lägger samma
 * jobb som laserpanelen (sökrutan, klipprutan, förvalen) med kontots uppgifter, inte i AI-läget READ och inte för rollen Läsa;
 * list_laser_jobs visar läget, arbetarens version och filerna; read_laser_output ger en vektorfil i kartans mm med
 * egenskaper, utsnitt och sidindelning. Lantmäteriet och geo-arbetaren är falska; kartjobben görs av utskriftsarbetarens kod.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_ailaser_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const mapBytes = new Uint8Array(await readFile(new URL("../../../../fixtures/maps/kartfil.omap", import.meta.url)));
const parsed = readMapFile(mapBytes, "kartfil.omap");
const georeference = parsed.georeference!;
const boxes = parsed.objects.map(objectBox).filter(box => Number.isFinite(box.minX));
const bounds = { minX: Math.min(...boxes.map(box => box.minX)), minY: Math.min(...boxes.map(box => box.minY)),
  maxX: Math.max(...boxes.map(box => box.maxX)), maxY: Math.max(...boxes.map(box => box.maxY)) };
const environment = { OTID_EVENTOR_MASTER_KEY: randomBytes(32).toString("base64"), OTID_LM_STAC_HOJD_URL: "https://api.lantmateriet.se/stac-hojd/v1" };
const LAZ = "https://dl1.lantmateriet.se/hojd/laser/skog/24A001_65775_6575_25.laz";

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_ailaser_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

/** Lantmäteriet: samma ruta från två år (den nyaste ska väljas) och en ruta på en främmande adress (ska väljas bort). */
function fakeLantmateriet() {
  const calls: { url: string; body: string | null }[] = [];
  const fetcher = (async (input: string | URL, init: RequestInit = {}) => {
    const target = String(input);
    calls.push({ url: target, body: typeof init.body === "string" ? init.body : null });
    if (target.endsWith("/collections")) return Response.json({ collections: [{ id: "laserdata-skog", title: "Laserdata skog" }] });
    if (target.endsWith("/search")) return Response.json({ features: [
      { id: "ruta_2019", collection: "laserdata-skog", bbox: [18, 59.29, 18.04, 59.31], properties: { datetime: "2019-05-01T00:00:00Z", "proj:epsg": 5845 },
        assets: { data: { href: LAZ.replace("24A", "19A"), type: "application/vnd.laszip" } } },
      { id: "ruta_2024", collection: "laserdata-skog", bbox: [18, 59.29, 18.04, 59.31], properties: { datetime: "2024-05-01T00:00:00Z", "proj:epsg": 5845 },
        assets: { data: { href: LAZ, type: "application/vnd.laszip" } } },
      { id: "elak", properties: {}, assets: { data: { href: "https://elak.example/x.laz" } } }] });
    return new Response("nej", { status: 404 });
  }) as typeof fetch;
  return { calls, runtime: { ...laserRuntimeFromEnvironment(lantmaterietRuntimeFromEnvironment(environment)), vektorUrl: undefined, fetch: fetcher } };
}

async function project() {
  const owner = await registerTestAccount(db);
  const created = await createMapProjectFromUpload(db, { ...owner.proof, metadata: { formatVersion: 1, requestId: randomUUID(), name: "Laser", fileName: "Laser.omap" }, file: mapBytes });
  if (created.status !== "created") throw new Error(created.status);
  const reader = await registerTestAccount(db);
  await inviteMapProjectMember(db, { ...owner.proof, projectId: created.projectId, request: { formatVersion: 1, requestId: randomUUID(), email: reader.email, role: "READ" } });
  await readMapProject(db, { ...reader.proof, projectId: created.projectId });
  return { owner, reader, projectId: created.projectId };
}

const call = (name: string, args: object = {}) => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
type Reply = { result: { isError?: boolean; content: { type: string; text: string }[] } };
const textOf = (response: unknown) => (response as Reply).result.content[0]!.text;
const jsonOf = (response: unknown) => JSON.parse(textOf(response)) as Record<string, unknown>;
const failed = (response: unknown) => (response as Reply).result.isError === true;

/** Kör MCP-anropet medan kartjobben görs (som utskriftsarbetaren). */
async function mcp(accountId: string, message: object, runtime: ReturnType<typeof fakeLantmateriet>["runtime"]) {
  let done = false;
  const reply = handleMcpMessage(db, accountId, message, { pollMs: 20, timeoutMs: 20_000 }, ["kartprojekt"], { runtime }).finally(() => { done = true; });
  while (!done) {
    const job = await claimMapJob(db, "test-worker");
    if (job) await runMapJob(db, job, { worker: "test-worker", createCanvas: createMapJobCanvas });
    else await new Promise(resolve => setTimeout(resolve, 20));
  }
  return reply;
}

const geoJobs = () => db.select().from(schema.mapProjectGeoJobs);
/** En punkt i kartans mm som SWEREF 99 TM, som geo-arbetaren skriver den. */
const sweref = (x: number, y: number): [number, number] => { const point = mapPointToProjected(georeference, { x, y }); return [point.easting, point.northing]; };

describe("ADR-0219: AI-kopplingens laserverktyg", () => {
  it("verktygen finns i listan och arbetsgången nämner dem", async () => {
    const { owner } = await project();
    const tools = await handleMcpMessage(db, owner.accountId, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    const names = (tools as { result: { tools: { name: string }[] } }).result.tools.map(tool => tool.name);
    expect(names).toEqual(expect.arrayContaining(["list_laser_jobs", "start_laser_job", "read_laser_output"]));
    const hello = await handleMcpMessage(db, owner.accountId, { jsonrpc: "2.0", id: 2, method: "initialize", params: {} });
    expect((hello as { result: { instructions: string } }).result.instructions).toContain("start_laser_job");
  });

  it("start_laser_job lägger samma jobb som laserpanelen, med spärrarna för AI-läget, rollen, uppgifterna och antalet samtidigt", async () => {
    const { owner, reader, projectId } = await project();
    const { calls, runtime } = fakeLantmateriet();
    expect(jsonOf(await mcp(owner.accountId, call("list_laser_jobs", { project_id: projectId }), runtime))).toMatchObject({ jobs: [], areas: [] });

    // Utan sparade uppgifter till Lantmäteriet, för rollen Läsa och i AI-läget READ startas inget.
    const without = await mcp(owner.accountId, call("start_laser_job", { project_id: projectId }), runtime);
    expect(failed(without)).toBe(true);
    expect(textOf(without)).toContain("uppgifter till Lantmäteriet");
    await saveMapSourceCredential(db, { ...owner.proof, request: { formatVersion: 1, method: "BASIC", id: "geotorget-anna", secret: "hemligt" } }, environment);
    const asReader = await mcp(reader.accountId, call("start_laser_job", { project_id: projectId }), runtime);
    expect(failed(asReader)).toBe(true);
    expect((await updateMapProject(db, { ...owner.proof, projectId, request: { formatVersion: 1, aiMode: "READ" } })).status).toBe("ok");
    calls.length = 0;
    const readOnly = await mcp(owner.accountId, call("start_laser_job", { project_id: projectId }), runtime);
    expect(failed(readOnly)).toBe(true);
    expect(textOf(readOnly)).toContain("bara läsa");
    expect(calls).toHaveLength(0);
    expect(await geoJobs()).toHaveLength(0);
    // Att se jobben går också i läget READ.
    expect(failed(await mcp(owner.accountId, call("list_laser_jobs", { project_id: projectId }), runtime))).toBe(false);

    // PROPOSE (förvalet): körningen köas med den nyaste skanningen per ruta, klipprutan kring kartan och O-Tids förval.
    expect((await updateMapProject(db, { ...owner.proof, projectId, request: { formatVersion: 1, aiMode: "PROPOSE" } })).status).toBe("ok");
    const started = await mcp(owner.accountId, call("start_laser_job", { project_id: projectId, settings: { smoothing: 1.2 } }), runtime);
    expect(failed(started)).toBe(false);
    const clip = laserClip(bounds, georeference, GEO_CLIP_MARGIN_M);
    expect(jsonOf(started)).toMatchObject({ status: "QUEUED", name: "Karttapullautin hela kartan", tiles: 1, areaId: null, clip,
      settings: { contour_interval: 5, formline: 2, smoothing: 1.2 } });
    const [row] = await geoJobs();
    expect(row).toMatchObject({ accountId: owner.accountId, kind: "PULLAUTIN", status: "QUEUED" });
    expect(row!.request).toMatchObject({ tiles: [{ id: "ruta_2024", href: LAZ, epsg: 5845 }], clip, moisture: { channelHa: 1, wetMeters: 0.3, moistMeters: 0.6 },
      vegetation: { minAreaM2: 300 } });
    const search = JSON.parse(calls.find(entry => entry.url.endsWith("/search"))!.body!) as { bbox: number[] };
    expect(search.bbox[0]).toBeLessThan(search.bbox[2]!);
    expect(search.bbox[1]).toBeGreaterThan(55);

    // En okänd inställning och en okänd etapp avvisas; en etapp ger en mindre klippruta och jobbets areaId.
    expect(textOf(await mcp(owner.accountId, call("start_laser_job", { project_id: projectId, settings: { rm_rf: 1 } }), runtime))).toContain("inställning");
    expect(textOf(await mcp(owner.accountId, call("start_laser_job", { project_id: projectId, area_id: randomUUID() }), runtime))).toContain("Etappen finns inte");
    const midX = (bounds.minX + bounds.maxX) / 2, midY = (bounds.minY + bounds.maxY) / 2;
    const polygon = [[{ x: bounds.minX, y: bounds.minY }, { x: midX, y: bounds.minY }, { x: midX, y: midY }, { x: bounds.minX, y: midY }]];
    const area = await createMapProjectArea(db, { ...owner.proof, projectId, request: { formatVersion: 1, requestId: randomUUID(), name: "Sydväst", polygon, assigneeAccountId: null } });
    if (area.status !== "created") throw new Error(area.status);
    const staged = jsonOf(await mcp(owner.accountId, call("start_laser_job", { project_id: projectId, area_id: area.area.areaId, contour_interval: 2.5 }), runtime));
    expect(staged).toMatchObject({ status: "QUEUED", name: "Karttapullautin Sydväst", areaId: area.area.areaId, settings: { contour_interval: 2.5 },
      clip: laserClip(bounds, georeference, GEO_CLIP_MARGIN_M, { name: "", polygon }) });
    // Två körningar samtidigt per konto, som i webben.
    const third = await mcp(owner.accountId, call("start_laser_job", { project_id: projectId }), runtime);
    expect(failed(third)).toBe(true);
    expect(textOf(third)).toContain("två laserkörningar");
    const listed = jsonOf(await mcp(reader.accountId, call("list_laser_jobs", { project_id: projectId }), runtime));
    expect(listed).toMatchObject({ areas: [{ areaId: area.area.areaId, name: "Sydväst" }], jobs: [{ status: "QUEUED", areaId: area.area.areaId }, { status: "QUEUED", areaId: null }] });
  }, 60_000);

  it("list_laser_jobs visar ett klart jobb och read_laser_output ger filerna i kartans mm", async () => {
    const { owner, reader, projectId } = await project();
    const { runtime } = fakeLantmateriet();
    await saveMapSourceCredential(db, { ...owner.proof, request: { formatVersion: 1, method: "BASIC", id: "geotorget-anna", secret: "hemligt" } }, environment);
    // Jobben som väntar från testet innan tas ur kön, så att geo-arbetaren här får det nya.
    await db.update(schema.mapProjectGeoJobs).set({ status: "CANCELLED" });
    const started = jsonOf(await mcp(owner.accountId, call("start_laser_job", { project_id: projectId }), runtime));
    const jobId = started.jobId as string;
    expect((await claimGeoJob(db, "geo-1"))?.jobId).toBe(jobId);

    // Geo-arbetarens filer: tre kullar (SWEREF 99 TM, angivet som 5845) och en kurva med 201 punkter och en kort i DXF.
    const knolls = [{ at: [10, 20], rise: 1.4 }, { at: [30, -15], rise: 0.9 }, { at: [-40, 5], rise: 2.1 }];
    const kullar = JSON.stringify({ type: "FeatureCollection", crs: { type: "name", properties: { name: "EPSG:5845" } },
      features: knolls.map((knoll, index) => ({ type: "Feature", geometry: { type: "Point", coordinates: sweref(knoll.at[0]!, knoll.at[1]!) },
        properties: { layer: "dotknoll_laser", rise: knoll.rise, share: 0.85, foot: 40 + index, ...(index === 2 ? { wet: 1 } : {}) } })) });
    const long = Array.from({ length: 201 }, (_, index) => sweref(-50 + index * 0.5, 12));
    const polyline = (layer: string, elevation: number, points: [number, number][]) => ["0", "LWPOLYLINE", "8", layer, "38", String(elevation), "70", "0",
      ...points.flatMap(([x, y]) => ["10", String(x), "20", String(y)])];
    const kurvor = ["0", "SECTION", "2", "ENTITIES", ...polyline("contour", 35, long), ...polyline("contour_index", 40, [sweref(0, -30), sweref(5, -31)]),
      "0", "ENDSEC", "0", "EOF", ""].join("\n");
    for (const [name, mediaType, body] of [["kullar.geojson", "application/geo+json", kullar], ["kurvor.dxf", "application/dxf", kurvor],
      ["hojd.png", "image/png", "inte en vektorfil"]] as const) {
      expect(await storeGeoOutput(db, { jobId, worker: "geo-1", name, mediaType, file: new TextEncoder().encode(body) })).toEqual({ status: "stored" });
    }
    // Innan jobbet är klart finns inget att läsa.
    expect(failed(await mcp(owner.accountId, call("read_laser_output", { project_id: projectId, file: "kullar" }), runtime))).toBe(true);
    expect((await finishGeoJob(db, jobId, "geo-1", { status: "DONE", summary: { worker: GEO_WORKER_VERSION, tiles: 1 } })).status).toBe("ok");

    const listed = jsonOf(await mcp(owner.accountId, call("list_laser_jobs", { project_id: projectId }), runtime));
    expect(listed).toMatchObject({ jobs: [{ jobId, status: "DONE", workerVersion: GEO_WORKER_VERSION, areaId: null, progress: null,
      outputs: [{ name: "hojd.png" }, { name: "kullar.geojson" }, { name: "kurvor.dxf" }] }] });

    // Kullarna: kartans mm (5845 läses som 3006) med egenskaperna; rollen Läsa får läsa.
    const all = jsonOf(await mcp(reader.accountId, call("read_laser_output", { project_id: projectId, file: "kullar" }), runtime));
    expect(all).toMatchObject({ jobId, file: "kullar.geojson", crs: "EPSG:3006", total: 3, returned: 3, truncated: false, layers: [{ layer: "dotknoll_laser", count: 3 }] });
    const objects = all.objects as { layer: string; kind: string; at: [number, number]; properties: Record<string, number> }[];
    objects.forEach((object, index) => {
      expect(object).toMatchObject({ layer: "dotknoll_laser", kind: "point", properties: { rise: knolls[index]!.rise, share: 0.85, foot: 40 + index } });
      expect(object.at[0]).toBeCloseTo(knolls[index]!.at[0]!, 1);
      expect(object.at[1]).toBeCloseTo(knolls[index]!.at[1]!, 1);
    });
    expect(objects[2]!.properties.wet).toBe(1);
    // Utsnitt och sidindelning.
    const inside = jsonOf(await mcp(owner.accountId, call("read_laser_output", { project_id: projectId, file: "kullar.geojson", job_id: jobId,
      area: { min_x: 0, min_y: -20, max_x: 50, max_y: 30 } }), runtime));
    expect(inside).toMatchObject({ total: 2, returned: 2 });
    const paged = jsonOf(await mcp(owner.accountId, call("read_laser_output", { project_id: projectId, file: "kullar", limit: 1, offset: 1 }), runtime));
    expect(paged).toMatchObject({ total: 3, offset: 1, returned: 1, truncated: true, nextOffset: 2 });

    // Kurvorna ur DXF: höjden följer med, långa linjer glesas jämnt med ändpunkterna kvar, och lagren går att välja.
    const curves = jsonOf(await mcp(owner.accountId, call("read_laser_output", { project_id: projectId, file: "kurvor.dxf", max_points: 11 }), runtime));
    expect(curves).toMatchObject({ file: "kurvor.dxf", total: 2, layers: [{ layer: "contour", count: 1 }, { layer: "contour_index", count: 1 }] });
    const [first, second] = curves.objects as { layer: string; kind: string; points: [number, number][]; vertices: number; elevation: number; closed: boolean }[];
    expect(first).toMatchObject({ layer: "contour", kind: "line", vertices: 201, elevation: 35, closed: false });
    expect(first!.points).toHaveLength(11);
    expect(first!.points[0]![0]).toBeCloseTo(-50, 1);
    expect(first!.points[10]![0]).toBeCloseTo(50, 1);
    expect(first!.points[5]![1]).toBeCloseTo(12, 1);
    expect(second).toMatchObject({ layer: "contour_index", vertices: 2, elevation: 40 });
    const index = jsonOf(await mcp(owner.accountId, call("read_laser_output", { project_id: projectId, file: "kurvor", layers: ["contour_index"] }), runtime));
    expect(index).toMatchObject({ total: 1, returned: 1 });

    // Raster och okända filer, ett annat projekts jobb och ogiltiga argument avvisas.
    for (const file of ["hojd.png", "saknas.dxf"]) {
      expect(failed(await mcp(owner.accountId, call("read_laser_output", { project_id: projectId, file }), runtime))).toBe(true);
    }
    const other = await project();
    expect(failed(await mcp(other.owner.accountId, call("read_laser_output", { project_id: other.projectId, file: "kullar", job_id: jobId }), runtime))).toBe(true);
    expect(failed(await mcp(other.owner.accountId, call("read_laser_output", { project_id: projectId, file: "kullar" }), runtime))).toBe(true);
    expect(failed(await mcp(owner.accountId, call("read_laser_output", { project_id: projectId, file: "../kullar" }), runtime))).toBe(true);
  }, 60_000);
});
