import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GEO_WORKER_VERSION, MAP_PROJECT_SYNC_MAX_EDITS } from "@o-tid/contracts";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { projectedToWgs84 } from "@o-tid/map-file";
import { createMapJobCanvas } from "../../../../scripts/map-job-canvas";
import { createMapProjectArea } from "../../src/map-project-areas";
import { claimGeoJob, finishGeoJob, storeGeoOutput } from "../../src/map-project-geo-jobs";
import { claimMapJob, runMapJob } from "../../src/map-project-jobs";
import { lantmaterietRuntimeFromEnvironment } from "../../src/map-project-lantmateriet";
import { laserRuntimeFromEnvironment } from "../../src/map-project-laser";
import { listMapProjectProposals } from "../../src/map-project-proposals";
import { inviteMapProjectMember, readMapProject, updateMapProject } from "../../src/map-projects";
import { saveMapSourceCredential } from "../../src/map-source-credentials";
import { handleMcpMessage, type McpToolOptions } from "../../src/mcp";
import { registerTestAccount } from "./accounts";

/**
 * Ägaren 2026-11-13 (etapp 2 av «AI:n tar fram ett kartblad själv»): apply_base_map sätter ihop grundkartan ur ett klart
 * laserjobb (filerna, OpenStreetMap och hyggena) med samma kod som webbläsaren och lägger in den: som förslag i läget
 * PROPOSE, direkt i AUTONOMOUS, nekat i READ och för rollen Läsa. Går OpenStreetMap inte att hämta läggs grundkartan in ändå.
 * Samma anrop igen lägger inte in något två gånger, och ett stort blad läggs in i omgångar över flera anrop. Lantmäteriet,
 * Overpass, Skogsstyrelsen och geo-arbetaren är falska; kartjobben görs av utskriftsarbetarens kod.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_aibase_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const environment = { OTID_EVENTOR_MASTER_KEY: randomBytes(32).toString("base64"), OTID_LM_STAC_HOJD_URL: "https://api.lantmateriet.se/stac-hojd/v1" };
const LAZ = "https://dl1.lantmateriet.se/hojd/laser/skog/24A001_65775_6575_25.laz";
/** Kartans mitt (SWEREF 99 TM) och storlek i meter; kartan är 1:10 000. */
const E = 674000, N = 6575000, W = 1000, H = 800;

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_aibase_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

const lantmateriet = { ...laserRuntimeFromEnvironment(lantmaterietRuntimeFromEnvironment(environment)), vektorUrl: undefined, fetch: (async (input: string | URL) => {
  const target = String(input);
  if (target.endsWith("/collections")) return Response.json({ collections: [{ id: "laserdata-skog", title: "Laserdata skog" }] });
  if (target.endsWith("/search")) return Response.json({ features: [{ id: "ruta_2024", collection: "laserdata-skog", bbox: [18, 59.2, 18.2, 59.4],
    properties: { datetime: "2024-05-01T00:00:00Z", "proj:epsg": 5845 }, assets: { data: { href: LAZ, type: "application/vnd.laszip" } } }] });
  return new Response("nej", { status: 404 });
}) as typeof fetch };

const wgs84 = (e: number, n: number) => { const point = projectedToWgs84({ kind: "EPSG", code: 3006 }, e, n); return { lat: point.latitude, lon: point.longitude }; };
/** Overpass: en stig tvärs över kartan. Skogsstyrelsen: ett färskt hygge (avverkat efter skanningen). `osmDown` ger fel från Overpass. */
function sources(osmDown = false) {
  const calls: string[] = [];
  const fetcher = (async (input: string | URL) => {
    const target = String(input);
    calls.push(target);
    if (target.includes("overpass")) {
      return osmDown ? new Response("upptagen", { status: 504 }) : Response.json({ elements: [{ type: "way", id: 1, tags: { highway: "path" },
        geometry: [wgs84(E - 300, N - 200), wgs84(E, N - 150), wgs84(E + 300, N - 200)] }] });
    }
    // SGU:s jordartskarta: en sandyta över hela kartan.
    if (target.includes("sgu.example")) {
      const sand = [[E - W, N - H], [E + W, N - H], [E + W, N + H], [E - W, N + H], [E - W, N - H]];
      return Response.json({ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [sand] }, properties: { jg2: 31, jg2_tx: "Postglacial sand" } }], links: [] });
    }
    const ring = [[E + 100, N + 100], [E + 250, N + 100], [E + 250, N + 250], [E + 100, N + 250], [E + 100, N + 100]];
    return Response.json({ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] },
      properties: { Avvdatum: Date.parse("2026-03-01"), Avverktyp: "Föryngringsavverkning" } }] });
  }) as typeof fetch;
  return { calls, sources: { osm: { overpassUrl: "https://overpass.example/api", fetch: fetcher }, clearCuts: { url: "https://sks.example/MapServer/1", fetch: fetcher },
    soil: { url: "https://sgu.example/items", fetch: fetcher } } };
}

