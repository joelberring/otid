import {
  decodeIofXml,
  requireRaceRole,
  importIofXmlAsAdmin
} from "@o-tid/application";
import {
  IOF_IMPORT_CONFIRM_HEADER,
  iofImportIdempotencyKeySchema,
  iofImportResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  SecurityConfigurationError,
  hasExpectedOrigin,
  importFailure,
  IofEncodingError,
  privateJson,
  readIofImportBody,
  securityPolicy,
  sessionProof
} from "./security-policy";
import { logServerError } from "./server-error-log";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Authenticate = typeof requireRaceRole;
type Import = typeof importIofXmlAsAdmin;

function policyOrFailure(environment: Environment) {
  try {
    return { policy: securityPolicy(environment) } as const;
  } catch (error) {
    if (error instanceof SecurityConfigurationError) {
      return { response: importFailure(500, "INTERNAL_ERROR") } as const;
    }
    throw error;
  }
}


export async function authenticatedIofImportRoute(
  db: Database,
  request: Request,
  raceId: string,
  authenticate: Authenticate = requireRaceRole,
  runImport: Import = importIofXmlAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedOrigin(request, configured.policy)) return importFailure(403, "FORBIDDEN");
  const proof = sessionProof(request, configured.policy, true);

  try {
    const authorization = await authenticate(db, {
      ...proof,
      raceId,
      role: "ADMIN",
      requireCsrf: true
    });
    if (authorization.status === "unauthorized") return importFailure(401, "UNAUTHORIZED");
    if (authorization.status === "forbidden") return importFailure(403, "FORBIDDEN");
  } catch (error) { logServerError("import-admin", "authenticatedIofImportRoute", error); return importFailure(500, "INTERNAL_ERROR"); }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!iofImportIdempotencyKeySchema.safeParse(idempotencyKey).success) {
    return importFailure(400, "INVALID_REQUEST");
  }
  let xmlBytes: Uint8Array;
  try {
    ({ bytes: xmlBytes } = await readIofImportBody(request, decodeIofXml));
  } catch (error) {
    if (error instanceof IofEncodingError) return importFailure(422, "INVALID_IOF_XML", [error.message]);
    return importFailure(400, "INVALID_REQUEST");
  }

  try {
    const confirmChanges = request.headers.get(IOF_IMPORT_CONFIRM_HEADER) === "1";
    const result = await runImport(db, { ...proof, raceId, idempotencyKey, xmlBytes, confirmChanges });
    // Översynen 2026-11-02: vem det gäller och vad som skiljer, i stället för ett tomt 409.
    if (result.status === "entry-list-changes") return importFailure(409, "CHANGES_REQUIRE_CONFIRMATION", undefined, result.changes);
    if (result.status === "course-file-sync-required") return importFailure(409, "COURSE_FILE_SYNC_REQUIRED", result.issues);
    if (result.status === "unauthorized") return importFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return importFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return importFailure(400, "INVALID_REQUEST");
    if (result.status === "invalid-iof-xml") return importFailure(422, "INVALID_IOF_XML", result.issues);
    if (result.status === "conflict") return importFailure(409, "CONFLICT", undefined, result.changes);
    if (!("response" in result)) return importFailure(500, "INTERNAL_ERROR");
    return privateJson(iofImportResponseSchema.parse(result.response), result.status === "stored" ? 201 : 200);
  } catch (error) { logServerError("import-admin", "authenticatedIofImportRoute", error); return importFailure(500, "INTERNAL_ERROR"); }
}
