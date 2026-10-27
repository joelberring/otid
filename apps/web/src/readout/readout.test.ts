import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deviceEventSchema, sportidentReadoutPayloadSchema, type DeviceBatch } from "@o-tid/contracts";
import type { SiCardData } from "@o-tid/sportident";
import { evaluateLocally, formatRunningTime } from "./evaluate";
import { cardTypeForNumber, simulatedRun, stationClock } from "@o-tid/sportident";
import { exerciseAnchor, exerciseCard, exerciseRunners, exerciseWindow } from "./exercise";
import { FakeStationTransport } from "./fake-transport";
import { buildReadoutPayload, payloadHash } from "./payload";
import { loadFastRead, saveFastRead, StationController, type StationStatus } from "./station";
import { TrafficLog } from "./rawlog";
import { heldReadouts, pendingBatches, releaseHeldReadouts, syncPending } from "./sync";
import { forkedTestPackage, ids, MemoryReadoutStore, TEST_CARD, testPackage } from "./test-support";
import type { QueuedReadout } from "./store";

const TIME_ZONE = "Europe/Stockholm";
const NOW = new Date("2026-10-01T17:45:00.000Z");

interface Read { card: SiCardData; frames: readonly Uint8Array[]; serial: number | undefined; clockOffsetMs: number | undefined }

