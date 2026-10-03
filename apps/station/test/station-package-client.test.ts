import { describe, expect, it, vi } from "vitest";
import type { StationStoreCapacitorPlugin } from "../src/station-store-plugin";
import { installDownloadedStationPackage } from "../src/station-package-client";

const raceId = "00000000-0000-4000-8000-000000000001";
const keyId = "a".repeat(64);
const envelope = {
  formatVersion: 1,
  algorithm: "RS256",
  keyId,
  payload: "eyJmb3JtYXRWZXJzaW9uIjoxfQ",
  signature: "c2lnbmF0dXJl"
};

function fakeStore(): {
  store: StationStoreCapacitorPlugin;
  installPackage: ReturnType<typeof vi.fn>;
} {
  const installPackage = vi.fn(async () => ({
    status: "installed" as const,
    raceId,
    packageVersion: 4,
    payloadSha256: "b".repeat(64),
    keyId
  }));
  return {
    installPackage,
    store: {
      beginDevicePairing: vi.fn(),
      getDevicePairingStatus: vi.fn(),
      redeemDevicePairing: vi.fn(),
      discardDevicePairing: vi.fn(),
      discardInvalidDevicePairing: vi.fn(),
      getDeviceCredentialStatus: vi.fn(),
      authorizedStationRequest: vi.fn(),
      installPackage,
      getStatus: vi.fn(),
      saveBaseUrl: vi.fn(),
      loadBaseUrl: vi.fn(),
      loadLatestEvaluationPair: vi.fn(),
      loadActivePackage: vi.fn(),
      enqueueEvent: vi.fn(),
      recordLocalEvaluation: vi.fn(),
      listPending: vi.fn(),
      applyAcknowledgements: vi.fn()
    }
  };
}

describe("station package client", () => {
  it("delegates authenticated package download to native without a plaintext credential input", async () => {
    const requester = vi.fn(async () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      data: JSON.stringify(envelope),
      url: `https://otid.example/api/races/${raceId}/station-package`
    }));
    const { store, installPackage } = fakeStore();

    const result = await installDownloadedStationPackage({
      baseUrl: "https://otid.example/",
      raceId,
      trustedPublicKeySpkiBase64: "YWJjZA==",
      requester,
      store
    });

    expect(requester).toHaveBeenCalledWith({
      baseUrl: "https://otid.example/",
      raceId,
      resource: "station-package",
      method: "GET",
      connectTimeoutMs: 10_000,
      readTimeoutMs: 30_000
    });
    expect(installPackage).toHaveBeenCalledWith({
      envelopeJson: JSON.stringify(envelope),
      trustedPublicKeySpkiBase64: "YWJjZA=="
    });
    expect(result).toMatchObject({ raceId, packageVersion: 4, status: "installed" });
  });

  it("does not call native storage for a malformed server response", async () => {
    const { store, installPackage } = fakeStore();
    const requester = vi.fn(async () => ({
      status: 200,
      headers: {},
      data: JSON.stringify({ ...envelope, signature: "inte base64url!" }),
      url: "http://localhost/invalid"
    }));
    await expect(installDownloadedStationPackage({
      baseUrl: "http://localhost:3000",
      raceId,
      trustedPublicKeySpkiBase64: "YWJjZA==",
      requester,
      store
    })).rejects.toThrow("giltigt tävlingspaket");
    expect(installPackage).not.toHaveBeenCalled();
  });

  it("can reuse an already installed credential without receiving plaintext in TypeScript", async () => {
    const { store } = fakeStore();
    const requester = vi.fn(async () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      data: JSON.stringify(envelope),
      url: `https://otid.example/api/races/${raceId}/station-package`
    }));

    await installDownloadedStationPackage({
      baseUrl: "https://otid.example",
      raceId,
      trustedPublicKeySpkiBase64: "YWJjZA==",
      requester,
      store
    });

    expect(requester).toHaveBeenCalledWith({
      baseUrl: "https://otid.example",
      raceId,
      resource: "station-package",
      method: "GET",
      connectTimeoutMs: 10_000,
      readTimeoutMs: 30_000
    });
  });

  it("leaves URL policy enforcement at the native credential boundary", async () => {
    const requester = vi.fn(async () => {
      throw new Error("Endast HTTPS eller loopback-HTTP tillåts");
    });
    await expect(installDownloadedStationPackage({
      baseUrl: "http://otid.example",
      raceId,
      trustedPublicKeySpkiBase64: "YWJjZA==",
      requester,
      store: fakeStore().store
    })).rejects.toThrow("HTTPS");
  });
});
