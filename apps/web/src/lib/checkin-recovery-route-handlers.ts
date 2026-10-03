import { syncStartCheckinWithRecovery } from "@o-tid/application";
import { StartCheckinReceiptSchema, StartCheckinRecoveryTokenSchema } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  StartCheckinAdminConfigurationError,
  hasExpectedStartCheckinAdminOrigin,
  readStartCheckinAdminJson,
  startCheckinAdminFailure,
  startCheckinAdminJson,
  startCheckinAdminSecurityPolicy
} from "./start-checkin-admin-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Sync = typeof syncStartCheckinWithRecovery;

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function recoveryToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  if (authorization === null || !authorization.startsWith("Bearer ")) return undefined;
  const token = authorization.slice("Bearer ".length);
  return StartCheckinRecoveryTokenSchema.safeParse(token).success ? token : undefined;
}

function policyOrFailure(environment: Environment) {
  try {
    return { policy: startCheckinAdminSecurityPolicy("START_CHECKIN", environment) } as const;
  } catch (error) {
    if (error instanceof StartCheckinAdminConfigurationError) {
      return { response: startCheckinAdminFailure(500, "INTERNAL_ERROR") } as const;
    }
    throw error;
  }
}

function applicationFailure(result: { status: string }): Response | null {
  switch (result.status) {
    case "unauthorized": return startCheckinAdminFailure(401, "UNAUTHORIZED");
    case "forbidden": return startCheckinAdminFailure(403, "FORBIDDEN");
    case "invalid-request": return startCheckinAdminFailure(400, "INVALID_REQUEST");
    case "not-found": return startCheckinAdminFailure(404, "NOT_FOUND");
    case "conflict": return startCheckinAdminFailure(409, "CONFLICT");
    default: return null;
  }
}

/** Recovery bearer authentication is deliberately independent of browser sessions and CSRF. */
export async function checkinRecoverySyncRoute(
  db: Database,
  request: Request,
  raceId: string,
  sync: Sync = syncStartCheckinWithRecovery,
  environment: Environment = process.env
): Promise<Response> {
  if (!CANONICAL_UUID.test(raceId)) return startCheckinAdminFailure(400, "INVALID_REQUEST");
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedStartCheckinAdminOrigin(request, configured.policy)) return startCheckinAdminFailure(403, "FORBIDDEN");

  let bodyReadFailed = false;
  try {
    const result = await sync(db, {
      raceId,
      recoveryToken: recoveryToken(request),
      readBody: async () => {
        try {
          return await readStartCheckinAdminJson(request);
        } catch (error) {
          bodyReadFailed = true;
          throw error;
        }
      }
    });
    const failure = applicationFailure(result);
    if (failure) return failure;
    if (result.status !== "stored") return startCheckinAdminFailure(500, "INTERNAL_ERROR");
    const response = StartCheckinReceiptSchema.parse(result.response);
    if (response.raceId !== raceId) return startCheckinAdminFailure(500, "INTERNAL_ERROR");
    return startCheckinAdminJson(response);
  } catch {
    return bodyReadFailed ? startCheckinAdminFailure(400, "INVALID_REQUEST") : startCheckinAdminFailure(500, "INTERNAL_ERROR");
  }
}
