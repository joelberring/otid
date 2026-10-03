import {
  eventorMasterKeyFromEnvironment, importEventorEventAsAdmin,
  listEventorConnectionsAsAdmin, previewEventorImportAsAdmin, type EventorImportRuntime,
} from "@o-tid/application";
import {
  eventorConnectionsResponseSchema, eventorImportErrorResponseSchema,
  eventorImportResponseSchema, eventorPreviewResponseSchema,
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { eventCreationSecurityPolicy, eventCreationSessionProof, hasExpectedEventCreationOrigin,
  privateEventCreationHeaders, readEventCreationJson } from "./event-creation-admin-security";

type Services = {
  list: typeof listEventorConnectionsAsAdmin; preview: typeof previewEventorImportAsAdmin;
  commit: typeof importEventorEventAsAdmin; runtime?: EventorImportRuntime;
};
const defaults: Services = { list: listEventorConnectionsAsAdmin, preview: previewEventorImportAsAdmin, commit: importEventorEventAsAdmin };
function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: privateEventCreationHeaders });
}
function failure(status: number, error: "INVALID_REQUEST" | "UNAUTHORIZED" | "FORBIDDEN" | "CONFLICT" | "SOURCE_UNAVAILABLE" | "INTERNAL_ERROR") {
  return json(eventorImportErrorResponseSchema.parse({ formatVersion: 1, error }), status);
}

export async function eventorImportRoute(db: Database, request: Request, mode: "list" | "preview" | "commit",
  services = defaults, environment: Partial<NodeJS.ProcessEnv> = process.env): Promise<Response> {
  let masterKey: Uint8Array | undefined;
  try {
    const policy = eventCreationSecurityPolicy(environment);
    if (mode !== "list" && !hasExpectedEventCreationOrigin(request, policy)) return failure(403, "FORBIDDEN");
    const proof = eventCreationSessionProof(request, policy, mode !== "list");
    const runtime = services.runtime ?? { masterKeyFor: (id: string) => {
      const configuration = eventorMasterKeyFromEnvironment(environment);
      masterKey = configuration.masterKey;
      return configuration.keyId === id ? masterKey : undefined;
    } };
    const result = mode === "list" ? await services.list(db, proof)
      : mode === "preview" ? await services.preview(db, { ...proof, readBody: () => readEventCreationJson(request) }, runtime)
        : await services.commit(db, { ...proof, readBody: () => readEventCreationJson(request),
          idempotencyKey: request.headers.get("idempotency-key") }, runtime);
    switch (result.status) {
      case "unauthorized": return failure(401, "UNAUTHORIZED");
      case "forbidden": return failure(403, "FORBIDDEN");
      case "invalid-request": return failure(400, "INVALID_REQUEST");
      case "conflict": return failure(409, "CONFLICT");
      case "source-unavailable": return failure(503, "SOURCE_UNAVAILABLE");
      case "created": return json(eventorImportResponseSchema.parse(result.response), result.response.replayed ? 200 : 201);
      case "available": return json(mode === "list" ? eventorConnectionsResponseSchema.parse(result.response)
        : eventorPreviewResponseSchema.parse(result.response));
    }
    return failure(500, "INTERNAL_ERROR");
  } catch {
    return failure(500, "INTERNAL_ERROR");
  } finally {
    masterKey?.fill(0);
  }
}
