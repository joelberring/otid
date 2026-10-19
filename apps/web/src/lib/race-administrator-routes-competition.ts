import { courseDetailsRequestSchema, courseDetailsResponseSchema, markRemainingDidNotStartRequestSchema,
  markRemainingDidNotStartResponseSchema, readoutRegistrationIdempotencyKeySchema, readoutRegistrationRequestSchema,
  readoutRegistrationResponseSchema, remainingRunnersResponseSchema } from "@o-tid/contracts";
import { adminFailure as failure, hasNoRequestBody, privateJson as json, readJsonBody } from "./security-policy";
import { resultFailure, type RaceAdministratorRouteContext } from "./race-administrator-route-context";
import { write } from "./race-administrator-routes-relay";

/**
 * PLAN.md steg 25: direktanmälan från avläsningssidan (funktionär), "Markera alla kvar i skogen som ej start" och
 * banans längd och stigning (administratör). Ger undefined för åtgärder som inte hör till gruppen.
 */
export async function handleCompetitionRoute(context: RaceAdministratorRouteContext): Promise<Response | undefined> {
  const { db, request, raceId, action, dependencies, proof } = context;
  if (action.kind === "readout-registrations") {
    const key = readoutRegistrationIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) return failure(400, "INVALID_REQUEST");
    let body: unknown;
    try { body = await readJsonBody(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const parsed = readoutRegistrationRequestSchema.safeParse(body);
    if (!parsed.success || key.data !== `readout-registration:${parsed.data.requestId}`) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.readoutRegistration(db, { ...proof, raceId, idempotencyKey: key.data, request: parsed.data });
    if (result.status !== "registered") return resultFailure(result.status);
    const response = readoutRegistrationResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.requestId !== parsed.data.requestId || response.cardNumber !== parsed.data.cardNumber) {
      return failure(500, "INTERNAL_ERROR");
    }
    return json(response);
  }
  if (action.kind === "remaining-runners" && request.method === "GET") {
    if (!await hasNoRequestBody(request)) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.remainingRunners(db, { ...proof, raceId });
    if (result.status !== "ok") return resultFailure(result.status);
    const response = remainingRunnersResponseSchema.parse(result.response);
    return response.raceId === raceId ? json(response) : failure(500, "INTERNAL_ERROR");
  }
  if (action.kind === "remaining-runners") {
    return write(context, "remaining-did-not-start", markRemainingDidNotStartRequestSchema, markRemainingDidNotStartResponseSchema,
      dependencies.markRemainingDidNotStart);
  }
  if (action.kind === "course-details") {
    const courseId = action.courseId;
    return write(context, "course-details", {
      safeParse: (value: unknown) => {
        const parsed = courseDetailsRequestSchema.safeParse(value);
        return parsed.success && parsed.data.courseId === courseId ? parsed : { success: false as const };
      }
    }, courseDetailsResponseSchema, dependencies.courseDetails);
  }
  return undefined;
}