const call = (name: string, args: object = {}) => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
type Reply = { result: { isError?: boolean; content: { type: string; text: string }[] } };
const textOf = (response: unknown) => (response as Reply).result.content[0]!.text;
const jsonOf = (response: unknown) => JSON.parse(textOf(response)) as Record<string, unknown>;
const failed = (response: unknown) => (response as Reply).result.isError === true;

/** Kör MCP-anropet medan kartjobben görs (som utskriftsarbetaren). */
async function mcp(accountId: string, message: object, options: McpToolOptions = {}) {
  let done = false;
  const reply = handleMcpMessage(db, accountId, message, { pollMs: 20, timeoutMs: 30_000 }, ["kartprojekt"], { runtime: lantmateriet, ...options }).finally(() => { done = true; });
  while (!done) {
    const job = await claimMapJob(db, "test-worker");
    if (job) await runMapJob(db, job, { worker: "test-worker", createCanvas: createMapJobCanvas });
    else await new Promise(resolve => setTimeout(resolve, 20));
  }
  return reply;
}

const polyline = (layer: string, points: [number, number][], closed = false) => ["0", "LWPOLYLINE", "8", layer, "38", "40", "70", closed ? "1" : "0",
  ...points.flatMap(([x, y]) => ["10", String(x), "20", String(y)])];
const dxf = (...entities: string[][]) => ["0", "SECTION", "2", "ENTITIES", ...entities.flat(), "0", "ENDSEC", "0", "EOF", ""].join("\n");
const collection = (features: object[]) => JSON.stringify({ type: "FeatureCollection", crs: { type: "name", properties: { name: "EPSG:3006" } }, features });

/** En ny tom karta (ISOM 2017-2) genom AI-kopplingen, med ägaren och en läsare. */
async function project() {
  const owner = await registerTestAccount(db);
  await saveMapSourceCredential(db, { ...owner.proof, request: { formatVersion: 1, method: "BASIC", id: "geotorget-anna", secret: "hemligt" } }, environment);
  const made = jsonOf(await mcp(owner.accountId, call("create_map_project", { name: "Provblad", center_e: E, center_n: N, width_m: W, height_m: H })));
  const projectId = made.projectId as string;
  const reader = await registerTestAccount(db);
  await inviteMapProjectMember(db, { ...owner.proof, projectId, request: { formatVersion: 1, requestId: randomUUID(), email: reader.email, role: "READ" } });
  await readMapProject(db, { ...reader.proof, projectId });
  return { owner, reader, projectId };
}

/** Ett klart laserjobb (för hela kartan eller en etapp) med geo-arbetarens filer. */
async function laserJob(accountId: string, projectId: string, files: Record<string, string>, areaId?: string) {
  await db.update(schema.mapProjectGeoJobs).set({ status: "CANCELLED" }).where(eq(schema.mapProjectGeoJobs.status, "QUEUED"));
  const started = jsonOf(await mcp(accountId, call("start_laser_job", { project_id: projectId, ...(areaId ? { area_id: areaId } : {}) })));
  const jobId = started.jobId as string;
  expect((await claimGeoJob(db, "geo-1"))?.jobId).toBe(jobId);
  for (const [name, body] of Object.entries(files)) {
    expect(await storeGeoOutput(db, { jobId, worker: "geo-1", name, mediaType: name.endsWith(".dxf") ? "application/dxf" : "application/geo+json",
      file: new TextEncoder().encode(body) })).toEqual({ status: "stored" });
  }
  expect((await finishGeoJob(db, jobId, "geo-1", { status: "DONE", summary: { worker: GEO_WORKER_VERSION, tiles: 1 } })).status).toBe("ok");
  return jobId;
}