async function readThroughExerciseStation(codes: readonly number[], variant: "ok" | "missing-control" | "no-finish", cardNumber = TEST_CARD,
  traffic?: TrafficLog, fastRead?: boolean) {
  const transport = new FakeStationTransport();
  const statuses: StationStatus[] = [];
  let read: Read | undefined;
  const controller = new StationController(transport, {
    onStatus: (status) => statuses.push(status),
    onCardInserted: () => undefined,
    onCardRead: (card, frames, station) => { read = { card, frames, serial: station.serialNumber, clockOffsetMs: station.clock?.clockOffsetMs }; },
    onReadFailed: (cardNumber, reason) => { throw new Error(`${cardNumber}: ${reason}`); },
    onUnsupportedCard: (card) => { throw new Error(`Okänd typ ${card}`); },
    onTraffic: (direction, bytes) => traffic?.add(direction, bytes),
    onLog: (text) => traffic?.note(text)
  }, { timeoutMs: 500, timeZone: TIME_ZONE, ...(fastRead === undefined ? {} : { fastRead }) });
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
    const ready = statuses.find((status) => status.kind === "ready");
    expect(ready).toMatchObject({ kind: "ready", serialNumber: 999_001 });
    expect(ready?.kind === "ready" && typeof ready.clock?.clockOffsetMs).toBe("number");
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

  it("steg 53: snabb utläsning som förval, kan stängas av, och utläsningssättet står i felsökningsloggen", async () => {
    const fast = new TrafficLog();
    const first = await readThroughExerciseStation([31, 32, 33], "ok", TEST_CARD, fast);
    expect(first.read.frames).toHaveLength(3); // detektering + block 0 och 4
    expect(fast.notes.map((note) => note.text)).toEqual([
      expect.stringMatching(/^Station 999001: kod 10, .*blockinställning 0xc1, snabb utläsning på$/),
      expect.stringMatching(/^SI10 7123456: snabb utläsning, 2 svar, \d+ ms$/)]);
    const full = new TrafficLog();
    const second = await readThroughExerciseStation([31, 32, 33], "ok", TEST_CARD, full, false);
    expect(second.read.frames).toHaveLength(6);
    expect(second.read.card).toEqual(first.read.card);
    expect(full.notes[1]?.text).toMatch(/^SI10 7123456: hel utläsning, 5 svar/);
    expect((JSON.parse(full.export(ids.race, [], "test")) as { notes: unknown[] }).notes).toHaveLength(2);
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(loadFastRead(storage)).toBe(true);
    saveFastRead(false, storage);
    expect(loadFastRead(storage)).toBe(false);
    saveFastRead(true, storage);
    expect(loadFastRead(storage)).toBe(true);
  });

  // PLAN.md steg 22: stationens klocka, övning på tävlingsdagen och brickbyte i övningsstationen.
  it("rapporterar övningsstationens klocka och löser tiderna mot den", async () => {
    const transport = new FakeStationTransport({ timeZone: TIME_ZONE });
    const statuses: StationStatus[] = [];
    let read: Read | undefined;
    const controller = new StationController(transport, {
      onStatus: (status) => statuses.push(status), onCardInserted: () => undefined,
      onCardRead: (card, frames, station) => { read = { card, frames, serial: station.serialNumber, clockOffsetMs: station.clock?.clockOffsetMs }; },
      onReadFailed: (cardNumber, reason) => { throw new Error(`${cardNumber}: ${reason}`); }, onUnsupportedCard: () => undefined
    }, { timeoutMs: 500, timeZone: TIME_ZONE });
    expect(await controller.start()).toBe(true);
    const ready = statuses.find((status) => status.kind === "ready");
    expect(ready?.kind === "ready" && Math.abs(ready.clock!.clockOffsetMs) < 2_000).toBe(true);
    // Brickan sätts i med klockan ställd strax efter målet, som på en kommande tävlingsdag.
    const finishAt = new Date("2026-11-07T10:30:00.000Z");
    const card = simulatedRun(TEST_CARD, { startAt: new Date("2026-11-07T10:00:00.000Z"), finishAt, controlCodes: [31, 32, 33], timeZone: TIME_ZONE });
    transport.insert(card, new Date(finishAt.getTime() + 5_000));
    for (let i = 0; i < 200 && !read; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    await controller.stop();
    expect(Math.abs(transport.now().getTime() - (finishAt.getTime() + 5_000))).toBeLessThan(2_000);
    const payload = buildReadoutPayload(read!.card, read!.frames, { reference: transport.now(), timeZone: TIME_ZONE, simulated: true,
      clockSource: "station", clockOffsetMs: 1234 });
    expect(payload).toMatchObject({ startPunchedAt: "2026-11-07T10:00:00.000Z", finishPunchedAt: finishAt.toISOString(),
      clockSource: "station", clockOffsetMs: 1234 });
    expect(sportidentReadoutPayloadSchema.safeParse(payload).success).toBe(true);
    // Nycklarna ligger i kontraktets ordning så att hashen stämmer med serverns.
    expect(JSON.stringify(sportidentReadoutPayloadSchema.parse(JSON.parse(JSON.stringify(payload))))).toBe(JSON.stringify(payload));
  });

  it("lägger övningen relativt löparens fasta start på tävlingsdagen", () => {
    const pkg = testPackage();
    const [runner] = exerciseRunners(pkg);
    expect(runner?.fixedStartTime).toBeUndefined();
    const now = new Date("2026-09-20T07:12:34.000Z");
    // Tävlingen är 2026-10-01: samma klockslag den dagen.
    expect(exerciseAnchor(pkg.raceSnapshot.race.raceDate, TIME_ZONE, now).toISOString()).toBe("2026-10-01T07:12:34.000Z");
    expect(exerciseAnchor(pkg.raceSnapshot.race.raceDate, TIME_ZONE, NOW)).toBe(NOW);
    const open = exerciseWindow(pkg, runner!, "ok", now);
    expect(open.finishAt.toISOString()).toBe("2026-10-01T07:12:29.000Z");
    expect(open.finishAt.getTime() - open.startAt.getTime()).toBe(30 * 60_000);
    const fixed = exerciseWindow(pkg, { ...runner!, fixedStartTime: "2026-10-01T09:00:00.000Z" }, "ok", now);
    expect(fixed).toEqual({ startAt: new Date("2026-10-01T09:00:00.000Z"), finishAt: new Date("2026-10-01T09:30:00.000Z") });
    const late = exerciseWindow(pkg, { ...runner!, fixedStartTime: "2026-10-01T09:00:00.000Z", timeLimitMs: 60 * 60_000 }, "late", now);
    expect(late.finishAt.toISOString()).toBe("2026-10-01T10:01:30.000Z");
    // På tävlingsdagen: startade löparen för mer än loppets längd sedan går hen i mål nu (fem sekunder före).
    const started = exerciseWindow(pkg, { ...runner!, fixedStartTime: "2026-10-01T17:00:00.000Z" }, "ok", NOW);
    expect(started).toEqual({ startAt: new Date("2026-10-01T17:00:00.000Z"), finishAt: new Date("2026-10-01T17:44:55.000Z") });
    const recent = exerciseWindow(pkg, { ...runner!, fixedStartTime: "2026-10-01T17:30:00.000Z" }, "ok", NOW);
    expect(recent.finishAt.toISOString()).toBe("2026-10-01T18:00:00.000Z");
  });

  it("läser en bricka som sätts i strax efter den föregående", async () => {
    const transport = new FakeStationTransport({ timeZone: TIME_ZONE });
    const events: string[] = [];
    const controller = new StationController(transport, {
      onStatus: () => undefined, onCardInserted: (card) => events.push(`inserted ${card}`),
      onCardRead: (card) => events.push(`read ${card.cardNumber}`), onReadFailed: (card, reason) => events.push(`failed ${card} ${reason}`),
      onUnsupportedCard: () => undefined
    }, { timeoutMs: 3000, timeZone: TIME_ZONE });
    expect(await controller.start()).toBe(true);
    const card = (n: number) => simulatedRun(n, { startAt: new Date(NOW.getTime() - 60_000), controlCodes: [31, 32], timeZone: TIME_ZONE, finishAt: NOW });
    transport.insert(card(8_001_001));
    await new Promise((resolve) => setTimeout(resolve, 398));
    transport.insert(card(8_001_002));
    for (let i = 0; i < 300 && !events.includes("read 8001002"); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    await controller.stop();
    expect(events).toEqual(["inserted 8001001", "read 8001001", "inserted 8001002", "read 8001002"]);
  });

  // Steg 58: en webbläsare som hackar (belastad dator) mitt i utläsningen får inte göra att övningsbrickan dras ur.
  it("övningsbrickan sitter kvar tills stationen har svarat färdigt, även när webbläsaren hackar", async () => {
    const transport = new FakeStationTransport({ timeZone: TIME_ZONE });
    const events: string[] = [];
    let stall = false;
    // Före stationens hanterare: tråden står still innan nästa fråga till stationen hinner skickas.
    transport.onBytes(() => {
      if (!stall) return;
      stall = false;
      const until = Date.now() + 600;
      while (Date.now() < until) { /* hackar */ }
    });
    const controller = new StationController(transport, {
      onStatus: () => undefined, onCardInserted: (card) => { events.push(`inserted ${card}`); stall = true; },
      onCardRead: (card) => events.push(`read ${card.cardNumber}`), onReadFailed: (card, reason) => events.push(`failed ${card} ${reason}`),
      onUnsupportedCard: () => undefined
    }, { timeoutMs: 3000, timeZone: TIME_ZONE, fastRead: true });
    expect(await controller.start()).toBe(true);
    transport.insert(simulatedRun(8_001_003, { startAt: new Date(NOW.getTime() - 60_000), controlCodes: [31, 32], timeZone: TIME_ZONE, finishAt: NOW }));
    for (let i = 0; i < 400 && events.length < 2; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    await controller.stop();
    expect(events).toEqual(["inserted 8001003", "read 8001003"]);
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
    // Steg 31: avläsningar som ger serverfel hålls åt sidan (skickas en och en) tills "Försök igen".
    expect(heldReadouts(store.items)).toHaveLength(2);
    expect(await syncPending(store, ids.race, { fetch: broken, csrf: () => "token" })).toEqual({ kind: "idle" });
    expect(await releaseHeldReadouts(store, ids.race)).toBe(2);
    expect(heldReadouts(store.items)).toHaveLength(0);
  });

  it("400, 404 och 409 håller bara den avläsningen åt sidan, 429 väntar utan att markera (steg 45)", async () => {
    for (const status of [400, 404, 409]) {
      const store = await storeWithTwoReadouts();
      const bodies: DeviceBatch[] = [];
      const picky = (async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string) as DeviceBatch;
        bodies.push(body);
        if (body.events.some((event) => event.localSequence === 1)) return Response.json({ error: "X" }, { status });
        return Response.json({ deviceId: body.deviceId, highestContiguousSequence: 0, currentPackageVersion: body.packageVersion,
          packageVersionStatus: "current", packageUpdateRequired: false,
          acknowledgements: body.events.map((event) => ({ localSequence: event.localSequence, contentHash: event.contentHash,
            status: "stored", rawMessageId: "10000000-0000-4000-8000-000000000099" })) });
      }) as typeof globalThis.fetch;
      expect(await syncPending(store, ids.race, { fetch: picky, csrf: () => "token" })).toMatchObject({ kind: "synced", count: 1 });
      expect(bodies.map((body) => body.events.map((event) => event.localSequence))).toEqual([[1, 2], [1], [2]]);
      expect(store.items.map((item) => [item.localSequence, item.status, item.serverFailedStatus])).toEqual([[1, "pending", status],
        [2, "stored", undefined]]);
      expect(heldReadouts(store.items)).toHaveLength(1);
      // "Försök igen" skickar den igen.
      expect(await releaseHeldReadouts(store, ids.race)).toBe(1);
      expect(store.items[0]!.serverFailedStatus).toBeUndefined();
    }
    const store = await storeWithTwoReadouts();
    const busy = (async () => new Response(null, { status: 429 })) as typeof globalThis.fetch;
    expect(await syncPending(store, ids.race, { fetch: busy, csrf: () => "token" })).toEqual({ kind: "throttled" });
    expect(heldReadouts(store.items)).toHaveLength(0);
    expect(store.items.every((item) => item.status === "pending" && !item.serverFailedAt)).toBe(true);
  });

  it("en avläsning som ger serverfel stoppar inte resten av kön (steg 31)", async () => {
    const store = await storeWithTwoReadouts();
    const bodies: DeviceBatch[] = [];
    const picky = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as DeviceBatch;
      bodies.push(body);
      if (body.events.some((event) => event.localSequence === 1)) return new Response(null, { status: 500 });
      return Response.json({ deviceId: body.deviceId, highestContiguousSequence: 0, currentPackageVersion: body.packageVersion,
        packageVersionStatus: "current", packageUpdateRequired: false,
        acknowledgements: body.events.map((event) => ({ localSequence: event.localSequence, contentHash: event.contentHash,
          status: "stored", rawMessageId: "10000000-0000-4000-8000-000000000099" })) });
    }) as typeof globalThis.fetch;
    expect(await syncPending(store, ids.race, { fetch: picky, csrf: () => "token" })).toMatchObject({ kind: "synced", count: 1 });
    expect(bodies.map((body) => body.events.map((event) => event.localSequence))).toEqual([[1, 2], [1], [2]]);
    expect(store.items.map((item) => [item.localSequence, item.status, !!item.serverFailedAt])).toEqual([[1, "pending", true],
      [2, "stored", false]]);
  });
});

describe("godkänt utan sträcktider (steg 45)", () => {
  it("märks när alla stämplingar ligger före starten", () => {
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 15, minute)).toISOString();
    const payload = { cardNumber: String(TEST_CARD), cardType: "SI10" as const, startPunchedAt: at(30), finishPunchedAt: at(55),
      punches: [31, 32, 33].map((code, index) => ({ code, punchedAt: at(index * 5) })), untimedPunchCodes: [], frames: ["02"],
      simulated: true };
    expect(evaluateLocally(payload, testPackage())).toMatchObject({ status: "OK", splits: [], splitsMissing: true });
    const normal = { ...payload, punches: [31, 32, 33].map((code, index) => ({ code, punchedAt: at(35 + index * 5) })) };
    expect(evaluateLocally(normal, testPackage()).splitsMissing).toBeUndefined();
  });
});
