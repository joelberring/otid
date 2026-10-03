import {
  authenticateUserAccountSession,
  issueEventAccountInvitationAsOwner,
  listEventAccountInvitationsAsOwner,
  revokeEventAccountInvitationAsOwner
} from "@o-tid/application";
import {
  organizerAccountInvitationIssueIdempotencyKeySchema,
  organizerAccountInvitationIssueRequestSchema,
  organizerAccountInvitationIssueResponseSchema,
  organizerAccountInvitationListResponseSchema,
  organizerAccountInvitationRevokeIdempotencyKeySchema,
  organizerAccountInvitationRevokeRequestSchema,
  organizerAccountInvitationRevokeResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  OrganizerConfigurationError,
  hasExpectedOrganizerOrigin,
  hasNoOrganizerRequestBody,
  organizerFailure,
  organizerJson,
  organizerSecurityPolicy,
  organizerSessionProof,
  readOrganizerJson
} from "./organizer-account-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Authenticate = typeof authenticateUserAccountSession;
type Issue = typeof issueEventAccountInvitationAsOwner;
type List = typeof listEventAccountInvitationsAsOwner;
type Revoke = typeof revokeEventAccountInvitationAsOwner;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function policy(environment: Environment) {
  try { return { value: organizerSecurityPolicy(environment) } as const; }
  catch (error) {
    if (error instanceof OrganizerConfigurationError) return { response: organizerFailure(500, "INTERNAL_ERROR") } as const;
    throw error;
  }
}

function failure(status: string): Response {
  switch (status) {
    case "unauthorized": return organizerFailure(401, "UNAUTHORIZED");
    case "forbidden": return organizerFailure(403, "FORBIDDEN");
    case "invalid-request": return organizerFailure(400, "INVALID_REQUEST");
    case "conflict": return organizerFailure(409, "CONFLICT");
    case "not-found": return organizerFailure(404, "UNAUTHORIZED");
    default: return organizerFailure(500, "INTERNAL_ERROR");
  }
}

export async function organizerAccountInvitationListRoute(
  db: Database, request: Request, eventId: string, list: List = listEventAccountInvitationsAsOwner,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policy(environment);
  if ("response" in configured) return configured.response;
  if (request.method !== "GET" || !uuid.test(eventId) || !await hasNoOrganizerRequestBody(request)) {
    return organizerFailure(400, "INVALID_REQUEST");
  }
  try {
    const result = await list(db, { ...organizerSessionProof(request, configured.value, false), eventId });
    if (result.status !== "ok") return failure(result.status);
    const response = organizerAccountInvitationListResponseSchema.parse(result.response);
    if (response.eventId !== eventId) return organizerFailure(500, "INTERNAL_ERROR");
    return organizerJson(response);
  } catch { return organizerFailure(500, "INTERNAL_ERROR"); }
}

export async function organizerAccountInvitationIssueRoute(
  db: Database, request: Request, eventId: string, issue: Issue = issueEventAccountInvitationAsOwner,
  authenticate: Authenticate = authenticateUserAccountSession, environment: Environment = process.env
): Promise<Response> {
  const configured = policy(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedOrganizerOrigin(request, configured.value)) return organizerFailure(403, "FORBIDDEN");
  if (!uuid.test(eventId)) return organizerFailure(400, "INVALID_REQUEST");
  const proof = organizerSessionProof(request, configured.value, true);
  try {
    const auth = await authenticate(db, { ...proof, requireCsrf: true });
    if (auth.status !== "authenticated") return failure(auth.status);
  } catch { return organizerFailure(500, "INTERNAL_ERROR"); }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!organizerAccountInvitationIssueIdempotencyKeySchema.safeParse(idempotencyKey).success) {
    return organizerFailure(400, "INVALID_REQUEST");
  }
  let body: unknown;
  try { body = await readOrganizerJson(request); } catch { return organizerFailure(400, "INVALID_REQUEST"); }
  const parsed = organizerAccountInvitationIssueRequestSchema.safeParse(body);
  if (!parsed.success || parsed.data.eventId !== eventId) return organizerFailure(400, "INVALID_REQUEST");
  try {
    const result = await issue(db, { ...proof, requireCsrf: true, idempotencyKey,
      readBody: async () => parsed.data });
    if (result.status !== "issued") return failure(result.status);
    const response = organizerAccountInvitationIssueResponseSchema.parse(result.response);
    if (response.eventId !== eventId || response.requestId !== parsed.data.requestId) {
      return organizerFailure(500, "INTERNAL_ERROR");
    }
    return organizerJson(response, response.replayed ? 200 : 201);
  } catch { return organizerFailure(500, "INTERNAL_ERROR"); }
}

export async function organizerAccountInvitationRevokeRoute(
  db: Database, request: Request, eventId: string, invitationId: string,
  revoke: Revoke = revokeEventAccountInvitationAsOwner,
  authenticate: Authenticate = authenticateUserAccountSession, environment: Environment = process.env
): Promise<Response> {
  const configured = policy(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedOrganizerOrigin(request, configured.value)) return organizerFailure(403, "FORBIDDEN");
  if (!uuid.test(eventId) || !uuid.test(invitationId)) return organizerFailure(400, "INVALID_REQUEST");
  const proof = organizerSessionProof(request, configured.value, true);
  try {
    const auth = await authenticate(db, { ...proof, requireCsrf: true });
    if (auth.status !== "authenticated") return failure(auth.status);
  } catch { return organizerFailure(500, "INTERNAL_ERROR"); }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!organizerAccountInvitationRevokeIdempotencyKeySchema.safeParse(idempotencyKey).success) {
    return organizerFailure(400, "INVALID_REQUEST");
  }
  let body: unknown;
  try { body = await readOrganizerJson(request); } catch { return organizerFailure(400, "INVALID_REQUEST"); }
  const parsed = organizerAccountInvitationRevokeRequestSchema.safeParse(body);
  if (!parsed.success || parsed.data.eventId !== eventId || parsed.data.invitationId !== invitationId) {
    return organizerFailure(400, "INVALID_REQUEST");
  }
  try {
    const result = await revoke(db, { ...proof, requireCsrf: true, idempotencyKey, invitationId,
      readBody: async () => parsed.data });
    if (result.status !== "revoked") return failure(result.status);
    const response = organizerAccountInvitationRevokeResponseSchema.parse(result.response);
    if (response.eventId !== eventId || response.invitationId !== invitationId ||
      response.requestId !== parsed.data.requestId) return organizerFailure(500, "INTERNAL_ERROR");
    return organizerJson(response);
  } catch { return organizerFailure(500, "INTERNAL_ERROR"); }
}
