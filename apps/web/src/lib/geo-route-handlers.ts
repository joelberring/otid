import {
  retireGeoServer,
  authenticateGeoWorker, fetchMapProjectForestImage, fetchMapProjectMoisture, forestImageRuntimeFromEnvironment, moistureRuntimeFromEnvironment,
  type ForestImageRuntime, type MoistureRuntime, claimGeoJob, createGeoJob, discardStagedMapContent, finishGeoJob, geoServerView, heartbeatGeoJob, laserRuntimeFromEnvironment,
  lantmaterietRuntimeFromEnvironment, listGeoJobs, openGeoJobLaser, pruneGeoJobs, readGeoOutput, removeGeoJob, searchMapProjectLaser, stageMapContent, storeGeoOutput,
  type LaserRuntime
} from "@o-tid/application";
import { GEO_OUTPUT_MAX_BYTES, GEO_OUTPUT_NAME, GEO_WORKER_VERSION, UUID_PATTERN, geoJobPruneResponseSchema } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { failure, guarded, mutation, problem, readProof, streamChunks, type ClubEnvironment } from "./club-route-handlers";
import { privateHeaders, privateJson, validDeclaredLength } from "./security-policy";

/**
 * ADR-0219 K5: geo-arbetarens jobb. Användarens anrop under /api/organizer/map-projects/[projectId]/geo-jobs (samma skydd som
 * projektets övriga) och geo-arbetarens under /api/geo-worker (bara med geo-arbetarens nyckel, ingen session).
 */
const laserRuntime = (): LaserRuntime => laserRuntimeFromEnvironment(lantmaterietRuntimeFromEnvironment(process.env));

function geoFailure(result: { status: string; detail?: string }): Response {
  if (result.status === "no-credential") return problem("SOURCE_NO_CREDENTIAL");
  if (result.status === "rejected") return problem("SOURCE_REJECTED");
  if (result.status === "too-large") return problem("SOURCE_AREA_TOO_LARGE");
  if (result.status === "throttled") return problem("SOURCE_THROTTLED");
  if (result.status === "busy") return problem("GEO_JOB_BUSY");
  if (result.status === "quota") return problem("GEO_JOB_QUOTA");
  if (result.status === "unavailable") return privateJson({ formatVersion: 1, error: "SOURCE_UNAVAILABLE", detail: result.detail }, 502);
  return failure(result.status);
}

/** POST sök laserrutor för en ruta (/api/organizer/map-projects/[projectId]/sources/lantmateriet/laser). */
export async function mapProjectLaserSearchRoute(db: Database, request: Request, projectId: string, environment: ClubEnvironment = process.env,
  runtime: LaserRuntime = laserRuntime()): Promise<Response> {
  if (!UUID_PATTERN.test(projectId)) return failure("not-found");
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await searchMapProjectLaser(db, { ...input.proof, projectId, request: input.body }, runtime);
    return result.status === "ok" ? privateJson({ formatVersion: 1, collection: result.collection, items: result.items, extras: result.extras }) : geoFailure(result);
  });
}

/**
 * K5c: POST SLU:s markfuktighetskarta för en ruta (/api/organizer/map-projects/[projectId]/sources/markfuktighet). Svaret är
 * bilden (PNG); världsfilen och koordinatsystemet står i `x-otid-world` och `x-otid-crs`.
 */
export async function mapProjectMoistureRoute(db: Database, request: Request, projectId: string, environment: ClubEnvironment = process.env,
  runtime: MoistureRuntime = moistureRuntimeFromEnvironment(process.env)): Promise<Response> {
  return imageRoute(request, projectId, environment, proof => fetchMapProjectMoisture(db, { ...proof, projectId, request: proof.body }, runtime));
}

/** Ägaren 2026-11-11: Skogsstyrelsens kartbilder (hyggen, anmälningar, nyckelbiotoper, trädhöjd) för en ruta, som underlag. */
export async function mapProjectForestImageRoute(db: Database, request: Request, projectId: string, environment: ClubEnvironment = process.env,
  runtime: ForestImageRuntime = forestImageRuntimeFromEnvironment(process.env)): Promise<Response> {
  return imageRoute(request, projectId, environment, proof => fetchMapProjectForestImage(db, { ...proof, projectId, request: proof.body }, runtime));
}

async function imageRoute(request: Request, projectId: string, environment: ClubEnvironment,
  fetchImage: (proof: Parameters<typeof fetchMapProjectMoisture>[1] & { body: unknown }) => ReturnType<typeof fetchMapProjectMoisture>): Promise<Response> {
  if (!UUID_PATTERN.test(projectId)) return failure("not-found");
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await fetchImage({ ...input.proof, projectId, request: input.body, body: input.body });
    if (result.status !== "ok") return geoFailure(result);
    const headers = new Headers(privateHeaders);
    headers.set("content-type", "image/png");
    headers.set("x-otid-world", encodeURIComponent(result.world));
    headers.set("x-otid-crs", String(result.crs));
    return new Response(new Uint8Array(result.png), { status: 200, headers });
  });
}

