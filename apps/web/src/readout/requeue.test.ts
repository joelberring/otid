import { describe, expect, it } from "vitest";
import { sportidentReadoutPayloadSchema, type DeviceBatch, type SportidentReadoutPayload } from "@o-tid/contracts";
import { Command, encodeStationFrame } from "@o-tid/sportident";
import { payloadHash, toHex } from "./payload";
import { requeueLocallyInvalid, syncPending } from "./sync";
import { ids, MemoryReadoutStore } from "./test-support";

/**
 * Steg 36: med steg 34 gav en station som skickar alla åtta block detektering + 8 block = 9 ramar, fler än schemat
 * tillät (8). Avläsningen markerades LOCAL_INVALID i webbläsaren. När sidan laddas prövas sådana igen och skickas.
 */
const frame = "02e8060001007a1a3203";
const payload = (frames: number): SportidentReadoutPayload => ({ cardNumber: "8001234", cardType: "SIAC",
  startPunchedAt: "2026-10-20T16:47:56.000Z", finishPunchedAt: "2026-10-20T17:41:19.000Z",
  punches: [{ code: 31, punchedAt: "2026-10-20T16:50:12.000Z" }], untimedPunchCodes: [],
  frames: Array.from({ length: frames }, () => frame), clockSource: "station", clockOffsetMs: 1200, simulated: false });

async function add(store: MemoryReadoutStore, value: SportidentReadoutPayload, rejectedReason?: string) {
  const stored = await store.append(ids.race, { packageVersion: 3, stationReceivedAt: "2026-10-20T17:45:00.000Z", payload: value,
    contentHash: await payloadHash(value) });
  if (rejectedReason) await store.update({ ...stored, status: "rejected", rejectedReason });
  return stored;
}

describe("omprövning av lokalt avvisade avläsningar", () => {
  it("nio ramar är giltiga nu: tillbaka i kön med samma löpnummer och skickas som vanligt", async () => {
    expect(sportidentReadoutPayloadSchema.safeParse(payload(9)).success).toBe(true);
    expect(sportidentReadoutPayloadSchema.safeParse(payload(12)).success).toBe(true);
    expect(sportidentReadoutPayloadSchema.safeParse(payload(13)).success).toBe(false);
    const store = new MemoryReadoutStore();
    await add(store, payload(3));
    const nine = await add(store, payload(9), "LOCAL_INVALID");
    await add(store, payload(13), "LOCAL_INVALID");
    await add(store, payload(9), "SEQUENCE_HASH_CONFLICT");
    store.items[0] = { ...store.items[0]!, status: "stored" };
    expect(await requeueLocallyInvalid(store, ids.race)).toBe(1);
    expect(store.items.map((item) => [item.localSequence, item.status, item.rejectedReason])).toEqual([
      [1, "stored", undefined], [2, "pending", undefined], [3, "rejected", "LOCAL_INVALID"], [4, "rejected", "SEQUENCE_HASH_CONFLICT"]]);
    expect(store.items[1]).not.toHaveProperty("rejectedReason");
    // Igen: inget mer att göra.
    expect(await requeueLocallyInvalid(store, ids.race)).toBe(0);
    const sent: DeviceBatch[] = [];
    const fetch = (async (_url: string, init: RequestInit) => {
      const batch = JSON.parse(init.body as string) as DeviceBatch;
      sent.push(batch);
      return Response.json({ deviceId: batch.deviceId, highestContiguousSequence: 2, currentPackageVersion: 3,
        packageVersionStatus: "current", packageUpdateRequired: false,
        acknowledgements: batch.events.map((event) => ({ localSequence: event.localSequence, contentHash: event.contentHash,
          status: "stored", rawMessageId: ids.entry })) });
    }) as typeof globalThis.fetch;
    expect(await syncPending(store, ids.race, { fetch, csrf: () => "token" })).toEqual({ kind: "synced", count: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ firstSequence: 2, lastSequence: 2 });
    expect(sent[0]!.events[0]).toMatchObject({ localSequence: 2, contentHash: nine.contentHash });
    expect(sent[0]!.events[0]!.payload).toEqual(payload(9));
    expect(store.items[1]).toMatchObject({ status: "stored" });
  });
});

