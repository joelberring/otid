import {
  eventorEventChoiceResponseSchema, eventorEventsResponseSchema, eventorSettingsResponseSchema, eventorSyncProblemSchema,
  eventorTestResponseSchema, sourceSyncStatusSchema, syncApplyIdempotencyKeySchema, syncApplyRequestSchema, syncApplyResponseSchema,
  syncConsequenceRequestSchema, syncConsequenceResponseSchema, syncPreviewResponseSchema
} from "@o-tid/contracts";
import { entryClassAdminFailure as failure, entryClassAdminJson as json, hasNoEntryClassAdminRequestBody,
  readEntryClassAdminJson } from "./entry-class-admin-security";
import { importAdminFailure, readIofImportBody } from "./import-admin-security";
import { eventorRuntime } from "./eventor-runtime";
import { resultFailure, type RaceAdministratorRouteContext } from "./race-administrator-route-context";

/**
 * Eventor och banfiler (ADR-0170 beslut 4): koppling, tävlingsval, skillnader och godkännande.
 * Ger undefined för åtgärder som inte hör till gruppen. Eventor-nyckeln skickas bara in och
 * kommer aldrig tillbaka i något svar.
 */
export async function handleSourceRoute(context: RaceAdministratorRouteContext): Promise<Response | undefined> {
  const { db, request, raceId, action, dependencies, proof } = context;
  const input = { ...proof, raceId };
  const body = async () => {
    try { return { ok: true as const, value: await readEntryClassAdminJson(request) }; } catch { return { ok: false as const }; }
  };
  switch (action.kind) {
    case "eventor": {
      if (request.method === "GET" || request.method === "DELETE") {
        if (request.method === "DELETE" && !await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
        const result = request.method === "GET" ? await dependencies.eventorSettings(db, input, eventorRuntime())
          : await dependencies.eventorKeyRemove(db, input, eventorRuntime());
        if (result.status !== "ok") return resultFailure(result.status);
        return json(eventorSettingsResponseSchema.parse(result.response));
      }
      const parsed = await body();
      if (!parsed.ok) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.eventorKey(db, { ...input, request: parsed.value }, eventorRuntime());
      if (result.status === "not-configured") return failure(409, "CONFLICT");
      if (result.status !== "ok") return resultFailure(result.status);
      return json(eventorTestResponseSchema.parse(result.response));
    }
    case "eventor-test": {
      if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.eventorTest(db, input, eventorRuntime());
      if (result.status !== "ok") return resultFailure(result.status);
      return json(eventorTestResponseSchema.parse(result.response));
    }
    case "eventor-events": {
      const result = await dependencies.eventorEvents(db, input, eventorRuntime());
      if (result.status !== "ok") return resultFailure(result.status);
      return json(eventorEventsResponseSchema.parse(result.response));
    }
    case "eventor-event": {
      const parsed = await body();
      if (!parsed.ok) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.eventorEvent(db, { ...input, request: parsed.value }, eventorRuntime());
      if (result.status !== "ok") return resultFailure(result.status);
      return json(eventorEventChoiceResponseSchema.parse(result.response));
    }
    case "eventor-sync-preview": {
      if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.eventorSyncPreview(db, input, eventorRuntime());
      if (result.status === "eventor") return json(eventorSyncProblemSchema.parse({ formatVersion: 1, raceId, problem: result.outcome }));
      if (result.status !== "ok") return resultFailure(result.status);
      return json(syncPreviewResponseSchema.parse(result.response));
    }
    case "course-file-preview": {
      let xml: string;
      try { ({ xml } = await readIofImportBody(request)); } catch { return failure(400, "INVALID_REQUEST"); }
      let fileName = "banfil.xml";
      try { fileName = decodeURIComponent(request.headers.get("x-otid-file-name") ?? fileName); } catch { return failure(400, "INVALID_REQUEST"); }
      const result = await dependencies.courseFilePreview(db, { ...input, xml, fileName });
      if (result.status === "invalid-iof-xml") return importAdminFailure(422, "INVALID_IOF_XML");
      if (result.status !== "ok") return resultFailure(result.status);
      return json(syncPreviewResponseSchema.parse(result.response));
    }
    case "source-sync-consequence": {
      const parsed = await body();
      const intent = parsed.ok ? syncConsequenceRequestSchema.safeParse(parsed.value) : undefined;
      if (!intent?.success) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.syncConsequence(db, { ...input, request: intent.data });
      if (result.status !== "ok") return resultFailure(result.status);
      return json(syncConsequenceResponseSchema.parse(result.response));
    }
    case "source-sync": {
      if (request.method === "GET") {
        const result = await dependencies.syncStatus(db, input);
        if (result.status !== "ok") return resultFailure(result.status);
        return json(sourceSyncStatusSchema.parse(result.response));
      }
      const key = syncApplyIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      const parsed = await body();
      const intent = parsed.ok ? syncApplyRequestSchema.safeParse(parsed.value) : undefined;
      if (!key.success || !intent?.success || key.data !== `source-sync:${intent.data.requestId}`) return failure(400, "INVALID_REQUEST");
      const result = await dependencies.syncApply(db, { ...input, idempotencyKey: key.data, request: intent.data });
      // Beskedet har ändrats sedan det visades: klienten hämtar nytt besked och frågar igen.
      if (result.status === "confirmation-required") return failure(409, "CONFLICT");
      if (result.status !== "saved") return resultFailure(result.status);
      const response = syncApplyResponseSchema.parse(result.response);
      if (response.raceId !== raceId || response.requestId !== intent.data.requestId) return failure(500, "INTERNAL_ERROR");
      return json(response);
    }
    default:
      return undefined;
  }
}
