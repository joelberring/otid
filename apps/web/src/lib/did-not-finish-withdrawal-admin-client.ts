import { didNotFinishWithdrawalListResponseSchema, didNotFinishWithdrawalRequestSchema, didNotFinishWithdrawalResponseSchema, type DidNotFinishWithdrawalListResponse, type DidNotFinishWithdrawalRequest, type DidNotFinishWithdrawalResponse } from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import { readDidNotFinishWithdrawalAdminCsrfCookie } from "./did-not-finish-withdrawal-admin-cookies";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export type DidNotFinishWithdrawals = DidNotFinishWithdrawalListResponse;
export type DidNotFinishWithdrawalCandidate = DidNotFinishWithdrawalListResponse["entries"][number];
export interface DidNotFinishWithdrawalAttempt { requestId: string; entryId: string; displayName: string; className: string; request: DidNotFinishWithdrawalRequest; }

export function parseDidNotFinishWithdrawals(value: unknown, expectedRaceId: string): DidNotFinishWithdrawals {
  const parsed = didNotFinishWithdrawalListResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.raceId !== expectedRaceId) throw new Error(sv.didNotFinishWithdrawalInvalidResponse);
  return parsed.data;
}

export function createDidNotFinishWithdrawalAttempt(candidate: DidNotFinishWithdrawalCandidate, context: Pick<DidNotFinishWithdrawals, "snapshotVersion" | "policyVersion">, webCrypto: Crypto = globalThis.crypto): DidNotFinishWithdrawalAttempt {
  const requestId = webCrypto.randomUUID();
  if (!UUID_PATTERN.test(requestId) || candidate.state !== "WITHDRAWABLE" || candidate.withdrawal !== null) throw new Error(sv.didNotFinishWithdrawalInvalidAttempt);
  return {
    requestId, entryId: candidate.id, displayName: candidate.displayName, className: candidate.className,
    request: didNotFinishWithdrawalRequestSchema.parse({
      formatVersion: 1, expectedEntryVersion: candidate.entryVersion, expectedClassId: candidate.classId,
      expectedCourseVersionId: candidate.courseVersionId, expectedSnapshotVersion: context.snapshotVersion,
      expectedDidNotFinishDecisionId: candidate.didNotFinishDecisionId,
      expectedTargetResultRevision: candidate.targetResultRevision,
      expectedDidNotFinishResultRevision: candidate.didNotFinishResultRevision,
      expectedAbsoluteResultRevision: candidate.absoluteResultRevision,
      expectedRestorationSourceResultRevision: candidate.restorationSourceResultRevision,
      reason: "ERRONEOUS_MANUAL_DID_NOT_FINISH",
      policyVersion: context.policyVersion
    })
  };
}

export function parseDidNotFinishWithdrawalResponse(value: unknown, attempt: DidNotFinishWithdrawalAttempt, expectedRaceId: string): DidNotFinishWithdrawalResponse {
  const parsed = didNotFinishWithdrawalResponseSchema.safeParse(value); const response = parsed.success ? parsed.data : undefined;
  if (!response || response.requestId !== attempt.requestId || response.raceId !== expectedRaceId || response.entryId !== attempt.entryId || response.didNotFinishDecisionId !== attempt.request.expectedDidNotFinishDecisionId || response.didNotFinishResultRevisionId !== attempt.request.expectedDidNotFinishResultRevision.id || response.restorationSourceResultRevisionId !== attempt.request.expectedRestorationSourceResultRevision.id || response.policyVersion !== attempt.request.policyVersion || response.snapshotVersion !== attempt.request.expectedSnapshotVersion || response.courseVersionId !== attempt.request.expectedCourseVersionId) throw new Error(sv.didNotFinishWithdrawalInvalidResponse);
  if (response.revision !== attempt.request.expectedAbsoluteResultRevision.revision + 1 ||
    response.status !== attempt.request.expectedRestorationSourceResultRevision.status ||
    response.reason !== attempt.request.expectedRestorationSourceResultRevision.reason) throw new Error(sv.didNotFinishWithdrawalInvalidResponse);
  return response;
}

export function readDidNotFinishWithdrawalAdminCsrf(cookieText: string, currentUrl: URL): string {
  const value = readDidNotFinishWithdrawalAdminCsrfCookie(cookieText, currentUrl);
  if (value !== undefined && /^[A-Za-z0-9_-]{43}$/.test(value)) return value;
  throw new Error(sv.didNotFinishWithdrawalLoginAgain);
}

export function isDefinitiveDidNotFinishWithdrawalRejection(status: number): boolean { return status === 400 || status === 404 || status === 409 || status === 413; }
