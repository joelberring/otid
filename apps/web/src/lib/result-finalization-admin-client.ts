import {
  resultFinalizationCandidateResponseSchema,
  resultFinalizationRequestSchema,
  resultFinalizationResponseSchema,
  type ResultFinalizationCandidateResponse,
  type ResultFinalizationRequest,
  type ResultFinalizationResponse
} from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import { UUID_PATTERN } from "@o-tid/contracts";


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
      expectedBasisHash: candidate.basisHash,
      expectedLatestScopeRevision: candidate.latestFinalization?.scopeRevision ?? null
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
      finalization.basisHash !== attempt.request.expectedBasisHash ||
      finalization.scopeRevision !== (attempt.request.expectedLatestScopeRevision ?? 0) + 1) {
    throw new Error(sv.resultFinalizationInvalidResponse);
  }
  return parsed.data;
}

export function isDefinitiveResultFinalizationRejection(status: number): boolean {
  return status === 400 || status === 404 || status === 409 || status === 413;
}
