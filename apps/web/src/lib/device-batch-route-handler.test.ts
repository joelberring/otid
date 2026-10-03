import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { authenticateStationBearer, ingestDeviceBatch } from "@o-tid/application";
import type { DeviceBatch } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  DEVICE_BATCH_MAX_BODY_BYTES,
  deviceBatchRoute,
  readBoundedDeviceBatchJson
} from "./device-batch-route-handler";

const db = {} as Database;
const raceId = "10000000-0000-4000-8000-000000000001";
const deviceId = "10000000-0000-4000-8000-000000000002";
const otherDeviceId = "10000000-0000-4000-8000-000000000003";
const sessionId = "10000000-0000-4000-8000-000000000004";
const rawMessageId = "10000000-0000-4000-8000-000000000005";

function validBatch(sequence = 1): DeviceBatch {
  return {
    deviceId,
    sessionId,
    packageVersion: 1,
    firstSequence: sequence,
    lastSequence: sequence,
    events: [{
      localSequence: sequence,
      stationReceivedAt: "2026-08-31T10:00:00.000Z",
      transport: "simulator",
      payload: {
        cardNumber: "12345",
        startPunchedAt: "2026-08-31T09:50:00.000Z",
        finishPunchedAt: "2026-08-31T10:00:00.000Z",
        punches: [{ code: 31, punchedAt: "2026-08-31T09:55:00.000Z" }]
      },
      contentHash: "a".repeat(64)
    }]
  };
}

function authenticated(overrides: Partial<{ raceId: string; deviceId: string; scope: "READOUT" }> = {}) {
  return {
    status: "authenticated" as const,
    principal: {
      credentialId: "10000000-0000-4000-8000-000000000006",
      stationDeviceId: "10000000-0000-4000-8000-000000000007",
      deviceId: overrides.deviceId ?? deviceId,
      raceId: overrides.raceId ?? raceId,
      scope: overrides.scope ?? "READOUT" as const,
      generation: 1,
      issuedAt: "2026-08-31T09:00:00.000Z",
      expiresAt: "2026-09-01T09:00:00.000Z"
    }
  };
}

function authenticator(result: ReturnType<typeof authenticated> | { status: "unauthorized" }) {
  return vi.fn(async () => result) as unknown as typeof authenticateStationBearer;
}

function acknowledgement(batch: DeviceBatch) {
  return {
    deviceId: batch.deviceId,
    highestContiguousSequence: batch.lastSequence,
    currentPackageVersion: batch.packageVersion,
    packageVersionStatus: "current" as const,
    packageUpdateRequired: false,
    acknowledgements: batch.events.map((event, index) => ({
      localSequence: event.localSequence,
      contentHash: event.contentHash,
      status: "stored" as const,
      rawMessageId: index === 0
        ? rawMessageId
        : `10000000-0000-4000-8${String(index).padStart(3, "0")}-000000000005`
    }))
  };
}

function ingester(implementation: typeof ingestDeviceBatch = async (_db, _raceId, batch) => acknowledgement(batch)) {
  return vi.fn(implementation) as unknown as typeof ingestDeviceBatch;
}

function request(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request(`https://otid.example/api/races/${raceId}/device-batches`, {
    method: "POST",
    headers: {
      authorization: "Bearer station",
      "content-type": "application/json",
      "idempotency-key": `${deviceId}:1:1`,
      ...headers
    },
    body
  });
}

function expectPrivate(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("no-store, private");
  expect(response.headers.get("content-security-policy")).toBe("default-src 'none'");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
}

