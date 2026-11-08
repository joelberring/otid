import { deleteMapLayerProfile, listMapLayerProfiles, saveMapLayerProfile } from "@o-tid/application";
import { UUID_PATTERN } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { failure, guarded, mutation, readProof, type ClubEnvironment } from "./club-route-handlers";
import { privateJson } from "./security-policy";

/**
 * ADR-0219 K6b: lagermappningsprofiler under /api/organizer/map-projects/[projectId]/layer-profiles. GET kontots och klubbens
 * profiler, POST spara (ersätter samma namn), DELETE en egen. Samma skydd som projektets övriga anrop.
 */
export async function mapLayerProfilesRoute(db: Database, request: Request, projectId: string, environment: ClubEnvironment = process.env)
  : Promise<Response> {
  if (!UUID_PATTERN.test(projectId)) return failure("not-found");
  if (request.method === "GET") {
    const input = await readProof(request, environment);
    if ("response" in input) return input.response;
    return guarded(async () => {
      const result = await listMapLayerProfiles(db, { ...input.proof, projectId });
      return result.status === "ok" ? privateJson({ formatVersion: 1, profiles: result.profiles }) : failure(result.status);
    });
  }
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await saveMapLayerProfile(db, { ...input.proof, projectId, request: input.body });
    return result.status === "saved" ? privateJson({ formatVersion: 1, profile: result.profile }, 201) : failure(result.status);
  });
}

export async function mapLayerProfileRoute(db: Database, request: Request, projectId: string, profileId: string, environment: ClubEnvironment = process.env)
  : Promise<Response> {
  if (!UUID_PATTERN.test(projectId) || !UUID_PATTERN.test(profileId)) return failure("not-found");
  const input = await mutation(request, environment, "none");
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await deleteMapLayerProfile(db, { ...input.proof, projectId, profileId });
    return result.status === "deleted" ? privateJson({ formatVersion: 1, status: "deleted" }) : failure(result.status);
  });
}
