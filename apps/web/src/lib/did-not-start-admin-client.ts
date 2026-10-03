import {
  didNotStartCandidateResponseSchema,
  didNotStartRequestSchema,
  didNotStartResponseSchema,
  type DidNotStartCandidateResponse,
  type DidNotStartRequest,
  type DidNotStartResponse
} from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import { readDidNotStartAdminCsrfCookie } from "./did-not-start-admin-cookies";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type DidNotStartCandidates = DidNotStartCandidateResponse;
export type DidNotStartCandidate = DidNotStartCandidateResponse["entries"][number];

export interface DidNotStartAttempt extends DidNotStartRequest {
  requestId: string;
  entryId: string;
  displayName: string;
  className: string;
}

export function parseDidNotStartCandidates(value: unknown, expectedRaceId: string): DidNotStartCandidates {
  const parsed = didNotStartCandidateResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.raceId !== expectedRaceId) throw new Error(sv.didNotStartInvalidResponse);
  return parsed.data;
}

export function createDidNotStartAttempt(
  candidate: DidNotStartCandidate,
  context: Pick<DidNotStartCandidates, "snapshotVersion" | "decisionPolicyVersion">,
  webCrypto: Crypto = globalThis.crypto
): DidNotStartAttempt {
  const requestId = webCrypto.randomUUID();
  if (!UUID_PATTERN.test(requestId) || candidate.readiness !== "READY" || candidate.latestResultRevision !== null) {
    throw new Error(sv.didNotStartInvalidAttempt);
  }
  return {
    requestId,
    entryId: candidate.id,
    displayName: candidate.displayName,
    className: candidate.className,
    formatVersion: 1,
    expectedEntryVersion: candidate.entryVersion,
    expectedClassId: candidate.classId,
    expectedCourseVersionId: candidate.courseVersionId,
    expectedSnapshotVersion: context.snapshotVersion,
    expectedLatestResultRevision: null,
    policyVersion: context.decisionPolicyVersion
  };
}

export function didNotStartBody(attempt: DidNotStartAttempt): DidNotStartRequest {
  return didNotStartRequestSchema.parse({
    formatVersion: attempt.formatVersion,
    expectedEntryVersion: attempt.expectedEntryVersion,
    expectedClassId: attempt.expectedClassId,
    expectedCourseVersionId: attempt.expectedCourseVersionId,
    expectedSnapshotVersion: attempt.expectedSnapshotVersion,
    expectedLatestResultRevision: null,
    policyVersion: attempt.policyVersion
  });
}

export function parseDidNotStartResponse(
  value: unknown,
  attempt: DidNotStartAttempt,
  expectedRaceId: string
): DidNotStartResponse {
  const parsed = didNotStartResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.requestId !== attempt.requestId || parsed.data.raceId !== expectedRaceId ||
      parsed.data.entryId !== attempt.entryId || parsed.data.revision !== 1 ||
      parsed.data.snapshotVersion !== attempt.expectedSnapshotVersion ||
      parsed.data.courseVersionId !== attempt.expectedCourseVersionId ||
      parsed.data.decisionPolicyVersion !== attempt.policyVersion) {
    throw new Error(sv.didNotStartInvalidResponse);
  }
  return parsed.data;
}

export function readDidNotStartAdminCsrf(cookieText: string, currentUrl: URL): string {
  const value = readDidNotStartAdminCsrfCookie(cookieText, currentUrl);
  if (value !== undefined && /^[A-Za-z0-9_-]{43}$/.test(value)) return value;
  throw new Error(sv.didNotStartLoginAgain);
}

export function isDefinitiveDidNotStartRejection(status: number): boolean {
  return status === 400 || status === 404 || status === 409;
}
