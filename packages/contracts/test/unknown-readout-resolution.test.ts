import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  unknownReadoutResolutionIdempotencyKeySchema,
  unknownReadoutResolutionRequestSchema,
  unknownReadoutResolutionResponseSchema
} from "../src/unknown-readout-resolution";

const base = { formatVersion: 1 as const, requestId: randomUUID(), readoutId: randomUUID(), cardNumber: "12345",
  expectedSnapshotVersion: 4, expectedEngineVersion: "o-tid-result-v1" };

describe("TASK085 unknown readout resolution contracts", () => {
  it("strictly discriminates existing and new entry intents", () => {
    expect(unknownReadoutResolutionRequestSchema.safeParse({ ...base, target: "EXISTING_ENTRY",
      entryId: randomUUID(), expectedEntryVersion: 2, expectedClassId: randomUUID(),
      expectedAssignment: null, expectedLatestResultRevision: null }).success).toBe(true);
    expect(unknownReadoutResolutionRequestSchema.safeParse({ ...base, target: "NEW_ENTRY",
      classId: randomUUID(), expectedCourseVersionId: randomUUID(), givenName: "Ada",
      familyName: "Okänd", organisationName: null }).success).toBe(true);
    expect(unknownReadoutResolutionRequestSchema.safeParse({ ...base, target: "NEW_ENTRY",
      classId: randomUUID(), expectedCourseVersionId: randomUUID(), givenName: "Ada",
      familyName: "Okänd", organisationName: null, entryId: randomUUID() }).success).toBe(false);
  });

  it("requires the dedicated idempotency key and exact truthful receipt", () => {
    const requestId = randomUUID();
    expect(unknownReadoutResolutionIdempotencyKeySchema.safeParse(`unknown-readout-resolution:${requestId}`).success).toBe(true);
    expect(unknownReadoutResolutionIdempotencyKeySchema.safeParse(`result-recalculation:${requestId}`).success).toBe(false);
    const snapshotVersionBefore = 7;
    const receipt = { formatVersion: 1, replayed: false, requestId, raceId: randomUUID(),
      readoutId: base.readoutId, cardNumber: base.cardNumber, target: "NEW_ENTRY", entryId: randomUUID(),
      entryVersion: 1, classId: randomUUID(), assignmentId: randomUUID(), resultRevisionId: randomUUID(),
      revision: 1, cause: "UNKNOWN_READOUT_RESOLUTION", status: "OK", reason: "COMPLETE",
      engineVersion: base.expectedEngineVersion, snapshotVersionBefore,
      snapshotVersionAfter: snapshotVersionBefore + 1, courseVersionId: randomUUID(),
      resolvedAt: "2026-09-19T10:00:00Z" };
    expect(unknownReadoutResolutionResponseSchema.parse(receipt)).toEqual(receipt);
    expect(unknownReadoutResolutionResponseSchema.safeParse({ ...receipt, cause: "EXPLICIT_RECALCULATION" }).success).toBe(false);
  });
});
