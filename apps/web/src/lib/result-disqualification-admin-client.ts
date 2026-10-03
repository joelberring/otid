import {
  resultDisqualificationCandidateResponseSchema,
  resultDisqualificationRequestSchema,
  resultDisqualificationResponseSchema,
  type ResultDisqualificationCandidateResponse,
  type ResultDisqualificationRequest,
  type ResultDisqualificationResponse
} from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import { readResultDisqualificationAdminCsrfCookie } from "./result-disqualification-admin-cookies";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type ResultDisqualificationCandidates = ResultDisqualificationCandidateResponse;
export type ResultDisqualificationCandidate = ResultDisqualificationCandidateResponse["entries"][number];

export interface ResultDisqualificationAttempt {
  requestId: string;
  entryId: string;
  displayName: string;
  className: string;
  request: ResultDisqualificationRequest;
}

export function parseResultDisqualificationCandidates(
  value: unknown,
  expectedRaceId: string
): ResultDisqualificationCandidates {
  const parsed = resultDisqualificationCandidateResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.raceId !== expectedRaceId) {
    throw new Error(sv.resultDisqualificationInvalidResponse);
  }
  return parsed.data;
}

export function createResultDisqualificationAttempt(
  candidate: ResultDisqualificationCandidate,
  context: Pick<ResultDisqualificationCandidates, "snapshotVersion" | "policyVersion">,
  webCrypto: Crypto = globalThis.crypto
): ResultDisqualificationAttempt {
  const requestId = webCrypto.randomUUID();
  if (!UUID_PATTERN.test(requestId) || candidate.readiness !== "READY" || candidate.targetResultRevision === null) {
    throw new Error(sv.resultDisqualificationInvalidAttempt);
  }
  return {
    requestId,
    entryId: candidate.id,
    displayName: candidate.displayName,
    className: candidate.className,
    request: resultDisqualificationRequestSchema.parse({
      formatVersion: 1,
      expectedEntryVersion: candidate.entryVersion,
      expectedClassId: candidate.classId,
      expectedCourseVersionId: candidate.courseVersionId,
      expectedSnapshotVersion: context.snapshotVersion,
      expectedResultRevision: {
        id: candidate.targetResultRevision.id,
        revision: candidate.targetResultRevision.revision,
        status: candidate.targetResultRevision.status
      },
      policyVersion: context.policyVersion
    })
  };
}

export function parseResultDisqualificationResponse(
  value: unknown,
  attempt: ResultDisqualificationAttempt,
  expectedRaceId: string
): ResultDisqualificationResponse {
  const parsed = resultDisqualificationResponseSchema.safeParse(value);
  const response = parsed.success ? parsed.data : undefined;
  if (!response || response.requestId !== attempt.requestId || response.raceId !== expectedRaceId ||
      response.entryId !== attempt.entryId ||
      response.targetResultRevisionId !== attempt.request.expectedResultRevision.id ||
      response.targetResultRevision !== attempt.request.expectedResultRevision.revision ||
      response.policyVersion !== attempt.request.policyVersion ||
      response.snapshotVersion !== attempt.request.expectedSnapshotVersion ||
      response.courseVersionId !== attempt.request.expectedCourseVersionId ||
      response.revision !== attempt.request.expectedResultRevision.revision + 1) {
    throw new Error(sv.resultDisqualificationInvalidResponse);
  }
  return response;
}

export function readResultDisqualificationAdminCsrf(cookieText: string, currentUrl: URL): string {
  const value = readResultDisqualificationAdminCsrfCookie(cookieText, currentUrl);
  if (value !== undefined && /^[A-Za-z0-9_-]{43}$/.test(value)) return value;
  throw new Error(sv.resultDisqualificationLoginAgain);
}

export function isDefinitiveResultDisqualificationRejection(status: number): boolean {
  return status === 400 || status === 404 || status === 409 || status === 413;
}
