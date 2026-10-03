import {
  canonicalJsonBytes,
  stationPackagePayloadSchema,
  type LocalStationEvaluation
} from "@o-tid/contracts";
import { sha256Hex } from "@o-tid/device-transport";
import { RESULT_ENGINE_VERSION } from "@o-tid/domain";
import { describe, expect, it, vi } from "vitest";
import { readStationOperationalStatus } from "../src/operational-status";
import type { LatestEvaluationPair, StationStoreCapacitorPlugin } from "../src/station-store-plugin";

const ids = {
  event: "20000000-0000-4000-8000-000000000001",
  race: "20000000-0000-4000-8000-000000000002",
  device: "20000000-0000-4000-8000-000000000003"
};

function fakeStore(engineVersion = RESULT_ENGINE_VERSION): {
  store: StationStoreCapacitorPlugin;
  getStatus: ReturnType<typeof vi.fn>;
  loadLatestEvaluationPair: ReturnType<typeof vi.fn>;
} {
  const payload = stationPackagePayloadSchema.parse({
    formatVersion: 1,
    raceId: ids.race,
    packageVersion: 1,
    resultEngineVersion: engineVersion,
    stationFunction: "READOUT",
    event: { id: ids.event, name: "Test", startsOn: "2026-08-31", timeZone: "Europe/Stockholm" },
    raceSnapshot: {
      race: { id: ids.race, eventId: ids.event, name: "Lopp", raceDate: "2026-08-31", snapshotVersion: 1 },
      classes: [], courses: [], entries: [], cardAssignments: [], classControlNeutralizations: []
    },
    verificationKey: { algorithm: "RS256", keyId: "a".repeat(64), publicKeySpkiBase64: "AQ==" }
  });
  const payloadJson = new TextDecoder().decode(canonicalJsonBytes(payload));
  const payloadSha256 = sha256Hex(new TextEncoder().encode(payloadJson));
  const getStatus = vi.fn(async () => ({
    deviceId: ids.device,
    nextLocalSequence: 4,
    activePackages: [{ raceId: ids.race, packageVersion: 1, payloadSha256, keyId: "a".repeat(64) }],
    pendingCount: 1,
    readoutCount: 3,
    acknowledgedCount: 1,
    rejectedCount: 1,
    latestLocalEvaluation: null
  }));
  const loadLatestEvaluationPair = vi.fn(async () => ({ pair: null }));
  const store: StationStoreCapacitorPlugin = {
    beginDevicePairing: vi.fn(),
    getDevicePairingStatus: vi.fn(async () => ({ state: "none" as const })),
    redeemDevicePairing: vi.fn(),
    discardDevicePairing: vi.fn(),
    discardInvalidDevicePairing: vi.fn(),
    getDeviceCredentialStatus: vi.fn(async () => ({
      state: "active" as const,
      credential: {
        credentialId: "20000000-0000-4000-8000-000000000004",
        deviceId: ids.device,
        raceId: ids.race,
        scope: "READOUT" as const,
        generation: 1,
        issuedAt: "2026-08-31T08:00:00.000Z",
        expiresAt: "2026-09-01T08:00:00.000Z"
      }
    })),
    authorizedStationRequest: vi.fn(),
    installPackage: vi.fn(),
    getStatus,
    saveBaseUrl: vi.fn(),
    loadBaseUrl: vi.fn(),
    loadLatestEvaluationPair,
    loadActivePackage: vi.fn(async () => ({
      raceId: ids.race,
      packageVersion: 1,
      payloadSha256,
      keyId: "a".repeat(64),
      payloadJson
    })),
    enqueueEvent: vi.fn(),
    recordLocalEvaluation: vi.fn(),
    listPending: vi.fn(),
    applyAcknowledgements: vi.fn()
  };
  return { store, getStatus, loadLatestEvaluationPair };
}

function evaluationPair(options: { engineVersion?: string; evaluationHash?: string } = {}): LatestEvaluationPair {
  const evaluation: LocalStationEvaluation = {
    formatVersion: 1,
    deviceId: ids.device,
    localSequence: 3,
    raceId: ids.race,
    packageVersion: 1,
    packagePayloadSha256: "b".repeat(64),
    engineVersion: RESULT_ENGINE_VERSION,
    snapshotVersion: 1,
    evaluation: { status: "UNKNOWN_CARD", reason: "UNKNOWN_CARD", missingControls: [], extraPunches: [], splits: [] }
  };
  const localEvaluationJson = new TextDecoder().decode(canonicalJsonBytes(evaluation));
  const fullEvaluationHash = sha256Hex(canonicalJsonBytes(evaluation.evaluation));
  const serverResult = {
    status: "UNKNOWN_CARD" as const,
    reason: "UNKNOWN_CARD" as const,
    engineVersion: options.engineVersion ?? RESULT_ENGINE_VERSION,
    snapshotVersion: 1,
    evaluationHash: options.evaluationHash ?? fullEvaluationHash
  };
  const serverResultJson = new TextDecoder().decode(canonicalJsonBytes(serverResult));
  return {
    deviceId: ids.device,
    localSequence: 3,
    raceId: ids.race,
    packageVersion: 1,
    contentHash: "c".repeat(64),
    outboxState: "ACKNOWLEDGED",
    rejectionReason: null,
    localEvaluation: {
      localEvaluationJson,
      evaluationHash: sha256Hex(canonicalJsonBytes(evaluation))
    },
    serverObservation: {
      observationHash: "d".repeat(64),
      rawMessageId: "20000000-0000-4000-8000-000000000004",
      acknowledgementStatus: "stored",
      rejectionReason: null,
      currentPackageVersion: 2,
      packageVersionStatus: "stale",
      packageUpdateRequired: true,
      serverResultJson,
      serverResultHash: sha256Hex(canonicalJsonBytes(serverResult)),
      evaluationHash: serverResult.evaluationHash,
      observedAtEpochMs: 1_788_163_200_000
    }
  };
}

