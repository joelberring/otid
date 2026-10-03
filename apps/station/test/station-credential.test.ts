import { describe, expect, it, vi } from "vitest";
import {
  parseAuthorizedStationResponse,
  parseStationCredentialStatus
} from "../src/station-credential";
import type { StationStoreCapacitorPlugin } from "../src/station-store-plugin";

const metadata = {
  credentialId: "30000000-0000-4000-8000-000000000001",
  deviceId: "30000000-0000-4000-8000-000000000002",
  raceId: "30000000-0000-4000-8000-000000000003",
  scope: "READOUT" as const,
  generation: 2,
  issuedAt: "2026-08-31T08:00:00.000Z",
  expiresAt: "2026-09-01T08:00:00.000Z"
};

function fakeStore(): StationStoreCapacitorPlugin {
  return {
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
    listPending: vi.fn(),
    applyAcknowledgements: vi.fn()
  };
}

describe("station credential boundary", () => {
  it("has no public manual plaintext installation method", () => {
    expect("installDeviceCredential" in fakeStore()).toBe(false);
  });

  it("accepts exact operational states and rejects extra or contradictory fields", () => {
    expect(parseStationCredentialStatus({ state: "missing" })).toEqual({ state: "missing" });
    expect(parseStationCredentialStatus({ state: "active", credential: metadata }))
      .toEqual({ state: "active", credential: metadata });
    expect(() => parseStationCredentialStatus({ state: "missing", credential: metadata })).toThrow("ogiltig");
    expect(() => parseStationCredentialStatus({
      state: "active",
      credential: { ...metadata, expiresAt: metadata.issuedAt }
    })).toThrow("ogiltig");
  });

  it("parses only the bounded native response shape and normalizes header names", () => {
    expect(parseAuthorizedStationResponse({
      status: 401,
      headers: { "Cache-Control": "no-store" },
      data: "{}",
      url: "https://otid.example/api/races/one/device-batches"
    })).toEqual({
      status: 401,
      headers: { "cache-control": "no-store" },
      data: "{}",
      url: "https://otid.example/api/races/one/device-batches"
    });
    expect(() => parseAuthorizedStationResponse({
      status: 200,
      headers: {},
      data: {},
      url: "https://otid.example",
      token: "leak"
    })).toThrow("ogiltigt");
  });
});
