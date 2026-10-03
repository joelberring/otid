import {
  eventorMasterKeyFromEnvironment, importEventorEntriesAsAdmin,
  previewEventorEntryImportAsAdmin, type EventorImportRuntime
} from "@o-tid/application";
import {
  eventorEntryImportErrorResponseSchema, eventorEntryImportIdempotencyKeySchema,
  eventorEntryImportPreviewResponseSchema, eventorEntryImportResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  ImportAdminConfigurationError, hasExpectedImportAdminOrigin, importAdminSecurityPolicy,
  importAdminSessionProof, privateImportAdminHeaders, readImportAdminJson
} from "./import-admin-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN" | "OTID_EVENTOR_MASTER_KEY_ID" | "OTID_EVENTOR_MASTER_KEY_BASE64">>;
type Preview = typeof previewEventorEntryImportAsAdmin;
type Commit = typeof importEventorEntriesAsAdmin;

function response(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: privateImportAdminHeaders });
}

function failure(status: 400 | 401 | 403 | 409 | 500 | 503, error: "INVALID_REQUEST" | "UNAUTHORIZED" | "FORBIDDEN" | "CONFLICT" | "SOURCE_UNAVAILABLE" | "INTERNAL_ERROR"): Response {
  return response(eventorEntryImportErrorResponseSchema.parse({ formatVersion: 1, error }), status);
}

/** A grant-scoped, person-data-free Eventor preview route. */
export async function eventorEntryImportPreviewRoute(
  db: Database,
  request: Request,
  raceId: string,
  preview: Preview = previewEventorEntryImportAsAdmin,
  runtime?: EventorImportRuntime,
  environment: Environment = process.env
): Promise<Response> {
  let masterKey: Uint8Array | undefined;
  try {
    let policy;
    try { policy = importAdminSecurityPolicy(environment); }
    catch (error) {
      if (error instanceof ImportAdminConfigurationError) return failure(500, "INTERNAL_ERROR");
      throw error;
    }
    if (!hasExpectedImportAdminOrigin(request, policy)) return failure(403, "FORBIDDEN");
    const proof = importAdminSessionProof(request, policy, true);
    const serverRuntime = runtime ?? {
      masterKeyFor: (keyId: string) => {
        const configuration = eventorMasterKeyFromEnvironment(environment);
        masterKey = configuration.masterKey;
        return configuration.keyId === keyId ? masterKey : undefined;
      }
    };
    const result = await preview(db, { ...proof, raceId, readBody: () => readImportAdminJson(request) }, serverRuntime);
    if (result.status === "unauthorized") return failure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return failure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return failure(400, "INVALID_REQUEST");
    if (result.status === "source-unavailable") return failure(503, "SOURCE_UNAVAILABLE");
    if (result.status !== "available") return failure(500, "INTERNAL_ERROR");
    return response(eventorEntryImportPreviewResponseSchema.parse(result.response));
  } catch {
    return failure(500, "INTERNAL_ERROR");
  } finally {
    masterKey?.fill(0);
  }
}

/** Commit route for a reviewed explicit mapping. It never exposes the API key or source entries. */
export async function eventorEntryImportCommitRoute(
  db: Database,
  request: Request,
  raceId: string,
  commit: Commit = importEventorEntriesAsAdmin,
  runtime?: EventorImportRuntime,
  environment: Environment = process.env
): Promise<Response> {
  let masterKey: Uint8Array | undefined;
  try {
    let policy;
    try { policy = importAdminSecurityPolicy(environment); }
    catch (error) {
      if (error instanceof ImportAdminConfigurationError) return failure(500, "INTERNAL_ERROR");
      throw error;
    }
    if (!hasExpectedImportAdminOrigin(request, policy)) return failure(403, "FORBIDDEN");
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!eventorEntryImportIdempotencyKeySchema.safeParse(idempotencyKey).success) {
      return failure(400, "INVALID_REQUEST");
    }
    const proof = importAdminSessionProof(request, policy, true);
    const serverRuntime = runtime ?? {
      masterKeyFor: (keyId: string) => {
        const configuration = eventorMasterKeyFromEnvironment(environment);
        masterKey = configuration.masterKey;
        return configuration.keyId === keyId ? masterKey : undefined;
      }
    };
    const result = await commit(db, { ...proof, raceId, idempotencyKey,
      readBody: () => readImportAdminJson(request) }, serverRuntime);
    if (result.status === "unauthorized") return failure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return failure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return failure(400, "INVALID_REQUEST");
    if (result.status === "conflict") return failure(409, "CONFLICT");
    if (result.status === "source-unavailable") return failure(503, "SOURCE_UNAVAILABLE");
    if (result.status !== "created") return failure(500, "INTERNAL_ERROR");
    return response(eventorEntryImportResponseSchema.parse(result.response), result.response.replayed ? 200 : 201);
  } catch {
    return failure(500, "INTERNAL_ERROR");
  } finally {
    masterKey?.fill(0);
  }
}
