import {
  redeemParticipantEntryClaimAsAccount,
  listMyParticipantResults
} from "@o-tid/application";
import {
  participantClaimRedeemRequestSchema,
  participantClaimRedeemResponseSchema, participantClaimRedeemIdempotencyKeySchema,
  participantOwnResultsResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  hasExpectedOrganizerOrigin, hasNoOrganizerRequestBody, organizerFailure,
  organizerJson, organizerSecurityPolicy, organizerSessionProof, readOrganizerJson
} from "./organizer-account-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
function accountFailure(status: 400 | 401 | 403 | 404 | 409 | 500) {
  return organizerFailure(status, status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" :
    status === 404 ? "UNAUTHORIZED" : status === 409 ? "CONFLICT" : status === 400 ? "INVALID_REQUEST" : "INTERNAL_ERROR");
}
function accountPolicy(environment: Environment) {
  try { return { policy: organizerSecurityPolicy(environment) } as const; }
  catch { return { response: accountFailure(500) } as const; }
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
