import { describe, expect, it } from "vitest";
import type { PartyPackage, SportidentReadoutPayload } from "@o-tid/contracts";
import { cardEvening, decideReadout, guestName, type DeskKnowledge } from "./party-logic";
import { MemoryPartyActionStore, type QueuedPartyAction } from "./party-store";
import { syncPartyActions } from "./party-sync";
import type { QueuedReadout } from "./store";

/** Steg 40: bardiskens beslut per utläsning och den lokala kön för in-/utcheckning och gästnamn. Påhittade brickor. */
const raceId = "10000000-0000-4000-8000-000000000002";
const device = "10000000-0000-4000-8000-000000000008";
const party: PartyPackage = { startsAt: "2026-10-24T15:00:00.000Z", items: [
  { id: "10000000-0000-4000-8000-000000000031", code: 31, name: "Öl", hidden: false, priceOre: 4_000,
    prices: [{ priceOre: 4_000, validFrom: "1970-01-01T00:00:00.000Z" }] },
  { id: "10000000-0000-4000-8000-000000000032", code: 32, name: "Drink", hidden: false, priceOre: 6_000,
    prices: [{ priceOre: 6_000, validFrom: "1970-01-01T00:00:00.000Z" }] }] };

function readout(localSequence: number, punches: [number, string][], extra: Partial<SportidentReadoutPayload> = {}): QueuedReadout {
  const payload: SportidentReadoutPayload = { cardNumber: "8123456", cardType: "SIAC", punches: punches.map(([code, punchedAt]) => ({ code, punchedAt })),
    untimedPunchCodes: [], frames: ["02"], simulated: true, ...extra };
  return { raceId, deviceId: device, sessionId: device, localSequence, packageVersion: 1, stationReceivedAt: `2026-10-24T${16 + localSequence}:00:00.000Z`,
    payload, contentHash: "0".repeat(64), status: "pending" };
}

const knowledge = (readouts: QueuedReadout[], actions: QueuedPartyAction[] = []): DeskKnowledge => ({ party, server: undefined, readouts, actions });

describe("bardisken: automatiskt läge", () => {
  const first = readout(1, []);
  const second = readout(2, [[31, "2026-10-24T17:30:00.000Z"], [32, "2026-10-24T17:40:00.000Z"]]);
  const third = readout(3, [[31, "2026-10-24T17:30:00.000Z"], [32, "2026-10-24T17:40:00.000Z"]]);
  const checkIn: QueuedPartyAction = { raceId, requestId: "a", createdAt: "2026-10-24T17:00:00.000Z", status: "pending",
    action: { kind: "desk", request: { formatVersion: 1, deviceId: device, localSequence: 1, cardNumber: "8123456", kind: "CHECK_IN", at: first.stationReceivedAt } } };

  it("första utläsningen checkar in och köar incheckningen", () => {
    expect(decideReadout(first, "AUTO", knowledge([first]))).toMatchObject({ kind: "WELCOME", enqueue: "CHECK_IN", newPurchases: [] });
  });

  it("senare utläsning visar bara nya köp; samma stämplingar igen ger inga nya köp", () => {
    const next = decideReadout(second, "AUTO", knowledge([first, second], [checkIn]));
    expect(next.kind).toBe("PURCHASES");
    expect(next.newPurchases.map(row => row.itemName)).toEqual(["Öl", "Drink"]);
    expect(next.enqueue).toBeUndefined();
    expect(decideReadout(third, "AUTO", knowledge([first, second, third], [checkIn])).kind).toBe("NO_NEW");
    expect(cardEvening("8123456", knowledge([first, second, third])).totalOre).toBe(10_000);
  });

  it("målstämpling efter start checkar ut; startstämpling räknas som incheckning", () => {
    const finish = readout(4, [[31, "2026-10-24T17:30:00.000Z"]], { finishPunchedAt: "2026-10-24T21:47:00.000Z" });
    expect(decideReadout(finish, "AUTO", knowledge([first, finish], [checkIn]))).toMatchObject({ kind: "CHECKED_OUT",
      checkedOutAt: "2026-10-24T21:47:00.000Z" });
    const started = readout(1, [], { startPunchedAt: "2026-10-24T16:10:00.000Z" });
    expect(decideReadout(started, "AUTO", knowledge([started]))).toMatchObject({ kind: "WELCOME", checkedInAt: "2026-10-24T16:10:00.000Z" });
    expect(decideReadout(started, "AUTO", knowledge([started])).enqueue).toBeUndefined();
  });

  it("personalens lägen: redan incheckad och utcheckning i bardisken", () => {
    expect(decideReadout(third, "CHECK_IN", knowledge([first, third], [checkIn]))).toMatchObject({ kind: "ALREADY_IN" });
    expect(decideReadout(third, "CHECK_OUT", knowledge([first, third], [checkIn]))).toMatchObject({ kind: "CHECKED_OUT", enqueue: "CHECK_OUT" });
  });
});

describe("bardisken: lokal kö (offline-säker)", () => {
  const guest: QueuedPartyAction = { raceId, requestId: "g", createdAt: "2026-10-24T17:00:01.000Z", status: "pending",
    action: { kind: "guest", request: { formatVersion: 1, cardNumber: "8123456", name: "Testa Festsson", club: null } } };

  it("ligger kvar utan nät och skickas när nätet finns; namnet gäller direkt lokalt", async () => {
    const store = new MemoryPartyActionStore();
    await store.add(guest);
    expect(guestName("8123456", { server: undefined, actions: await store.list(raceId) })).toBe("Testa Festsson");
    const offline = await syncPartyActions(store, raceId, { fetch: async () => { throw new TypeError("offline"); }, csrf: () => "c".repeat(43) });
    expect(offline.kind).toBe("offline");
    expect((await store.list(raceId))[0]!.status).toBe("pending");
    const sent: string[] = [];
    const online = await syncPartyActions(store, raceId, { csrf: () => "c".repeat(43),
      fetch: async (url) => { sent.push(url as string); return new Response(null, { status: 204 }); } });
    expect(online).toEqual({ kind: "synced", count: 1 });
    expect(sent).toEqual([`/api/admin/races/${raceId}/administrator/party-guests`]);
    expect((await store.list(raceId))[0]!.status).toBe("stored");
  });
});
