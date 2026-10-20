import { raceCorrectionCommitResponseSchema, raceCorrectionListResponseSchema, raceCorrectionPreviewResponseSchema } from "@o-tid/contracts";
import { adminFailure as failure, privateJson as json, readJsonBody } from "./security-policy";
import { resultFailure, type RaceAdministratorRouteContext } from "./race-administrator-route-context";

/**
 * PLAN.md steg 31: rättningar för hela tävlingen (tidsjustering per station, kontroll ur funktion, flytta starttider,
 * räkna om hela tävlingen). Bara administratören (`race-roles.ts`). Ger undefined för åtgärder som inte hör till gruppen.
 */
export async function handleCorrectionRoute(context: RaceAdministratorRouteContext): Promise<Response | undefined> {
  const { db, request, raceId, action, dependencies, proof } = context;
  if (action.kind !== "race-corrections" && action.kind !== "race-corrections-preview") return undefined;
  if (action.kind === "race-corrections" && request.method === "GET") {
    const result = await dependencies.raceCorrections(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = raceCorrectionListResponseSchema.parse(result.response);
    return response.raceId === raceId ? json(response) : failure(500, "INTERNAL_ERROR");
  }
  let body: unknown;
  try { body = await readJsonBody(request); } catch { return failure(400, "INVALID_REQUEST"); }
  if (action.kind === "race-corrections-preview") {
    const result = await dependencies.raceCorrectionPreview(db, { ...proof, raceId, request: body });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = raceCorrectionPreviewResponseSchema.parse(result.response);
    return response.raceId === raceId ? json(response) : failure(500, "INTERNAL_ERROR");
  }
  const result = await dependencies.raceCorrectionApply(db, { ...proof, raceId, request: body });
  if (result.status !== "applied") return resultFailure(result.status);
  const response = raceCorrectionCommitResponseSchema.parse(result.response);
  return response.raceId === raceId ? json(response) : failure(500, "INTERNAL_ERROR");
}
