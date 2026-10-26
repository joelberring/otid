import { courseSecrecyResponseSchema, racePublicationResponseSchema } from "@o-tid/contracts";
import {
  adminFailure as failure,
  hasNoRequestBody,
  privateJson as json
} from "./security-policy";
import { resultFailure, type RaceAdministratorRouteContext } from "./race-administrator-route-context";

/**
 * Publicera tävlingen (ADR-0172 beslut 4): PUT publicerar, DELETE slutar publicera. Båda kan upprepas utan
 * verkan. Bara administratörer når hit. Ger undefined för åtgärder som inte hör till gruppen.
 */
export async function handlePublicationRoute(context: RaceAdministratorRouteContext): Promise<Response | undefined> {
  const { db, request, raceId, action, dependencies, proof } = context;
  if (action.kind === "course-secrecy") {
    // Steg 52 (ADR-0176): PUT = "Visa banorna publikt nu", DELETE = ångra valet.
    if (!await hasNoRequestBody(request)) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.courseSecrecy(db, { ...proof, raceId, reveal: request.method === "PUT" });
    if (result.status !== "saved") return resultFailure(result.status);
    const response = courseSecrecyResponseSchema.parse(result.response);
    return response.raceId === raceId ? json(response) : failure(500, "INTERNAL_ERROR");
  }
  if (action.kind !== "race-publication") return undefined;
  if (!await hasNoRequestBody(request)) return failure(400, "INVALID_REQUEST");
  const result = await dependencies.racePublication(db, { ...proof, raceId, published: request.method === "PUT" });
  if (result.status !== "saved") return resultFailure(result.status);
  const response = racePublicationResponseSchema.parse(result.response);
  return response.raceId === raceId ? json(response) : failure(500, "INTERNAL_ERROR");
}
