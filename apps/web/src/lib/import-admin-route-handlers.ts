import {
  authenticatePairingAdminSession,
  importIofXmlAsAdmin
} from "@o-tid/application";
import {
  iofImportIdempotencyKeySchema,
  iofImportResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  ImportAdminConfigurationError,
  hasExpectedImportAdminOrigin,
  importAdminFailure,
  importAdminJson,
  importAdminSecurityPolicy,
  importAdminSessionProof,
  readIofImportBody
} from "./import-admin-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Authenticate = typeof authenticatePairingAdminSession;
type Import = typeof importIofXmlAsAdmin;

function policyOrFailure(environment: Environment) {
  try {
    return { policy: importAdminSecurityPolicy(environment) } as const;
  } catch (error) {
    if (error instanceof ImportAdminConfigurationError) {
      return { response: importAdminFailure(500, "INTERNAL_ERROR") } as const;
    }
    throw error;
  }
}


export async function authenticatedIofImportRoute(
  db: Database,
  request: Request,
  raceId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  runImport: Import = importIofXmlAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedImportAdminOrigin(request, configured.policy)) return importAdminFailure(403, "FORBIDDEN");
  const proof = importAdminSessionProof(request, configured.policy, true);

  try {
    const authorization = await authenticate(db, {
      ...proof,
      raceId,
      capability: "IMPORT_IOF",
      requireCsrf: true
    });
    if (authorization.status === "unauthorized") return importAdminFailure(401, "UNAUTHORIZED");
    if (authorization.status === "forbidden") return importAdminFailure(403, "FORBIDDEN");
  } catch {
    return importAdminFailure(500, "INTERNAL_ERROR");
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!iofImportIdempotencyKeySchema.safeParse(idempotencyKey).success) {
    return importAdminFailure(400, "INVALID_REQUEST");
  }
  let xmlBytes: Uint8Array;
  try {
    ({ bytes: xmlBytes } = await readIofImportBody(request));
  } catch {
    return importAdminFailure(400, "INVALID_REQUEST");
  }

  try {
    const result = await runImport(db, { ...proof, raceId, idempotencyKey, xmlBytes });
    if (result.status === "unauthorized") return importAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return importAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return importAdminFailure(400, "INVALID_REQUEST");
    if (result.status === "invalid-iof-xml") return importAdminFailure(422, "INVALID_IOF_XML");
    if (result.status === "conflict") return importAdminFailure(409, "CONFLICT");
    if (!("response" in result)) return importAdminFailure(500, "INTERNAL_ERROR");
    return importAdminJson(iofImportResponseSchema.parse(result.response), result.status === "stored" ? 201 : 200);
  } catch {
    return importAdminFailure(500, "INTERNAL_ERROR");
  }
}
