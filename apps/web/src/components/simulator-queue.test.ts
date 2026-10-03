import { describe, expect, it } from "vitest";
import {
  isDurablyAcknowledged,
  parseStoredBatch,
  parseStoredQueue,
  packageStatusNotice,
  storedQueueItemCount,
  validatedAcknowledgementForEvent,
  withoutAcknowledgedBatch,
  type PendingSimulatorBatch
} from "./simulator-queue";

const firstBatch: PendingSimulatorBatch = {
  queueId: "10000000-0000-4000-8000-000000000010",
  deviceId: "10000000-0000-4000-8000-000000000001",
  sessionId: "10000000-0000-4000-8000-000000000001",
  packageVersion: 7,
  event: {
    localSequence: 12,
    stationReceivedAt: "2026-08-30T10:00:00.000Z",
    transport: "simulator",
    payload: {
      cardNumber: "12345",
      startPunchedAt: "2026-08-30T09:00:00.000Z",
      finishPunchedAt: "2026-08-30T10:00:00.000Z",
      punches: [{ code: 31, punchedAt: "2026-08-30T09:30:00.000Z" }]
    },
    contentHash: "a".repeat(64)
  }
};

describe("simulatorns beständiga kö", () => {
  it("återställer sekvens, hash och ursprunglig paketversion", () => {
    expect(parseStoredQueue(JSON.stringify([firstBatch]), 99, firstBatch.deviceId)).toEqual([firstBatch]);
    expect(parseStoredBatch(JSON.stringify(firstBatch), 99, firstBatch.deviceId)).toEqual(firstBatch);
    expect(parseStoredQueue(
      JSON.stringify([firstBatch]),
      99,
      "10000000-0000-4000-8000-000000000099"
    )[0]?.deviceId).toBe(firstBatch.deviceId);
  });

  it("migrerar äldre köform med fryst device/session och ny lokal köidentitet", () => {
    const queueId = "10000000-0000-4000-8000-000000000011";
    expect(parseStoredQueue(JSON.stringify([firstBatch.event]), 9, firstBatch.deviceId, () => queueId)).toEqual([
      {
        queueId,
        deviceId: firstBatch.deviceId,
        sessionId: firstBatch.deviceId,
        packageVersion: 9,
        event: firstBatch.event
      }
    ]);
  });

  it("ignorerar trasig lokal lagring", () => {
    expect(parseStoredQueue("inte json", 1, firstBatch.deviceId)).toEqual([]);
    expect(parseStoredBatch("{}", 1, firstBatch.deviceId)).toBeUndefined();
    expect(storedQueueItemCount("inte json")).toBeUndefined();
    expect(storedQueueItemCount(JSON.stringify([firstBatch]))).toBe(1);
  });

  it("tar bara bort den exakt kvitterade sekvensen och hashen", () => {
    const newerHash = {
      ...firstBatch,
      event: { ...firstBatch.event, contentHash: "b".repeat(64) }
    };
    expect(withoutAcknowledgedBatch([firstBatch, newerHash], firstBatch)).toEqual([newerHash]);
    const sameContextDifferentQueueId = {
      ...firstBatch,
      queueId: "10000000-0000-4000-8000-000000000012"
    };
    expect(withoutAcknowledgedBatch([firstBatch, sameContextDifferentQueueId], firstBatch))
      .toEqual([sameContextDifferentQueueId]);
  });

  it("godtar bara runtimevaliderad kvittens för exakt enhet, sekvens och hash", () => {
    const deviceId = "10000000-0000-4000-8000-000000000001";
    const response = {
      deviceId,
      highestContiguousSequence: 12,
      currentPackageVersion: 7,
      packageVersionStatus: "current",
      packageUpdateRequired: false,
      acknowledgements: [{
        localSequence: 12,
        contentHash: firstBatch.event.contentHash,
        status: "stored",
        rawMessageId: "10000000-0000-4000-8000-000000000002"
      }]
    };

    expect(validatedAcknowledgementForEvent(
      response,
      firstBatch
    )?.event.status).toBe("stored");
    expect(validatedAcknowledgementForEvent(
      response,
      { ...firstBatch, event: { ...firstBatch.event, contentHash: "b".repeat(64) } }
    )).toBeUndefined();
    expect(validatedAcknowledgementForEvent(
      { ...response, packageUpdateRequired: true },
      firstBatch
    )).toBeUndefined();
    expect(validatedAcknowledgementForEvent(
      response,
      { ...firstBatch, deviceId: "10000000-0000-4000-8000-000000000099" }
    )).toBeUndefined();
    expect(validatedAcknowledgementForEvent(
      response,
      { ...firstBatch, event: { ...firstBatch.event, localSequence: firstBatch.event.localSequence + 1 } }
    )).toBeUndefined();
    expect(validatedAcknowledgementForEvent(
      { ...response, currentPackageVersion: 9, packageVersionStatus: "current" },
      firstBatch
    )).toBeUndefined();
    expect(validatedAcknowledgementForEvent(
      { ...response, acknowledgements: [
        ...response.acknowledgements,
        { ...response.acknowledgements[0]!, status: "rejected", reason: "SEQUENCE_HASH_CONFLICT" }
      ] },
      firstBatch
    )).toBeUndefined();
    expect(validatedAcknowledgementForEvent(
      { ...response, unexpected: true },
      firstBatch
    )).toBeUndefined();
  });

  it("tar endast bort stored och duplicate, aldrig rejected", () => {
    expect(isDurablyAcknowledged({
      localSequence: 1,
      contentHash: "a".repeat(64),
      status: "rejected",
      reason: "CONTENT_HASH_MISMATCH"
    })).toBe(false);
    expect(isDurablyAcknowledged({
      localSequence: 1,
      contentHash: "a".repeat(64),
      status: "duplicate",
      rawMessageId: "10000000-0000-4000-8000-000000000002"
    })).toBe(true);
  });

  it("visar stale och ahead paketstatus med serverversion", () => {
    const base = {
      deviceId: "10000000-0000-4000-8000-000000000001",
      highestContiguousSequence: 1,
      currentPackageVersion: 9,
      acknowledgements: [{
        localSequence: 1,
        contentHash: "a".repeat(64),
        status: "stored" as const,
        rawMessageId: "10000000-0000-4000-8000-000000000002"
      }]
    };
    expect(packageStatusNotice({
      ...base,
      packageVersionStatus: "stale",
      packageUpdateRequired: true
    })).toContain("Nytt tävlingspaket krävs (serverversion 9)");
    expect(packageStatusNotice({
      ...base,
      packageVersionStatus: "ahead",
      packageUpdateRequired: false
    })).toContain("högre än serverns (9)");
  });
});
