import { readStartCheckinConflictReviewAsAdmin, reviewStartCheckinConflictsAsAdmin } from "@o-tid/application";
import { StartCheckinConflictReviewCandidateSchema, StartCheckinConflictReviewResponseSchema } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  StartCheckinAdminConfigurationError,
  hasExpectedStartCheckinAdminOrigin,
  hasNoStartCheckinAdminRequestBody,
  startCheckinAdminFailure,
  startCheckinAdminJson,
  startCheckinAdminSecurityPolicy,
  startCheckinAdminSessionProof
} from "./start-checkin-admin-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Read = typeof readStartCheckinConflictReviewAsAdmin;
type Review = typeof reviewStartCheckinConflictsAsAdmin;

export const CHECKIN_CONFLICT_REVIEW_MAX_BODY_BYTES = 64 * 1024;

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class ConflictReviewRequestError extends Error {
  constructor(readonly tooLarge = false) { super(); }
}

function policyOrFailure(environment: Environment) {
  try {
    return { policy: startCheckinAdminSecurityPolicy("FINISH_FOREST_WATCH", environment) } as const;
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
    case "too-large": return startCheckinAdminFailure(413, "TOO_LARGE");
    default: return null;
  }
}

export async function readReviewJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type") !== "application/json") throw new ConflictReviewRequestError();
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) < 1)) {
    throw new ConflictReviewRequestError();
  }
  if (declaredLength !== null && Number(declaredLength) > CHECKIN_CONFLICT_REVIEW_MAX_BODY_BYTES) {
    throw new ConflictReviewRequestError(true);
  }
  if (!request.body) throw new ConflictReviewRequestError();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > CHECKIN_CONFLICT_REVIEW_MAX_BODY_BYTES) throw new ConflictReviewRequestError(true);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  if (length === 0) throw new ConflictReviewRequestError();
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new ConflictReviewRequestError();
  }
}

export async function checkinConflictReviewReadRoute(
  db: Database, request: Request, raceId: string, entryId: string,
  read: Read = readStartCheckinConflictReviewAsAdmin, environment: Environment = process.env
): Promise<Response> {
  if (!CANONICAL_UUID.test(raceId) || !CANONICAL_UUID.test(entryId)) return startCheckinAdminFailure(400, "INVALID_REQUEST");
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (new URL(request.url).search || !await hasNoStartCheckinAdminRequestBody(request)) {
    return startCheckinAdminFailure(400, "INVALID_REQUEST");
  }
  const proof = startCheckinAdminSessionProof(request, configured.policy, false);
  try {
    const result = await read(db, { ...proof, raceId, entryId, capability: "FINISH_FOREST_WATCH" });
    const failure = applicationFailure(result);
    if (failure) return failure;
    if (!("response" in result)) return startCheckinAdminFailure(500, "INTERNAL_ERROR");
    const response = StartCheckinConflictReviewCandidateSchema.parse(result.response);
    if (response.source.raceId !== raceId || response.source.entryId !== entryId) return startCheckinAdminFailure(500, "INTERNAL_ERROR");
    return startCheckinAdminJson(response);
  } catch {
    return startCheckinAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function checkinConflictReviewRoute(
  db: Database, request: Request, raceId: string,
  review: Review = reviewStartCheckinConflictsAsAdmin, environment: Environment = process.env
): Promise<Response> {
  if (!CANONICAL_UUID.test(raceId)) return startCheckinAdminFailure(400, "INVALID_REQUEST");
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedStartCheckinAdminOrigin(request, configured.policy)) return startCheckinAdminFailure(403, "FORBIDDEN");
  const proof = startCheckinAdminSessionProof(request, configured.policy, true);
  let readError: ConflictReviewRequestError | undefined;
  try {
    const result = await review(db, { ...proof, raceId, capability: "FINISH_FOREST_WATCH", readBody: async () => {
      try { return await readReviewJson(request); } catch (error) {
        if (error instanceof ConflictReviewRequestError) readError = error;
        throw error;
      }
    } });
    const failure = applicationFailure(result);
    if (failure) return failure;
    if (!("response" in result)) return startCheckinAdminFailure(500, "INTERNAL_ERROR");
    const response = StartCheckinConflictReviewResponseSchema.parse(result.response);
    if (response.raceId !== raceId) return startCheckinAdminFailure(500, "INTERNAL_ERROR");
    return startCheckinAdminJson(response);
  } catch {
    if (readError) return startCheckinAdminFailure(readError.tooLarge ? 413 : 400, readError.tooLarge ? "TOO_LARGE" : "INVALID_REQUEST");
    return startCheckinAdminFailure(500, "INTERNAL_ERROR");
  }
}
