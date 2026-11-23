import { createMapProjectPrimarySource, listMapProjectPrimarySources, mapProjectOsmOrigin, removeMapProjectPrimarySource } from "@o-tid/application";
import { UUID_PATTERN } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { failure, guarded, mutation, readProof, type ClubEnvironment } from "./club-route-handlers";
import { privateJson } from "./security-policy";

/** Ett täckningsområde har högst 6 000 punkter. */
const PRIMARY_MAX_BYTES = 600_000;

/**
 * PLAN K4c Huvudkälla (0143): GET projektets huvudkällor (medlemmarna), POST en ny markering (föreslå eller mer). Samma skydd som
 * projektets övriga anrop.
 */
export async function mapProjectPrimarySourcesRoute(db: Database, request: Request, projectId: string, environment: ClubEnvironment = process.env)
  : Promise<Response> {
  if (!UUID_PATTERN.test(projectId)) return failure("not-found");
  if (request.method === "GET") {
    const input = await readProof(request, environment);
    if ("response" in input) return input.response;
    return guarded(async () => {
      const result = await listMapProjectPrimarySources(db, { ...input.proof, projectId });
      return result.status === "ok" ? privateJson({ formatVersion: 1, sources: result.sources }) : failure(result.status);
    });
  }
  const input = await mutation(request, environment, "json", PRIMARY_MAX_BYTES);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await createMapProjectPrimarySource(db, { ...input.proof, projectId, request: input.body });
    if (result.status === "full") return failure("conflict");
    return result.status === "created" ? privateJson({ formatVersion: 1, source: result.source }, result.replayed ? 200 : 201) : failure(result.status);
  });
}

/** DELETE markeringen (föreslå eller mer); kartans objekt påverkas inte. */
export async function mapProjectPrimarySourceRoute(db: Database, request: Request, projectId: string, sourceId: string, environment: ClubEnvironment = process.env)
  : Promise<Response> {
  if (!UUID_PATTERN.test(projectId) || !UUID_PATTERN.test(sourceId)) return failure("not-found");
  const input = await mutation(request, environment, "none");
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await removeMapProjectPrimarySource(db, { ...input.proof, projectId, sourceId });
    return result.status === "removed" ? privateJson({ formatVersion: 1, status: "removed" }) : failure(result.status);
  });
}

/** GET ursprunget för kartans orörda objekt ur inlagda utkast (för borttagningen av OpenStreetMaps objekt inom en huvudkälla). */
export async function mapProjectOsmOriginRoute(db: Database, request: Request, projectId: string, environment: ClubEnvironment = process.env): Promise<Response> {
  if (!UUID_PATTERN.test(projectId)) return failure("not-found");
  const input = await readProof(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await mapProjectOsmOrigin(db, { ...input.proof, projectId });
    return result.status === "ok" ? privateJson({ formatVersion: 1, decisions: result.decisions }) : failure(result.status);
  });
}
