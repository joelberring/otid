import {
  withoutTimingWithdrawalListResponseSchema,
  withoutTimingWithdrawalRequestSchema,
  withoutTimingWithdrawalResponseSchema,
  type WithoutTimingWithdrawalListResponse,
  type WithoutTimingWithdrawalRequest,
  type WithoutTimingWithdrawalResponse
} from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import { readWithoutTimingWithdrawalAdminCsrfCookie } from "./without-timing-withdrawal-admin-cookies";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type WithoutTimingWithdrawals = WithoutTimingWithdrawalListResponse;
export type WithoutTimingWithdrawalCandidate = WithoutTimingWithdrawalListResponse["entries"][number];

export interface WithoutTimingWithdrawalAttempt {
  requestId: string;
  entryId: string;
  displayName: string;
  className: string;
  request: WithoutTimingWithdrawalRequest;
}

export function parseWithoutTimingWithdrawals(value: unknown, expectedRaceId: string): WithoutTimingWithdrawals {
  const parsed = withoutTimingWithdrawalListResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.raceId !== expectedRaceId) {
    throw new Error(sv.withoutTimingWithdrawalInvalidResponse);
  }
  return parsed.data;
}

export function createWithoutTimingWithdrawalAttempt(
  candidate: WithoutTimingWithdrawalCandidate,
  context: Pick<WithoutTimingWithdrawals, "snapshotVersion" | "policyVersion">,
  webCrypto: Crypto = globalThis.crypto
): WithoutTimingWithdrawalAttempt {
  const requestId = webCrypto.randomUUID();
  if (!UUID_PATTERN.test(requestId) || candidate.state !== "WITHDRAWABLE" || candidate.withdrawal !== null) {
    throw new Error(sv.withoutTimingWithdrawalInvalidAttempt);
  }
  return {
    requestId,
    entryId: candidate.id,
    displayName: candidate.displayName,
    className: candidate.className,
    request: withoutTimingWithdrawalRequestSchema.parse({
      formatVersion: 1,
      expectedEntryVersion: candidate.entryVersion,
      expectedClassId: candidate.classId,
      expectedCourseVersionId: candidate.courseVersionId,
      expectedSnapshotVersion: context.snapshotVersion,
      expectedWithoutTimingDecisionId: candidate.withoutTimingDecisionId,
      expectedTargetResultRevision: candidate.targetResultRevision,
      expectedWithoutTimingResultRevision: candidate.withoutTimingResultRevision,
      expectedAbsoluteResultRevision: candidate.absoluteResultRevision,
      expectedRestorationSourceResultRevision: candidate.restorationSourceResultRevision,
      reason: "ERRONEOUS_MANUAL_WITHOUT_TIMING",
      policyVersion: context.policyVersion
    })
  };
}

export function parseWithoutTimingWithdrawalResponse(
  value: unknown,
  attempt: WithoutTimingWithdrawalAttempt,
  expectedRaceId: string
): WithoutTimingWithdrawalResponse {
  const parsed = withoutTimingWithdrawalResponseSchema.safeParse(value);
  const response = parsed.success ? parsed.data : undefined;
  if (!response || response.requestId !== attempt.requestId || response.raceId !== expectedRaceId ||
      response.entryId !== attempt.entryId ||
      response.withoutTimingDecisionId !== attempt.request.expectedWithoutTimingDecisionId ||
      response.withoutTimingResultRevisionId !== attempt.request.expectedWithoutTimingResultRevision.id ||
      response.restorationSourceResultRevisionId !== attempt.request.expectedRestorationSourceResultRevision.id ||
      response.policyVersion !== attempt.request.policyVersion ||
      response.snapshotVersion !== attempt.request.expectedSnapshotVersion ||
      response.courseVersionId !== attempt.request.expectedCourseVersionId ||
      response.revision !== attempt.request.expectedAbsoluteResultRevision.revision + 1 ||
      response.status !== attempt.request.expectedRestorationSourceResultRevision.status ||
      response.reason !== attempt.request.expectedRestorationSourceResultRevision.reason) {
    throw new Error(sv.withoutTimingWithdrawalInvalidResponse);
  }
  return response;
}

export function readWithoutTimingWithdrawalAdminCsrf(cookieText: string, currentUrl: URL): string {
  const value = readWithoutTimingWithdrawalAdminCsrfCookie(cookieText, currentUrl);
  if (value !== undefined && /^[A-Za-z0-9_-]{43}$/.test(value)) return value;
  throw new Error(sv.withoutTimingWithdrawalLoginAgain);
}

export function isDefinitiveWithoutTimingWithdrawalRejection(status: number): boolean {
  return status === 400 || status === 404 || status === 409 || status === 413;
}
