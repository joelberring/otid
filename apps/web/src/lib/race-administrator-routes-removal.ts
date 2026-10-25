import { classRemovalRequestSchema, classRemovalResponseSchema, courseRemovalRequestSchema, courseRemovalResponseSchema,
  entryRemovalRequestSchema, entryRemovalResponseSchema, resultsOfficialRequestSchema, resultsOfficialResponseSchema,
  resultsOfficialStateSchema, selfRegistrationCleanupPreviewSchema, selfRegistrationCleanupRequestSchema,
  selfRegistrationCleanupResponseSchema } from "@o-tid/contracts";
import { adminFailure as failure, hasNoRequestBody, privateHeaders, privateJson as json } from "./security-policy";
import { resultFailure, type RaceAdministratorRouteContext } from "./race-administrator-route-context";
import { write } from "./race-administrator-routes-relay";

/** Kroppen måste gälla samma deltagare, klass eller bana som adressen. */
function matching<T extends { requestId: string }>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  matches: (value: T) => boolean) {
  return { safeParse: (value: unknown) => {
    const parsed = schema.safeParse(value);
    return parsed.success && matches(parsed.data) ? parsed : { success: false as const };
  } };
}

/**
 * PLAN.md steg 27: ta bort eller stryk deltagare, ta bort klass och bana, "Resultaten är klara" och "Exportera tävlingen".
 * Bara administratören (`race-roles.ts`). Ger undefined för åtgärder som inte hör till gruppen.
 */
export async function handleRemovalRoute(context: RaceAdministratorRouteContext): Promise<Response | undefined> {
  const { db, request, raceId, action, dependencies, proof } = context;
  switch (action.kind) {
    case "entry-removal": {
      const entryId = action.entryId;
      return write(context, "entry-removal", matching(entryRemovalRequestSchema, value => value.entryId === entryId),
        entryRemovalResponseSchema, dependencies.removeEntry);
    }
    case "class-removal": {
      const classId = action.classId;
      return write(context, "class-removal", matching(classRemovalRequestSchema, value => value.classId === classId),
        classRemovalResponseSchema, dependencies.removeClass);
    }
    case "course-removal": {
      const courseId = action.courseId;
      return write(context, "course-removal", matching(courseRemovalRequestSchema, value => value.courseId === courseId),
        courseRemovalResponseSchema, dependencies.removeCourse);
    }
    case "results-official": {
      if (request.method === "POST") {
        return write(context, "results-official", resultsOfficialRequestSchema, resultsOfficialResponseSchema, dependencies.resultsOfficial);
      }
      if (!await hasNoRequestBody(request)) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.resultsOfficialState(db, { sessionToken: proof.sessionToken, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = resultsOfficialStateSchema.parse(result.response);
      return response.raceId === raceId ? json(response) : failure(500, "INTERNAL_ERROR");
    }
    case "self-registration-cleanup": {
      // PLAN.md steg 46: förhandsvisning (GET) och "Stryk alla självregistrerade som inte läst ut" (POST).
      if (request.method === "POST") {
        return write(context, "self-registration-cleanup", selfRegistrationCleanupRequestSchema, selfRegistrationCleanupResponseSchema,
          dependencies.strikeSelfRegistered);
      }
      if (!await hasNoRequestBody(request)) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.selfRegistrationCleanup(db, { ...proof, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      const response = selfRegistrationCleanupPreviewSchema.parse(result.response);
      return response.raceId === raceId ? json(response) : failure(500, "INTERNAL_ERROR");
    }
    case "race-export": {
      if (!await hasNoRequestBody(request)) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.raceExport(db, { sessionToken: proof.sessionToken, raceId });
      if (result.status !== "ok") return resultFailure(result.status);
      const bytes = Uint8Array.from(result.bytes);
      return new Response(bytes, { headers: { ...privateHeaders, "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${result.fileName}"`, "content-length": String(bytes.byteLength) } });
    }
    default:
      return undefined;
  }
}
