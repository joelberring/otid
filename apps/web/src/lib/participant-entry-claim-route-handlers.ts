import {
  issueParticipantEntryClaimAsAdmin,
  listParticipantEntryClaimsAsAdmin,
  revokeParticipantEntryClaimAsAdmin,
  redeemParticipantEntryClaimAsAccount,
  listMyParticipantResults
} from "@o-tid/application";
import {
  participantClaimIssueRequestSchema, participantClaimIssueResponseSchema,
  participantClaimIssueIdempotencyKeySchema, participantClaimListResponseSchema,
  participantClaimRevokeRequestSchema, participantClaimRevokeResponseSchema,
  participantClaimRevokeIdempotencyKeySchema, participantClaimRedeemRequestSchema,
  participantClaimRedeemResponseSchema, participantClaimRedeemIdempotencyKeySchema,
  participantOwnResultsResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { RACE_ADMINISTRATOR_LOOPBACK_COOKIES, RACE_ADMINISTRATOR_PRODUCTION_COOKIES } from "./race-administrator-cookies";
import {
  entryClassAdminFailure, entryClassAdminJson, entryClassAdminSecurityPolicy,
  entryClassAdminSessionProof, hasExpectedEntryClassAdminOrigin,
  hasNoEntryClassAdminRequestBody, readEntryClassAdminJson
} from "./entry-class-admin-security";
import {
  hasExpectedOrganizerOrigin, hasNoOrganizerRequestBody, organizerFailure,
  organizerJson, organizerSecurityPolicy, organizerSessionProof, readOrganizerJson
} from "./organizer-account-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function adminFailure(status: 400 | 401 | 403 | 404 | 409 | 500) {
  return entryClassAdminFailure(status, status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" :
    status === 404 ? "NOT_FOUND" : status === 409 ? "CONFLICT" : status === 400 ? "INVALID_REQUEST" : "INTERNAL_ERROR");
}
function accountFailure(status: 400 | 401 | 403 | 404 | 409 | 500) {
  return organizerFailure(status, status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" :
    status === 404 ? "UNAUTHORIZED" : status === 409 ? "CONFLICT" : status === 400 ? "INVALID_REQUEST" : "INTERNAL_ERROR");
}
function adminPolicy(environment: Environment) {
  try {
    const base = entryClassAdminSecurityPolicy(environment);
    return { policy: { ...base, cookieNames: base.secureCookies ? RACE_ADMINISTRATOR_PRODUCTION_COOKIES : RACE_ADMINISTRATOR_LOOPBACK_COOKIES } } as const;
  }
  catch { return { response: adminFailure(500) } as const; }
}
function accountPolicy(environment: Environment) {
  try { return { policy: organizerSecurityPolicy(environment) } as const; }
  catch { return { response: accountFailure(500) } as const; }
}
function statusFailure(status: string) {
  switch (status) {
    case "unauthorized": return adminFailure(401);
    case "forbidden": return adminFailure(403);
    case "invalid-request": return adminFailure(400);
    case "not-found": return adminFailure(404);
    case "conflict": return adminFailure(409);
    default: return adminFailure(500);
  }
}
function accountStatusFailure(status: string) {
  switch (status) {
    case "unauthorized": return accountFailure(401);
    case "forbidden": return accountFailure(403);
    case "invalid-request": return accountFailure(400);
    case "conflict": return accountFailure(409);
    case "not-found": return accountFailure(404);
    default: return accountFailure(500);
  }
}

export async function participantClaimListRoute(db: Database, request: Request, raceId: string, entryId: string,
  list: typeof listParticipantEntryClaimsAsAdmin = listParticipantEntryClaimsAsAdmin, environment: Environment = process.env): Promise<Response> {
  if (!uuid.test(raceId) || !uuid.test(entryId)) return adminFailure(400);
  const configured = adminPolicy(environment); if ("response" in configured) return configured.response;
  if (!await hasNoEntryClassAdminRequestBody(request)) return adminFailure(400);
  try {
    const result = await list(db, { ...entryClassAdminSessionProof(request, configured.policy, false), raceId, entryId });
    if (result.status !== "ok") return statusFailure(result.status);
    const response = participantClaimListResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.entryId !== entryId) return adminFailure(500);
    return entryClassAdminJson(response);
  } catch { return adminFailure(500); }
}

