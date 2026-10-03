import { describe, expect, it, vi } from "vitest";
import { StationSyncCoordinator } from "../src/station-sync";
import type { StationStoreCapacitorPlugin, StoredOutboxEvent } from "../src/station-store-plugin";

const ids = {
  race: "10000000-0000-4000-8000-000000000001",
  device: "10000000-0000-4000-8000-000000000002",
  session: "10000000-0000-4000-8000-000000000003",
  raw: "10000000-0000-4000-8000-000000000004"
};
const payload = {
  cardNumber: "12345",
  startPunchedAt: "2026-08-31T08:00:00.000Z",
  finishPunchedAt: "2026-08-31T08:10:00.000Z",
  punches: [{ code: 31, punchedAt: "2026-08-31T08:05:00.000Z" }]
};
const payloadJson = JSON.stringify(payload);
const event: StoredOutboxEvent = {
  raceId: ids.race,
  sessionId: ids.session,
  packageVersion: 3,
  stationReceivedAt: "2026-08-31T08:10:01.000Z",
  transport: "simulator",
  payloadJson,
  contentHash: "46f3a9c5096dcba31ed3042f0cd4d4499d260c755568cc76157fa3677475c1bf",
  deviceId: ids.device,
  localSequence: 7
};

function acknowledgement(overrides: Record<string, unknown> = {}) {
  return {
    deviceId: ids.device,
    highestContiguousSequence: 7,
    currentPackageVersion: 3,
    packageVersionStatus: "current",
    packageUpdateRequired: false,
    acknowledgements: [{
      localSequence: 7,
      contentHash: event.contentHash,
      status: "stored",
      rawMessageId: ids.raw,
      serverResult: {
        status: "UNKNOWN_CARD",
        reason: "UNKNOWN_CARD",
        engineVersion: "1",
        snapshotVersion: 3,
        evaluationHash: "a".repeat(64)
      }
    }],
    ...overrides
  };
}

function fakeStore(listPending = vi.fn()
  .mockResolvedValueOnce({ events: [event] })
  .mockResolvedValueOnce({ events: [] })) {
  const applyAcknowledgements = vi.fn(async () => ({
    acknowledgedCount: 1,
    rejectedCount: 0,
    unchangedCount: 0,
    pendingCount: 0
  }));
  const store: StationStoreCapacitorPlugin = {
    beginDevicePairing: vi.fn(),
    getDevicePairingStatus: vi.fn(),
    redeemDevicePairing: vi.fn(),
    discardDevicePairing: vi.fn(),
    discardInvalidDevicePairing: vi.fn(),
    getDeviceCredentialStatus: vi.fn(),
    authorizedStationRequest: vi.fn(),
    installPackage: vi.fn(),
    getStatus: vi.fn(),
    saveBaseUrl: vi.fn(),
    loadBaseUrl: vi.fn(),
    loadLatestEvaluationPair: vi.fn(),
    loadActivePackage: vi.fn(),
    enqueueEvent: vi.fn(),
    recordLocalEvaluation: vi.fn(),
    listPending,
    applyAcknowledgements
  };
  return { store, listPending, applyAcknowledgements };
}