/** Två kurvor (den ena går långt utanför kartan), en lång opasserbar brant och en sjö. */
const SMALL = {
  "kurvor.dxf": dxf(polyline("contour", [[E - 400, N], [E - 100, N + 60], [E + 200, N], [E + 2000, N]]), polyline("contour", [[E - 300, N - 300], [E, N - 260], [E + 300, N - 300]])),
  "brantlinjer.dxf": dxf(polyline("brant_opasserbar", [[E - 200, N + 200], [E - 170, N + 220], [E - 140, N + 230]])),
  "vatten.geojson": collection([{ type: "Feature", properties: { layer: "vatten" }, geometry: { type: "Polygon",
    coordinates: [[[E - 350, N + 250], [E - 250, N + 250], [E - 250, N + 330], [E - 350, N + 330], [E - 350, N + 250]]] } }])
};

const proposals = async (owner: { proof: object }, projectId: string) => {
  const list = await listMapProjectProposals(db, { ...(owner.proof as Parameters<typeof listMapProjectProposals>[1]), projectId });
  if (list.status !== "ok") throw new Error(list.status);
  return list.list.proposals;
};
const objectCount = async (projectId: string) => (await db.select({ key: schema.mapProjectObjects.objectKey }).from(schema.mapProjectObjects)
  .where(eq(schema.mapProjectObjects.projectId, projectId))).length;

