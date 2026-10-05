import {
  adminRaceMapStateSchema, PARTICIPANT_ROUTE_CONTENT_TYPE, PARTICIPANT_ROUTE_MAX_BYTES, participantRouteUploadResponseSchema, RACE_MAP_MAX_BYTES,
  RACE_MAP_MEDIA_TYPES, raceMapProblemSchema, type RaceMapProblem
} from "@o-tid/contracts";
import { entryClassAdminFailure as failure, entryClassAdminJson as json, hasNoEntryClassAdminRequestBody, privateEntryClassAdminHeaders,
  readEntryClassAdminJson } from "./entry-class-admin-security";
import { ImportAdminRequestError, readBoundedBytes, validDeclaredLength } from "./import-admin-security";
import { resultFailure, type RaceAdministratorRouteContext } from "./race-administrator-route-context";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function problem(error: RaceMapProblem): Response {
  return json(raceMapProblemSchema.parse({ formatVersion: 1, error }), 422);
}

/** Filens namn i en header (URI-kodad); ett trasigt namn ger fallback i stället för fel. */
function headerFileName(request: Request): string {
  const raw = request.headers.get("x-otid-file-name") ?? "";
  try { return decodeURIComponent(raw).slice(0, 200); } catch { return ""; }
}

/** Läser en binär body med typ och storleksgräns. Ger undefined när requesten inte uppfyller dem. */
async function binaryBody(request: Request, types: readonly string[], limit: number): Promise<Uint8Array | "too-large" | undefined> {
  if (!types.includes(request.headers.get("content-type") ?? "")) return undefined;
  if (!validDeclaredLength(request, limit)) return "too-large";
  try { return await readBoundedBytes(request, limit); }
  catch (error) { if (error instanceof ImportAdminRequestError) return error.message === "Bodyn är för stor" ? "too-large" : undefined; throw error; }
}

/**
 * Karta och vägval (PLAN.md steg 16, ADR-0171): kartbilden (GET tillstånd, PUT bild, DELETE), bilden för
 * georeferensen, georeferensen (POST) och löparnas GPX-rutter (POST, DELETE; löparen i `x-otid-entry-id`).
 * Ger undefined för åtgärder som inte hör till gruppen.
 */
export async function handleMapRoute(context: RaceAdministratorRouteContext): Promise<Response | undefined> {
  const { db, request, raceId, action, dependencies, proof } = context;
  const input = { ...proof, raceId };
  switch (action.kind) {
    case "race-map": {
      if (request.method === "GET") {
        const result = await dependencies.raceMapState(db, input);
        if (result.status !== "ok") return resultFailure(result.status);
        return json(adminRaceMapStateSchema.parse(result.response));
      }
      if (request.method === "DELETE") {
        if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
        const result = await dependencies.raceMapRemove(db, input);
        return result.status === "ok" ? new Response(null, { status: 204, headers: privateEntryClassAdminHeaders }) : resultFailure(result.status);
      }
      const bytes = await binaryBody(request, RACE_MAP_MEDIA_TYPES, RACE_MAP_MAX_BYTES);
      if (bytes === "too-large") return problem("IMAGE_TOO_LARGE");
      if (!bytes) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.raceMapSave(db, { ...input, bytes, fileName: headerFileName(request) });
      if (result.status === "problem") return problem(result.problem);
      return result.status === "ok" ? new Response(null, { status: 204, headers: privateEntryClassAdminHeaders }) : resultFailure(result.status);
    }
    case "race-map-image": {
      const result = await dependencies.raceMapImage(db, input);
      if (result.status !== "ok") return resultFailure(result.status);
      return new Response(new Uint8Array(result.image), { headers: { ...privateEntryClassAdminHeaders, "content-type": result.mediaType } });
    }
    case "race-map-georeference": {
      let body: unknown;
      try { body = await readEntryClassAdminJson(request); } catch { return failure(400, "INVALID_REQUEST"); }
      const result = await dependencies.raceMapGeoreference(db, { ...input, request: body });
      if (result.status === "problem") return problem(result.problem);
      return result.status === "ok" ? new Response(null, { status: 204, headers: privateEntryClassAdminHeaders }) : resultFailure(result.status);
    }
    case "participant-route": {
      const entryId = request.headers.get("x-otid-entry-id") ?? "";
      if (!uuid.test(entryId)) return failure(400, "INVALID_REQUEST");
      if (request.method === "DELETE") {
        if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
        const result = await dependencies.participantRouteRemove(db, { ...input, entryId });
        return result.status === "ok" ? new Response(null, { status: 204, headers: privateEntryClassAdminHeaders }) : resultFailure(result.status);
      }
      const bytes = await binaryBody(request, [PARTICIPANT_ROUTE_CONTENT_TYPE], PARTICIPANT_ROUTE_MAX_BYTES);
      if (bytes === "too-large") return problem("INVALID_GPX");
      if (!bytes) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.participantRouteSave(db, { ...input, entryId, bytes, fileName: headerFileName(request) });
      if (result.status === "problem") return problem(result.problem);
      if (result.status !== "ok") return resultFailure(result.status);
      return json(participantRouteUploadResponseSchema.parse(result.response));
    }
    default:
      return undefined;
  }
}
