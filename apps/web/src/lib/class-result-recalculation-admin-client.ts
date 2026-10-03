import {
  classResultRecalculationCandidateResponseSchema,
  classResultRecalculationRequestSchema,
  classResultRecalculationResponseSchema,
  type ClassResultRecalculationCandidateResponse,
  type ClassResultRecalculationRequest,
  type ClassResultRecalculationResponse
} from "@o-tid/contracts";
import { sv } from "../i18n/sv";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type ClassResultRecalculationCandidates = ClassResultRecalculationCandidateResponse;
export type ClassResultRecalculationRequestWithId = ClassResultRecalculationRequest & { requestId: string };
export type ClassResultRecalculationAttempt = {
  requestId: string;
  classId: string;
  className: string;
  entryIds: string[];
  request: ClassResultRecalculationRequest;
};

export function parseClassResultRecalculationCandidates(value: unknown, raceId: string): ClassResultRecalculationCandidates {
  const parsed = classResultRecalculationCandidateResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.raceId !== raceId) throw new Error(sv.resultRecalculationInvalidResponse);
  return parsed.data;
}

export function createClassResultRecalculationAttempt(
  candidate: ClassResultRecalculationCandidates,
  entryIds: string[],
  webCrypto: Crypto = globalThis.crypto
): ClassResultRecalculationAttempt {
  const requestId = webCrypto.randomUUID();
  const selected = [...new Set(entryIds)].sort();
  if (!UUID.test(requestId) || selected.length < 1 || selected.length > 100 ||
      selected.some((id) => !UUID.test(id)) || candidate.entries.some((entry) => selected.includes(entry.id) && entry.readiness !== "READY")) {
    throw new Error(sv.resultRecalculationInvalidResponse);
  }
  const request = classResultRecalculationRequestSchema.parse({ formatVersion: 1, classId: candidate.classId,
    snapshotVersion: candidate.snapshotVersion, engineVersion: candidate.engineVersion,
    manifestHash: candidate.manifestHash, entryIds: selected });
  return { requestId, classId: candidate.classId, className: candidate.className, entryIds: selected, request };
}

export function parseClassResultRecalculationResponse(value: unknown, attempt: ClassResultRecalculationAttempt, raceId: string): ClassResultRecalculationResponse {
  const parsed = classResultRecalculationResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.raceId !== raceId || parsed.data.classId !== attempt.classId ||
      parsed.data.requestId !== attempt.requestId || parsed.data.manifestHash !== attempt.request.manifestHash ||
      parsed.data.snapshotVersion !== attempt.request.snapshotVersion || parsed.data.engineVersion !== attempt.request.engineVersion ||
      parsed.data.items.length !== attempt.entryIds.length || parsed.data.items.some((item) => !attempt.entryIds.includes(item.entryId))) {
    throw new Error(sv.resultRecalculationInvalidResponse);
  }
  return parsed.data;
}

export function classResultRecalculationBody(attempt: ClassResultRecalculationAttempt): ClassResultRecalculationRequest {
  return classResultRecalculationRequestSchema.parse(attempt.request);
}
