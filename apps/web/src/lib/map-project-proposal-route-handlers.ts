import {
  createMapProjectArea, createMapProjectProposal, decideAllMapProjectProposals, decideMapProjectProposal, deleteMapProjectArea, listMapProjectAreas, listMapProjectProposals,
  updateMapProjectArea
} from "@o-tid/application";
import { MAP_PROJECT_AREA_MAX_BYTES, MAP_PROJECT_SYNC_MAX_BYTES, UUID_PATTERN } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { failure, guarded, mutation, readProof, type ClubEnvironment } from "./club-route-handlers";
import { privateJson } from "./security-policy";

/**
 * ADR-0219 tillägget om arbetssätt (K1): delområden och förslag under /api/organizer/map-projects/[projectId]. Samma skydd som
 * projektets övriga anrop (exakt Origin och CSRF på skrivningar, privata svar utan cache, 404 för den som inte är medlem);
 * behörigheten avgörs i tjänsterna. Arbetssättet byts med PUT på projektet (`mode`).
 */
type Environment = ClubEnvironment;
const validId = (id: string) => UUID_PATTERN.test(id);

/** GET projektets delområden, POST nytt delområde (ägarna). */
export async function mapProjectAreasRoute(db: Database, request: Request, projectId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(projectId)) return failure("not-found");
  if (request.method === "GET") {
    const input = await readProof(request, environment);
    if ("response" in input) return input.response;
    return guarded(async () => {
      const result = await listMapProjectAreas(db, { ...input.proof, projectId });
      return result.status === "ok" ? privateJson(result.list) : failure(result.status);
    });
  }
  const input = await mutation(request, environment, "json", MAP_PROJECT_AREA_MAX_BYTES);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await createMapProjectArea(db, { ...input.proof, projectId, request: input.body });
    return result.status === "created" ? privateJson({ formatVersion: 1, area: result.area }, result.replayed ? 200 : 201) : failure(result.status);
  });
}

/** PUT ändra delområdet (ägarna; den som fått området bara statusen), DELETE ta bort det (ägarna). */
export async function mapProjectAreaRoute(db: Database, request: Request, projectId: string, areaId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(projectId) || !validId(areaId)) return failure("not-found");
  if (request.method === "DELETE") {
    const input = await mutation(request, environment, "none");
    if ("response" in input) return input.response;
    return guarded(async () => {
      const result = await deleteMapProjectArea(db, { ...input.proof, projectId, areaId });
      return result.status === "removed" ? privateJson({ formatVersion: 1, status: "removed" }) : failure(result.status);
    });
  }
  const input = await mutation(request, environment, "json", MAP_PROJECT_AREA_MAX_BYTES);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await updateMapProjectArea(db, { ...input.proof, projectId, areaId, request: input.body });
    return result.status === "ok" ? privateJson({ formatVersion: 1, area: result.area }) : failure(result.status);
  });
}

/** GET förslagen (alla medlemmar), POST ett förslag med anteckning (Föreslå eller mer), PUT avgör alla öppna (ägarna). */
export async function mapProjectProposalsRoute(db: Database, request: Request, projectId: string, environment: Environment = process.env)
  : Promise<Response> {
  if (!validId(projectId)) return failure("not-found");
  if (request.method === "GET") {
    const input = await readProof(request, environment);
    if ("response" in input) return input.response;
    return guarded(async () => {
      const result = await listMapProjectProposals(db, { ...input.proof, projectId });
      return result.status === "ok" ? privateJson(result.list) : failure(result.status);
    });
  }
  if (request.method === "PUT") {
    // "Godkänn alla" / "Avvisa alla" (ägaren 2026-11-10).
    const all = await mutation(request, environment);
    if ("response" in all) return all.response;
    return guarded(async () => {
      const result = await decideAllMapProjectProposals(db, { ...all.proof, projectId, request: all.body });
      return result.status === "ok" ? privateJson({ formatVersion: 1, decided: result.decided, conflicts: result.conflicts, remaining: result.remaining,
        seq: result.seq }) : failure(result.status);
    });
  }
  const input = await mutation(request, environment, "json", MAP_PROJECT_SYNC_MAX_BYTES);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await createMapProjectProposal(db, { ...input.proof, projectId, request: input.body });
    return result.status === "created" ? privateJson({ formatVersion: 1, proposal: result.proposal }, result.replayed ? 200 : 201)
      : failure(result.status);
  });
}

/** PUT godkänn, avvisa eller dra tillbaka förslaget (`action`). */
export async function mapProjectProposalRoute(db: Database, request: Request, projectId: string, proposalId: string,
  environment: Environment = process.env): Promise<Response> {
  if (!validId(projectId) || !validId(proposalId)) return failure("not-found");
  const input = await mutation(request, environment);
  if ("response" in input) return input.response;
  return guarded(async () => {
    const result = await decideMapProjectProposal(db, { ...input.proof, projectId, proposalId, request: input.body });
    return result.status === "ok" ? privateJson({ formatVersion: 1, seq: result.seq, proposal: result.proposal }) : failure(result.status);
  });
}
