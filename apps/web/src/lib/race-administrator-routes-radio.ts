import { radioFetchResponseSchema, radioSettingsResponseSchema } from "@o-tid/contracts";
import { entryClassAdminFailure as failure, entryClassAdminJson as json, hasNoEntryClassAdminRequestBody,
  readEntryClassAdminJson } from "./entry-class-admin-security";
import { radioRuntime } from "./radio-runtime";
import { resultFailure, type RaceAdministratorRouteContext } from "./race-administrator-route-context";

/**
 * Radiokontroller (ADR-0172 beslut 5): GET läser inställningarna och läget, PUT sparar dem och POST …/fetch
 * hämtar direkt ("Hämta nu"). Bara administratörer. Ger undefined för åtgärder som inte hör till gruppen.
 */
export async function handleRadioRoute(context: RaceAdministratorRouteContext): Promise<Response | undefined> {
  const { db, request, raceId, action, dependencies, proof } = context;
  const input = { ...proof, raceId };
  if (action.kind === "radio") {
    if (request.method === "GET") {
      const result = await dependencies.radioSettings(db, input);
      if (result.status !== "ok") return resultFailure(result.status);
      return json(radioSettingsResponseSchema.parse(result.response));
    }
    let body: unknown;
    try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
    const result = await dependencies.radioSave(db, { ...input, request: body });
    if (result.status !== "ok") return resultFailure(result.status);
    return json(radioSettingsResponseSchema.parse(result.response));
  }
  if (action.kind === "radio-fetch") {
    if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
    const result = await dependencies.radioFetch(db, input, radioRuntime());
    if (result.status !== "ok") return resultFailure(result.status);
    return json(radioFetchResponseSchema.parse(result.response));
  }
  return undefined;
}
