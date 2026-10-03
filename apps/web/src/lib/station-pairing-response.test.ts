import { describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";
import type {
  redeemStationPairingGrant,
  StationPairingRedemptionResult
} from "@o-tid/application";
import { stationPairingRedemptionResponse } from "./station-pairing-response";

const attemptId = "10000000-0000-4000-8000-000000000001";
const deviceId = "10000000-0000-4000-8000-000000000002";
const db = {} as Database;

function request(body = "{}") {
  return new Request("https://otid.test/api/station-pairing/redeem", {
    method: "POST",
    headers: {
      authorization: "Bearer otid_pair_v1.10000000-0000-4000-8000-000000000003.secret",
      "idempotency-key": `pairing:${attemptId}`,
      "content-type": "application/json"
    },
    body
  });
}

function redeemer(result: StationPairingRedemptionResult) {
  return vi.fn(async () => result);
}

describe("pairing-route-svar", () => {
  it("returnerar endast runtimevaliderad publik credentialmetadata och no-store", async () => {
    const response = await stationPairingRedemptionResponse(db, request(), redeemer({
      status: "stored",
      response: {
        formatVersion: 1,
        attemptId,
        credential: {
          credentialId: "10000000-0000-4000-8000-000000000004",
          deviceId,
          raceId: "10000000-0000-4000-8000-000000000005",
          scope: "READOUT",
          generation: 1,
          issuedAt: "2026-08-31T12:00:00.000Z",
          expiresAt: "2026-09-01T12:00:00.000Z"
        }
      }
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(await response.json()).toMatchObject({ formatVersion: 1, attemptId, credential: { deviceId } });
  });

  it.each([
    ["unauthorized", 401],
    ["invalid-request", 400],
    ["conflict", 409]
  ] as const)("ger generiskt privat %s-svar", async (status, expectedStatus) => {
    const response = await stationPairingRedemptionResponse(db, request("inte-json"), redeemer({ status }));
    expect(response.status).toBe(expectedStatus);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(await response.json()).toEqual({ error: "Parningen kunde inte genomföras" });
  });

  it("begränsar Retry-After till use casets publika heltal", async () => {
    const response = await stationPairingRedemptionResponse(db, request(), redeemer({
      status: "rate-limited",
      retryAfterSeconds: 417
    }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("417");
    expect(await response.json()).toEqual({ error: "Parningen kunde inte genomföras" });
  });

  it("maskerar oväntade fel och kontraktsavvikelser som generiskt 500", async () => {
    const response = await stationPairingRedemptionResponse(db, request(), vi.fn(async () => {
      throw new Error("databasdetalj");
    }));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("databasdetalj");
  });

  it("avvisar body över 8 KiB innan JSON parsas", async () => {
    const oversized = request(JSON.stringify({ padding: "x".repeat(9 * 1024) }));
    const parseBody: typeof redeemStationPairingGrant = async (_db, input) => {
      try {
        await input.readBody();
      } catch {
        return { status: "invalid-request" as const };
      }
      throw new Error("För stor body accepterades");
    };
    const response = await stationPairingRedemptionResponse(db, oversized, vi.fn(parseBody));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Parningen kunde inte genomföras" });
  });
});
