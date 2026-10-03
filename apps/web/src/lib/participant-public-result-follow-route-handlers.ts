import { listMyPublicResultFollows, setPublicResultFollow, authenticateUserAccountSession } from "@o-tid/application";
import {
  publicResultFollowIdempotencyKey,
  publicResultFollowSetRequestSchema,
  publicResultFollowSetResponseSchema,
  publicResultFollowListResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  hasExpectedOrganizerOrigin, hasNoOrganizerRequestBody, organizerFailure, organizerJson,
  organizerSecurityPolicy, organizerSessionProof, readOrganizerJson
} from "./organizer-account-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;

function statusFailure(status: string): Response {
  if (status === "unauthorized") return organizerFailure(401, "UNAUTHORIZED");
  if (status === "forbidden") return organizerFailure(403, "FORBIDDEN");
  if (status === "not-found") return organizerFailure(404, "UNAUTHORIZED");
  if (status === "conflict") return organizerFailure(409, "CONFLICT");
  if (status === "invalid-request") return organizerFailure(400, "INVALID_REQUEST");
  return organizerFailure(500, "INTERNAL_ERROR");
}

function configuredPolicy(environment: Environment) {
  try { return { policy: organizerSecurityPolicy(environment) } as const; }
  catch { return { response: organizerFailure(500, "INTERNAL_ERROR") } as const; }
}

export async function participantPublicResultFollowListRoute(
  db: Database,
  request: Request,
  list: typeof listMyPublicResultFollows = listMyPublicResultFollows,
  environment: Environment = process.env
): Promise<Response> {
  const configured = configuredPolicy(environment);
  if ("response" in configured) return configured.response;
  if (request.method !== "GET" || !await hasNoOrganizerRequestBody(request)) return organizerFailure(400, "INVALID_REQUEST");
  try {
    const result = await list(db, organizerSessionProof(request, configured.policy, false));
    if (result.status !== "ok") return statusFailure(result.status);
    return organizerJson(publicResultFollowListResponseSchema.parse(result.response));
  } catch { return organizerFailure(500, "INTERNAL_ERROR"); }
}

export async function participantPublicResultFollowSetRoute(
  db: Database,
  request: Request,
  set: typeof setPublicResultFollow = setPublicResultFollow,
  authenticate: typeof authenticateUserAccountSession = authenticateUserAccountSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = configuredPolicy(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedOrganizerOrigin(request, configured.policy)) return organizerFailure(403, "FORBIDDEN");
  const proof = organizerSessionProof(request, configured.policy, true);
  try {
    const auth = await authenticate(db, { ...proof, requireCsrf: true });
    if (auth.status !== "authenticated") return statusFailure(auth.status);
  } catch { return organizerFailure(500, "INTERNAL_ERROR"); }
  const idempotencyKey = request.headers.get("idempotency-key");
  let body: unknown;
  try { body = await readOrganizerJson(request); } catch { return organizerFailure(400, "INVALID_REQUEST"); }
  const parsed = publicResultFollowSetRequestSchema.safeParse(body);
  if (!parsed.success || idempotencyKey !== publicResultFollowIdempotencyKey(parsed.data.requestId)) {
    return organizerFailure(400, "INVALID_REQUEST");
  }
  try {
    const result = await set(db, { ...proof, requireCsrf: true, idempotencyKey, request: parsed.data });
    if (result.status !== "ok") return statusFailure(result.status);
    const response = publicResultFollowSetResponseSchema.parse(result.response);
    if (response.requestId !== parsed.data.requestId || response.raceId !== parsed.data.raceId ||
      response.publicResultId !== parsed.data.publicResultId || response.followed !== parsed.data.followed) {
      return organizerFailure(500, "INTERNAL_ERROR");
    }
    return organizerJson(response, response.replayed ? 200 : 201);
  } catch { return organizerFailure(500, "INTERNAL_ERROR"); }
}
