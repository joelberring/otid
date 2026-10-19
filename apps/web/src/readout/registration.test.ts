import { describe, expect, it } from "vitest";
import { readoutPackageSchema, type DeviceBatch, type ReadoutRegistrationRequest, type SportidentReadoutPayload } from "@o-tid/contracts";
import { evaluateLocally, withLocalRegistrations } from "./evaluate";
import { payloadHash } from "./payload";
import { buildReceipt } from "./receipt";
import { syncPending } from "./sync";
import type { QueuedRegistration } from "./store";
import { ids, MemoryReadoutStore, TEST_CARD, testPackage } from "./test-support";

/** PLAN.md steg 25: direktanmälan av okänd bricka på avläsningssidan, även offline. */
const UNKNOWN = "7999001";
const REQUEST_ID = "20000000-0000-4000-8000-000000000001";

function payload(cardNumber: string): SportidentReadoutPayload {
  return { cardNumber, cardType: "SI10", startPunchedAt: "2026-10-01T17:00:00.000Z", finishPunchedAt: "2026-10-01T17:30:00.000Z",
    punches: [31, 32, 33].map((code, index) => ({ code, punchedAt: `2026-10-01T17:${String(10 + index * 5)}:00.000Z` })),
    untimedPunchCodes: [], frames: ["02"], simulated: true };
}

function registration(overrides: Partial<QueuedRegistration> = {}, request: Partial<ReadoutRegistrationRequest> = {}): QueuedRegistration {
  return { raceId: ids.race, requestId: REQUEST_ID, localSequence: 1, createdAt: "2026-10-01T17:31:00.000Z", status: "pending",
    request: { formatVersion: 1, requestId: REQUEST_ID, cardNumber: UNKNOWN, classId: ids.class, givenName: "Bo", familyName: "Ek",
      organisationName: null, ...request }, ...overrides };
}

const receipt = (requestId: string, outcome: "CREATED" | "EXISTING" = "CREATED") => ({ formatVersion: 1, replayed: false, requestId,
  raceId: ids.race, cardNumber: UNKNOWN, outcome, entryId: ids.entry, entryName: outcome === "CREATED" ? "Bo Ek" : "Anna Berg",
  className: "Lång", linkedResult: null, registeredAt: "2026-10-01T17:32:00.000Z" });

const ack = (batch: DeviceBatch) => Response.json({ deviceId: batch.deviceId, highestContiguousSequence: batch.lastSequence,
  currentPackageVersion: 3, packageVersionStatus: "current", packageUpdateRequired: false,
  acknowledgements: batch.events.map((event) => ({ localSequence: event.localSequence, contentHash: event.contentHash, status: "stored",
    rawMessageId: ids.entry })) });

async function storeWithUnknownReadout() {
  const store = new MemoryReadoutStore();
  const value = payload(UNKNOWN);
  await store.append(ids.race, { packageVersion: 3, stationReceivedAt: "2026-10-01T17:31:00.000Z", payload: value, contentHash: await payloadHash(value) });
  return store;
}

