import { didNotFinishCandidateResponseSchema, didNotFinishRequestSchema, didNotFinishResponseSchema, type DidNotFinishCandidateResponse, type DidNotFinishRequest, type DidNotFinishResponse } from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import { readDidNotFinishAdminCsrfCookie } from "./did-not-finish-admin-cookies";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export type DidNotFinishCandidates = DidNotFinishCandidateResponse;
export type DidNotFinishCandidate = DidNotFinishCandidateResponse["entries"][number];
export interface DidNotFinishAttempt { requestId: string; entryId: string; displayName: string; className: string; request: DidNotFinishRequest; }

export function parseDidNotFinishCandidates(value: unknown, expectedRaceId: string): DidNotFinishCandidates {
  const parsed = didNotFinishCandidateResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.raceId !== expectedRaceId) throw new Error(sv.didNotFinishInvalidResponse);
  return parsed.data;
}

export function createDidNotFinishAttempt(candidate: DidNotFinishCandidate, context: Pick<DidNotFinishCandidates, "snapshotVersion" | "policyVersion">, webCrypto: Crypto = globalThis.crypto): DidNotFinishAttempt {
  const requestId = webCrypto.randomUUID();
  if (!UUID_PATTERN.test(requestId) || candidate.readiness !== "READY" || candidate.targetResultRevision === null) throw new Error(sv.didNotFinishInvalidAttempt);
  return {
    requestId, entryId: candidate.id, displayName: candidate.displayName, className: candidate.className,
    request: didNotFinishRequestSchema.parse({
      formatVersion: 1, expectedEntryVersion: candidate.entryVersion, expectedClassId: candidate.classId,
      expectedCourseVersionId: candidate.courseVersionId, expectedSnapshotVersion: context.snapshotVersion,
      expectedResultRevision: { id: candidate.targetResultRevision.id, revision: candidate.targetResultRevision.revision, status: candidate.targetResultRevision.status }, policyVersion: context.policyVersion
    })
  };
}

export function parseDidNotFinishResponse(value: unknown, attempt: DidNotFinishAttempt, expectedRaceId: string): DidNotFinishResponse {
  const parsed = didNotFinishResponseSchema.safeParse(value); const response = parsed.success ? parsed.data : undefined;
  if (!response || response.requestId !== attempt.requestId || response.raceId !== expectedRaceId || response.entryId !== attempt.entryId || response.targetResultRevisionId !== attempt.request.expectedResultRevision.id || response.targetResultRevision !== attempt.request.expectedResultRevision.revision || response.policyVersion !== attempt.request.policyVersion || response.snapshotVersion !== attempt.request.expectedSnapshotVersion || response.courseVersionId !== attempt.request.expectedCourseVersionId) throw new Error(sv.didNotFinishInvalidResponse);
  if (response.revision !== attempt.request.expectedResultRevision.revision + 1) throw new Error(sv.didNotFinishInvalidResponse);
  return response;
}

export function readDidNotFinishAdminCsrf(cookieText: string, currentUrl: URL): string {
  const value = readDidNotFinishAdminCsrfCookie(cookieText, currentUrl);
  if (value !== undefined && /^[A-Za-z0-9_-]{43}$/.test(value)) return value;
  throw new Error(sv.didNotFinishLoginAgain);
}

export function isDefinitiveDidNotFinishRejection(status: number): boolean { return status === 400 || status === 404 || status === 409 || status === 413; }
