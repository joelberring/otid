import {
  resultFinalizationCandidateResponseSchema,
  resultFinalizationRequestSchema,
  resultFinalizationResponseSchema,
  type ResultFinalizationCandidateResponse,
  type ResultFinalizationRequest,
  type ResultFinalizationResponse
} from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import { readResultFinalizationAdminCsrfCookie } from "./result-finalization-admin-cookies";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type ResultFinalizationCandidates = ResultFinalizationCandidateResponse;

export interface ResultFinalizationAttempt {
  requestId: string;
  label: string;
  request: ResultFinalizationRequest;
}

export function parseResultFinalizationCandidates(
  value: unknown,
  expectedRaceId: string
): ResultFinalizationCandidates {
  const parsed = resultFinalizationCandidateResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.raceId !== expectedRaceId) {
    throw new Error(sv.resultFinalizationInvalidResponse);
  }
  return parsed.data;
}

export function createClassFinalizationAttempt(
  candidates: ResultFinalizationCandidates,
  classId: string,
  webCrypto: Crypto = globalThis.crypto
): ResultFinalizationAttempt {
  const candidate = candidates.classes.find((value) => value.classId === classId);
  const requestId = webCrypto.randomUUID();
  if (!candidate || !UUID_PATTERN.test(requestId) || candidate.blockerCodes.length > 0) {
    throw new Error(sv.resultFinalizationInvalidAttempt);
  }
  return {
    requestId,
    label: candidate.className,
    request: resultFinalizationRequestSchema.parse({
      formatVersion: 1,
      scope: "CLASS",
      classId: candidate.classId,
      expectedSnapshotVersion: candidates.snapshotVersion,
      expectedBasisHash: candidate.basisHash,
      expectedLatestScopeRevision: candidate.latestFinalization?.scopeRevision ?? null
    })
  };
}

export function createRaceFinalizationAttempt(
  candidates: ResultFinalizationCandidates,
  webCrypto: Crypto = globalThis.crypto
): ResultFinalizationAttempt {
  const requestId = webCrypto.randomUUID();
  if (!UUID_PATTERN.test(requestId) || candidates.race.blockerCodes.length > 0) {
    throw new Error(sv.resultFinalizationInvalidAttempt);
  }
  return {
    requestId,
    label: sv.resultFinalizationRaceScope,
    request: resultFinalizationRequestSchema.parse({
      formatVersion: 1,
      scope: "RACE",
      classId: null,
      expectedSnapshotVersion: candidates.snapshotVersion,
      expectedBasisHash: candidates.race.basisHash,
      expectedLatestScopeRevision: candidates.race.latestFinalization?.scopeRevision ?? null
    })
  };
}

export function parseResultFinalizationResponse(
  value: unknown,
  attempt: ResultFinalizationAttempt,
  expectedRaceId: string
): ResultFinalizationResponse {
  const parsed = resultFinalizationResponseSchema.safeParse(value);
  const finalization = parsed.success ? parsed.data.finalization : undefined;
  if (!parsed.success || parsed.data.requestId !== attempt.requestId ||
      finalization?.raceId !== expectedRaceId || finalization.scope !== attempt.request.scope ||
      finalization.classId !== attempt.request.classId ||
      finalization.sourceSnapshotVersion !== attempt.request.expectedSnapshotVersion ||
      finalization.basisHash !== attempt.request.expectedBasisHash ||
      finalization.scopeRevision !== (attempt.request.expectedLatestScopeRevision ?? 0) + 1) {
    throw new Error(sv.resultFinalizationInvalidResponse);
  }
  return parsed.data;
}

export function readResultFinalizationAdminCsrf(cookieText: string, currentUrl: URL): string {
  const value = readResultFinalizationAdminCsrfCookie(cookieText, currentUrl);
  if (value !== undefined && /^[A-Za-z0-9_-]{43}$/.test(value)) return value;
  throw new Error(sv.resultFinalizationLoginAgain);
}

export function isDefinitiveResultFinalizationRejection(status: number): boolean {
  return status === 400 || status === 404 || status === 409 || status === 413;
}
