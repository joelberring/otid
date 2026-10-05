import type { Database } from "@o-tid/database";
import { raceAdministratorLoginResponseSchema, raceSettingsRequestSchema, raceSettingsResponseSchema } from "@o-tid/contracts";
import { clearEntryClassAdminCookies, entryClassAdminFailure as failure, entryClassAdminJson as json,
  entryClassAdminSecurityPolicy, entryClassAdminSessionProof, hasExpectedEntryClassAdminOrigin,
  hasNoEntryClassAdminRequestBody, privateEntryClassAdminHeaders } from "./entry-class-admin-security";
import { RACE_ADMINISTRATOR_LOOPBACK_COOKIES, RACE_ADMINISTRATOR_PRODUCTION_COOKIES } from "./race-administrator-cookies";
import { raceAdministratorServices as services, resultFailure, type RaceAdministratorAction as Action,
  type RaceAdministratorRouteContext } from "./race-administrator-route-context";
import { handleRaceDayRoute } from "./race-administrator-routes-race-day";
import { handlePreparationRoute } from "./race-administrator-routes-preparation";
import { handleResultRoute } from "./race-administrator-routes-results";
import { handleEntryRoute } from "./race-administrator-routes-entries";
import { handleVariantRoute } from "./race-administrator-routes-variants";
import { handleRelayRoute, write as idempotentWrite } from "./race-administrator-routes-relay";
import { handleSourceRoute } from "./race-administrator-routes-sources";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;

/**
 * Dedicated administrator cookie boundary; never falls back to a limited-role cookie.
 * Kontrollerar adress, metod, origin och verklig administratörsroll innan åtgärden lämnas till sin grupp.
 * Sessionen öppnas med kontot via /api/organizer/races/{id}/enter (ADR-0168); här finns bara läsning och utloggning.
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
    headers: { ...privateEntryClassAdminHeaders, allow: allowed.join(", ") } });
  let policy;
  try {
    const base = entryClassAdminSecurityPolicy(environment);
    policy = { ...base, cookieNames: base.secureCookies ? RACE_ADMINISTRATOR_PRODUCTION_COOKIES : RACE_ADMINISTRATOR_LOOPBACK_COOKIES };
  } catch { return failure(500, "INTERNAL_ERROR"); }
  const write = request.method !== "GET";
  if (write && !hasExpectedEntryClassAdminOrigin(request, policy)) return failure(403, "FORBIDDEN");
  const proof = entryClassAdminSessionProof(request, policy, write);
  try {
    if (action.kind === "session" && request.method === "DELETE") {
      const result = await dependencies.logout(db, { ...proof, raceId, capability: "MANAGE_RACE",
        readBodyIsEmpty: () => hasNoEntryClassAdminRequestBody(request) });
      if (result.status === "unauthorized") return clearEntryClassAdminCookies(resultFailure(result.status), policy);
      if (result.status !== "logged-out" && result.status !== "already-logged-out") return resultFailure(result.status);
      return clearEntryClassAdminCookies(new Response(null, { status: 204, headers: privateEntryClassAdminHeaders }), policy);
    }
    // Verify actual administrator role before parsing mutations or reading participant data.
    const auth = await dependencies.authenticate(db, { ...proof, raceId, capability: "MANAGE_RACE", requireCsrf: write });
    if (auth.status !== "authenticated") return resultFailure(auth.status);
    if (auth.principal.raceId !== raceId || auth.principal.capability !== "MANAGE_RACE") return failure(403, "FORBIDDEN");
    if (action.kind === "session") return json(raceAdministratorLoginResponseSchema.parse({
      formatVersion: 1, raceId, capability: "MANAGE_RACE", expiresAt: auth.principal.expiresAt }));
    const context: RaceAdministratorRouteContext = { db, request, raceId, action, dependencies, proof, cursor, beforeVersion };
    return await handleRaceDayRoute(context) ?? await handlePreparationRoute(context) ?? await handleResultRoute(context) ??
      await handleEntryRoute(context) ?? await handleVariantRoute(context) ?? await handleRelayRoute(context) ?? await handleSourceRoute(context) ??
      (action.kind === "race-settings"
        ? await idempotentWrite(context, "race-settings", raceSettingsRequestSchema, raceSettingsResponseSchema, dependencies.raceSettings) : undefined) ??
      failure(500, "INTERNAL_ERROR");
  } catch { return failure(500, "INTERNAL_ERROR"); }
}

function allowedMethods(action: Action): string[] {
  return action.kind === "operator-access" ? ["GET", "POST", "DELETE"] : action.kind === "eventor" ? ["GET", "PUT", "DELETE"] :
    action.kind === "source-sync" ? ["GET", "POST"] : action.kind === "eventor-events" ? ["GET"] :
    action.kind === "eventor-test" || action.kind === "eventor-event" || action.kind === "eventor-sync-preview" ||
    action.kind === "course-file-preview" || action.kind === "source-sync-consequence" ? ["POST"] : action.kind === "shortened-course-class-transfer" || action.kind === "manual-finish-time-correction" || action.kind === "manual-punch-start-time-correction" || action.kind === "manual-punch-start-time-correction-withdrawal" || action.kind === "manual-finish-time-correction-withdrawal" || action.kind === "unknown-readout-resolution" || action.kind === "class-result-recalculation" || action.kind === "draw" ? ["GET", "POST"] : action.kind === "review-conflicts" ? ["POST"] : action.kind === "conflict-candidate" ? ["GET"] : action.kind === "session" ? ["GET", "DELETE"] : action.kind === "checkin-history" || action.kind === "effective-result" || action.kind === "changes" ? ["GET"] :
    action.kind === "start-correction" || action.kind === "manual-return-withdrawal" || action.kind === "manual-return" || action.kind === "publication" || action.kind === "draw-preview" || action.kind === "finalize" || action.kind === "recalculate" || action.kind === "registration" || action.kind === "registration-candidates" ||
    action.kind === "did-not-start" || action.kind === "did-not-start-withdrawal" ||
    action.kind === "did-not-finish" || action.kind === "did-not-finish-withdrawal" ||
    action.kind === "disqualification" || action.kind === "disqualification-withdrawal" ||
    action.kind === "approval" || action.kind === "approval-withdrawal" ||
    action.kind === "out-of-competition" || action.kind === "out-of-competition-withdrawal" ||
    action.kind === "without-timing" || action.kind === "without-timing-withdrawal" || action.kind === "manual-course-class" || action.kind === "manual-class" ||
    action.kind === "course-edit-preview" || action.kind === "course-edit" ||
    action.kind === "class-edit-preview" || action.kind === "class-edit" ||
    action.kind === "entry-variant-preview" || action.kind === "entry-variant" || action.kind === "class-variant-distribution" ||
    action.kind === "relay-class" || action.kind === "relay-team" || action.kind === "relay-leg-runner" ||
    action.kind === "relay-start-times" || action.kind === "race-settings" ? ["POST"] :
    "entryId" in action || action.kind === "capacity" ? ["PATCH"] : ["GET"];
}
