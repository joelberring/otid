import { partyDeskEventResponseSchema, partyStateResponseSchema } from "@o-tid/contracts";
import { RequestBodyError, adminFailure as failure, hasNoRequestBody, privateJson as json, privateHeaders, readBoundedBytes, readJsonBody,
  validDeclaredLength } from "./security-policy";
import { resultFailure, type RaceAdministratorRouteContext } from "./race-administrator-route-context";

/**
 * Fest med bardisk (PLAN.md steg 40). GET `party` läser läget (funktionär räcker), POST `party` är admins ändringar
 * (varor, start, ångra), POST `party-guests` sätter namn på en bricka och POST `party-desk-events` är bardiskens in- och
 * utcheckning (funktionär räcker, `race-roles.ts`). Ger undefined för åtgärder som inte hör till gruppen.
 */
const LOGO_MAX_BYTES = 1_048_576;

export async function handlePartyRoute(context: RaceAdministratorRouteContext): Promise<Response | undefined> {
  const { db, request, raceId, action, dependencies, proof } = context;
  const input = { ...proof, raceId };
  if (action.kind === "party-logo") {
    // Loggan (admin): PUT med bilden (PNG eller JPEG, högst 1 MB; typen prövas mot innehållet i tjänsten), DELETE tar bort.
    if (request.method === "DELETE") {
      if (!await hasNoRequestBody(request)) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.partyLogo(db, { ...input, image: null });
      return result.status === "ok" ? new Response(null, { status: 204, headers: privateHeaders }) : resultFailure(result.status);
    }
    if (!["image/png", "image/jpeg"].includes(request.headers.get("content-type") ?? "") || !validDeclaredLength(request, LOGO_MAX_BYTES)) {
      return failure(400, "INVALID_REQUEST");
    }
    let image: Uint8Array;
    try { image = await readBoundedBytes(request, LOGO_MAX_BYTES); }
    catch (error) { if (error instanceof RequestBodyError) return failure(400, "INVALID_REQUEST"); throw error; }
    const result = await dependencies.partyLogo(db, { ...input, image });
    return result.status === "ok" ? new Response(null, { status: 204, headers: privateHeaders }) : resultFailure(result.status);
  }
  if (action.kind !== "party" && action.kind !== "party-guests" && action.kind !== "party-desk-events") return undefined;
  if (action.kind === "party" && request.method === "GET") {
    const result = await dependencies.party(db, input);
    if (result.status !== "ok") return resultFailure(result.status);
    return json(partyStateResponseSchema.parse(result.response));
  }
  let body: unknown;
  try { body = await readJsonBody(request); } catch { return failure(400, "INVALID_REQUEST"); }
  if (action.kind === "party") {
    const result = await dependencies.partyChange(db, { ...input, request: body });
    if (result.status !== "ok") return resultFailure(result.status);
    return json(partyStateResponseSchema.parse(result.response));
  }
  if (action.kind === "party-guests") {
    const result = await dependencies.partyGuest(db, { ...input, request: body });
    if (result.status !== "ok") return resultFailure(result.status);
    return new Response(null, { status: 204, headers: privateHeaders });
  }
  const result = await dependencies.partyDeskEvent(db, { ...input, request: body });
  if (result.status !== "ok") return resultFailure(result.status);
  return json(partyDeskEventResponseSchema.parse(result.response));
}
