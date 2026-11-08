import {
  createMapProjectLayer, deleteMapProjectLayer, discardStagedMapContent, listMapProjectLayers, readMapProjectLayerImage, stageMapContent,
  streamMapContentParts, updateMapProjectLayer
} from "@o-tid/application";
import { MAP_PROJECT_LAYER_MAX_BYTES, UUID_PATTERN } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { failure, guarded, headerText, mutation, problem, readProof, streamChunks, type ClubEnvironment } from "./club-route-handlers";
import { privateHeaders, privateJson, validDeclaredLength } from "./security-policy";
import { logServerError } from "./server-error-log";

/**
 * ADR-0219 tillägget om underlagen (K4a): projektets egna underlag under /api/organizer/map-projects/[projectId]/layers. Samma
 * skydd som projektets övriga anrop. Bilden strömmas in (som projektets kartfil) och ut (oföränderlig per sha256).
 */
type Environment = ClubEnvironment;
const validId = (id: string) => UUID_PATTERN.test(id);

/** `x-otid-layer` är procentkodad JSON med `crs` och `transform`. */
function layerHeader(request: Request): unknown {
  const raw = headerText(request, "x-otid-layer", 2000);
  if (!raw) return undefined;
  try { return JSON.parse(raw) as unknown; } catch { return undefined; }
}

/** GET projektets underlag (alla medlemmar), POST nytt underlag (bilden som kroppen; Föreslå eller mer). */
export async function mapProjectLayersRoute(db: Database, request: Request, projectId: string, environment: Environment = process.env): Promise<Response> {
  if (!validId(projectId)) return failure("not-found");
  if (request.method === "GET") {
    const input = await readProof(request, environment);
    if ("response" in input) return input.response;
    return guarded(async () => {
      const result = await listMapProjectLayers(db, { ...input.proof, projectId });
      return result.status === "ok" ? privateJson(result.list) : failure(result.status);
    });
  }
  const input = await mutation(request, environment, "stream");
  if ("response" in input) return input.response;
  if (request.headers.get("content-type") !== "application/octet-stream" || !request.body) return failure("invalid-request");
  if (!validDeclaredLength(request, MAP_PROJECT_LAYER_MAX_BYTES)) return problem("MAP_FILE_TOO_LARGE");
  const layer = layerHeader(request) as { crs?: unknown; transform?: unknown } | undefined;
  const metadata = { formatVersion: 1, requestId: headerText(request, "x-otid-request-id", 64) ?? "", name: headerText(request, "x-otid-name", 80) ?? "",
    crs: layer?.crs, transform: layer?.transform };
  const body = request.body;
  return guarded(async () => {
    const staged = await stageMapContent(db, streamChunks(body), { maxBytes: MAP_PROJECT_LAYER_MAX_BYTES });
    if (staged.kind === "too-large") return problem("MAP_FILE_TOO_LARGE");
    if (staged.kind === "empty") return failure("invalid-request");
    let result: Awaited<ReturnType<typeof createMapProjectLayer>>;
    try { result = await createMapProjectLayer(db, { ...input.proof, projectId, metadata, file: staged }); }
    catch (error) { await discardStagedMapContent(db, staged.contentId); throw error; }
    if (result.status !== "created" || result.replayed) await discardStagedMapContent(db, staged.contentId).catch(() => undefined);
    if (result.status === "created") return privateJson({ formatVersion: 1, layer: result.layer }, result.replayed ? 200 : 201);
    if (result.status === "quota") return problem("STORAGE_QUOTA_EXCEEDED");
    if (result.status === "unsupported-file") return problem("UNSUPPORTED_IMAGE");
    if (result.status === "too-large") return problem("MAP_FILE_TOO_LARGE");
    return failure(result.status);
  });
}

/** PUT namn, genomskinlighet och ordning, DELETE ta bort (den som lade till underlaget eller ägarna). */
export async function mapProjectLayerRoute(db: Database, request: Request, projectId: string, layerId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(projectId) || !validId(layerId)) return failure("not-found");
  if (request.method === "DELETE") {
    const input = await mutation(request, environment, "none");
    if ("response" in input) return input.response;
    return guarded(async () => {
      const result = await deleteMapProjectLayer(db, { ...input.proof, projectId, layerId });
      return result.status === "deleted" ? privateJson({ formatVersion: 1, status: "deleted" }) : failure(result.status);
    });
  }
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await updateMapProjectLayer(db, { ...input.proof, projectId, layerId, request: input.body });
    return result.status === "ok" ? privateJson({ formatVersion: 1, layer: result.layer }) : failure(result.status);
  });
}

/** GET bilden (alla medlemmar), strömmad; oföränderlig per sha256 (etag). */
export async function mapProjectLayerImageRoute(db: Database, request: Request, projectId: string, layerId: string,
  environment: Environment = process.env): Promise<Response> {
  if (!validId(projectId) || !validId(layerId)) return failure("not-found");
  const input = await readProof(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const head = await readMapProjectLayerImage(db, { ...input.proof, projectId, layerId });
    if (head.status !== "ok") return failure(head.status);
    const parts = streamMapContentParts(db, head.contentId);
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await parts.next();
          if (next.done) controller.close(); else controller.enqueue(next.value);
        } catch (error) {
          logServerError("map-project", "layer", error);
          controller.error(error);
        }
      },
      async cancel() { await parts.return(undefined); }
    });
    return new Response(stream, { headers: { ...privateHeaders, "content-type": head.mediaType, "content-length": String(head.byteLength),
      etag: `"${head.sha256}"`, "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" } });
  });
}
