import {
  didNotStartWithdrawalListResponseSchema,
  didNotStartWithdrawalRequestSchema,
  didNotStartWithdrawalResponseSchema,
  type DidNotStartWithdrawalListResponse,
  type DidNotStartWithdrawalRequest,
  type DidNotStartWithdrawalResponse
} from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import { readDidNotStartWithdrawalAdminCsrfCookie } from "./did-not-start-withdrawal-admin-cookies";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type DidNotStartWithdrawals = DidNotStartWithdrawalListResponse;
export type DidNotStartWithdrawalCandidate = DidNotStartWithdrawalListResponse["entries"][number];

export interface DidNotStartWithdrawalAttempt {
  requestId: string;
  entryId: string;
  displayName: string;
  className: string;
  request: DidNotStartWithdrawalRequest;
}

export function parseDidNotStartWithdrawals(
  value: unknown,
  expectedRaceId: string
): DidNotStartWithdrawals {
  const parsed = didNotStartWithdrawalListResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.raceId !== expectedRaceId) {
    throw new Error(sv.didNotStartWithdrawalInvalidResponse);
  }
  return parsed.data;
}

export function createDidNotStartWithdrawalAttempt(
  candidate: DidNotStartWithdrawalCandidate,
  context: Pick<DidNotStartWithdrawals, "snapshotVersion" | "withdrawalPolicyVersion">,
  webCrypto: Crypto = globalThis.crypto
): DidNotStartWithdrawalAttempt {
  const requestId = webCrypto.randomUUID();
  if (!UUID_PATTERN.test(requestId) || candidate.state !== "WITHDRAWABLE" || candidate.withdrawal !== null ||
      candidate.latestResultRevision.id !== candidate.targetResultRevision.id ||
      candidate.latestResultRevision.revision !== candidate.targetResultRevision.revision) {
    throw new Error(sv.didNotStartWithdrawalInvalidAttempt);
  }
  return {
    requestId,
    entryId: candidate.id,
    displayName: candidate.displayName,
    className: candidate.className,
    request: didNotStartWithdrawalRequestSchema.parse({
      formatVersion: 1,
      expectedEntryVersion: candidate.entryVersion,
      expectedClassId: candidate.classId,
      expectedCourseVersionId: candidate.courseVersionId,
      expectedSnapshotVersion: context.snapshotVersion,
      expectedDidNotStartDecisionId: candidate.didNotStartDecisionId,
      expectedResultRevision: {
        id: candidate.targetResultRevision.id,
        revision: candidate.targetResultRevision.revision
      },
      policyVersion: context.withdrawalPolicyVersion
    })
  };
}

export function parseDidNotStartWithdrawalResponse(
  value: unknown,
  attempt: DidNotStartWithdrawalAttempt,
  expectedRaceId: string
): DidNotStartWithdrawalResponse {
  const parsed = didNotStartWithdrawalResponseSchema.safeParse(value);
  const response = parsed.success ? parsed.data : undefined;
  if (!response || response.requestId !== attempt.requestId || response.raceId !== expectedRaceId ||
      response.entryId !== attempt.entryId ||
      response.didNotStartDecisionId !== attempt.request.expectedDidNotStartDecisionId ||
      response.withdrawnResultRevisionId !== attempt.request.expectedResultRevision.id ||
      response.withdrawnResultRevision !== attempt.request.expectedResultRevision.revision ||
      response.withdrawalPolicyVersion !== attempt.request.policyVersion) {
    throw new Error(sv.didNotStartWithdrawalInvalidResponse);
  }
  return response;
}

export function readDidNotStartWithdrawalAdminCsrf(cookieText: string, currentUrl: URL): string {
  const value = readDidNotStartWithdrawalAdminCsrfCookie(cookieText, currentUrl);
  if (value !== undefined && /^[A-Za-z0-9_-]{43}$/.test(value)) return value;
  throw new Error(sv.didNotStartWithdrawalLoginAgain);
}

export function isDefinitiveDidNotStartWithdrawalRejection(status: number): boolean {
  return status === 400 || status === 404 || status === 409 || status === 413;
}
