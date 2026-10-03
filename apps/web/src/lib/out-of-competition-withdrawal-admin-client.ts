import {
  outOfCompetitionWithdrawalListResponseSchema,
  outOfCompetitionWithdrawalRequestSchema,
  outOfCompetitionWithdrawalResponseSchema,
  type OutOfCompetitionWithdrawalListResponse,
  type OutOfCompetitionWithdrawalRequest,
  type OutOfCompetitionWithdrawalResponse
} from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import { readOutOfCompetitionWithdrawalAdminCsrfCookie } from "./out-of-competition-withdrawal-admin-cookies";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type OutOfCompetitionWithdrawals = OutOfCompetitionWithdrawalListResponse;
export type OutOfCompetitionWithdrawalCandidate = OutOfCompetitionWithdrawalListResponse["entries"][number];

export interface OutOfCompetitionWithdrawalAttempt {
  requestId: string;
  entryId: string;
  displayName: string;
  className: string;
  request: OutOfCompetitionWithdrawalRequest;
}

export function parseOutOfCompetitionWithdrawals(
  value: unknown,
  expectedRaceId: string
): OutOfCompetitionWithdrawals {
  const parsed = outOfCompetitionWithdrawalListResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.raceId !== expectedRaceId) {
    throw new Error(sv.outOfCompetitionWithdrawalInvalidResponse);
  }
  return parsed.data;
}

export function createOutOfCompetitionWithdrawalAttempt(
  candidate: OutOfCompetitionWithdrawalCandidate,
  context: Pick<OutOfCompetitionWithdrawals, "snapshotVersion" | "policyVersion">,
  webCrypto: Crypto = globalThis.crypto
): OutOfCompetitionWithdrawalAttempt {
  const requestId = webCrypto.randomUUID();
  if (!UUID_PATTERN.test(requestId) || candidate.state !== "WITHDRAWABLE" || candidate.withdrawal !== null) {
    throw new Error(sv.outOfCompetitionWithdrawalInvalidAttempt);
  }
  return {
    requestId,
    entryId: candidate.id,
    displayName: candidate.displayName,
    className: candidate.className,
    request: outOfCompetitionWithdrawalRequestSchema.parse({
      formatVersion: 1,
      expectedEntryVersion: candidate.entryVersion,
      expectedClassId: candidate.classId,
      expectedCourseVersionId: candidate.courseVersionId,
      expectedSnapshotVersion: context.snapshotVersion,
      expectedNotCompetingDecisionId: candidate.notCompetingDecisionId,
      expectedTargetResultRevision: candidate.targetResultRevision,
      expectedOutOfCompetitionResultRevision: candidate.outOfCompetitionResultRevision,
      expectedAbsoluteResultRevision: candidate.absoluteResultRevision,
      expectedRestorationSourceResultRevision: candidate.restorationSourceResultRevision,
      reason: "ERRONEOUS_MANUAL_OUT_OF_COMPETITION",
      policyVersion: context.policyVersion
    })
  };
}

export function parseOutOfCompetitionWithdrawalResponse(
  value: unknown,
  attempt: OutOfCompetitionWithdrawalAttempt,
  expectedRaceId: string
): OutOfCompetitionWithdrawalResponse {
  const parsed = outOfCompetitionWithdrawalResponseSchema.safeParse(value);
  const response = parsed.success ? parsed.data : undefined;
  if (!response || response.requestId !== attempt.requestId || response.raceId !== expectedRaceId ||
      response.entryId !== attempt.entryId ||
      response.notCompetingDecisionId !== attempt.request.expectedNotCompetingDecisionId ||
      response.outOfCompetitionResultRevisionId !== attempt.request.expectedOutOfCompetitionResultRevision.id ||
      response.restorationSourceResultRevisionId !== attempt.request.expectedRestorationSourceResultRevision.id ||
      response.policyVersion !== attempt.request.policyVersion ||
      response.snapshotVersion !== attempt.request.expectedSnapshotVersion ||
      response.courseVersionId !== attempt.request.expectedCourseVersionId ||
      response.revision !== attempt.request.expectedAbsoluteResultRevision.revision + 1 ||
      response.status !== attempt.request.expectedRestorationSourceResultRevision.status ||
      response.reason !== attempt.request.expectedRestorationSourceResultRevision.reason) {
    throw new Error(sv.outOfCompetitionWithdrawalInvalidResponse);
  }
  return response;
}

export function readOutOfCompetitionWithdrawalAdminCsrf(cookieText: string, currentUrl: URL): string {
  const value = readOutOfCompetitionWithdrawalAdminCsrfCookie(cookieText, currentUrl);
  if (value !== undefined && /^[A-Za-z0-9_-]{43}$/.test(value)) return value;
  throw new Error(sv.outOfCompetitionWithdrawalLoginAgain);
}

export function isDefinitiveOutOfCompetitionWithdrawalRejection(status: number): boolean {
  return status === 400 || status === 404 || status === 409 || status === 413;
}
