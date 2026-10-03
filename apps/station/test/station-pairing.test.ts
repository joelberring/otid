import { describe, expect, it, vi } from "vitest";
import {
  beginStationPairing,
  discardInvalidStationPairing,
  discardStationPairing,
  parseStationPairingStatus,
  readStationPairingStatus,
  redeemStationPairing
} from "../src/station-pairing";
import type { StationPairingStatus, StationStoreCapacitorPlugin } from "../src/station-store-plugin";

const attemptId = "10000000-0000-4000-8000-000000000001";
const deviceId = "10000000-0000-4000-8000-000000000002";
const credentialId = "10000000-0000-4000-8000-000000000003";
const raceId = "10000000-0000-4000-8000-000000000004";
const grantToken = `otid_pair_v1.${attemptId}.${"A".repeat(43)}`;
const credential = {
  credentialId,
  deviceId,
  raceId,
  scope: "READOUT" as const,
  generation: 2,
  issuedAt: "2026-08-31T08:00:00.000Z",
  expiresAt: "2026-09-01T08:00:00.000Z"
};

function fakeStore(status: StationPairingStatus = { state: "none" }) {
  const beginDevicePairing = vi.fn(async () => status);
  const redeemDevicePairing = vi.fn(async () => ({ status: "installed" as const, credential }));
  const discardDevicePairing = vi.fn(async () => ({ state: "none" as const }));
  const discardInvalidDevicePairing = vi.fn(async () => ({ state: "none" as const }));
  const store: StationStoreCapacitorPlugin = {
    beginDevicePairing,
    getDevicePairingStatus: vi.fn(async () => status),
    redeemDevicePairing,
    discardDevicePairing,
    discardInvalidDevicePairing,
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
    listPending: vi.fn(),
    applyAcknowledgements: vi.fn()
  };
  return { store, beginDevicePairing, redeemDevicePairing, discardDevicePairing, discardInvalidDevicePairing };
}

describe("station pairing bridge", () => {
  it("passes the one-time grant only to begin and returns only public pending metadata", async () => {
    const pending = { state: "pending" as const, attempt: { attemptId, deviceId, startedAtEpochMs: 1_788_163_200_000 } };
    const { store, beginDevicePairing } = fakeStore(pending);

    await expect(beginStationPairing({ baseUrl: "https://otid.example/", grantToken }, store)).resolves.toEqual(pending);
    expect(beginDevicePairing).toHaveBeenCalledWith({ baseUrl: "https://otid.example/", grantToken });
    expect(JSON.stringify(await readStationPairingStatus(store))).not.toMatch(/grant|secret|hash|token/i);
  });

  it("redeems only by attempt id with bounded native timeouts", async () => {
    const { store, redeemDevicePairing } = fakeStore();

    await expect(redeemStationPairing(attemptId, store)).resolves.toEqual({ status: "installed", credential });
    expect(redeemDevicePairing).toHaveBeenCalledWith({
      attemptId,
      connectTimeoutMs: 10_000,
      readTimeoutMs: 30_000
    });
  });

  it("rejects secret-bearing or structurally ambiguous native responses", async () => {
    expect(() => parseStationPairingStatus({
      state: "pending",
      attempt: { attemptId, deviceId, startedAtEpochMs: 1, credentialSecretHash: "a".repeat(64) }
    })).toThrow("ogiltig pairingstatus");

    const { store, redeemDevicePairing } = fakeStore();
    redeemDevicePairing.mockResolvedValueOnce({
      status: "installed",
      credential,
      token: "must-not-cross-the-bridge"
    } as never);
    await expect(redeemStationPairing(attemptId, store)).rejects.toThrow("ogiltigt pairingsvar");
  });

  it("requires exact explicit identifiers for readable and invalid-state discard", async () => {
    const { store, discardDevicePairing, discardInvalidDevicePairing } = fakeStore();

    await expect(discardStationPairing(attemptId, store)).resolves.toEqual({ state: "none" });
    expect(discardDevicePairing).toHaveBeenCalledWith({ expectedAttemptId: attemptId });
    await expect(discardInvalidStationPairing(deviceId, store)).resolves.toEqual({ state: "none" });
    expect(discardInvalidDevicePairing).toHaveBeenCalledWith({ confirmDeviceId: deviceId });

    await expect(discardStationPairing("not-an-attempt", store)).rejects.toThrow("ogiltigt");
    await expect(discardInvalidStationPairing("not-a-device", store)).rejects.toThrow("ogiltigt");
  });

  it("rejects malformed grants before native receives them", async () => {
    const { store, beginDevicePairing } = fakeStore();
    await expect(beginStationPairing({ baseUrl: "https://otid.example/", grantToken: `${grantToken}=` }, store))
      .rejects.toThrow("ogiltigt");
    expect(beginDevicePairing).not.toHaveBeenCalled();
  });
});
