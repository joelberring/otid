import {
  requireRaceRole,
  importIofXmlAsAdmin
} from "@o-tid/application";
import {
  iofImportIdempotencyKeySchema,
  iofImportResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  SecurityConfigurationError,
  hasExpectedOrigin,
  importFailure,
  privateJson,
  readIofImportBody,
  securityPolicy,
  sessionProof
} from "./security-policy";

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
  } catch {
    return importFailure(500, "INTERNAL_ERROR");
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!iofImportIdempotencyKeySchema.safeParse(idempotencyKey).success) {
    return importFailure(400, "INVALID_REQUEST");
  }
  let xmlBytes: Uint8Array;
  try {
    ({ bytes: xmlBytes } = await readIofImportBody(request));
  } catch {
    return importFailure(400, "INVALID_REQUEST");
  }

  try {
    const result = await runImport(db, { ...proof, raceId, idempotencyKey, xmlBytes });
    if (result.status === "unauthorized") return importFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return importFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return importFailure(400, "INVALID_REQUEST");
    if (result.status === "invalid-iof-xml") return importFailure(422, "INVALID_IOF_XML", result.issues);
    if (result.status === "conflict") return importFailure(409, "CONFLICT");
    if (!("response" in result)) return importFailure(500, "INTERNAL_ERROR");
    return privateJson(iofImportResponseSchema.parse(result.response), result.status === "stored" ? 201 : 200);
  } catch {
    return importFailure(500, "INTERNAL_ERROR");
  }
}
