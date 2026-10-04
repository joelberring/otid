import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deviceEventSchema, sportidentReadoutPayloadSchema, type DeviceBatch } from "@o-tid/contracts";
import type { SiCardData } from "@o-tid/sportident";
import { evaluateLocally, formatRunningTime } from "./evaluate";
import { cardTypeForNumber, stationClock } from "@o-tid/sportident";
import { exerciseCard, exerciseRunners } from "./exercise";
import { FakeStationTransport } from "./fake-transport";
import { buildReadoutPayload, payloadHash } from "./payload";
import { StationController, type StationStatus } from "./station";
import { TrafficLog } from "./rawlog";
import { pendingBatches, syncPending } from "./sync";
import { forkedTestPackage, ids, MemoryReadoutStore, TEST_CARD, testPackage } from "./test-support";
import type { QueuedReadout } from "./store";

const TIME_ZONE = "Europe/Stockholm";
const NOW = new Date("2026-10-01T17:45:00.000Z");

interface Read { card: SiCardData; frames: readonly Uint8Array[]; serial: number | undefined }

async function readThroughExerciseStation(codes: readonly number[], variant: "ok" | "missing-control" | "no-finish", cardNumber = TEST_CARD,
  traffic?: TrafficLog) {
  const transport = new FakeStationTransport();
  const statuses: StationStatus[] = [];
  let read: Read | undefined;
  const controller = new StationController(transport, {
    onStatus: (status) => statuses.push(status),
    onCardInserted: () => undefined,
    onCardRead: (card, frames, serial) => { read = { card, frames, serial }; },
    onReadFailed: (cardNumber, reason) => { throw new Error(`${cardNumber}: ${reason}`); },
    onUnsupportedCard: (card) => { throw new Error(`Okänd typ ${card}`); },
    onTraffic: (direction, bytes) => traffic?.add(direction, bytes)
  }, 500);
  expect(await controller.start()).toBe(true);
  transport.insert(exerciseCard(cardNumber, codes, variant, NOW, TIME_ZONE));
  for (let i = 0; i < 200 && !read; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  await controller.stop();
  if (!read) throw new Error("Ingen avläsning");
  return { read, statuses };
}

describe("avläsning i webbläsaren", () => {
  it("läser en bricka genom övningsstationen och bedömer den lokalt som godkänd", async () => {
    const pkg = testPackage();
    const [runner] = exerciseRunners(pkg);
    expect(runner).toMatchObject({ entryId: ids.entry, cardNumber: TEST_CARD, controlCodes: [31, 32, 33] });
    const { read, statuses } = await readThroughExerciseStation(runner!.controlCodes, "ok");
    expect(statuses).toContainEqual({ kind: "ready", serialNumber: 999_001 });
    expect(read.card.cardType).toBe("SI10");
    const payload = buildReadoutPayload(read.card, read.frames, { reference: NOW, timeZone: TIME_ZONE, ...(read.serial !== undefined ? { stationSerial: read.serial } : {}), simulated: true });
    expect(payload.finishPunchedAt).toBe("2026-10-01T17:44:55.000Z");
    expect(payload.startPunchedAt).toBe("2026-10-01T17:14:55.000Z");
    const verdict = evaluateLocally(payload, pkg);
    expect(verdict).toMatchObject({ status: "OK", name: "Anna Berg", className: "Lång", elapsedMs: 30 * 60_000 });
    expect(formatRunningTime(verdict.elapsedMs!)).toBe("30:00");
    expect(verdict.splits.map((split) => [split.controlCode, formatRunningTime(split.elapsedMs)])).toEqual([[31, "7:30"], [32, "15:00"], [33, "22:30"]]);
  });

  it("gafflad bana: övningsstationen stämplar löparens variant och beskedet visar varianten", async () => {
    const pkg = forkedTestPackage();
    const [runner] = exerciseRunners(pkg);
    expect(runner).toMatchObject({ entryId: ids.entry, controlCodes: [31, 34, 32, 33] });
    const { read } = await readThroughExerciseStation(runner!.controlCodes, "ok");
    const payload = buildReadoutPayload(read.card, read.frames, { reference: NOW, timeZone: TIME_ZONE, simulated: true });
    expect(evaluateLocally(payload, pkg)).toMatchObject({ status: "OK", variant: { code: "BA", assigned: true } });
    const other = { ...pkg, raceSnapshot: { ...pkg.raceSnapshot, entries: pkg.raceSnapshot.entries.map((entry) => ({ ...entry, courseVariantCode: "AB" })) } };
    expect(evaluateLocally(payload, other)).toMatchObject({ status: "MP", variant: { code: "AB", assigned: true } });
  });

  it("visar felstämpling och saknat mål", async () => {
    const pkg = testPackage();
    const missing = await readThroughExerciseStation([31, 32, 33], "missing-control");
    const missingPayload = buildReadoutPayload(missing.read.card, missing.read.frames, { reference: NOW, timeZone: TIME_ZONE, simulated: true });
    expect(evaluateLocally(missingPayload, pkg)).toMatchObject({ status: "MP", reason: "MISSING_CONTROL", missingControls: [32] });

    const noFinish = await readThroughExerciseStation([31, 32, 33], "no-finish");
    const noFinishPayload = buildReadoutPayload(noFinish.read.card, noFinish.read.frames, { reference: NOW, timeZone: TIME_ZONE, simulated: true });
    expect(noFinishPayload.finishPunchedAt).toBeUndefined();
    expect(sportidentReadoutPayloadSchema.safeParse(noFinishPayload).success).toBe(true);
    expect(evaluateLocally(noFinishPayload, pkg)).toMatchObject({ status: "MP", reason: "MISSING_FINISH" });
  });

  it("känner igen okänd bricka", async () => {
    const { read } = await readThroughExerciseStation([], "ok", 7_500_001);
    const payload = buildReadoutPayload(read.card, read.frames, { reference: NOW, timeZone: TIME_ZONE, simulated: true });
    expect(evaluateLocally(payload, testPackage())).toMatchObject({ status: "UNKNOWN_CARD" });
  });

  it("ger samma innehållshash som servern räknar efter tolkningen", async () => {
    const { read } = await readThroughExerciseStation([31, 32, 33], "ok");
    const payload = buildReadoutPayload(read.card, read.frames, { reference: NOW, timeZone: TIME_ZONE, ...(read.serial !== undefined ? { stationSerial: read.serial } : {}), simulated: false });
    const parsed = sportidentReadoutPayloadSchema.parse(JSON.parse(JSON.stringify(payload)));
    const serverHash = createHash("sha256").update(JSON.stringify(parsed)).digest("hex");
    expect(await payloadHash(payload)).toBe(serverHash);
    expect(payload.frames.length).toBeGreaterThan(1);
    expect(deviceEventSchema.parse({ localSequence: 1, stationReceivedAt: NOW.toISOString(), transport: "sportident",
      payload, contentHash: serverHash }).transport).toBe("sportident");
  });

  it("loggar all stationstrafik för råloggen, utan namn", async () => {
    const traffic = new TrafficLog();
    const { read } = await readThroughExerciseStation([31, 32, 33], "ok", TEST_CARD, traffic);
    expect(traffic.size).toBeGreaterThan(4);
    const payload = buildReadoutPayload(read.card, read.frames, { reference: NOW, timeZone: TIME_ZONE, simulated: true });
    const store = new MemoryReadoutStore();
    await store.append(ids.race, { packageVersion: 3, stationReceivedAt: NOW.toISOString(), payload, contentHash: await payloadHash(payload) });
    const log = JSON.parse(traffic.export(ids.race, store.items, "test")) as { traffic: { direction: string; hex: string }[]; readouts: { frames: string[] }[] };
    expect(log.traffic.some((entry) => entry.direction === "out" && /^(ff)?02/.test(entry.hex))).toBe(true);
    expect(log.traffic.some((entry) => entry.direction === "in")).toBe(true);
    expect(log.readouts[0]!.frames).toEqual(payload.frames);
    expect(JSON.stringify(log)).not.toContain("Anna");
  });

  it("räknar stationens klocka i tävlingens tidszon", () => {
    expect(stationClock(new Date("2026-10-01T17:45:00.000Z"), TIME_ZONE)).toEqual({ secondsOfDay: 19 * 3600 + 45 * 60, dayOfWeek: 4 });
    expect(cardTypeForNumber(23_456)).toBe("SI5");
    expect(cardTypeForNumber(654_321)).toBe("SI6");
    expect(cardTypeForNumber(8_000_001)).toBe("SIAC");
    expect(cardTypeForNumber(3_000_000)).toBeUndefined();
  });
});

function queued(localSequence: number, packageVersion = 3, status: QueuedReadout["status"] = "pending"): QueuedReadout {
  return { raceId: ids.race, deviceId: ids.device, sessionId: ids.session, localSequence, packageVersion,
    stationReceivedAt: NOW.toISOString(), status, contentHash: "a".repeat(64),
    payload: { cardNumber: "7123456", cardType: "SI10", punches: [], untimedPunchCodes: [], frames: ["02"], simulated: true } };
}

describe("synk av avläsningskön", () => {
  it("delar kön i sammanhängande följder med samma paketversion", () => {
    const batches = pendingBatches([queued(4), queued(1), queued(2, 3, "stored"), queued(3), queued(5, 4), queued(6, 4)]);
    expect(batches.map((batch) => batch.map((item) => item.localSequence))).toEqual([[1], [3, 4], [5, 6]]);
  });

  async function storeWithTwoReadouts() {
    const store = new MemoryReadoutStore();
    for (const card of ["7123456", "7500001"]) {
      const payload = { ...queued(1).payload, cardNumber: card };
      await store.append(ids.race, { packageVersion: 3, stationReceivedAt: NOW.toISOString(), payload, contentHash: await payloadHash(payload) });
    }
    return store;
  }

  it("markerar avläsningar först när servern kvitterat dem", async () => {
    const store = await storeWithTwoReadouts();
    const sent: DeviceBatch[] = [];
    const fetch = (async (_url: string, init: RequestInit) => {
      const batch = JSON.parse(init.body as string) as DeviceBatch;
      sent.push(batch);
      expect(new Headers(init.headers).get("x-otid-csrf")).toBe("token");
      return Response.json({ deviceId: batch.deviceId, highestContiguousSequence: 2, currentPackageVersion: 3,
        packageVersionStatus: "current", packageUpdateRequired: false,
        acknowledgements: batch.events.map((event) => event.localSequence === 1
          ? { localSequence: 1, contentHash: event.contentHash, status: "stored", rawMessageId: ids.entry }
          : { localSequence: 2, contentHash: event.contentHash, status: "rejected", reason: "SEQUENCE_HASH_CONFLICT" }) });
    }) as typeof globalThis.fetch;
    expect(await syncPending(store, ids.race, { fetch, csrf: () => "token" })).toEqual({ kind: "synced", count: 2 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ deviceId: ids.device, sessionId: ids.session, packageVersion: 3, firstSequence: 1, lastSequence: 2 });
    expect(store.items.map((item) => [item.status, item.rejectedReason])).toEqual([["stored", undefined], ["rejected", "SEQUENCE_HASH_CONFLICT"]]);
    expect(await syncPending(store, ids.race, { fetch, csrf: () => "token" })).toEqual({ kind: "idle" });
  });

  it("behåller kön vid nätfel, utloggning och serverfel", async () => {
    const store = await storeWithTwoReadouts();
    const offline = (async () => { throw new TypeError("Failed to fetch"); }) as typeof globalThis.fetch;
    expect(await syncPending(store, ids.race, { fetch: offline, csrf: () => "token" })).toEqual({ kind: "offline" });
    const unauthorized = (async () => new Response(null, { status: 401 })) as typeof globalThis.fetch;
    expect(await syncPending(store, ids.race, { fetch: unauthorized, csrf: () => "token" })).toEqual({ kind: "unauthorized" });
    expect(await syncPending(store, ids.race, { fetch: unauthorized, csrf: () => undefined })).toEqual({ kind: "unauthorized" });
    const broken = (async () => new Response(null, { status: 500 })) as typeof globalThis.fetch;
    expect(await syncPending(store, ids.race, { fetch: broken, csrf: () => "token" })).toEqual({ kind: "failed", status: 500 });
    expect(store.items.every((item) => item.status === "pending")).toBe(true);
  });
});