/** GET projektets geo-jobb och geo-serverns läge, POST nytt jobb. */
export async function geoJobsRoute(db: Database, request: Request, projectId: string, environment: ClubEnvironment = process.env,
  runtime: LaserRuntime = laserRuntime()): Promise<Response> {
  if (!UUID_PATTERN.test(projectId)) return failure("not-found");
  if (request.method === "GET") {
    const input = await readProof(request, environment);
    if ("response" in input) return input.response;
    return guarded(async () => {
      const result = await listGeoJobs(db, { ...input.proof, projectId }, await geoServerView(db, environment as Record<string, string | undefined>));
      return result.status === "ok" ? privateJson(result.list) : failure(result.status);
    });
  }
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await createGeoJob(db, { ...input.proof, projectId, request: input.body }, runtime);
    // `split` säger att området var för stort för en körning och delades i etapper (ägaren 2026-11-13).
    return result.status === "created"
      ? privateJson({ formatVersion: 1, job: result.job, ...(result.split ? { split: result.split } : {}) }, result.replayed ? 200 : 201)
      : geoFailure(result);
  });
}

/** DELETE avbryt ett pågående jobb eller ta bort ett färdigt. */
export async function geoJobRoute(db: Database, request: Request, projectId: string, jobId: string, environment: ClubEnvironment = process.env)
  : Promise<Response> {
  if (!UUID_PATTERN.test(projectId) || !UUID_PATTERN.test(jobId)) return failure("not-found");
  const input = await mutation(request, environment, "none");
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await removeGeoJob(db, { ...input.proof, projectId, jobId });
    return result.status === "cancelled" || result.status === "deleted" ? privateJson({ formatVersion: 1, status: result.status }) : failure(result.status);
  });
}

/** POST "Ta bort äldre körningar" (PLAN.md steg L3): allt avslutat utom projektets senaste klara körning. */
export async function geoJobsPruneRoute(db: Database, request: Request, projectId: string, environment: ClubEnvironment = process.env): Promise<Response> {
  if (!UUID_PATTERN.test(projectId)) return failure("not-found");
  const input = await mutation(request, environment, "none");
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await pruneGeoJobs(db, { ...input.proof, projectId });
    return result.status === "pruned"
      ? privateJson(geoJobPruneResponseSchema.parse({ formatVersion: 1, removedRuns: result.removedRuns, removedLayers: result.removedLayers }))
      : failure(result.status);
  });
}

/** GET en resultatfil (kurvor m.m. som DXF, bilden, världsfilen). */
export async function geoOutputRoute(db: Database, request: Request, projectId: string, jobId: string, name: string, environment: ClubEnvironment = process.env)
  : Promise<Response> {
  if (!UUID_PATTERN.test(projectId) || !UUID_PATTERN.test(jobId) || !GEO_OUTPUT_NAME.test(name)) return failure("not-found");
  const input = await readProof(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await readGeoOutput(db, { ...input.proof, projectId, jobId, name });
    if (result.status !== "ok") return failure(result.status);
    const headers = new Headers(privateHeaders);
    headers.set("content-type", result.mediaType === "application/dxf" ? "application/dxf" : result.mediaType);
    headers.set("content-length", String(result.bytes.byteLength));
    return new Response(new Uint8Array(result.bytes), { status: 200, headers });
  });
}

// --- Geo-arbetaren ------------------------------------------------------------------------------------------------------

async function worker(db: Database, request: Request, environment: Record<string, string | undefined>): Promise<string | Response> {
  const name = await authenticateGeoWorker(db, request.headers.get("authorization"), request.headers.get("x-otid-geo-worker"), environment);
  return name ?? privateJson({ formatVersion: 1, error: "UNAUTHORIZED" }, 401);
}
async function jsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 64 * 1024) return undefined;
  try { return JSON.parse(text || "{}") as unknown; } catch { return undefined; }
}

/** POST /api/geo-worker/claim: nästa jobb, eller 204 när kön är tom. */
export async function geoWorkerClaimRoute(db: Database, request: Request, environment: Record<string, string | undefined> = process.env): Promise<Response> {
  const name = await worker(db, request, environment);
  if (typeof name !== "string") return name;
  // En äldre geo-arbetare (utan versionen, eller lägre) får inga jobb; en server som O-Tid startat raderas strax.
  const version = Number(request.headers.get("x-otid-geo-version") ?? 0);
  if (!(version >= GEO_WORKER_VERSION)) {
    return guarded(async () => {
      await retireGeoServer(db, name);
      return new Response(null, { status: 204, headers: privateHeaders });
    });
  }
  return guarded(async () => {
    const job = await claimGeoJob(db, name);
    return job ? privateJson({ formatVersion: 1, job }) : new Response(null, { status: 204, headers: privateHeaders });
  });
}

