import {
  adminRouteChoiceSchema, ROUTE_CHOICE_PUBLISH_MAX_BYTES, ROUTE_CHOICE_SETTINGS_MAX_BYTES, routeChoiceCalibrationRoutesSchema,
  routeChoiceProblemSchema, routeChoiceSettingsRequestSchema
} from "@o-tid/contracts";
import { adminFailure as failure, privateHeaders, privateJson as json, readJsonBody } from "./security-policy";
import { resultFailure, type RaceAdministratorRouteContext } from "./race-administrator-route-context";

/**
 * Steg 60 (ADR-0179 beslut 11–13): vägvalsanalysens läge (GET), inställningar (POST), "Visa bästa vägval publikt" (POST) och
 * GPS-rutternas delar för kalibreringen (GET per bana). Bara admin (race-roles.ts). Ger undefined för andra åtgärder.
 */
export async function handleRouteChoiceRoute(context: RaceAdministratorRouteContext): Promise<Response | undefined> {
  const { db, request, raceId, action, dependencies, proof } = context;
  switch (action.kind) {
    case "route-choice": {
      const result = await dependencies.routeChoice(db, { ...proof, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = adminRouteChoiceSchema.parse(result.response);
      return response.raceId === raceId ? json(response) : failure(500, "INTERNAL_ERROR");
    }
    case "route-choice-calibration": {
      const result = await dependencies.routeChoiceCalibration(db, { ...proof, raceId, courseId: action.courseId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = routeChoiceCalibrationRoutesSchema.parse(result.response);
      return response.raceId === raceId && response.courseId === action.courseId ? json(response) : failure(500, "INTERNAL_ERROR");
    }
    case "route-choice-settings": {
      let body: unknown;
      try { body = await readJsonBody(request, ROUTE_CHOICE_SETTINGS_MAX_BYTES); } catch { return failure(400, "INVALID_REQUEST"); }
      const parsed = routeChoiceSettingsRequestSchema.safeParse(body);
      if (!parsed.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.routeChoiceSettings(db, { ...proof, raceId, request: parsed.data });
      if (result.status !== "ok") return resultFailure(result.status);
      return json(routeChoiceSettingsRequestSchema.parse({ formatVersion: 1, settings: result.settings }));
    }
    case "route-choice-published": {
      let body: unknown;
      try { body = await readJsonBody(request, ROUTE_CHOICE_PUBLISH_MAX_BYTES); } catch { return failure(400, "INVALID_REQUEST"); }
      const result = await dependencies.routeChoicePublish(db, { ...proof, raceId, request: body });
      if (result.status === "problem") return json(routeChoiceProblemSchema.parse({ formatVersion: 1, error: result.problem }), 422);
      if (result.status !== "ok") return resultFailure(result.status);
      return new Response(null, { status: 204, headers: privateHeaders });
    }
    default:
      return undefined;
  }
}
