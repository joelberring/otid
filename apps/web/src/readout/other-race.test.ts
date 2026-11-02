import { describe, expect, it } from "vitest";
import type { DeviceBatch, SportidentReadoutPayload } from "@o-tid/contracts";
import { payloadHash } from "./payload";
import { syncPending } from "./sync";
import { ids, MemoryReadoutStore, testPackage } from "./test-support";

/**
 * ADR-0187: avläsningsdatorns kö efter en återställning. Den återställda tävlingen har ett nytt id, så kön för den gamla
 * tävlingen skickas aldrig dit (och inget tas bort). Avläsningssidan för den nya tävlingen visar de väntande avläsningarna
 * för den gamla, med namn och datum när datorn har den gamla tävlingens paket.
 */
const restored = "20000000-0000-4000-8000-000000000001";
const payload = (cardNumber: string): SportidentReadoutPayload => ({ cardNumber, cardType: "SI9",
  startPunchedAt: "2026-11-02T10:00:00.000Z", finishPunchedAt: "2026-11-02T10:30:00.000Z",
  punches: [{ code: 31, punchedAt: "2026-11-02T10:10:00.000Z" }], untimedPunchCodes: [], frames: ["02ef0100"], simulated: false });

describe("kön för en annan tävling (återställd från säkerhetskopia)", () => {
  it("skickas inte till den nya tävlingen, ligger kvar och visas med kort och tid", async () => {
    const store = new MemoryReadoutStore();
    await store.savePackage(testPackage());
    for (const card of ["7001", "7002", "7003"]) {
      const value = payload(card);
      await store.append(ids.race, { packageVersion: 3, stationReceivedAt: "2026-11-02T10:31:00.000Z", payload: value,
        contentHash: await payloadHash(value) });
    }
    // Den första hann fram till den gamla servern; två väntar.
    await store.update({ ...store.items[0]!, status: "stored" });

    const sent: DeviceBatch[] = [];
    const fetch = (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(init.body as string) as DeviceBatch);
      return Response.json({});
    }) as typeof globalThis.fetch;
    expect(await syncPending(store, restored, { fetch, csrf: () => "token" })).toEqual({ kind: "idle" });
    expect(sent).toEqual([]);

    const other = await store.pendingElsewhere(restored);
    expect(other).toHaveLength(1);
    expect(other[0]).toMatchObject({ raceId: ids.race, raceDate: testPackage().raceSnapshot.race.raceDate });
    expect(other[0]!.name).toContain(testPackage().event.name);
    expect(other[0]!.readouts.map(item => [item.payload.cardNumber, item.status])).toEqual([["7002", "pending"], ["7003", "pending"]]);
    // Inget ändrades i den gamla kön, och för den gamla tävlingen själv finns inget "annat".
    expect(store.items.map(item => item.status)).toEqual(["stored", "pending", "pending"]);
    expect(await store.pendingElsewhere(ids.race)).toEqual([]);
  });
});
