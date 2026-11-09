import { authenticateGeoWorker, createDwgJob, discardStagedMapContent, readGeoJobInput, stageMapContent } from "@o-tid/application";
import { GEO_DWG_MAX_BYTES, UUID_PATTERN } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { failure, guarded, headerText, mutation, problem, streamChunks, type ClubEnvironment } from "./club-route-handlers";
import { privateHeaders, privateJson, validDeclaredLength } from "./security-policy";

/**
 * ADR-0219 K6b: DWG-ritningar till geo-arbetaren. Användaren skickar ritningen (kroppen, `application/octet-stream`;
 * förfrågans id och filnamnet i rubrikerna) och geo-arbetaren hämtar den med sin nyckel för att göra om den till DXF.
 */
export async function geoDwgJobRoute(db: Database, request: Request, projectId: string, environment: ClubEnvironment = process.env): Promise<Response> {
  if (!UUID_PATTERN.test(projectId)) return failure("not-found");
  const input = await mutation(request, environment, "stream");
  if ("response" in input) return input.response;
  if (request.headers.get("content-type") !== "application/octet-stream" || !request.body) return failure("invalid-request");
  if (!validDeclaredLength(request, GEO_DWG_MAX_BYTES)) return problem("MAP_FILE_TOO_LARGE");
  const requestId = headerText(request, "x-otid-request-id", 64) ?? "", fileName = headerText(request, "x-otid-file-name", 200) ?? "ritning.dwg";
  const body = request.body;
  return guarded(async () => {
    const staged = await stageMapContent(db, streamChunks(body), { maxBytes: GEO_DWG_MAX_BYTES });
    if (staged.kind === "too-large") return problem("MAP_FILE_TOO_LARGE");
    if (staged.kind === "empty") return failure("invalid-request");
    let result: Awaited<ReturnType<typeof createDwgJob>>;
    try { result = await createDwgJob(db, { ...input.proof, projectId, requestId, fileName, file: staged }); }
    catch (error) { await discardStagedMapContent(db, staged.contentId); throw error; }
    if (result.status !== "created" || result.replayed) await discardStagedMapContent(db, staged.contentId).catch(() => undefined);
    if (result.status === "created") return privateJson({ formatVersion: 1, jobId: result.jobId }, result.replayed ? 200 : 201);
    if (result.status === "busy") return problem("GEO_JOB_BUSY");
    if (result.status === "quota") return problem("STORAGE_QUOTA_EXCEEDED");
    if (result.status === "too-large") return problem("MAP_FILE_TOO_LARGE");
    if (result.status === "unsupported-file") return problem("UNSUPPORTED_DWG_FILE");
    return failure(result.status);
  });
}

/** GET /api/geo-worker/jobs/[jobId]/input: ritningen för ett pågående DWG-jobb (bara med geo-arbetarens nyckel). */
export async function geoWorkerInputRoute(db: Database, request: Request, jobId: string, environment: Record<string, string | undefined> = process.env)
  : Promise<Response> {
  const name = await authenticateGeoWorker(db, request.headers.get("authorization"), request.headers.get("x-otid-geo-worker"), environment);
  if (!name) return privateJson({ formatVersion: 1, error: "UNAUTHORIZED" }, 401);
  return guarded(async () => {
    const bytes = await readGeoJobInput(db, jobId, name);
    if (!bytes) return failure("not-found");
    const headers = new Headers(privateHeaders);
    headers.set("content-type", "application/octet-stream");
    headers.set("content-length", String(bytes.byteLength));
    return new Response(new Uint8Array(bytes), { status: 200, headers });
  });
}
