import { describe, expect, it } from "vitest";
import { createClassFinalizationAttempt, isDefinitiveResultFinalizationRejection, parseResultFinalizationCandidates, parseResultFinalizationResponse } from "./result-finalization-admin-client";

const raceId = "10000000-0000-4000-8000-000000000001";
const classId = "10000000-0000-4000-8000-000000000002";
const requestId = "10000000-0000-4000-8000-000000000003";
const finalizationId = "10000000-0000-4000-8000-000000000004";
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const hashC = "c".repeat(64);
const cryptoStub = { randomUUID: () => requestId } as unknown as Crypto;

const candidates = {
  formatVersion: 1 as const,
  raceId,
  snapshotVersion: 4,
  race: {
    entryCount: 1,
    nonEmptyClassCount: 1,
    unresolvedUnknownCardReadoutCount: 0,
    blockerCodes: ["MISSING_CLASS_FINALIZATION" as const],
    basisHash: hashB,
    latestFinalization: null
  },
  classes: [{
    classId,
    className: "D21",
    entryCount: 1,
    blockerCodes: [],
    basisHash: hashA,
    latestFinalization: null
  }]
};

describe("TASK 006D finaliseringsklient", () => {
  it("runtimevaliderar metadata utan deltagar- eller resultatdetaljer och binder till loppet", () => {
    expect(parseResultFinalizationCandidates(candidates, raceId)).toEqual(candidates);
    expect(() => parseResultFinalizationCandidates({ ...candidates, cardNumber: "12345" }, raceId)).toThrow();
    expect(() => parseResultFinalizationCandidates(candidates, classId)).toThrow();
  });

  it("fryser klassens snapshot, hash och scope-head i ett strikt intent", () => {
    expect(createClassFinalizationAttempt(candidates, classId, cryptoStub)).toEqual({
      requestId,
      label: "D21",
      request: {
        formatVersion: 1,
        scope: "CLASS",
        classId,
        expectedBasisHash: hashA,
        expectedLatestScopeRevision: null
      }
    });
  });

  it("accepterar endast svar som exakt motsvarar fryst intent och nästa scope-revision", () => {
    const attempt = createClassFinalizationAttempt(candidates, classId, cryptoStub);
    const response = {
      formatVersion: 1 as const,
      replayed: false,
      requestId,
      finalization: {
        id: finalizationId,
        raceId,
        scope: "CLASS" as const,
        classId,
        scopeRevision: 1,
        sourceSnapshotVersion: 4,
        basisHash: hashA,
        frozenProjectionHash: hashC,
        entryCount: 1,
        classCount: 1,
        completeXmlSha256: null,
        finalizedAt: "2026-08-31T10:00:00.000Z"
      }
    };
    expect(parseResultFinalizationResponse(response, attempt, raceId)).toEqual(response);
    expect(() => parseResultFinalizationResponse({
      ...response, finalization: { ...response.finalization, scopeRevision: 2 }
    }, attempt, raceId)).toThrow();
  });

  it("läser endast finaliseringens separata CSRF-cookie och behåller auth/5xx som okänd commit", () => {
    expect([400, 404, 409, 413].every(isDefinitiveResultFinalizationRejection)).toBe(true);
    expect([401, 403, 500, 502].some(isDefinitiveResultFinalizationRejection)).toBe(false);
  });
});
