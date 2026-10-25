import type { Database } from "@o-tid/database";
import { raceSessionAbsentSchema, raceSessionResponseSchema, raceSettingsRequestSchema, raceSettingsResponseSchema } from "@o-tid/contracts";
import {
  clearSessionCookies,
  adminFailure as failure,
  hasExpectedOrigin,
  hasNoRequestBody,
  privateJson as json,
  privateHeaders,
  securityPolicy,
  sessionProof
} from "./security-policy";
import { raceAdministratorServices as services, resultFailure, type RaceAdministratorAction as Action,
  type RaceAdministratorRouteContext } from "./race-administrator-route-context";
import { handleRaceDayRoute } from "./race-administrator-routes-race-day";
import { handlePreparationRoute } from "./race-administrator-routes-preparation";
import { handleResultRoute } from "./race-administrator-routes-results";
import { handleEntryRoute } from "./race-administrator-routes-entries";
import { handleVariantRoute } from "./race-administrator-routes-variants";
import { handleRelayRoute, write as idempotentWrite } from "./race-administrator-routes-relay";
import { handleSourceRoute } from "./race-administrator-routes-sources";
import { handleMapRoute } from "./race-administrator-routes-maps";
import { handlePeopleRoute } from "./race-administrator-routes-people";
import { handlePublicationRoute } from "./race-administrator-routes-publication";
import { handleRadioRoute } from "./race-administrator-routes-radio";
import { handleCompetitionRoute } from "./race-administrator-routes-competition";
import { handleRemovalRoute } from "./race-administrator-routes-removal";
import { handleCorrectionRoute } from "./race-administrator-routes-corrections";
import { handlePartyRoute } from "./race-administrator-routes-party";
import { principalAllows, raceRoleFor } from "./race-roles";
import { UUID_PATTERN as uuid } from "@o-tid/contracts";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;

/**
 * Tävlingens adminroutes. Kontrollerar adress, metod, origin och rollen (administratör eller funktionär,
 * `race-roles.ts`) innan åtgärden lämnas till sin grupp. Förfrågan bär kontots session (ADR-0173 beslut 4);
 * här finns läsning av rollen och utloggning.
 */
export async function raceAdministratorRoute(db: Database, request: Request, raceId: string, action: Action,
  overrides: Partial<typeof services> = services, environment: Environment = process.env): Promise<Response> {
  const dependencies = { ...services, ...overrides };
  const url = new URL(request.url);
  const before = url.searchParams.get("beforeVersion");
  const beforeVersion = before === null ? undefined : Number(before);
  const validHistoryQuery = action.kind === "changes" &&
    [...url.searchParams.keys()].every(key => key === "beforeVersion") &&
    url.searchParams.getAll("beforeVersion").length <= 1 &&
    (before === null || (/^[1-9]\d{0,9}$/.test(before) && Number.isSafeInteger(beforeVersion) && beforeVersion! <= 2_147_483_647));
  const cursor = url.searchParams.get("cursor");
  const validCheckinQuery = action.kind === "checkin-history" &&
    [...url.searchParams.keys()].every(key => key === "cursor") && url.searchParams.getAll("cursor").length <= 1 &&
    (cursor === null || /^[A-Za-z0-9_-]{1,1024}$/.test(cursor));
  if (!uuid.test(raceId) || ("entryId" in action && !uuid.test(action.entryId)) ||
    ("finalizationId" in action && !uuid.test(action.finalizationId)) ||
    ("classId" in action && !uuid.test(action.classId)) ||
    ("courseId" in action && !uuid.test(action.courseId)) || (url.search && !validHistoryQuery && !validCheckinQuery)) {
    return failure(400, "INVALID_REQUEST");
  }
  const allowed = allowedMethods(action);
  if (!allowed.includes(request.method)) return new Response(null, { status: 405,
    headers: { ...privateHeaders, allow: allowed.join(", ") } });
  let policy;
  try { policy = securityPolicy(environment); } catch { return failure(500, "INTERNAL_ERROR"); }
  const write = request.method !== "GET";
  if (write && !hasExpectedOrigin(request, policy)) return failure(403, "FORBIDDEN");
  const proof = sessionProof(request, policy, write);
  try {
    if (action.kind === "session" && request.method === "DELETE") {
      if (!await hasNoRequestBody(request).catch(() => false)) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.logout(db, proof);
      if (result.status === "unauthorized") return clearSessionCookies(resultFailure(result.status), policy);
      if (result.status !== "logged-out" && result.status !== "already-logged-out") return resultFailure(result.status);
      return clearSessionCookies(new Response(null, { status: 204, headers: privateHeaders }), policy);
    }
    // Rollen kontrolleras innan en ändring tolkas eller deltagardata läses. Funktionären får 403 för allt annat.
    const role = raceRoleFor(action.kind, request.method);
    const auth = await dependencies.authenticate(db, { ...proof, raceId, role, requireCsrf: write });
    // Frågan "har jag en session?" utan session är ett normalt svar, inte ett fel i webbläsarens konsol (PLAN.md steg 22).
    if (action.kind === "session" && auth.status === "unauthorized") {
      return json(raceSessionAbsentSchema.parse({ formatVersion: 1, raceId, authenticated: false }));
    }
    if (auth.status !== "authenticated") return resultFailure(auth.status);
    if (!principalAllows(auth.principal, raceId, role)) return failure(403, "FORBIDDEN");
    if (action.kind === "session") return json(raceSessionResponseSchema.parse({
      formatVersion: 1, raceId, role: auth.principal.role, expiresAt: auth.principal.expiresAt }));
    const context: RaceAdministratorRouteContext = { db, request, raceId, action, dependencies, proof, cursor, beforeVersion };
    return await handleRaceDayRoute(context) ?? await handlePreparationRoute(context) ?? await handleResultRoute(context) ??
      await handleEntryRoute(context) ?? await handleVariantRoute(context) ?? await handleRelayRoute(context) ?? await handleSourceRoute(context) ??
      await handleMapRoute(context) ?? await handlePeopleRoute(context) ?? await handlePublicationRoute(context) ?? await handleRadioRoute(context) ??
      await handleCompetitionRoute(context) ?? await handleRemovalRoute(context) ?? await handleCorrectionRoute(context) ??
      await handlePartyRoute(context) ??
      (action.kind === "race-settings"
        ? await idempotentWrite(context, "race-settings", raceSettingsRequestSchema, raceSettingsResponseSchema, dependencies.raceSettings) : undefined) ??
      failure(500, "INTERNAL_ERROR");
  } catch { return failure(500, "INTERNAL_ERROR"); }
}

