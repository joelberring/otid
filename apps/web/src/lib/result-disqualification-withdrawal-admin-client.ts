import {
  resultDisqualificationWithdrawalListResponseSchema,
  resultDisqualificationWithdrawalRequestSchema,
  resultDisqualificationWithdrawalResponseSchema,
  type ResultDisqualificationWithdrawalListResponse,
  type ResultDisqualificationWithdrawalRequest,
  type ResultDisqualificationWithdrawalResponse
} from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import { readResultDisqualificationWithdrawalAdminCsrfCookie } from "./result-disqualification-withdrawal-admin-cookies";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type ResultDisqualificationWithdrawals = ResultDisqualificationWithdrawalListResponse;
export type ResultDisqualificationWithdrawalCandidate = ResultDisqualificationWithdrawalListResponse["entries"][number];

export interface ResultDisqualificationWithdrawalAttempt {
  requestId: string;
  entryId: string;
  displayName: string;
  className: string;
  request: ResultDisqualificationWithdrawalRequest;
}

export function parseResultDisqualificationWithdrawals(
  value: unknown,
  expectedRaceId: string
): ResultDisqualificationWithdrawals {
  const parsed = resultDisqualificationWithdrawalListResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.raceId !== expectedRaceId) {
    throw new Error(sv.resultDisqualificationWithdrawalInvalidResponse);
  }
  return parsed.data;
}

export function createResultDisqualificationWithdrawalAttempt(
  candidate: ResultDisqualificationWithdrawalCandidate,
  context: Pick<ResultDisqualificationWithdrawals, "snapshotVersion" | "policyVersion">,
  webCrypto: Crypto = globalThis.crypto
): ResultDisqualificationWithdrawalAttempt {
  const requestId = webCrypto.randomUUID();
  if (!UUID_PATTERN.test(requestId) || candidate.state !== "WITHDRAWABLE" || candidate.withdrawal !== null) {
    throw new Error(sv.resultDisqualificationWithdrawalInvalidAttempt);
  }
  return {
    requestId,
    entryId: candidate.id,
    displayName: candidate.displayName,
    className: candidate.className,
    request: resultDisqualificationWithdrawalRequestSchema.parse({
      formatVersion: 1,
      expectedEntryVersion: candidate.entryVersion,
      expectedClassId: candidate.classId,
      expectedCourseVersionId: candidate.courseVersionId,
      expectedSnapshotVersion: context.snapshotVersion,
      expectedResultDisqualificationDecisionId: candidate.resultDisqualificationDecisionId,
      expectedTargetResultRevision: candidate.targetResultRevision,
      expectedDisqualifiedResultRevision: candidate.disqualifiedResultRevision,
      expectedAbsoluteResultRevision: candidate.absoluteResultRevision,
      expectedRestorationSourceResultRevision: candidate.restorationSourceResultRevision,
      policyVersion: context.policyVersion
    })
  };
}

export function parseResultDisqualificationWithdrawalResponse(
  value: unknown,
  attempt: ResultDisqualificationWithdrawalAttempt,
  expectedRaceId: string
): ResultDisqualificationWithdrawalResponse {
  const parsed = resultDisqualificationWithdrawalResponseSchema.safeParse(value);
  const response = parsed.success ? parsed.data : undefined;
  if (!response || response.requestId !== attempt.requestId || response.raceId !== expectedRaceId ||
      response.entryId !== attempt.entryId ||
      response.resultDisqualificationDecisionId !== attempt.request.expectedResultDisqualificationDecisionId ||
      response.disqualifiedResultRevisionId !== attempt.request.expectedDisqualifiedResultRevision.id ||
      response.restorationSourceResultRevisionId !== attempt.request.expectedRestorationSourceResultRevision.id ||
      response.policyVersion !== attempt.request.policyVersion ||
      response.snapshotVersion !== attempt.request.expectedSnapshotVersion ||
      response.courseVersionId !== attempt.request.expectedCourseVersionId ||
      response.revision !== attempt.request.expectedAbsoluteResultRevision.revision + 1 ||
      response.status !== attempt.request.expectedRestorationSourceResultRevision.status ||
      response.reason !== attempt.request.expectedRestorationSourceResultRevision.reason) {
    throw new Error(sv.resultDisqualificationWithdrawalInvalidResponse);
  }
  return response;
}

export function readResultDisqualificationWithdrawalAdminCsrf(cookieText: string, currentUrl: URL): string {
  const value = readResultDisqualificationWithdrawalAdminCsrfCookie(cookieText, currentUrl);
  if (value !== undefined && /^[A-Za-z0-9_-]{43}$/.test(value)) return value;
  throw new Error(sv.resultDisqualificationWithdrawalLoginAgain);
}

export function isDefinitiveResultDisqualificationWithdrawalRejection(status: number): boolean {
  return status === 400 || status === 404 || status === 409 || status === 413;
}
