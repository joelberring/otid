import {
  resultApprovalWithdrawalListResponseSchema,
  resultApprovalWithdrawalRequestSchema,
  resultApprovalWithdrawalResponseSchema,
  type ResultApprovalWithdrawalListResponse,
  type ResultApprovalWithdrawalRequest,
  type ResultApprovalWithdrawalResponse
} from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import { readResultApprovalWithdrawalAdminCsrfCookie } from "./result-approval-withdrawal-admin-cookies";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type ResultApprovalWithdrawals = ResultApprovalWithdrawalListResponse;
export type ResultApprovalWithdrawalCandidate = ResultApprovalWithdrawalListResponse["entries"][number];

export interface ResultApprovalWithdrawalAttempt {
  requestId: string;
  entryId: string;
  displayName: string;
  className: string;
  request: ResultApprovalWithdrawalRequest;
}

export function parseResultApprovalWithdrawals(
  value: unknown,
  expectedRaceId: string
): ResultApprovalWithdrawals {
  const parsed = resultApprovalWithdrawalListResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.raceId !== expectedRaceId) {
    throw new Error(sv.resultApprovalWithdrawalInvalidResponse);
  }
  return parsed.data;
}

export function createResultApprovalWithdrawalAttempt(
  candidate: ResultApprovalWithdrawalCandidate,
  context: Pick<ResultApprovalWithdrawals, "snapshotVersion" | "policyVersion">,
  webCrypto: Crypto = globalThis.crypto
): ResultApprovalWithdrawalAttempt {
  const requestId = webCrypto.randomUUID();
  if (!UUID_PATTERN.test(requestId) || candidate.state !== "WITHDRAWABLE" || candidate.withdrawal !== null) {
    throw new Error(sv.resultApprovalWithdrawalInvalidAttempt);
  }
  return {
    requestId,
    entryId: candidate.id,
    displayName: candidate.displayName,
    className: candidate.className,
    request: resultApprovalWithdrawalRequestSchema.parse({
      formatVersion: 1,
      expectedEntryVersion: candidate.entryVersion,
      expectedClassId: candidate.classId,
      expectedCourseVersionId: candidate.courseVersionId,
      expectedSnapshotVersion: context.snapshotVersion,
      expectedResultApprovalDecisionId: candidate.resultApprovalDecisionId,
      expectedTargetResultRevision: candidate.targetResultRevision,
      expectedApprovedResultRevision: candidate.approvedResultRevision,
      expectedAbsoluteResultRevision: candidate.absoluteResultRevision,
      expectedRestorationSourceResultRevision: candidate.restorationSourceResultRevision,
      policyVersion: context.policyVersion
    })
  };
}

export function parseResultApprovalWithdrawalResponse(
  value: unknown,
  attempt: ResultApprovalWithdrawalAttempt,
  expectedRaceId: string
): ResultApprovalWithdrawalResponse {
  const parsed = resultApprovalWithdrawalResponseSchema.safeParse(value);
  const response = parsed.success ? parsed.data : undefined;
  if (!response || response.requestId !== attempt.requestId || response.raceId !== expectedRaceId ||
      response.entryId !== attempt.entryId ||
      response.resultApprovalDecisionId !== attempt.request.expectedResultApprovalDecisionId ||
      response.approvedResultRevisionId !== attempt.request.expectedApprovedResultRevision.id ||
      response.restorationSourceResultRevisionId !== attempt.request.expectedRestorationSourceResultRevision.id ||
      response.policyVersion !== attempt.request.policyVersion ||
      response.snapshotVersion !== attempt.request.expectedSnapshotVersion ||
      response.courseVersionId !== attempt.request.expectedCourseVersionId ||
      response.revision !== attempt.request.expectedAbsoluteResultRevision.revision + 1 ||
      response.status !== attempt.request.expectedRestorationSourceResultRevision.status ||
      response.reason !== attempt.request.expectedRestorationSourceResultRevision.reason) {
    throw new Error(sv.resultApprovalWithdrawalInvalidResponse);
  }
  return response;
}

export function readResultApprovalWithdrawalAdminCsrf(cookieText: string, currentUrl: URL): string {
  const value = readResultApprovalWithdrawalAdminCsrfCookie(cookieText, currentUrl);
  if (value !== undefined && /^[A-Za-z0-9_-]{43}$/.test(value)) return value;
  throw new Error(sv.resultApprovalWithdrawalLoginAgain);
}

export function isDefinitiveResultApprovalWithdrawalRejection(status: number): boolean {
  return status === 400 || status === 404 || status === 409 || status === 413;
}
