import { racePeopleResponseSchema, racePersonGrantResponseSchema, racePersonRevokeResponseSchema } from "@o-tid/contracts";
import { entryClassAdminFailure as failure, entryClassAdminJson as json, hasNoEntryClassAdminRequestBody,
  readEntryClassAdminJson } from "./entry-class-admin-security";
import { resultFailure, type RaceAdministratorRouteContext } from "./race-administrator-route-context";

/**
 * Personer med behörighet (ADR-0172 beslut 3): GET listar ägaren, administratörer och funktionärer, POST lägger till
 * ett befintligt konto med e-post och roll, DELETE tar bort en behörighet. Bara administratörer når hit.
 * Ger undefined för åtgärder som inte hör till gruppen.
 */
export async function handlePeopleRoute(context: RaceAdministratorRouteContext): Promise<Response | undefined> {
  const { db, request, raceId, action, dependencies, proof } = context;
  if (action.kind !== "people") return undefined;
  if (request.method === "GET") {
    if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.people(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = racePeopleResponseSchema.parse(result.response);
    return response.raceId === raceId ? json(response) : failure(500, "INTERNAL_ERROR");
  }
  let body: unknown;
  try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
  const input = { ...proof, raceId, idempotencyKey: request.headers.get("idempotency-key"), readBody: async () => body };
  if (request.method === "POST") {
    const result = await dependencies.grantPerson(db, input);
    if (result.status !== "granted") return resultFailure(result.status);
    return json(racePersonGrantResponseSchema.parse(result.response));
  }
  const result = await dependencies.revokePerson(db, input);
  if (result.status !== "revoked") return resultFailure(result.status);
  return json(racePersonRevokeResponseSchema.parse(result.response));
}
