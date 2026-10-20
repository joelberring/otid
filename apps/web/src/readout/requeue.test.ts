import { describe, expect, it } from "vitest";
import { sportidentReadoutPayloadSchema, type DeviceBatch, type SportidentReadoutPayload } from "@o-tid/contracts";
import { payloadHash } from "./payload";
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
