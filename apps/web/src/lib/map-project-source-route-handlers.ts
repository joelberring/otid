import {
  clearCutRuntimeFromEnvironment, deleteMapSourceCredential, fetchMapProjectClearCuts, fetchMapProjectOsm, fetchMapProjectSoil, soilRuntimeFromEnvironment, type SoilRuntime, type ClearCutRuntime, lantmaterietRuntimeFromEnvironment, mapSourceRuntimeFromEnvironment, readMapProjectOrthoAsset,
  readMapSourceCredential, saveMapSourceCredential, searchMapProjectOrtho, type LantmaterietRuntime, type MapSourceRuntime
} from "@o-tid/application";
import { UUID_PATTERN } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { failure, guarded, mutation, problem, readProof, type ClubEnvironment } from "./club-route-handlers";
import { privateHeaders, privateJson } from "./security-policy";

/**
 * ADR-0219 tillägget om hämtningen (K4c): POST /api/organizer/map-projects/[projectId]/sources/osm hämtar OpenStreetMap för en
 * ruta och svarar med lager och objekt som en vektorfil. Samma skydd som projektets övriga skrivningar.
 */
export async function mapProjectOsmRoute(db: Database, request: Request, projectId: string, environment: ClubEnvironment = process.env,
  runtime: MapSourceRuntime = mapSourceRuntimeFromEnvironment(process.env)): Promise<Response> {
  if (!UUID_PATTERN.test(projectId)) return failure("not-found");
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await fetchMapProjectOsm(db, { ...input.proof, projectId, request: input.body }, runtime);
    if (result.status === "ok") return privateJson({ formatVersion: 1, source: "OSM", attribution: result.attribution, data: result.data });
    if (result.status === "too-large") return problem("SOURCE_AREA_TOO_LARGE");
    if (result.status === "throttled") return problem("SOURCE_THROTTLED");
    if (result.status === "unavailable") return privateJson({ formatVersion: 1, error: "SOURCE_UNAVAILABLE", detail: result.detail }, 502);
    return failure(result.status);
  });
}

/** Ägaren 2026-11-11: POST …/sources/avverkningar, Skogsstyrelsens utförda avverkningar för en ruta (samma skydd som OSM). */
export async function mapProjectClearCutsRoute(db: Database, request: Request, projectId: string, environment: ClubEnvironment = process.env,
  runtime: ClearCutRuntime = clearCutRuntimeFromEnvironment(process.env)): Promise<Response> {
  if (!UUID_PATTERN.test(projectId)) return failure("not-found");
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await fetchMapProjectClearCuts(db, { ...input.proof, projectId, request: input.body }, runtime);
    if (result.status === "ok") return privateJson({ formatVersion: 1, crs: 3006, cuts: result.cuts, attribution: result.attribution });
    if (result.status === "too-large") return problem("SOURCE_AREA_TOO_LARGE");
    if (result.status === "throttled") return problem("SOURCE_THROTTLED");
    if (result.status === "unavailable") return privateJson({ formatVersion: 1, error: "SOURCE_UNAVAILABLE", detail: result.detail }, 502);
    return failure(result.status);
  });
}

/** Ägaren 2026-11-13: POST …/sources/jordarter, SGU:s jordartskarta för en ruta (samma skydd som hyggena). */
export async function mapProjectSoilRoute(db: Database, request: Request, projectId: string, environment: ClubEnvironment = process.env,
  runtime: SoilRuntime = soilRuntimeFromEnvironment(process.env)): Promise<Response> {
  if (!UUID_PATTERN.test(projectId)) return failure("not-found");
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await fetchMapProjectSoil(db, { ...input.proof, projectId, request: input.body }, runtime);
    if (result.status === "ok") return privateJson({ formatVersion: 1, crs: 3006, areas: result.areas, attribution: result.attribution });
    if (result.status === "too-large") return problem("SOURCE_AREA_TOO_LARGE");
    if (result.status === "throttled") return problem("SOURCE_THROTTLED");
    if (result.status === "unavailable") return privateJson({ formatVersion: 1, error: "SOURCE_UNAVAILABLE", detail: result.detail }, 502);
    return failure(result.status);
  });
}

/** Ett fel från Lantmäteriet som svar (uppgifterna nämns aldrig). */
function lantmaterietFailure(result: { status: string; detail?: string }): Response {
  if (result.status === "no-credential") return problem("SOURCE_NO_CREDENTIAL");
  if (result.status === "rejected") return problem("SOURCE_REJECTED");
  if (result.status === "too-large") return problem("SOURCE_AREA_TOO_LARGE");
  if (result.status === "throttled") return problem("SOURCE_THROTTLED");
  if (result.status === "unavailable") return privateJson({ formatVersion: 1, error: "SOURCE_UNAVAILABLE", detail: result.detail }, 502);
  return failure(result.status);
}

/** K4c: GET vad som är sparat, PUT spara kontots uppgifter till Lantmäteriet, DELETE ta bort dem (/api/account/map-sources/lantmateriet). */
export async function mapSourceCredentialRoute(db: Database, request: Request, environment: ClubEnvironment = process.env): Promise<Response> {
  if (request.method === "GET") {
    const input = await readProof(request, environment);
    if ("response" in input) return input.response;
    return guarded(async () => {
      const result = await readMapSourceCredential(db, input.proof, environment);
      return result.status === "ok" ? privateJson(result.view) : failure(result.status);
    });
  }
  const input = await mutation(request, environment, request.method === "DELETE" ? "none" : "json");
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = request.method === "DELETE" ? await deleteMapSourceCredential(db, input.proof, environment)
      : await saveMapSourceCredential(db, { ...input.proof, request: input.body }, environment);
    if (result.status === "ok") return privateJson(result.view);
    if (result.status === "not-configured") return problem("SOURCE_NOT_CONFIGURED");
    return failure(result.status);
  });
}

/** K4c: POST sök ortofoton för en ruta (/api/organizer/map-projects/[projectId]/sources/lantmateriet/search). */
export async function mapProjectOrthoSearchRoute(db: Database, request: Request, projectId: string, environment: ClubEnvironment = process.env,
  runtime: LantmaterietRuntime = lantmaterietRuntimeFromEnvironment(process.env)): Promise<Response> {
  if (!UUID_PATTERN.test(projectId)) return failure("not-found");
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await searchMapProjectOrtho(db, { ...input.proof, projectId, request: input.body }, runtime);
    return result.status === "ok" ? privateJson({ formatVersion: 1, items: result.items }) : lantmaterietFailure(result);
  });
}

/**
 * K4c: GET en del av en ortofotobild (`?href=`, Range krävs) med kontots uppgifter
 * (/api/organizer/map-projects/[projectId]/sources/lantmateriet/asset). Webbläsaren läser bilden (COG) i delar härifrån.
 */
export async function mapProjectOrthoAssetRoute(db: Database, request: Request, projectId: string, environment: ClubEnvironment = process.env,
  runtime: LantmaterietRuntime = lantmaterietRuntimeFromEnvironment(process.env)): Promise<Response> {
  if (!UUID_PATTERN.test(projectId)) return failure("not-found");
  const href = new URL(request.url).searchParams.get("href");
  if (!href || href.length > 2000) return failure("invalid-request");
  const input = await readProof(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await readMapProjectOrthoAsset(db, { ...input.proof, projectId, href, range: request.headers.get("range") }, runtime);
    if (result.status !== "ok") return lantmaterietFailure(result);
    const upstream = result.response;
    const headers = new Headers(privateHeaders);
    headers.set("content-type", "application/octet-stream");
    for (const name of ["content-range", "content-length", "accept-ranges"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  });
}
