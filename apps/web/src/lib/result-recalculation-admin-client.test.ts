import { describe, expect, it } from "vitest";
import {
  createResultRecalculationAttempt,
  isDefinitiveResultRecalculationRejection,
  parseResultRecalculationCandidates,
  parseResultRecalculationResponse,
  readResultRecalculationAdminCsrf,
  resultRecalculationBody
} from "./result-recalculation-admin-client";

const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "10000000-0000-4000-8000-000000000002";
const classId = "10000000-0000-4000-8000-000000000003";
const assignmentId = "10000000-0000-4000-8000-000000000004";
const readoutId = "10000000-0000-4000-8000-000000000005";
const previousRevisionId = "10000000-0000-4000-8000-000000000006";
const requestId = "10000000-0000-4000-8000-000000000007";
const resultRevisionId = "10000000-0000-4000-8000-000000000008";
const courseVersionId = "10000000-0000-4000-8000-000000000009";

const candidates = {
  formatVersion: 1 as const,
  raceId,
  snapshotVersion: 4,
  engineVersion: "task-005i-v1",
  entries: [{
    id: entryId,
    displayName: "Ada Löpare",
    organisationName: "Centrum OK",
    classId,
    className: "D21",
    entryVersion: 2,
    readiness: "READY" as const,
    cardAssignmentId: assignmentId,
    latestReadout: { id: readoutId, readAt: "2026-08-31T10:00:00.000Z" },
    latestResultRevision: {
      id: previousRevisionId,
      revision: 3,
      status: "OK" as const,
      reason: "COMPLETE" as const,
      cause: "CARD_READOUT" as const,
      createdAt: "2026-08-31T10:00:01.000Z",
      snapshotVersion: 4
    }
  }]
};
const readyCandidate = candidates.entries[0]!;

const cryptoStub = { randomUUID: () => requestId } as unknown as Crypto;

describe("TASK 005I omräkningsklient", () => {
  it("runtimevaliderar kandidat-DTO och exakt race", () => {
    expect(parseResultRecalculationCandidates(candidates, raceId)).toEqual(candidates);
    expect(() => parseResultRecalculationCandidates(candidates, "20000000-0000-4000-8000-000000000001"))
      .toThrow("ogiltigt omräkningssvar");
    expect(() => parseResultRecalculationCandidates({ ...candidates, entries: [{ ...candidates.entries[0], cardNumber: "12345" }] }, raceId))
      .toThrow("ogiltigt omräkningssvar");
  });

  it("fryser hela observerade intentet och canonical request-id i minnet", () => {
    const attempt = createResultRecalculationAttempt(readyCandidate, candidates, cryptoStub);
    expect(attempt).toMatchObject({
      requestId,
      entryId,
      expectedEntryVersion: 2,
      expectedClassId: classId,
      expectedSnapshotVersion: 4,
      expectedCardAssignmentId: assignmentId,
      expectedReadoutId: readoutId,
      expectedLatestResultRevision: { id: previousRevisionId, revision: 3 },
      expectedEngineVersion: "task-005i-v1"
    });
    expect(resultRecalculationBody(attempt)).toEqual({
      formatVersion: 1,
      expectedEntryVersion: 2,
      expectedClassId: classId,
      expectedSnapshotVersion: 4,
      expectedCardAssignmentId: assignmentId,
      expectedReadoutId: readoutId,
      expectedLatestResultRevision: { id: previousRevisionId, revision: 3 },
      expectedEngineVersion: "task-005i-v1"
    });
  });

  it("vägrar skapa försök för en kandidat som inte är redo", () => {
    const unavailable = {
      ...readyCandidate,
      readiness: "NO_ACTIVE_ASSIGNMENT" as const,
      cardAssignmentId: null,
      latestReadout: null
    };
    expect(() => createResultRecalculationAttempt(unavailable, candidates, cryptoStub))
      .toThrow("ogiltigt");
  });

  it("accepterar endast ett svar som exakt motsvarar försöket", () => {
    const attempt = createResultRecalculationAttempt(readyCandidate, candidates, cryptoStub);
    const response = {
      formatVersion: 1 as const,
      replayed: false,
      requestId,
      raceId,
      entryId,
      readoutId,
      resultRevisionId,
      revision: 4,
      cause: "EXPLICIT_RECALCULATION" as const,
      status: "OK" as const,
      reason: "COMPLETE" as const,
      engineVersion: "task-005i-v1",
      snapshotVersion: 4,
      courseVersionId,
      recalculatedAt: "2026-08-31T10:05:00.000Z"
    };
    expect(parseResultRecalculationResponse(response, attempt, raceId)).toEqual(response);
    expect(() => parseResultRecalculationResponse({ ...response, revision: 5 }, attempt, raceId))
      .toThrow("ogiltigt omräkningssvar");
    expect(() => parseResultRecalculationResponse({ ...response, readoutId: courseVersionId }, attempt, raceId))
      .toThrow("ogiltigt omräkningssvar");
  });

  it("läser endast den separata CSRF-cookien för rätt miljö", () => {
    const csrf = "c".repeat(43);
    expect(readResultRecalculationAdminCsrf(
      `otid_entry_class_admin_csrf=${"x".repeat(43)}; otid_recalculation_admin_csrf=${csrf}`,
      new URL("http://127.0.0.1:3000/admin/race/recalculation")
    )).toBe(csrf);
    expect(() => readResultRecalculationAdminCsrf(
      `__Host-otid-recalculation-admin-csrf=${csrf}`,
      new URL("http://127.0.0.1:3000/admin/race/recalculation")
    )).toThrow("Logga in igen");
  });

  it("klassar endast säkra negativa svar som definitiva", () => {
    expect([400, 404, 409].every(isDefinitiveResultRecalculationRejection)).toBe(true);
    expect([401, 403, 500, 502].some(isDefinitiveResultRecalculationRejection)).toBe(false);
  });
});