describe("station sync", () => {
  it("sends one frozen event with stable idempotency identity and applies exact ack", async () => {
    const native = fakeStore();
    const requester = vi.fn(async () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      data: JSON.stringify(acknowledgement()),
      url: "https://otid.example/ack"
    }));
    const coordinator = new StationSyncCoordinator({
      baseUrl: "https://otid.example/",
      store: native.store,
      requester
    });

    const result = await coordinator.flush();

    expect(result).toMatchObject({ processedCount: 1, pendingCount: 0 });
    expect(requester).toHaveBeenCalledOnce();
    expect(requester).toHaveBeenCalledWith({
      baseUrl: "https://otid.example/",
      raceId: ids.race,
      resource: "device-batches",
      method: "POST",
      bodyJson: JSON.stringify({
        deviceId: ids.device,
        sessionId: ids.session,
        packageVersion: 3,
        firstSequence: 7,
        lastSequence: 7,
        events: [{
          localSequence: 7,
          stationReceivedAt: event.stationReceivedAt,
          transport: "simulator",
          payload,
          contentHash: event.contentHash
        }]
      }),
      idempotencyKey: `${ids.device}:7:7`,
      connectTimeoutMs: 10_000,
      readTimeoutMs: 30_000
    });
    expect(native.applyAcknowledgements).toHaveBeenCalledOnce();
  });

  it("coalesces simultaneous flush triggers through one single-flight promise", async () => {
    const native = fakeStore();
    let release: (() => void) | undefined;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    const requester = vi.fn(async () => {
      await blocker;
      return { status: 200, headers: {}, data: JSON.stringify(acknowledgement()), url: "https://otid.example/ack" };
    });
    const coordinator = new StationSyncCoordinator({ baseUrl: "https://otid.example", store: native.store, requester });

    const first = coordinator.flush();
    const second = coordinator.flush();
    expect(second).toBe(first);
    release?.();
    await Promise.all([first, second]);
    expect(requester).toHaveBeenCalledOnce();
  });

  it("preserves pending and stops on HTTP or response-contract errors", async () => {
    const httpFailure = fakeStore(vi.fn().mockResolvedValue({ events: [event] }));
    const failing = new StationSyncCoordinator({
      baseUrl: "https://otid.example",
      store: httpFailure.store,
      requester: vi.fn(async () => ({ status: 500, headers: {}, data: "{}", url: "https://otid.example/ack" }))
    });
    await expect(failing.flush()).rejects.toThrow("(500)");
    expect(httpFailure.applyAcknowledgements).not.toHaveBeenCalled();
    expect(httpFailure.listPending).toHaveBeenCalledOnce();

    const wrongAck = fakeStore(vi.fn().mockResolvedValue({ events: [event] }));
    const mismatched = new StationSyncCoordinator({
      baseUrl: "https://otid.example",
      store: wrongAck.store,
      requester: vi.fn(async () => ({
        status: 200,
        headers: {},
        data: JSON.stringify(acknowledgement({ deviceId: "20000000-0000-4000-8000-000000000001" })),
        url: "https://otid.example/ack"
      }))
    });
    await expect(mismatched.flush()).rejects.toThrow("matchar inte");
    expect(wrongAck.applyAcknowledgements).not.toHaveBeenCalled();

    const partialAck = fakeStore(vi.fn().mockResolvedValue({ events: [event] }));
    const partial = acknowledgement({
      acknowledgements: [
        ...acknowledgement().acknowledgements,
        { localSequence: 8, contentHash: "f".repeat(64), status: "rejected", reason: "CONTENT_HASH_MISMATCH" }
      ]
    });
    const partialCoordinator = new StationSyncCoordinator({
      baseUrl: "https://otid.example",
      store: partialAck.store,
      requester: vi.fn(async () => ({ status: 200, headers: {}, data: JSON.stringify(partial), url: "https://otid.example/ack" }))
    });
    await expect(partialCoordinator.flush()).rejects.toThrow("kardinalitet");
    expect(partialAck.applyAcknowledgements).not.toHaveBeenCalled();
  });

  it.each([401, 403, 413, 415])("keeps pending and stops ordered flush on rejected HTTP status %i", async (status) => {
    const native = fakeStore(vi.fn().mockResolvedValue({ events: [event] }));
    const coordinator = new StationSyncCoordinator({
      baseUrl: "https://otid.example",
      store: native.store,
      requester: vi.fn(async () => ({
        status,
        headers: { "cache-control": "no-store" },
        data: JSON.stringify({ error: "Stationsautentisering misslyckades" }),
        url: "https://otid.example/auth"
      }))
    });
    await expect(coordinator.flush()).rejects.toThrow(`(${status})`);
    expect(native.applyAcknowledgements).not.toHaveBeenCalled();
    expect(native.listPending).toHaveBeenCalledOnce();
  });

  it("propagates native commit failure so the same pending event can be retried", async () => {
    const native = fakeStore(vi.fn().mockResolvedValue({ events: [event] }));
    native.applyAcknowledgements.mockRejectedValueOnce(new Error("SQLite transaction rolled back"));
    const requester = vi.fn(async () => ({
      status: 200,
      headers: {},
      data: JSON.stringify(acknowledgement()),
      url: "https://otid.example/ack"
    }));
    const coordinator = new StationSyncCoordinator({ baseUrl: "https://otid.example", store: native.store, requester });

    await expect(coordinator.flush()).rejects.toThrow("rolled back");
    expect(native.listPending).toHaveBeenCalledOnce();
    expect(native.applyAcknowledgements).toHaveBeenCalledOnce();
  });

  it("never sends corrupt native payload or hash", async () => {
    const corrupted = { ...event, payloadJson: `${payloadJson} ` };
    const native = fakeStore(vi.fn().mockResolvedValue({ events: [corrupted] }));
    const requester = vi.fn();
    const coordinator = new StationSyncCoordinator({ baseUrl: "https://otid.example", store: native.store, requester });
    await expect(coordinator.flush()).rejects.toThrow("korrupt");
    expect(requester).not.toHaveBeenCalled();
    expect(native.applyAcknowledgements).not.toHaveBeenCalled();
  });

  it("accepts explicit rejection and coherent stale package status", async () => {
    const native = fakeStore();
    const data = acknowledgement({
      currentPackageVersion: 4,
      packageVersionStatus: "stale",
      packageUpdateRequired: true,
      acknowledgements: [{
        localSequence: 7,
        contentHash: event.contentHash,
        status: "rejected",
        reason: "SEQUENCE_CONTEXT_CONFLICT"
      }]
    });
    const coordinator = new StationSyncCoordinator({
      baseUrl: "https://otid.example",
      store: native.store,
      requester: vi.fn(async () => ({ status: 200, headers: {}, data: JSON.stringify(data), url: "https://otid.example/ack" }))
    });
    await expect(coordinator.flush()).resolves.toMatchObject({ processedCount: 1 });
    expect(native.applyAcknowledgements).toHaveBeenCalledOnce();
  });
});
