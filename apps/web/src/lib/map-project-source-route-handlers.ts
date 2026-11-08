import { fetchMapProjectOsm, mapSourceRuntimeFromEnvironment, type MapSourceRuntime } from "@o-tid/application";
import { UUID_PATTERN } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { failure, guarded, mutation, problem, type ClubEnvironment } from "./club-route-handlers";
import { privateJson } from "./security-policy";

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
