import { describe, expect, it } from "vitest";
import { deviceBatchAcknowledgementSchema, deviceBatchSchema } from "../src";

const deviceId = "10000000-0000-4000-8000-000000000001";
const rawMessageId = "10000000-0000-4000-8000-000000000002";
const resultRevisionId = "10000000-0000-4000-8000-000000000003";
const courseVersionId = "10000000-0000-4000-8000-000000000004";

function acknowledgement() {
  return {
    deviceId,
    highestContiguousSequence: 7,
    currentPackageVersion: 4,
    packageVersionStatus: "stale" as const,
    packageUpdateRequired: true,
    acknowledgements: [{
      localSequence: 7,
      contentHash: "a".repeat(64),
      status: "stored" as const,
      rawMessageId,
      serverResult: {
        resultRevisionId,
        revision: 3,
        status: "OK" as const,
        reason: "COMPLETE" as const,
        engineVersion: "1.0.0",
        snapshotVersion: 4,
        evaluationHash: "c".repeat(64),
        courseVersionId
      }
    }]
  };
}

describe("device-batchkvittens", () => {
  it.each(["batch", "event", "payload", "punch"] as const)("avvisar okända %s-fält i requestkontraktet", (level) => {
    const value = {
      deviceId,
      sessionId: deviceId,
      packageVersion: 1,
      firstSequence: 1,
      lastSequence: 1,
      events: [{
        localSequence: 1,
        stationReceivedAt: "2026-08-30T10:00:00Z",
        transport: "simulator",
        payload: {
          cardNumber: "12345",
          finishPunchedAt: "2026-08-30T10:00:00Z",
          punches: [{ code: 31, punchedAt: "2026-08-30T09:55:00Z" }]
        },
        contentHash: "a".repeat(64)
      }]
    } as Record<string, unknown> & { events: Array<Record<string, unknown> & { payload: Record<string, unknown> & { punches: Array<Record<string, unknown>> } }> };
    if (level === "batch") value.extra = true;
    if (level === "event") value.events[0]!.extra = true;
    if (level === "payload") value.events[0]!.payload.extra = true;
    if (level === "punch") value.events[0]!.payload.punches[0]!.extra = true;
    expect(deviceBatchSchema.safeParse(value).success).toBe(false);
  });

  it("kräver ett sammanhängande stigande requestintervall", () => {
    const payload = {
      cardNumber: "12345",
      finishPunchedAt: "2026-08-30T10:00:00Z",
      punches: []
    };
    const event = {
      stationReceivedAt: "2026-08-30T10:00:00Z",
      transport: "simulator" as const,
      payload,
      contentHash: "a".repeat(64)
    };
    expect(deviceBatchSchema.safeParse({
      deviceId,
      sessionId: deviceId,
      packageVersion: 1,
      firstSequence: 1,
      lastSequence: 3,
      events: [
        { ...event, localSequence: 1 },
        { ...event, localSequence: 3 }
      ]
    }).success).toBe(false);
  });

  it("accepterar en fullständig och paketmedveten stored-kvittens", () => {
    expect(deviceBatchAcknowledgementSchema.parse(acknowledgement()))
      .toEqual(acknowledgement());
  });

  it("kräver att update-flaggan exakt följer stale-status", () => {
    expect(deviceBatchAcknowledgementSchema.safeParse({
      ...acknowledgement(),
      packageVersionStatus: "current",
      packageUpdateRequired: true
    }).success).toBe(false);
  });

  it("kräver resultatrevisions-id och revisionsnummer tillsammans", () => {
    const value = acknowledgement();
    const serverResult = { ...value.acknowledgements[0]!.serverResult };
    delete (serverResult as { revision?: number }).revision;
    expect(deviceBatchAcknowledgementSchema.safeParse({
      ...value,
      acknowledgements: [{ ...value.acknowledgements[0], serverResult }]
    }).success).toBe(false);
  });

  it("kräver en SHA-256-hash över den fulla bedömningen", () => {
    const value = acknowledgement();
    const serverResult = { ...value.acknowledgements[0]!.serverResult };
    delete (serverResult as { evaluationHash?: string }).evaluationHash;
    expect(deviceBatchAcknowledgementSchema.safeParse({
      ...value,
      acknowledgements: [{ ...value.acknowledgements[0], serverResult }]
    }).success).toBe(false);
    expect(deviceBatchAcknowledgementSchema.safeParse({
      ...value,
      acknowledgements: [{
        ...value.acknowledgements[0],
        serverResult: { ...value.acknowledgements[0]!.serverResult, evaluationHash: "inte-sha256" }
      }]
    }).success).toBe(false);
  });

  it("avvisar omöjliga status-, reason- och revisionskombinationer", () => {
    const value = acknowledgement();
    expect(deviceBatchAcknowledgementSchema.safeParse({
      ...value,
      acknowledgements: [{
        ...value.acknowledgements[0],
        serverResult: {
          ...value.acknowledgements[0]!.serverResult,
          status: "UNKNOWN_CARD",
          reason: "UNKNOWN_CARD"
        }
      }]
    }).success).toBe(false);
    expect(deviceBatchAcknowledgementSchema.safeParse({
      ...value,
      acknowledgements: [{
        ...value.acknowledgements[0],
        serverResult: {
          ...value.acknowledgements[0]!.serverResult,
          status: "OK",
          reason: "MISSING_CONTROL"
        }
      }]
    }).success).toBe(false);
  });

  it("accepterar ett explicit per-event-avslag utan raw-id", () => {
    expect(deviceBatchAcknowledgementSchema.safeParse({
      ...acknowledgement(),
      acknowledgements: [{
        localSequence: 7,
        contentHash: "b".repeat(64),
        status: "rejected",
        reason: "CONTENT_HASH_MISMATCH"
      }]
    }).success).toBe(true);
  });

  it("avvisar motsägande kvittenser för samma lokala sekvens", () => {
    const value = acknowledgement();
    expect(deviceBatchAcknowledgementSchema.safeParse({
      ...value,
      acknowledgements: [
        ...value.acknowledgements,
        {
          localSequence: 7,
          contentHash: "b".repeat(64),
          status: "rejected",
          reason: "SEQUENCE_HASH_CONFLICT"
        }
      ]
    }).success).toBe(false);
  });

  it("avvisar extra kvittenser i fallande ordning", () => {
    const value = acknowledgement();
    expect(deviceBatchAcknowledgementSchema.safeParse({
      ...value,
      acknowledgements: [
        { ...value.acknowledgements[0], localSequence: 8 },
        { ...value.acknowledgements[0], localSequence: 7 }
      ]
    }).success).toBe(false);
  });
});
