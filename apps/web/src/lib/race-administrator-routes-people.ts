import { racePeopleResponseSchema, racePersonGrantResponseSchema, racePersonRevokeResponseSchema, UUID_PATTERN } from "@o-tid/contracts";
import {
  adminFailure as failure,
  hasNoRequestBody,
  privateJson as json,
  readJsonBody
} from "./security-policy";
import { invitationResendResponse, mailAvailable, routeMailer } from "./invitation-route-handlers";
import { resultFailure, type RaceAdministratorRouteContext } from "./race-administrator-route-context";

/**
 * Personer med behörighet (ADR-0172 beslut 3): GET listar ägaren, administratörer och funktionärer, POST lägger till
 * ett befintligt konto med e-post och roll, DELETE tar bort en behörighet. Bara administratörer når hit.
 * ADR-0206: POST …/people/invitations/{id} skickar inbjudan igen eller ger en länk att kopiera. Ger undefined för åtgärder
 * som inte hör till gruppen.
 */
export async function handlePeopleRoute(context: RaceAdministratorRouteContext): Promise<Response | undefined> {
  const { db, request, raceId, action, dependencies, proof } = context;
  if (action.kind === "people-invitation") {
    if (!UUID_PATTERN.test(action.invitationId)) return failure(404, "NOT_FOUND");
    let body: unknown;
    try { body = await readJsonBody(request); } catch { return failure(400, "INVALID_REQUEST"); }
    return invitationResendResponse(await dependencies.resendPersonInvitation(db, { ...proof, raceId, invitationId: action.invitationId,
      request: body }, routeMailer(context.environment, request)));
  }
  if (action.kind !== "people") return undefined;
  if (request.method === "GET") {
    if (!await hasNoRequestBody(request)) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.people(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = racePeopleResponseSchema.parse({ ...result.response, mailEnabled: mailAvailable(context.environment) });
    return response.raceId === raceId ? json(response) : failure(500, "INTERNAL_ERROR");
  }
  let body: unknown;
  try { body = await readJsonBody(request); } catch { return failure(400, "INVALID_REQUEST"); }
  const input = { ...proof, raceId, idempotencyKey: request.headers.get("idempotency-key"), readBody: async () => body };
  if (request.method === "POST") {
    // ADR-0206: inbjudan mejlas när e-post finns på servern.
    const result = await dependencies.grantPerson(db, input, new Date(), routeMailer(context.environment, request));
    if (result.status !== "granted") return resultFailure(result.status);
    return json(racePersonGrantResponseSchema.parse(result.response));
  }
  const result = await dependencies.revokePerson(db, input);
  if (result.status !== "revoked") return resultFailure(result.status);
  return json(racePersonRevokeResponseSchema.parse(result.response));
}