describe("TASK 005M device-batch-route", () => {
  it("läser ingen body för unauthenticated eller cross-race principal", async () => {
    for (const [authenticate, expectedStatus] of [
      [authenticator({ status: "unauthorized" }), 401],
      [authenticator(authenticated({ raceId: otherDeviceId })), 403]
    ] as const) {
      let pulls = 0;
      const unread = {
        headers: new Headers({ authorization: "Bearer station" }),
        get body() { pulls += 1; throw new Error("body lästes"); }
      } as unknown as Request;
      const ingest = ingester();
      const response = await deviceBatchRoute(db, unread, raceId, { authenticate, ingest });
      expect(response.status).toBe(expectedStatus);
      expect(pulls).toBe(0);
      expect(ingest).not.toHaveBeenCalled();
      expectPrivate(response);
    }
  });

  it("maskerar authfel som privat 500 före body", async () => {
    const authenticate = vi.fn(async () => { throw new Error("hemlig DB-detalj"); }) as unknown as typeof authenticateStationBearer;
    const response = await deviceBatchRoute(db, request(JSON.stringify(validBatch())), raceId, { authenticate });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("hemlig DB-detalj");
    expectPrivate(response);
  });

  it.each([undefined, "text/plain", "application/json; charset=utf-8"])(
    "kräver exakt application/json (%s)",
    async (contentType) => {
      const headers: Record<string, string> = {};
      if (contentType !== undefined) headers["content-type"] = contentType;
      const base = request(JSON.stringify(validBatch()), headers);
      if (contentType === undefined) base.headers.delete("content-type");
      const ingest = ingester();
      const response = await deviceBatchRoute(db, base, raceId, {
        authenticate: authenticator(authenticated()), ingest
      });
      expect(response.status).toBe(415);
      expect(await response.json()).toEqual({ error: "Ogiltig stationsbatch" });
      expect(ingest).not.toHaveBeenCalled();
      expectPrivate(response);
    }
  );

  it.each(["0", "-1", "+1", "01", " 1", "1 "])(
    "avvisar icke-canonical Content-Length %s som 400",
    async (contentLength) => {
      const ingest = ingester();
      const response = await deviceBatchRoute(db, request("{}", { "content-length": contentLength }), raceId, {
        authenticate: authenticator(authenticated()), ingest
      });
      expect(response.status).toBe(400);
      expect(ingest).not.toHaveBeenCalled();
    }
  );

  it("avvisar för stor deklaration före body-pull", async () => {
    let pulls = 0;
    const unread = {
      headers: new Headers({
        authorization: "Bearer station",
        "content-type": "application/json",
        "content-length": String(DEVICE_BATCH_MAX_BODY_BYTES + 1)
      }),
      get body() { pulls += 1; throw new Error("body lästes"); }
    } as unknown as Request;
    const response = await deviceBatchRoute(db, unread, raceId, {
      authenticate: authenticator(authenticated()), ingest: ingester()
    });
    expect(response.status).toBe(413);
    expect(pulls).toBe(0);
  });

  it("avvisar faktisk/deklarerad mismatch, tom body, trasig UTF-8 och JSON som 400", async () => {
    const cases = [
      request("{}", { "content-length": "3" }),
      request(null),
      request(new Uint8Array([0xff])),
      request("{")
    ];
    for (const candidate of cases) {
      const ingest = ingester();
      const response = await deviceBatchRoute(db, candidate, raceId, {
        authenticate: authenticator(authenticated()), ingest
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Ogiltig stationsbatch" });
      expect(ingest).not.toHaveBeenCalled();
    }
  });

  it("läser exakt 4 MiB men cancelar faktisk byte 4 MiB+1 utan deklaration", async () => {
    const exact = new Uint8Array(DEVICE_BATCH_MAX_BODY_BYTES);
    exact[0] = 0x22;
    exact.fill(0x20, 1, exact.length - 1);
    exact[exact.length - 1] = 0x22;
    await expect(readBoundedDeviceBatchJson(request(exact))).resolves.toBe(" ".repeat(exact.length - 2));

    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(DEVICE_BATCH_MAX_BODY_BYTES + 1));
      },
      cancel() { cancelled = true; }
    });
    const overflow = {
      headers: new Headers({ "content-type": "application/json" }),
      body
    } as unknown as Request;
    await expect(readBoundedDeviceBatchJson(overflow)).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
  });

  it.each(["batch", "event", "payload", "punch"] as const)(
    "avvisar okända %s-fält utan Zoddetalj eller ingest",
    async (level) => {
      const batch = validBatch() as DeviceBatch & Record<string, unknown>;
      if (level === "batch") batch.canary = "HEMLIG_BATCH";
      if (level === "event") (batch.events[0] as unknown as Record<string, unknown>).canary = "HEMLIG_EVENT";
      if (level === "payload") (batch.events[0]!.payload as unknown as Record<string, unknown>).canary = "HEMLIG_PAYLOAD";
      if (level === "punch") (batch.events[0]!.payload.punches[0] as unknown as Record<string, unknown>).canary = "HEMLIG_PUNCH";
      const ingest = ingester();
      const response = await deviceBatchRoute(db, request(JSON.stringify(batch)), raceId, {
        authenticate: authenticator(authenticated()), ingest
      });
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toBe(JSON.stringify({ error: "Ogiltig stationsbatch" }));
      expect(text).not.toContain("HEMLIG");
      expect(ingest).not.toHaveBeenCalled();
    }
  );

  it("binder body-device och exakt idempotency-key före ingest", async () => {
    const wrongDevice = validBatch();
    wrongDevice.deviceId = otherDeviceId;
    const ingest = ingester();
    const forbidden = await deviceBatchRoute(db, request(JSON.stringify(wrongDevice)), raceId, {
      authenticate: authenticator(authenticated()), ingest
    });
    expect(forbidden.status).toBe(403);
    const invalidKey = await deviceBatchRoute(db, request(JSON.stringify(validBatch()), {
      "idempotency-key": `${deviceId}:1:2`
    }), raceId, { authenticate: authenticator(authenticated()), ingest });
    expect(invalidKey.status).toBe(400);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("vidarebefordrar en giltig batch oförändrad och runtimevaliderar kvittensen", async () => {
    const batch = validBatch();
    const ingest = ingester();
    const response = await deviceBatchRoute(db, request(JSON.stringify(batch)), raceId, {
      authenticate: authenticator(authenticated()), ingest
    });
    expect(response.status).toBe(200);
    expect(ingest).toHaveBeenCalledWith(db, raceId, batch);
    expect(await response.json()).toEqual(acknowledgement(batch));
    expectPrivate(response);
  });

  it("maskerar ingest- och ackkontraktsfel som generiskt 500", async () => {
    for (const ingest of [
      ingester(async () => { throw new Error("databas-canary"); }),
      ingester(async () => ({ canary: "ack-canary" }) as never)
    ]) {
      const response = await deviceBatchRoute(db, request(JSON.stringify(validBatch())), raceId, {
        authenticate: authenticator(authenticated()), ingest
      });
      expect(response.status).toBe(500);
      const text = await response.text();
      expect(text).toBe(JSON.stringify({ error: "Batchen kunde inte behandlas" }));
      expect(text).not.toMatch(/canary|databas/i);
      expectPrivate(response);
    }
  });

  it("rymmer ett realistiskt strikt 100×256-kontrakt under 4 MiB", async () => {
    const events = Array.from({ length: 100 }, (_, index) => {
      const event = validBatch(index + 1).events[0]!;
      if (event.transport !== "simulator") throw new Error("Testet förutsätter simulatorhändelser");
      return {
      ...event,
      localSequence: index + 1,
      payload: {
        ...event.payload,
        punches: Array.from({ length: 256 }, (_unused, punchIndex) => ({
          code: punchIndex + 1,
          punchedAt: "2026-08-31T09:55:00.000Z"
        }))
      }
    }; });
    const batch: DeviceBatch = {
      ...validBatch(), firstSequence: 1, lastSequence: 100, events
    };
    const serialized = JSON.stringify(batch);
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThan(DEVICE_BATCH_MAX_BODY_BYTES);
    const ingest = ingester();
    const response = await deviceBatchRoute(db, request(serialized, {
      "idempotency-key": `${deviceId}:1:100`
    }), raceId, { authenticate: authenticator(authenticated()), ingest });
    expect(response.status).toBe(200);
    expect(ingest).toHaveBeenCalledWith(db, raceId, batch);
  });
});
