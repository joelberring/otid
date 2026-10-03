import { describe, expect, it } from "vitest";
import { hasStationCredentialScope, type StationCredentialPrincipal } from "../src/station-credentials";

const principal: StationCredentialPrincipal = {
  credentialId: "10000000-0000-4000-8000-000000000001",
  stationDeviceId: "10000000-0000-4000-8000-000000000002",
  deviceId: "10000000-0000-4000-8000-000000000003",
  raceId: "10000000-0000-4000-8000-000000000004",
  scope: "READOUT",
  generation: 1,
  issuedAt: "2026-08-31T12:00:00.000Z",
  expiresAt: "2026-09-01T12:00:00.000Z"
};

describe("station credential scope", () => {
  it("kräver exakt race, valfri exakt device och funktion", () => {
    expect(hasStationCredentialScope(principal, {
      raceId: principal.raceId,
      deviceId: principal.deviceId,
      scope: "READOUT"
    })).toBe(true);
    expect(hasStationCredentialScope(principal, {
      raceId: principal.raceId,
      scope: "READOUT"
    })).toBe(true);
    expect(hasStationCredentialScope(principal, {
      raceId: "20000000-0000-4000-8000-000000000004",
      deviceId: principal.deviceId,
      scope: "READOUT"
    })).toBe(false);
    expect(hasStationCredentialScope(principal, {
      raceId: principal.raceId,
      deviceId: "20000000-0000-4000-8000-000000000003",
      scope: "READOUT"
    })).toBe(false);
    expect(hasStationCredentialScope(principal, {
      raceId: principal.raceId,
      deviceId: principal.deviceId,
      scope: "START"
    })).toBe(false);
  });
});