describe("omprövning med ny avkodning av råramarna (steg 39)", () => {
  // Natt-KM 2026-10-20: block 0–4 från en riktig SIAC (bricknumret utbytt), som avläsningen sparade dem före steg 34.
  const CARD = 8_001_234;
  const cardBytes = [(CARD >> 16) & 0xff, (CARD >> 8) & 0xff, CARD & 0xff];
  const bytes = (value: string) => Uint8Array.from(value.match(/../g)!.map((pair) => parseInt(pair, 16)));
  const block = (offset: number, data: string) => { const value = new Uint8Array(128).fill(0xee); value.set(bytes(data), offset); return value; };
  const block0 = block(0, "e8797a9feaeaeaea35025b7f15035f9c05046c1f0d450e620f000000071921223b3b3b3b3b3b3b3b3b3b3b");
  block0.set(cardBytes, 25);
  const blocks = [block0, block(32, "07001a070303030304040404ebebebeb02000200020002000200020002000200020002000200020002000200"),
    new Uint8Array(128).fill(0xee), block(112, "73696163ffffffff0384007e06310000"),
    block(0, "051f6024052060db05216139052262900523632505246498052565160526660f0527672a052868c3052969ae052a69e105346ae4052b6bbb")];
  const frames = [encodeStationFrame(Command.SI8_PLUS_DETECTED, 0x1a, [0x0f, ...cardBytes]),
    ...blocks.map((value, index) => encodeStationFrame(Command.READ_SI8_PLUS, 0x1a, [index, ...value]))].map(toHex);
  /** Som den gamla avkodningen: block 1 lästes som stämplingar, med kod 0, och avläsningen stoppades här. */
  const garbled = { cardNumber: String(CARD), cardType: "SIAC", startPunchedAt: "2026-10-20T16:47:56.000Z",
    finishPunchedAt: "2026-10-20T17:41:19.000Z", punches: [{ code: 0, punchedAt: "2026-10-20T15:00:00.000Z" }],
    untimedPunchCodes: [], frames, stationSerial: 510_235, clockSource: "device", simulated: false } as unknown as SportidentReadoutPayload;

  it("avkodar ramarna på nytt: kvällens 14 stämplingar, tillbaka i kön och skickas", async () => {
    expect(sportidentReadoutPayloadSchema.safeParse(garbled).success).toBe(false);
    const store = new MemoryReadoutStore();
    const stored = await add(store, garbled, "LOCAL_INVALID");
    expect(await requeueLocallyInvalid(store, ids.race, "Europe/Stockholm")).toBe(1);
    const item = store.items[0]!;
    expect(item).toMatchObject({ localSequence: stored.localSequence, status: "pending" });
    expect(item.payload.punches.map((punch) => punch.code)).toEqual([31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 52, 43]);
    expect(item.payload.punches[0]!.punchedAt).toBe("2026-10-20T16:50:12.000Z");
    expect(item.payload).toMatchObject({ startPunchedAt: "2026-10-20T16:47:56.000Z", finishPunchedAt: "2026-10-20T17:41:19.000Z",
      checkPunchedAt: "2026-10-20T16:30:23.000Z", frames, stationSerial: 510_235, clockSource: "device", simulated: false });
    expect(sportidentReadoutPayloadSchema.safeParse(item.payload).success).toBe(true);
    expect(item.contentHash).toBe(await payloadHash(item.payload));
    expect(item.contentHash).not.toBe(stored.contentHash);
  });

  it("utan tidszon, med trasiga ramar eller simulerad: ligger kvar, inga påhittade stämplingar", async () => {
    const store = new MemoryReadoutStore();
    await add(store, garbled, "LOCAL_INVALID");
    await add(store, { ...garbled, frames: frames.slice(0, 3) }, "LOCAL_INVALID");
    await add(store, { ...garbled, frames: [frames[0]!.slice(0, -4) + "0000"] }, "LOCAL_INVALID");
    await add(store, { ...garbled, simulated: true }, "LOCAL_INVALID");
    expect(await requeueLocallyInvalid(store, ids.race)).toBe(0);
    expect(await requeueLocallyInvalid(store, ids.race, "Europe/Stockholm")).toBe(1);
    expect(store.items.map((item) => item.status)).toEqual(["pending", "rejected", "rejected", "rejected"]);
  });
});
