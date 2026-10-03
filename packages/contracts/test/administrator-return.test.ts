import { expect, it } from "vitest";
import { administratorReturnRequestSchema, administratorReturnResponseSchema, canonicalAdministratorReturnRequest } from "../src";
import { administratorStartCorrectionRequestSchema, administratorStartCorrectionResponseSchema } from "../src";

const id = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const request = { formatVersion: 1, requestId: id, entryId: id, packageVersion: 1,
  expectedEntryVersion: 1, expectedRevision: 0, expectedStartState: "UNMARKED", observedAt: "2026-09-12T10:00:00.000Z" };

it("TASK056 accepts only versioned start intent and binds its receipt", () => {
  const { expectedStartState, ...base } = request;
  const intent = { ...base, targetStartState: expectedStartState };
  expect(administratorStartCorrectionRequestSchema.safeParse(intent).success).toBe(true);
  for (const extra of [{ manualReturnRegistered: false }, { expectedStartState }, { targetStartState: "DNS" }, { actorCredentialId: id }]) {
    expect(administratorStartCorrectionRequestSchema.safeParse({ ...intent, ...extra }).success).toBe(false);
  }
  const receipt = { formatVersion: 1, storage: "STORED", requestId: id, entryId: id, raceId: other,
    deviceId: other, localSequence: 1, contentHash: "a".repeat(64), receivedAt: "2026-09-12T10:00:01.000Z",
    effect: { kind: "APPLIED", revisionId: other, revision: 1 } };
  const response = { formatVersion: 1, replayed: false, request: intent, receipt };
  expect(administratorStartCorrectionResponseSchema.safeParse(response).success).toBe(true);
  expect(administratorStartCorrectionResponseSchema.safeParse({ ...response, receipt: { ...receipt, entryId: other } }).success).toBe(false);
});

it("TASK054 rejects client-owned actor/action/source and invalid frozen versions", () => {
  expect(administratorReturnRequestSchema.safeParse(request).success).toBe(true);
  for (const changed of [{ actorCredentialId: id }, { deviceId: id }, { localSequence: 1 }, { action: { kind: "MARK_START", state: "STARTED" } },
    { manualReturnRegistered: false }, { expectedRevision: -1 }, { packageVersion: 0 }, { expectedEntryVersion: 0 },
    { observedAt: "2026-02-30T10:00:00.000Z" }, { observedAt: "2026-09-12T12:00:00+02:00" }, { expectedStartState: "RETURNED" }]) {
    expect(administratorReturnRequestSchema.safeParse({ ...request, ...changed }).success).toBe(false);
  }
  const reversed = Object.fromEntries(Object.entries(request).reverse());
  expect(canonicalAdministratorReturnRequest(reversed)).toEqual(canonicalAdministratorReturnRequest(request));
});

it("TASK054 binds receipt to frozen intent while preserving durable conflicts", () => {
  const receipt = { formatVersion: 1, storage: "STORED", requestId: id, entryId: id, raceId: other,
    deviceId: other, localSequence: 1, contentHash: "a".repeat(64), receivedAt: "2026-09-12T10:00:01.000Z",
    effect: { kind: "APPLIED", revisionId: other, revision: 1 } };
  const response = { formatVersion: 1, replayed: false, request, receipt };
  expect(administratorReturnResponseSchema.safeParse(response).success).toBe(true);
  for (const changed of [{ requestId: other }, { entryId: other }, { effect: { ...receipt.effect, revision: 2 } }]) {
    expect(administratorReturnResponseSchema.safeParse({ ...response, receipt: { ...receipt, ...changed } }).success).toBe(false);
  }
  expect(administratorReturnResponseSchema.safeParse({ ...response, replayed: true,
    receipt: { ...receipt, effect: { kind: "CONFLICT", revision: 9, reason: "STALE_REVISION" } } }).success).toBe(true);
});
