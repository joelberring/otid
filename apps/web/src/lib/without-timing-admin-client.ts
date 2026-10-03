import {
  withoutTimingCandidateResponseSchema,
  withoutTimingRequestSchema,
  withoutTimingResponseSchema,
  type WithoutTimingCandidateResponse,
  type WithoutTimingRequest,
  type WithoutTimingResponse
} from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import { readWithoutTimingAdminCsrfCookie } from "./without-timing-admin-cookies";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export type WithoutTimingCandidates = WithoutTimingCandidateResponse;
export type WithoutTimingCandidate = WithoutTimingCandidates["entries"][number];
export interface WithoutTimingAttempt {
  requestId: string;
  entryId: string;
  displayName: string;
  className: string;
  request: WithoutTimingRequest;
}

export function parseWithoutTimingCandidates(value: unknown, expectedRaceId: string): WithoutTimingCandidates {
  const parsed = withoutTimingCandidateResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.raceId !== expectedRaceId) throw new Error(sv.withoutTimingInvalidResponse);
  return parsed.data;
}

export function createWithoutTimingAttempt(
  candidate: WithoutTimingCandidate,
  context: Pick<WithoutTimingCandidates, "snapshotVersion" | "policyVersion">,
  webCrypto: Crypto = globalThis.crypto
): WithoutTimingAttempt {
  const requestId = webCrypto.randomUUID();
  if (!UUID_PATTERN.test(requestId) || candidate.readiness !== "READY" || candidate.targetResultRevision === null) {
    throw new Error(sv.withoutTimingInvalidAttempt);
  }
  return {
    requestId,
    entryId: candidate.id,
    displayName: candidate.displayName,
    className: candidate.className,
    request: withoutTimingRequestSchema.parse({
      formatVersion: 1,
      expectedEntryVersion: candidate.entryVersion,
      expectedClassId: candidate.classId,
      expectedCourseVersionId: candidate.courseVersionId,
      expectedSnapshotVersion: context.snapshotVersion,
      expectedResultRevision: {
        id: candidate.targetResultRevision.id,
        revision: candidate.targetResultRevision.revision,
        status: candidate.targetResultRevision.status,
        reason: candidate.targetResultRevision.reason
      },
      policyVersion: context.policyVersion
    })
  };
}

export function parseWithoutTimingResponse(
  value: unknown,
  attempt: WithoutTimingAttempt,
  expectedRaceId: string
): WithoutTimingResponse {
  const parsed = withoutTimingResponseSchema.safeParse(value);
  const response = parsed.success ? parsed.data : undefined;
  if (!response || response.requestId !== attempt.requestId || response.raceId !== expectedRaceId ||
      response.entryId !== attempt.entryId ||
      response.targetResultRevisionId !== attempt.request.expectedResultRevision.id ||
      response.targetResultRevision !== attempt.request.expectedResultRevision.revision ||
      response.policyVersion !== attempt.request.policyVersion ||
      response.snapshotVersion !== attempt.request.expectedSnapshotVersion ||
      response.courseVersionId !== attempt.request.expectedCourseVersionId ||
      response.revision !== attempt.request.expectedResultRevision.revision + 1) {
    throw new Error(sv.withoutTimingInvalidResponse);
  }
  return response;
}

export function readWithoutTimingAdminCsrf(cookieText: string, currentUrl: URL): string {
  const value = readWithoutTimingAdminCsrfCookie(cookieText, currentUrl);
  if (value !== undefined && /^[A-Za-z0-9_-]{43}$/.test(value)) return value;
  throw new Error(sv.withoutTimingLoginAgain);
}

export function isDefinitiveWithoutTimingRejection(status: number): boolean {
  return status === 400 || status === 404 || status === 409 || status === 413;
}
