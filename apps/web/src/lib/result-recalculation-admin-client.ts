import {
  resultRecalculationCandidateResponseSchema,
  resultRecalculationRequestSchema,
  resultRecalculationResponseSchema,
  type ResultRecalculationCandidateResponse,
  type ResultRecalculationRequest,
  type ResultRecalculationResponse
} from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import { readResultRecalculationAdminCsrfCookie } from "./result-recalculation-admin-cookies";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type ResultRecalculationCandidates = ResultRecalculationCandidateResponse;
export type ResultRecalculationCandidate = ResultRecalculationCandidateResponse["entries"][number];

export interface ResultRecalculationAttempt extends ResultRecalculationRequest {
  requestId: string;
  entryId: string;
  displayName: string;
  className: string;
  readAt: string;
}

export function parseResultRecalculationCandidates(
  value: unknown,
  expectedRaceId: string
): ResultRecalculationCandidates {
  const parsed = resultRecalculationCandidateResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.raceId !== expectedRaceId) {
    throw new Error(sv.resultRecalculationInvalidResponse);
  }
  return parsed.data;
}

export function createResultRecalculationAttempt(
  candidate: ResultRecalculationCandidate,
  context: Pick<ResultRecalculationCandidates, "snapshotVersion" | "engineVersion">,
  webCrypto: Crypto = globalThis.crypto
): ResultRecalculationAttempt {
  const requestId = webCrypto.randomUUID();
  if (!UUID_PATTERN.test(requestId) || candidate.readiness !== "READY" ||
      candidate.cardAssignmentId === null || candidate.latestReadout === null) {
    throw new Error(sv.resultRecalculationInvalidAttempt);
  }
  return {
    requestId,
    entryId: candidate.id,
    displayName: candidate.displayName,
    className: candidate.className,
    readAt: candidate.latestReadout.readAt,
    formatVersion: 1,
    expectedEntryVersion: candidate.entryVersion,
    expectedClassId: candidate.classId,
    expectedSnapshotVersion: context.snapshotVersion,
    expectedCardAssignmentId: candidate.cardAssignmentId,
    expectedReadoutId: candidate.latestReadout.id,
    expectedLatestResultRevision: candidate.latestResultRevision === null
      ? null
      : { id: candidate.latestResultRevision.id, revision: candidate.latestResultRevision.revision },
    expectedEngineVersion: context.engineVersion
  };
}

export function resultRecalculationBody(attempt: ResultRecalculationAttempt): ResultRecalculationRequest {
  return resultRecalculationRequestSchema.parse({
    formatVersion: attempt.formatVersion,
    expectedEntryVersion: attempt.expectedEntryVersion,
    expectedClassId: attempt.expectedClassId,
    expectedSnapshotVersion: attempt.expectedSnapshotVersion,
    expectedCardAssignmentId: attempt.expectedCardAssignmentId,
    expectedReadoutId: attempt.expectedReadoutId,
    expectedLatestResultRevision: attempt.expectedLatestResultRevision,
    expectedEngineVersion: attempt.expectedEngineVersion
  });
}

export function parseResultRecalculationResponse(
  value: unknown,
  attempt: ResultRecalculationAttempt,
  expectedRaceId: string
): ResultRecalculationResponse {
  const parsed = resultRecalculationResponseSchema.safeParse(value);
  const expectedRevision = (attempt.expectedLatestResultRevision?.revision ?? 0) + 1;
  if (!parsed.success || parsed.data.requestId !== attempt.requestId ||
      parsed.data.raceId !== expectedRaceId || parsed.data.entryId !== attempt.entryId ||
      parsed.data.readoutId !== attempt.expectedReadoutId ||
      parsed.data.revision !== expectedRevision ||
      parsed.data.engineVersion !== attempt.expectedEngineVersion ||
      parsed.data.snapshotVersion !== attempt.expectedSnapshotVersion) {
    throw new Error(sv.resultRecalculationInvalidResponse);
  }
  return parsed.data;
}

export function readResultRecalculationAdminCsrf(cookieText: string, currentUrl: URL): string {
  const value = readResultRecalculationAdminCsrfCookie(cookieText, currentUrl);
  if (value !== undefined && /^[A-Za-z0-9_-]{43}$/.test(value)) return value;
  throw new Error(sv.resultRecalculationLoginAgain);
}

export function isDefinitiveResultRecalculationRejection(status: number): boolean {
  return status === 400 || status === 404 || status === 409;
}