/** POST /api/geo-worker/jobs/[jobId]/heartbeat: förloppet; svaret säger om jobbet ska fortsätta. */
export async function geoWorkerHeartbeatRoute(db: Database, request: Request, jobId: string, environment: Record<string, string | undefined> = process.env)
  : Promise<Response> {
  const name = await worker(db, request, environment);
  if (typeof name !== "string") return name;
  if (!UUID_PATTERN.test(jobId)) return failure("not-found");
  return guarded(async () => privateJson({ formatVersion: 1, action: await heartbeatGeoJob(db, jobId, name, await jsonBody(request)) }));
}

/** GET /api/geo-worker/jobs/[jobId]/laser/[index]: laserfilen, hämtad med jobbkontots uppgifter (strömmad). */
export async function geoWorkerLaserRoute(db: Database, request: Request, jobId: string, index: string,
  environment: Record<string, string | undefined> = process.env, runtime: LaserRuntime = laserRuntime()): Promise<Response> {
  const name = await worker(db, request, environment);
  if (typeof name !== "string") return name;
  // «x0», «x1» … är jobbets vektorprodukter från Lantmäteriet (G8), annars laserrutans ordningstal.
  if (!UUID_PATTERN.test(jobId) || !/^x?\d{1,2}$/.test(index)) return failure("not-found");
  return guarded(async () => {
    const result = await openGeoJobLaser(db, jobId, name, Number(index.replace("x", "")), runtime, index.startsWith("x"));
    if (result.status !== "ok") return geoFailure(result);
    const headers = new Headers(privateHeaders);
    headers.set("content-type", "application/octet-stream");
    const length = result.response.headers.get("content-length");
    if (length) headers.set("content-length", length);
    return new Response(result.response.body, { status: 200, headers });
  });
}

/** PUT /api/geo-worker/jobs/[jobId]/outputs/[name]: en resultatfil (strömmad till kartinnehållet). */
export async function geoWorkerOutputRoute(db: Database, request: Request, jobId: string, fileName: string,
  environment: Record<string, string | undefined> = process.env): Promise<Response> {
  const name = await worker(db, request, environment);
  if (typeof name !== "string") return name;
  if (!UUID_PATTERN.test(jobId) || !GEO_OUTPUT_NAME.test(fileName) || !request.body) return failure("invalid-request");
  if (!validDeclaredLength(request, GEO_OUTPUT_MAX_BYTES)) return problem("MAP_FILE_TOO_LARGE");
  const mediaType = (request.headers.get("content-type") ?? "").split(";")[0]!.trim();
  const body = request.body;
  return guarded(async () => {
    const staged = await stageMapContent(db, streamChunks(body), { maxBytes: GEO_OUTPUT_MAX_BYTES });
    if (staged.kind === "too-large") return problem("MAP_FILE_TOO_LARGE");
    if (staged.kind === "empty") return failure("invalid-request");
    let result: Awaited<ReturnType<typeof storeGeoOutput>>;
    try { result = await storeGeoOutput(db, { jobId, worker: name, name: fileName, mediaType, file: staged }); }
    catch (error) { await discardStagedMapContent(db, staged.contentId); throw error; }
    if (result.status !== "stored") await discardStagedMapContent(db, staged.contentId).catch(() => undefined);
    if (result.status === "stored") return privateJson({ formatVersion: 1, status: "stored" }, 201);
    if (result.status === "quota") return problem("STORAGE_QUOTA_EXCEEDED");
    if (result.status === "too-large") return problem("MAP_FILE_TOO_LARGE");
    return failure(result.status);
  });
}

/** POST /api/geo-worker/jobs/[jobId]/finish: klart (bilden blir ett underlag) eller misslyckat med en förklaring. */
export async function geoWorkerFinishRoute(db: Database, request: Request, jobId: string, environment: Record<string, string | undefined> = process.env)
  : Promise<Response> {
  const name = await worker(db, request, environment);
  if (typeof name !== "string") return name;
  if (!UUID_PATTERN.test(jobId)) return failure("not-found");
  return guarded(async () => {
    const result = await finishGeoJob(db, jobId, name, await jsonBody(request));
    return result.status === "ok" ? privateJson({ formatVersion: 1, layerId: result.layerId }) : failure(result.status);
  });
}
