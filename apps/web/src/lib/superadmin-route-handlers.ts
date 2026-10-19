import { performSuperadminAction, readSuperadminOverview } from "@o-tid/application";
import { superadminActionResponseSchema, superadminOverviewSchema } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  SecurityConfigurationError,
  accountFailure,
  hasExpectedOrigin,
  hasNoRequestBody,
  privateJson,
  readJsonBody,
  securityPolicy,
  sessionProof
} from "./security-policy";

/** Superadminsidan (ADR-0172 beslut 2). Behörigheten kontrolleras av `requireSuperadmin` i varje anrop. */
type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;

function configured(environment: Environment) {
  try { return securityPolicy(environment); }
  catch (error) {
    if (error instanceof SecurityConfigurationError) return undefined;
    throw error;
  }
}

function failure(status: string): Response {
  switch (status) {
    case "unauthorized": return accountFailure(401, "UNAUTHORIZED");
    case "forbidden": return accountFailure(403, "FORBIDDEN");
    case "invalid-request": return accountFailure(400, "INVALID_REQUEST");
    case "not-found": return accountFailure(404, "NOT_FOUND");
    case "confirmation-mismatch": return accountFailure(409, "CONFIRMATION_MISMATCH");
    default: return accountFailure(500, "INTERNAL_ERROR");
  }
}

export async function superadminOverviewRoute(db: Database, request: Request, environment: Environment = process.env): Promise<Response> {
  const policy = configured(environment);
  if (!policy) return accountFailure(500, "INTERNAL_ERROR");
  if (!await hasNoRequestBody(request)) return accountFailure(400, "INVALID_REQUEST");
  const search = new URL(request.url).searchParams;
  const query = { accounts: search.get("konton")?.slice(0, 120) ?? "", races: search.get("tavlingar")?.slice(0, 120) ?? "" };
  try {
    const result = await readSuperadminOverview(db, sessionProof(request, policy, false), query);
    if (result.status !== "ok") return failure(result.status);
    return privateJson(superadminOverviewSchema.parse(result.response));
  } catch { return accountFailure(500, "INTERNAL_ERROR"); }
}

export async function superadminActionRoute(db: Database, request: Request, environment: Environment = process.env): Promise<Response> {
  const policy = configured(environment);
  if (!policy) return accountFailure(500, "INTERNAL_ERROR");
  if (!hasExpectedOrigin(request, policy)) return accountFailure(403, "FORBIDDEN");
  let body: unknown;
  try { body = await readJsonBody(request); } catch { return accountFailure(400, "INVALID_REQUEST"); }
  try {
    const result = await performSuperadminAction(db, { ...sessionProof(request, policy, true), requireCsrf: true }, body);
    if (result.status !== "done") return failure(result.status);
    return privateJson(superadminActionResponseSchema.parse({
      formatVersion: 1, action: result.action,
      ...(result.reset ? { resetUrl: `${policy.publicOrigin}/recover#token=${result.reset.token}`,
        resetExpiresAt: result.reset.expiresAt.toISOString() } : {})
    }));
  } catch { return accountFailure(500, "INTERNAL_ERROR"); }
}