describe("station operational status", () => {
  it("keeps network state separate and reports verified package/counts", async () => {
    await expect(readStationOperationalStatus({ raceId: ids.race, online: false, store: fakeStore().store }))
      .resolves.toMatchObject({
        online: false,
        deviceId: ids.device,
        readoutCount: 3,
        pendingCount: 1,
        acknowledgedCount: 1,
        rejectedCount: 1,
        packageState: { kind: "ready", raceId: ids.race, packageVersion: 1 }
      });
  });

  it("marks a package with another result engine as incompatible", async () => {
    const status = await readStationOperationalStatus({ raceId: ids.race, online: true, store: fakeStore("99").store });
    expect(status.packageState).toEqual({
      kind: "incompatible",
      raceId: ids.race,
      packageVersion: 1,
      packageEngineVersion: "99"
    });
  });

  it("proves a full local/central match and exposes persisted server package status", async () => {
    const native = fakeStore();
    native.loadLatestEvaluationPair.mockResolvedValueOnce({ pair: evaluationPair() });
    const status = await readStationOperationalStatus({ raceId: ids.race, online: true, store: native.store });
    expect(status.centralSync).toMatchObject({
      latestContactAtEpochMs: 1_788_163_200_000,
      currentPackageVersion: 2,
      packageVersionStatus: "stale",
      packageUpdateRequired: true,
      comparison: { kind: "match", localSequence: 3 }
    });
    expect(status.latestLocalEvaluation?.raceId).toBe(ids.race);
  });

  it("separates version divergence from an actual evaluation difference", async () => {
    const versioned = fakeStore();
    versioned.loadLatestEvaluationPair.mockResolvedValueOnce({ pair: evaluationPair({ engineVersion: "99" }) });
    await expect(readStationOperationalStatus({ raceId: ids.race, online: true, store: versioned.store }))
      .resolves.toMatchObject({ centralSync: { comparison: { kind: "version-divergence" } } });

    const different = fakeStore();
    different.loadLatestEvaluationPair.mockResolvedValueOnce({ pair: evaluationPair({ evaluationHash: "e".repeat(64) }) });
    await expect(readStationOperationalStatus({ raceId: ids.race, online: true, store: different.store }))
      .resolves.toMatchObject({ centralSync: { comparison: { kind: "different" } } });
  });

  it("rejects inconsistent counters and a changed evaluation hash", async () => {
    const inconsistent = fakeStore();
    inconsistent.getStatus.mockResolvedValueOnce({
      deviceId: ids.device,
      nextLocalSequence: 4,
      activePackages: [],
      pendingCount: 2,
      readoutCount: 3,
      acknowledgedCount: 1,
      rejectedCount: 1,
      latestLocalEvaluation: null
    });
    await expect(readStationOperationalStatus({ online: true, store: inconsistent.store }))
      .rejects.toThrow("inkonsistenta");

    const changed = fakeStore();
    const evaluation: LocalStationEvaluation = {
      formatVersion: 1,
      deviceId: ids.device,
      localSequence: 3,
      raceId: ids.race,
      packageVersion: 1,
      packagePayloadSha256: "b".repeat(64),
      engineVersion: RESULT_ENGINE_VERSION,
      snapshotVersion: 1,
      evaluation: { status: "UNKNOWN_CARD", reason: "UNKNOWN_CARD", missingControls: [], extraPunches: [], splits: [] }
    };
    changed.getStatus.mockResolvedValueOnce({
      deviceId: ids.device,
      nextLocalSequence: 4,
      activePackages: [],
      pendingCount: 1,
      readoutCount: 3,
      acknowledgedCount: 1,
      rejectedCount: 1,
      latestLocalEvaluation: {
        localEvaluationJson: new TextDecoder().decode(canonicalJsonBytes(evaluation)),
        evaluationHash: "f".repeat(64)
      }
    });
    await expect(readStationOperationalStatus({ online: true, store: changed.store }))
      .rejects.toThrow("hash matchar inte");
  });
});