export async function participantClaimIssueRoute(db: Database, request: Request, raceId: string, entryId: string,
  issue: typeof issueParticipantEntryClaimAsAdmin = issueParticipantEntryClaimAsAdmin, environment: Environment = process.env): Promise<Response> {
  if (!uuid.test(raceId) || !uuid.test(entryId)) return adminFailure(400);
  const configured = adminPolicy(environment); if ("response" in configured) return configured.response;
  if (!hasExpectedEntryClassAdminOrigin(request, configured.policy)) return adminFailure(403);
  let body: unknown; try { body = await readEntryClassAdminJson(request); } catch { return adminFailure(400); }
  const parsed = participantClaimIssueRequestSchema.safeParse(body), key = request.headers.get("idempotency-key");
  if (!parsed.success || parsed.data.raceId !== raceId || parsed.data.entryId !== entryId ||
    !participantClaimIssueIdempotencyKeySchema.safeParse(key).success) return adminFailure(400);
  try {
    const result = await issue(db, { ...entryClassAdminSessionProof(request, configured.policy, true), raceId, entryId,
      idempotencyKey: key, request: parsed.data });
    if (result.status !== "issued") return statusFailure(result.status);
    const response = participantClaimIssueResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.entryId !== entryId || response.requestId !== parsed.data.requestId) return adminFailure(500);
    return entryClassAdminJson(response, response.replayed ? 200 : 201);
  } catch { return adminFailure(500); }
}

export async function participantClaimRevokeRoute(db: Database, request: Request, raceId: string, entryId: string, claimId: string,
  revoke: typeof revokeParticipantEntryClaimAsAdmin = revokeParticipantEntryClaimAsAdmin, environment: Environment = process.env): Promise<Response> {
  if (![raceId, entryId, claimId].every(value => uuid.test(value))) return adminFailure(400);
  const configured = adminPolicy(environment); if ("response" in configured) return configured.response;
  if (!hasExpectedEntryClassAdminOrigin(request, configured.policy)) return adminFailure(403);
  let body: unknown; try { body = await readEntryClassAdminJson(request); } catch { return adminFailure(400); }
  const parsed = participantClaimRevokeRequestSchema.safeParse(body), key = request.headers.get("idempotency-key");
  if (!parsed.success || parsed.data.raceId !== raceId || parsed.data.entryId !== entryId || parsed.data.claimId !== claimId ||
    !participantClaimRevokeIdempotencyKeySchema.safeParse(key).success) return adminFailure(400);
  try {
    const result = await revoke(db, { ...entryClassAdminSessionProof(request, configured.policy, true), raceId, entryId, claimId,
      idempotencyKey: key, request: parsed.data });
    if (result.status !== "revoked") return statusFailure(result.status);
    const response = participantClaimRevokeResponseSchema.parse(result.response);
    if (response.claimId !== claimId || response.requestId !== parsed.data.requestId) return adminFailure(500);
    return entryClassAdminJson(response, response.replayed ? 200 : 201);
  } catch { return adminFailure(500); }
}

export async function participantClaimRedeemRoute(db: Database, request: Request,
  redeem: typeof redeemParticipantEntryClaimAsAccount = redeemParticipantEntryClaimAsAccount, environment: Environment = process.env): Promise<Response> {
  const configured = accountPolicy(environment); if ("response" in configured) return configured.response;
  if (!hasExpectedOrganizerOrigin(request, configured.policy)) return accountFailure(403);
  const proof = organizerSessionProof(request, configured.policy, true);
  const key = request.headers.get("idempotency-key");
  if (!participantClaimRedeemIdempotencyKeySchema.safeParse(key).success) return accountFailure(400);
  let body: unknown; try { body = await readOrganizerJson(request); } catch { return accountFailure(400); }
  const parsed = participantClaimRedeemRequestSchema.safeParse(body);
  if (!parsed.success || key !== `participant-claim-redeem:${parsed.data.requestId}`) return accountFailure(400);
  try {
    const result = await redeem(db, { ...proof, idempotencyKey: key, request: parsed.data });
    if (result.status !== "redeemed") return accountStatusFailure(result.status);
    const response = participantClaimRedeemResponseSchema.parse(result.response);
    if (response.requestId !== parsed.data.requestId) return accountFailure(500);
    return organizerJson(response, response.replayed ? 200 : 201);
  } catch { return accountFailure(500); }
}

export async function participantOwnResultsRoute(db: Database, request: Request,
  list: typeof listMyParticipantResults = listMyParticipantResults, environment: Environment = process.env): Promise<Response> {
  const configured = accountPolicy(environment); if ("response" in configured) return configured.response;
  if (!await hasNoOrganizerRequestBody(request)) return accountFailure(400);
  try {
    const result = await list(db, organizerSessionProof(request, configured.policy, false));
    if (result.status !== "ok") return accountStatusFailure(result.status);
    return organizerJson(participantOwnResultsResponseSchema.parse(result.response));
  } catch { return accountFailure(500); }
}
