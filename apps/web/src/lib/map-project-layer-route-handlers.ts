import {
  createMapProjectLayer, deleteMapProjectLayer, discardStagedMapContent, listMapProjectLayers, readMapProjectLayerImage, stageMapContent,
  streamMapContentParts, updateMapProjectLayer
} from "@o-tid/application";
import { MAP_PROJECT_LAYER_MAX_BYTES, UUID_PATTERN } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { contentPartStream, failure, guarded, headerText, mutation, privateContentCacheHeaders, problem, readProof, requireStreamSession, streamChunks, type ClubEnvironment } from "./club-route-handlers";
import { matchesIfNoneMatch } from "./http-etag";
import { privateJson, validDeclaredLength } from "./security-policy";

/**
 * ADR-0219 tillägget om underlagen (K4a): projektets egna underlag under /api/organizer/map-projects/[projectId]/layers. Samma
 * skydd som projektets övriga anrop. Bilden strömmas in (som projektets kartfil) och ut (oföränderlig per sha256).
 */
type Environment = ClubEnvironment;
const validId = (id: string) => UUID_PATTERN.test(id);

/** `x-otid-layer` är procentkodad JSON med `crs` och `transform` (PLAN.md steg M4: `x-otid-recipe` med receptet, samma form). */
function layerHeader(request: Request, name = "x-otid-layer", max = 2000): unknown {
  const raw = headerText(request, name, max);
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
  const recipe = layerHeader(request, "x-otid-recipe", 4000), replaces = headerText(request, "x-otid-replaces", 64);
  const metadata = { formatVersion: 1, requestId: headerText(request, "x-otid-request-id", 64) ?? "", name: headerText(request, "x-otid-name", 80) ?? "",
    crs: layer?.crs, transform: layer?.transform, ...(recipe !== undefined ? { recipe } : {}), ...(replaces ? { replaces } : {}) };
  const unauthenticated = await requireStreamSession(db, input.proof);
  if (unauthenticated) return unauthenticated;
  const body = request.body;
  return guarded(async () => {
    const staged = await stageMapContent(db, streamChunks(body), { maxBytes: MAP_PROJECT_LAYER_MAX_BYTES });
    if (staged.kind === "too-large") return problem("MAP_FILE_TOO_LARGE");
    if (staged.kind === "empty") return failure("invalid-request");
    let result: Awaited<ReturnType<typeof createMapProjectLayer>>;
    // Granskningen runda 2 (A): den strömmade filen tas bort efter transaktionen, också när innehållet sparades.
    try { result = await createMapProjectLayer(db, { ...input.proof, projectId, metadata, file: staged }); }
    finally { await discardStagedMapContent(db, staged.contentId); }
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
    const cache = {
      ...privateContentCacheHeaders(request, head.sha256),
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox"
    };
    if (matchesIfNoneMatch(request.headers.get("if-none-match"), `"${head.sha256}"`)) {
      return new Response(null, { status: 304, headers: cache });
    }
    const stream = contentPartStream(streamMapContentParts(db, head.contentId), "map-project", "layer");
    return new Response(stream, { headers: { ...cache, "content-type": head.mediaType, "content-length": String(head.byteLength) } });
  });
}