describe("direktanmälan på avläsningssidan", () => {
  it("bedömer den okända brickan lokalt mot den nya löparen, utan nät", () => {
    const pkg = testPackage();
    expect(evaluateLocally(payload(UNKNOWN), pkg).status).toBe("UNKNOWN_CARD");
    const verdict = evaluateLocally(payload(UNKNOWN), withLocalRegistrations(pkg, [registration()]));
    expect(verdict).toMatchObject({ status: "OK", name: "Bo Ek", className: "Lång", elapsedMs: 30 * 60_000 });
  });

  it("paketet gäller när det redan känner brickan, och en avvisad anmälan räknas inte", () => {
    const pkg = testPackage();
    const known = registration({}, { cardNumber: String(TEST_CARD) });
    expect(evaluateLocally(payload(String(TEST_CARD)), withLocalRegistrations(pkg, [known])).name).toBe("Anna Berg");
    expect(withLocalRegistrations(pkg, [registration({ status: "rejected" })])).toBe(pkg);
    expect(withLocalRegistrations(pkg, [registration({}, { classId: "20000000-0000-4000-8000-000000000099" })])).toBe(pkg);
  });

  it("skickar anmälan före avläsningarna, med eget begärans-id som idempotensnyckel", async () => {
    const store = await storeWithUnknownReadout();
    await store.addRegistration(registration());
    const calls: string[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      calls.push(url.split("/").at(-1)!);
      if (url.endsWith("/readout-registrations")) {
        expect(new Headers(init.headers).get("idempotency-key")).toBe(`readout-registration:${REQUEST_ID}`);
        expect(JSON.parse(init.body as string)).toMatchObject({ requestId: REQUEST_ID, cardNumber: UNKNOWN });
        return Response.json(receipt(REQUEST_ID));
      }
      return ack(JSON.parse(init.body as string) as DeviceBatch);
    }) as typeof globalThis.fetch;
    expect(await syncPending(store, ids.race, { fetch, csrf: () => "token" })).toEqual({ kind: "synced", count: 1, registered: 1 });
    expect(calls).toEqual(["readout-registrations", "readouts"]);
    expect(store.registrations[0]).toMatchObject({ status: "stored", response: { outcome: "CREATED", entryName: "Bo Ek" } });
    // Kvitterad anmälan skickas inte igen.
    expect(await syncPending(store, ids.race, { fetch, csrf: () => "token" })).toEqual({ kind: "idle" });
  });

  it("behåller anmälan och avläsningen vid nätfel; inget raderas", async () => {
    const store = await storeWithUnknownReadout();
    await store.addRegistration(registration());
    const offline = (async () => { throw new TypeError("Failed to fetch"); }) as typeof globalThis.fetch;
    expect(await syncPending(store, ids.race, { fetch: offline, csrf: () => "token" })).toEqual({ kind: "offline" });
    expect(store.registrations).toHaveLength(1);
    expect(store.registrations[0]!.status).toBe("pending");
    expect(store.items[0]!.status).toBe("pending");
  });

  it("en avvisad anmälan (full klass) markeras och avläsningarna skickas ändå", async () => {
    const store = await storeWithUnknownReadout();
    await store.addRegistration(registration());
    const fetch = (async (url: string, init: RequestInit) => url.endsWith("/readout-registrations")
      ? new Response(null, { status: 409 }) : ack(JSON.parse(init.body as string) as DeviceBatch)) as typeof globalThis.fetch;
    expect(await syncPending(store, ids.race, { fetch, csrf: () => "token" })).toEqual({ kind: "synced", count: 1 });
    expect(store.registrations[0]).toMatchObject({ status: "rejected", rejectedReason: "409" });
    expect(store.items[0]!.status).toBe("stored");
  });

  it("två anmälningar skickas i den ordning de gjordes och samma id kan inte köas två gånger", async () => {
    const store = new MemoryReadoutStore();
    const second = "20000000-0000-4000-8000-000000000002";
    await store.addRegistration(registration({ requestId: second, createdAt: "2026-10-01T17:40:00.000Z" }, { requestId: second, cardNumber: "7999002" }));
    await store.addRegistration(registration());
    await expect(store.addRegistration(registration())).rejects.toThrow();
    const order: string[] = [];
    const fetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as ReadoutRegistrationRequest;
      order.push(body.requestId);
      return Response.json({ ...receipt(body.requestId), cardNumber: body.cardNumber });
    }) as typeof globalThis.fetch;
    expect(await syncPending(store, ids.race, { fetch, csrf: () => "token" })).toEqual({ kind: "synced", count: 0, registered: 2 });
    expect(order).toEqual([REQUEST_ID, second]);
  });
});

describe("hyrbricka och startstämpling vid avläsningen", () => {
  it("hyrbrickan syns i beskedet och kvittot ber löparen lämna tillbaka den", () => {
    const base = testPackage();
    const pkg = readoutPackageSchema.parse({ ...base, raceSnapshot: { ...base.raceSnapshot,
      cardAssignments: base.raceSnapshot.cardAssignments.map((assignment) => ({ ...assignment, rental: true })) } });
    const verdict = evaluateLocally(payload(String(TEST_CARD)), pkg);
    expect(verdict.rental).toBe(true);
    const printed = buildReceipt({ verdict, cardNumber: String(TEST_CARD), pkg, origin: "https://otid.test", printedAt: new Date("2026-10-01T17:40:00Z") });
    expect(printed.notes[0]).toBe("Lämna tillbaka hyrbrickan");
    expect(evaluateLocally(payload(String(TEST_CARD)), base).rental).toBeUndefined();
  });

  it("minutstart med sen startstämpling ger varning i beskedet men samma status och tid", () => {
    const base = testPackage();
    const pkg = readoutPackageSchema.parse({ ...base, raceSnapshot: { ...base.raceSnapshot,
      classes: base.raceSnapshot.classes.map((raceClass) => ({ ...raceClass, startRule: "FIXED" })),
      entries: base.raceSnapshot.entries.map((entry) => ({ ...entry, fixedStartTime: "2026-10-01T16:57:48.000Z" })) } });
    const verdict = evaluateLocally(payload(String(TEST_CARD)), pkg);
    expect(verdict).toMatchObject({ status: "OK", elapsedMs: 32 * 60_000 + 12_000,
      startNote: { kind: "LATE", deviationMs: 132_000 } });
  });
});
