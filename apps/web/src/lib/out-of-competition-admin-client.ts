import { outOfCompetitionCandidateResponseSchema, outOfCompetitionRequestSchema, outOfCompetitionResponseSchema, type OutOfCompetitionCandidateResponse, type OutOfCompetitionRequest, type OutOfCompetitionResponse } from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import { readOutOfCompetitionAdminCsrfCookie } from "./out-of-competition-admin-cookies";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export type OutOfCompetitionCandidates = OutOfCompetitionCandidateResponse;
export type OutOfCompetitionCandidate = OutOfCompetitionCandidateResponse["entries"][number];
export interface OutOfCompetitionAttempt { requestId: string; entryId: string; displayName: string; className: string; request: OutOfCompetitionRequest; }

export function parseOutOfCompetitionCandidates(value: unknown, expectedRaceId: string): OutOfCompetitionCandidates {
  const parsed = outOfCompetitionCandidateResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.raceId !== expectedRaceId) throw new Error(sv.outOfCompetitionInvalidResponse);
  return parsed.data;
}

export function createOutOfCompetitionAttempt(candidate: OutOfCompetitionCandidate, context: Pick<OutOfCompetitionCandidates, "snapshotVersion" | "policyVersion">, webCrypto: Crypto = globalThis.crypto): OutOfCompetitionAttempt {
  const requestId = webCrypto.randomUUID();
  if (!UUID_PATTERN.test(requestId) || candidate.readiness !== "READY" || candidate.targetResultRevision === null) throw new Error(sv.outOfCompetitionInvalidAttempt);
  return {
    requestId, entryId: candidate.id, displayName: candidate.displayName, className: candidate.className,
    request: outOfCompetitionRequestSchema.parse({
      formatVersion: 1, expectedEntryVersion: candidate.entryVersion, expectedClassId: candidate.classId,
      expectedCourseVersionId: candidate.courseVersionId, expectedSnapshotVersion: context.snapshotVersion,
      expectedResultRevision: { id: candidate.targetResultRevision.id, revision: candidate.targetResultRevision.revision, status: candidate.targetResultRevision.status }, policyVersion: context.policyVersion
    })
  };
}

export function parseOutOfCompetitionResponse(value: unknown, attempt: OutOfCompetitionAttempt, expectedRaceId: string): OutOfCompetitionResponse {
  const parsed = outOfCompetitionResponseSchema.safeParse(value); const response = parsed.success ? parsed.data : undefined;
  if (!response || response.requestId !== attempt.requestId || response.raceId !== expectedRaceId || response.entryId !== attempt.entryId || response.targetResultRevisionId !== attempt.request.expectedResultRevision.id || response.targetResultRevision !== attempt.request.expectedResultRevision.revision || response.policyVersion !== attempt.request.policyVersion || response.snapshotVersion !== attempt.request.expectedSnapshotVersion || response.courseVersionId !== attempt.request.expectedCourseVersionId || response.revision !== attempt.request.expectedResultRevision.revision + 1) throw new Error(sv.outOfCompetitionInvalidResponse);
  return response;
}

export function readOutOfCompetitionAdminCsrf(cookieText: string, currentUrl: URL): string {
  const value = readOutOfCompetitionAdminCsrfCookie(cookieText, currentUrl);
  if (value !== undefined && /^[A-Za-z0-9_-]{43}$/.test(value)) return value;
  throw new Error(sv.outOfCompetitionLoginAgain);
}

export function isDefinitiveOutOfCompetitionRejection(status: number): boolean { return status === 400 || status === 404 || status === 409 || status === 413; }