function allowedMethods(action: Action): string[] {
  return action.kind === "people" ? ["GET", "POST", "DELETE"] : action.kind === "uninterpreted-readouts" ? ["GET", "POST"] :
    action.kind === "uninterpreted-readouts-reread" ? ["POST"] : action.kind === "party" ? ["GET", "POST"] : action.kind === "party-logo" ? ["PUT", "DELETE"] :
    action.kind === "party-guests" || action.kind === "party-desk-events" ? ["POST"] : action.kind === "radio" ? ["GET", "PUT"] :
    action.kind === "radio-fetch" ? ["POST"] : action.kind === "race-publication" ? ["PUT", "DELETE"] : action.kind === "race-map" ? ["GET", "PUT", "DELETE"] :
    action.kind === "race-map-image" ? ["GET"] : action.kind === "race-map-georeference" ? ["POST"] :
    action.kind === "participant-route" ? ["POST", "DELETE"] : action.kind === "eventor" ? ["GET", "PUT", "DELETE"] :
    action.kind === "runner-database" ? ["GET", "POST", "DELETE"] : action.kind === "runner-search" ? ["POST"] :
    action.kind === "source-sync" ? ["GET", "POST"] : action.kind === "eventor-events" ? ["GET"] :
    action.kind === "eventor-test" || action.kind === "eventor-event" || action.kind === "eventor-sync-preview" ||
    action.kind === "course-file-preview" || action.kind === "source-sync-consequence" ? ["POST"] : action.kind === "entry-status" || action.kind === "unknown-readout-resolution" || action.kind === "remaining-runners" || action.kind === "class-result-recalculation" || action.kind === "race-corrections" || action.kind === "draw" || action.kind === "results-official" || action.kind === "self-registration-cleanup" ? ["GET", "POST"] : action.kind === "review-conflicts" ? ["POST"] : action.kind === "conflict-candidate" ? ["GET"] : action.kind === "session" ? ["GET", "DELETE"] : action.kind === "checkin-history" || action.kind === "effective-result" || action.kind === "changes" ? ["GET"] :
    action.kind === "start-correction" || action.kind === "manual-return-withdrawal" || action.kind === "manual-return" || action.kind === "publication" || action.kind === "draw-preview" || action.kind === "finalize" || action.kind === "recalculate" || action.kind === "registration" || action.kind === "registration-candidates" ||
    action.kind === "manual-course-class" || action.kind === "manual-class" ||
    action.kind === "course-edit-preview" || action.kind === "course-edit" ||
    action.kind === "class-edit-preview" || action.kind === "class-edit" ||
    action.kind === "rogaining-preview" || action.kind === "rogaining" ||
    action.kind === "entry-variant-preview" || action.kind === "entry-variant" || action.kind === "class-variant-distribution" ||
    action.kind === "relay-class" || action.kind === "relay-team" || action.kind === "relay-leg-runner" ||
    action.kind === "relay-start-times" || action.kind === "relay-class-edit" || action.kind === "relay-team-edit" ||
    action.kind === "relay-team-removal" || action.kind === "relay-team-dns" || action.kind === "relay-leg-variant" ||
    action.kind === "race-settings" || action.kind === "readout-registrations" ||
    action.kind === "course-details" || action.kind === "entry-removal" || action.kind === "class-removal" ||
    action.kind === "course-removal" || action.kind === "race-corrections-preview" ||
    action.kind === "readout-reread" || action.kind === "readout-reread-preview" ? ["POST"] :
    "entryId" in action || action.kind === "capacity" ? ["PATCH"] : ["GET"];
}
