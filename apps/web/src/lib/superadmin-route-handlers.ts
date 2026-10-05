import { performSuperadminAction, readSuperadminOverview } from "@o-tid/application";
import { superadminActionResponseSchema, superadminOverviewSchema } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  OrganizerConfigurationError,
  accountFailure,
  hasExpectedOrganizerOrigin,
  hasNoOrganizerRequestBody,
  organizerJson,
  organizerSecurityPolicy,
  organizerSessionProof,
  readOrganizerJson
} from "./organizer-account-security";

/** Superadminsidan (ADR-0172 beslut 2). Behörigheten kontrolleras av `requireSuperadmin` i varje anrop. */
type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;

function configured(environment: Environment) {
  try { return organizerSecurityPolicy(environment); }
  catch (error) {
    if (error instanceof OrganizerConfigurationError) return undefined;
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
  if (!await hasNoOrganizerRequestBody(request)) return accountFailure(400, "INVALID_REQUEST");
  const search = new URL(request.url).searchParams;
  const query = { accounts: search.get("konton")?.slice(0, 120) ?? "", races: search.get("tavlingar")?.slice(0, 120) ?? "" };
  try {
    const result = await readSuperadminOverview(db, organizerSessionProof(request, policy, false), query);
    if (result.status !== "ok") return failure(result.status);
    return organizerJson(superadminOverviewSchema.parse(result.response));
  } catch { return accountFailure(500, "INTERNAL_ERROR"); }
}

export async function superadminActionRoute(db: Database, request: Request, environment: Environment = process.env): Promise<Response> {
  const policy = configured(environment);
  if (!policy) return accountFailure(500, "INTERNAL_ERROR");
  if (!hasExpectedOrganizerOrigin(request, policy)) return accountFailure(403, "FORBIDDEN");
  let body: unknown;
  try { body = await readOrganizerJson(request); } catch { return accountFailure(400, "INVALID_REQUEST"); }
  try {
    const result = await performSuperadminAction(db, { ...organizerSessionProof(request, policy, true), requireCsrf: true }, body);
    if (result.status !== "done") return failure(result.status);
    return organizerJson(superadminActionResponseSchema.parse({
      formatVersion: 1, action: result.action,
      ...(result.reset ? { resetUrl: `${policy.publicOrigin}/recover#token=${result.reset.token}`,
        resetExpiresAt: result.reset.expiresAt.toISOString() } : {})
    }));
  } catch { return accountFailure(500, "INTERNAL_ERROR"); }
}