describe("ADR-0219: AI-kopplingen lägger in grundkartan (apply_base_map)", () => {
  it("verktyget finns i listan och arbetsgången nämner det", async () => {
    const owner = await registerTestAccount(db);
    const tools = await handleMcpMessage(db, owner.accountId, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect((tools as { result: { tools: { name: string }[] } }).result.tools.map(tool => tool.name)).toContain("apply_base_map");
    const hello = await handleMcpMessage(db, owner.accountId, { jsonrpc: "2.0", id: 2, method: "initialize", params: {} });
    expect((hello as { result: { instructions: string } }).result.instructions).toContain("apply_base_map");
  });

  it("PROPOSE: grundkartan blir förslag, också utan OpenStreetMap, och läggs inte in två gånger", async () => {
    const { owner, reader, projectId } = await project();
    // Utan något klart laserjobb finns inget att lägga in.
    expect(textOf(await mcp(owner.accountId, call("apply_base_map", { project_id: projectId })))).toContain("ingen klar laserkörning");
    const jobId = await laserJob(owner.accountId, projectId, SMALL);

    // Rollen Läsa och AI-läget READ nekas innan något hämtas eller räknas.
    const down = sources(true);
    expect(failed(await mcp(reader.accountId, call("apply_base_map", { project_id: projectId }), down))).toBe(true);
    expect((await updateMapProject(db, { ...owner.proof, projectId, request: { formatVersion: 1, aiMode: "READ" } })).status).toBe("ok");
    const readOnly = await mcp(owner.accountId, call("apply_base_map", { project_id: projectId }), down);
    expect(failed(readOnly)).toBe(true);
    expect(textOf(readOnly)).toContain("bara läsa");
    expect(down.calls).toHaveLength(0);
    expect(await db.select().from(schema.mapProjectJobs).where(eq(schema.mapProjectJobs.kind, "BASE_MAP"))).toHaveLength(0);
    expect((await updateMapProject(db, { ...owner.proof, projectId, request: { formatVersion: 1, aiMode: "PROPOSE" } })).status).toBe("ok");
    // Ett okänt jobb och en nivå utan sparade kullar avvisas.
    expect(textOf(await mcp(owner.accountId, call("apply_base_map", { project_id: projectId, job_id: randomUUID() }), down))).toContain("finns inte");
    expect(textOf(await mcp(owner.accountId, call("apply_base_map", { project_id: projectId, knolls: 7 }), down))).toContain("kullar.geojson");
    expect(failed(await mcp(owner.accountId, call("apply_base_map", { project_id: projectId, cliffs: 11 }), down))).toBe(true);

    // Overpass svarar inte: grundkartan läggs in ändå och svaret säger vad som saknas. Hygget kom med.
    // Hinner sammansättningen inte klart under anropet (här: ingen arbetare) svarar verktyget att den pågår; nästa anrop tar vid.
    const waiting = await handleMcpMessage(db, owner.accountId, call("apply_base_map", { project_id: projectId }), { pollMs: 10, timeoutMs: 50 }, ["kartprojekt"],
      { runtime: lantmateriet, ...down });
    expect(jsonOf(waiting)).toMatchObject({ jobId, status: "ASSEMBLING" });
    expect(await proposals(owner, projectId)).toHaveLength(0);
    const fetched = down.calls.length;
    expect(fetched).toBeGreaterThanOrEqual(2);
    const first = await mcp(owner.accountId, call("apply_base_map", { project_id: projectId }), down);
    expect(failed(first)).toBe(false);
    expect(down.calls).toHaveLength(fetched);
    const result = jsonOf(first);
    expect(result).toMatchObject({ jobId, status: "PROPOSED", mode: "PROPOSE", parts: 1, done: 1, remaining: 0, clearCuts: { fresh: 1, scrub: 0, young: 0 } });
    expect(result.missing).toEqual([expect.stringContaining("osm")]);
    const symbols = new Map((result.symbols as { symbol: string; objects: number }[]).map(row => [row.symbol, row.objects]));
    // Två kurvor (101), ett stup (201), sjön (301) med strandlinje, hygget (403) med sin gräns (416).
    expect(symbols.get("101")).toBe(2);
    expect(symbols.get("201")).toBe(1);
    expect(symbols.get("301")).toBe(1);
    expect(symbols.get("403")).toBe(1);
    expect(symbols.get("416")).toBe(1);
    const layers = result.layers as { layer: string; features: number; symbol: string | null }[];
    expect(layers.find(layer => layer.layer === "contour")).toMatchObject({ features: 2, symbol: "101" });
    expect(layers.some(layer => layer.layer.startsWith("OSM"))).toBe(false);
    expect((result.clipped as number)).toBeGreaterThanOrEqual(1);

    // Förslagen: källan AI, öppna, lika många ändringar som objekt; kartan är orörd tills ägaren godkänner.
    const open = await proposals(owner, projectId);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ source: "AI", status: "OPEN" });
    expect(open[0]!.note).toContain("Grundkartan ur laserkörningen");
    expect(open[0]!.edits).toHaveLength(result.objects as number);
    expect(open[0]!.edits.every(edit => edit.kind === "ADD")).toBe(true);
    expect(await objectCount(projectId)).toBe(0);
    // Kurvan som gick 2 km utanför är klippt mot kartans område (kartans mm: högst halva bredden plus marginalen).
    const xs = open[0]!.edits.flatMap(edit => JSON.stringify(edit.state).match(/"x":(-?[\d.]+)/g) ?? []).map(value => Number(value.slice(4)));
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(W / 10 + 0.01);

    // Samma anrop igen: samma svar, inga nya förslag och ingen ny hämtning.
    down.calls.length = 0;
    const again = jsonOf(await mcp(owner.accountId, call("apply_base_map", { project_id: projectId, job_id: jobId }), down));
    expect(again).toMatchObject({ status: "PROPOSED", parts: 1, done: 1, remaining: 0, objects: result.objects });
    expect(await proposals(owner, projectId)).toHaveLength(1);
    expect(down.calls).toHaveLength(0);
    // När kartjobbets resultat har rensats: nekas, om inte again anges (då med OpenStreetMap, som nu svarar).
    await db.delete(schema.mapProjectJobs).where(eq(schema.mapProjectJobs.kind, "BASE_MAP"));
    const repeat = await mcp(owner.accountId, call("apply_base_map", { project_id: projectId }), sources());
    expect(failed(repeat)).toBe(true);
    expect(textOf(repeat)).toContain("redan inlagd");
    const forced = jsonOf(await mcp(owner.accountId, call("apply_base_map", { project_id: projectId, again: true }), sources()));
    expect(forced).toMatchObject({ status: "PROPOSED", missing: [] });
    expect((forced.layers as { layer: string; symbol: string | null }[]).find(layer => layer.layer.startsWith("OSM stig"))?.symbol).toMatch(/^50[5-8]/);
    expect(forced.objects).toBe((result.objects as number) + 1);
    expect(await proposals(owner, projectId)).toHaveLength(2);
  }, 120_000);

  it("AUTONOMOUS: en etapps grundkarta läggs in direkt, klippt mot etappen, i omgångar över flera anrop", async () => {
    const { owner, projectId } = await project();
    expect((await updateMapProject(db, { ...owner.proof, projectId, request: { formatVersion: 1, aiMode: "AUTONOMOUS" } })).status).toBe("ok");
    // Etappen: kartans västra halva (kartans mm ur området). Kullarna ligger i ett rutnät över hela kartan, 30 m isär.
    const view = await readMapProject(db, { ...owner.proof, projectId });
    if (view.status !== "ok" || !view.view.area) throw new Error("Kartan saknar område");
    const outline = view.view.area[0]!, minX = Math.min(...outline.map(point => point.x)), maxX = Math.max(...outline.map(point => point.x));
    const minY = Math.min(...outline.map(point => point.y)), maxY = Math.max(...outline.map(point => point.y)), midX = (minX + maxX) / 2;
    const polygon = [[{ x: minX, y: minY }, { x: midX, y: minY }, { x: midX, y: maxY }, { x: minX, y: maxY }]];
    const area = await createMapProjectArea(db, { ...owner.proof, projectId, request: { formatVersion: 1, requestId: randomUUID(), name: "Väst", polygon, assigneeAccountId: null } });
    if (area.status !== "created") throw new Error(area.status);
    const knolls: object[] = [];
    for (let x = E - W / 2 + 15; x < E + W / 2; x += 30) for (let y = N - H / 2 + 15; y < N + H / 2; y += 30) {
      knolls.push({ type: "Feature", geometry: { type: "Point", coordinates: [x, y] }, properties: { layer: "dotknoll_laser", rise: 1.2, share: 0.9, foot: 30 } });
    }
    const jobId = await laserJob(owner.accountId, projectId, { ...SMALL, "kullar.geojson": collection(knolls) }, area.area.areaId);

    // Första anropet hinner en omgång (tiden för inläggningen är satt till noll), nästa fortsätter där det slutade.
    const options = { ...sources(), budgetMs: 0 };
    const first = jsonOf(await mcp(owner.accountId, call("apply_base_map", { project_id: projectId, knolls: 5 }), options));
    expect(first).toMatchObject({ jobId, status: "APPLYING", mode: "AUTONOMOUS", done: 1, appliedNow: MAP_PROJECT_SYNC_MAX_EDITS, conflictsNow: 0, missing: [] });
    const parts = first.parts as number, objects = first.objects as number;
    expect(parts).toBeGreaterThanOrEqual(2);
    expect(first.remaining).toBe(parts - 1);
    expect(first.knolls).toMatchObject({ level: 5, candidates: knolls.length });
    expect(await objectCount(projectId)).toBe(MAP_PROJECT_SYNC_MAX_EDITS);
    let last = first;
    for (let round = 1; round < parts; round += 1) last = jsonOf(await mcp(owner.accountId, call("apply_base_map", { project_id: projectId, knolls: 5 }), options));
    expect(last).toMatchObject({ status: "APPLIED", done: parts, remaining: 0, objects });
    expect(await objectCount(projectId)).toBe(objects);
    // Ungefär hälften av kullarna (etappens halva), och inget öster om etappens gräns.
    const points = (last.symbols as { symbol: string; objects: number }[]).find(row => row.symbol === "109")!.objects;
    expect(points).toBeGreaterThan(knolls.length * 0.4);
    expect(points).toBeLessThan(knolls.length * 0.6);
    const rows = await db.select({ state: schema.mapProjectObjects.state }).from(schema.mapProjectObjects).where(eq(schema.mapProjectObjects.projectId, projectId));
    const xs = rows.flatMap(row => JSON.stringify(row.state).match(/"x":(-?[\d.]+)/g) ?? []).map(value => Number(value.slice(4)));
    expect(Math.max(...xs)).toBeLessThanOrEqual(midX + 0.01);
    // Historiken: godkända AI-förslag. Ett anrop till ändrar inget.
    const listed = await proposals(owner, projectId);
    expect(listed).toHaveLength(parts);
    expect(listed.every(proposal => proposal.source === "AI" && proposal.status === "ACCEPTED")).toBe(true);
    expect(jsonOf(await mcp(owner.accountId, call("apply_base_map", { project_id: projectId, knolls: 5 }), options))).toMatchObject({ status: "APPLIED", remaining: 0 });
    expect(await objectCount(projectId)).toBe(objects);
  }, 120_000);
});
