import { describe, expect, it } from "vitest";
import {
  stationPairingRedemptionRequestSchema,
  stationPairingRedemptionResponseSchema
} from "../src";

const attemptId = "10000000-0000-4000-8000-000000000001";
const deviceId = "10000000-0000-4000-8000-000000000002";

describe("stationsparningskontrakt", () => {
  it("validerar exakt fyrfälts-request", () => {
    const request = {
      formatVersion: 1,
      attemptId,
      deviceId,
      credentialSecretHash: "a".repeat(64)
    };
    expect(stationPairingRedemptionRequestSchema.parse(request)).toEqual(request);
    expect(stationPairingRedemptionRequestSchema.safeParse({ ...request, raceId: crypto.randomUUID() }).success)
      .toBe(false);
    expect(stationPairingRedemptionRequestSchema.safeParse({
      ...request,
      attemptId: "a0000000-0000-4000-8000-000000000001".toUpperCase()
    }).success)
      .toBe(false);
    expect(stationPairingRedemptionRequestSchema.safeParse({ ...request, credentialSecretHash: "A".repeat(64) }).success)
      .toBe(false);
  });

  it("validerar det nested native-svaret utan token eller secret", () => {
    const response = {
      formatVersion: 1,
      attemptId,
      credential: {
        credentialId: "10000000-0000-4000-8000-000000000003",
        deviceId,
        raceId: "10000000-0000-4000-8000-000000000004",
        scope: "READOUT",
        generation: 2,
        issuedAt: "2026-08-31T12:00:00.000Z",
        expiresAt: "2026-09-01T12:00:00.000Z"
      }
    };
    expect(stationPairingRedemptionResponseSchema.parse(response)).toEqual(response);
    expect(stationPairingRedemptionResponseSchema.safeParse({
      ...response,
      credential: { ...response.credential, token: "hemlig" }
    }).success).toBe(false);
  });
});
