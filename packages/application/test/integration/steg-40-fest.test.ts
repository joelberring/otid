import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { partyPurchasesCsv, partySummaryCsv } from "@o-tid/domain";
import {
  changePartyAsAdmin, contentHash, createEvent, ingestDeviceBatch, readPartyAsAdmin, readPublicParty, readReadoutPackageAsAdmin,
  registerPartyDeskEventAsAdmin, setPartyGuestAsAdmin
} from "../../src";
import { db, useRaceDatabase } from "./race-fixtures";
import { raceAuth } from "./accounts";

/**
 * Steg 40: fest med bardisk. Gästen stämplar själv på varornas enheter (kod 31 = öl, 32 = drink) och läser ut brickan.
 * Köpen räknas fram ur avläsningarna; in- och utcheckning i bardisken köas med enhet + löpnummer. Påhittade namn.
 */
useRaceDatabase();

const startsAt = "2026-10-24T15:00:00.000Z"; // 17:00 svensk tid

async function party() {
  const { race } = await createEvent(db, { name: `Fest ${randomUUID().slice(0, 8)}`, raceName: "20-årsfest", raceDate: "2026-10-24",
    timeZone: "Europe/Stockholm" });
  await db.update(schema.races).set({ raceType: "PARTY" }).where(eq(schema.races.id, race.id));
  const admin = await raceAuth(db, race.id, "ADMIN");
  const change = (change: Record<string, unknown>) => changePartyAsAdmin(db, { ...admin, request: { formatVersion: 1, requestId: randomUUID(), change } });
  expect((await change({ kind: "settings", startsAt, showPublicNames: true, doublePunchSeconds: 5 })).status).toBe("ok");
  expect((await change({ kind: "item-add", code: 31, name: "Öl", priceOre: 4_000 })).status).toBe("ok");
  const added = await change({ kind: "item-add", code: 32, name: "Drink", priceOre: 6_000 });
  if (added.status !== "ok") throw new Error("Varan sparades inte");
  return { raceId: race.id, admin, change, items: added.response.items };
}

function readout(deviceId: string, localSequence: number, cardNumber: string, punches: [number, string][],
  extra: { startPunchedAt?: string; finishPunchedAt?: string } = {}, simulated = false) {
  const payload = { cardNumber, cardType: "SIAC" as const, ...extra, punches: punches.map(([code, punchedAt]) => ({ code, punchedAt })),
    untimedPunchCodes: [], frames: ["02ef0001"], clockSource: "station" as const, clockOffsetMs: 0, simulated };
  const stationReceivedAt = new Date(Date.parse(punches.at(-1)?.[1] ?? extra.finishPunchedAt ?? startsAt) + 60_000).toISOString();
  return { deviceId, sessionId: deviceId, packageVersion: 1, firstSequence: localSequence, lastSequence: localSequence,
    events: [{ localSequence, stationReceivedAt, transport: "sportident" as const, payload, contentHash: contentHash(payload) }] };
}

async function state(auth: Awaited<ReturnType<typeof raceAuth>>) {
  const result = await readPartyAsAdmin(db, auth);
  if (result.status !== "ok") throw new Error(`Läget kunde inte läsas: ${result.status}`);
  return result.response;
}

describe("steg 40: fest med bardisk", () => {
  it("köp ur stämplingarna: samma stämpling igen ger ett köp, summa per person och totalt, priset vid köpet", async () => {
    const { raceId, admin, change, items } = await party();
    // Köpen före prisändringen ligger i det förflutna (prisändringen gäller från nu), köpet efter i framtiden.
    expect((await change({ kind: "settings", startsAt: "2020-01-01T00:00:00.000Z", showPublicNames: true, doublePunchSeconds: 5 })).status).toBe("ok");
    const now = Math.floor(Date.now() / 1_000) * 1_000;
    const ago = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
    const device = randomUUID();
    await ingestDeviceBatch(db, raceId, readout(device, 1, "8123456", [[31, ago(3)]]));
    // Samma stämpling igen (ny utläsning) och samma avläsning skickad två gånger (idempotent mottagning).
    const second = readout(device, 2, "8123456", [[31, ago(3)], [32, ago(2)]]);
    await ingestDeviceBatch(db, raceId, second);
    await ingestDeviceBatch(db, raceId, second);
    // Priset ändras efter köpen: gamla köp behåller sitt pris.
    const drink = items.find(item => item.code === 32)!;
    expect((await change({ kind: "item-change", itemId: drink.id, name: "Drink", priceOre: 7_500, hidden: false })).status).toBe("ok");
    await ingestDeviceBatch(db, raceId, readout(device, 3, "2100200", [[32, "2099-10-24T19:00:00.000Z"]]));
    const value = await state(admin);
    expect(value.guests.map(guest => [guest.cardNumber, guest.purchaseCount, guest.totalOre]))
      .toEqual([["2100200", 1, 7_500], ["8123456", 2, 10_000]]);
    expect(value.totalOre).toBe(17_500);
    expect(value.items.find(item => item.code === 32)?.priceOre).toBe(7_500);
  });

  it("okänd bricka checkar in, får namn, köper och checkar ut med målstämpling: allt på samma gäst", async () => {
    const { raceId, admin } = await party();
    const functionary = await raceAuth(db, raceId, "FUNCTIONARY");
    const device = randomUUID();
    // Incheckning: första utläsningen, köad i bardisken. Samma enhet + löpnummer två gånger ger en incheckning.
    const checkIn = { formatVersion: 1, deviceId: device, localSequence: 1, cardNumber: "8765432", kind: "CHECK_IN", at: "2026-10-24T16:05:00.000Z" };
    await ingestDeviceBatch(db, raceId, readout(device, 1, "8765432", []));
    expect(await registerPartyDeskEventAsAdmin(db, { ...functionary, request: checkIn })).toMatchObject({ status: "ok", response: { status: "stored" } });
    expect(await registerPartyDeskEventAsAdmin(db, { ...functionary, request: checkIn })).toMatchObject({ status: "ok", response: { status: "duplicate" } });
    expect((await setPartyGuestAsAdmin(db, { ...functionary, request: { formatVersion: 1, cardNumber: "8765432", name: "Festa Påhittsson",
      club: "Påhittade OK" } })).status).toBe("ok");
    await ingestDeviceBatch(db, raceId, readout(device, 2, "8765432", [[31, "2026-10-24T19:14:00.000Z"], [32, "2026-10-24T21:50:00.000Z"]],
      { finishPunchedAt: "2026-10-24T21:47:00.000Z" }));
    const value = await state(admin);
    expect(value.guests).toHaveLength(1);
    expect(value.guests[0]).toMatchObject({ cardNumber: "8765432", name: "Festa Påhittsson", club: "Påhittade OK", purchaseCount: 2,
      totalOre: 10_000, checkIn: { at: "2026-10-24T16:05:00.000Z", source: "DESK" }, checkout: { at: "2026-10-24T21:47:00.000Z", source: "FINISH" } });
    expect(value.purchases.map(row => row.afterCheckout)).toEqual([false, true]);
    expect((await db.select().from(schema.partyDeskEvents).where(eq(schema.partyDeskEvents.raceId, raceId)))).toHaveLength(1);

    // Export: en rad per gäst och en rad per köp, UTF-8 med BOM.
    const ledger = { purchases: value.purchases, guests: value.guests, totalOre: value.totalOre, purchaseCount: value.purchaseCount };
    const summary = partySummaryCsv(ledger, value.timeZone).slice(1).split("\r\n");
    expect(summary[1]).toBe("Festa Påhittsson;Festa P;Påhittade OK;8765432;2;100,00;2026-10-24 18:05:00;2026-10-24 23:47:00;Mål");
    expect(partyPurchasesCsv(ledger, value.timeZone).split("\r\n")).toHaveLength(4);
  });

  it("bardiskens utcheckning och ångrat köp med orsak och auditpost", async () => {
    const { raceId, admin, change } = await party();
    const device = randomUUID();
    await ingestDeviceBatch(db, raceId, readout(device, 1, "8123456", [[31, "2026-10-24T19:14:00.000Z"], [32, "2026-10-24T19:20:00.000Z"]]));
    expect((await registerPartyDeskEventAsAdmin(db, { ...admin, request: { formatVersion: 1, deviceId: device, localSequence: 1,
      cardNumber: "8123456", kind: "CHECK_OUT", at: "2026-10-24T22:00:00.000Z" } })).status).toBe("ok");
    const voided = await change({ kind: "void", cardNumber: "8123456", code: 31, punchedAt: "2026-10-24T19:14:00.000Z", reason: "Fel enhet" });
    if (voided.status !== "ok") throw new Error("Ångra misslyckades");
    expect(voided.response.guests[0]).toMatchObject({ purchaseCount: 1, totalOre: 6_000, checkout: { source: "DESK" } });
    expect(voided.response.purchases.find(row => row.code === 31)?.voided?.reason).toBe("Fel enhet");
    // Samma ångring igen ger samma läge, ingen ny rad.
    await change({ kind: "void", cardNumber: "8123456", code: 31, punchedAt: "2026-10-24T19:14:00.000Z", reason: "Fel enhet" });
    expect(await db.select().from(schema.partyPurchaseVoids).where(eq(schema.partyPurchaseVoids.raceId, raceId))).toHaveLength(1);
    const audits = await db.select({ action: schema.auditEvents.action }).from(schema.auditEvents).where(eq(schema.auditEvents.raceId, raceId));
    expect(audits.map(row => row.action)).toEqual(expect.arrayContaining(["PARTY_PURCHASE_VOIDED", "PARTY_CHECKED_OUT_AT_DESK", "PARTY_ITEM_ADDED"]));
  });

  it("behörighet: funktionären läser, köper (avläsning), sätter namn och checkar ut, men ändrar inte varor och ångrar inte", async () => {
    const { raceId } = await party();
    const functionary = await raceAuth(db, raceId, "FUNCTIONARY");
    expect((await readPartyAsAdmin(db, functionary)).status).toBe("ok");
    const pkg = await readReadoutPackageAsAdmin(db, functionary);
    expect(pkg.status === "ok" && pkg.response.party?.items.map(item => item.code)).toEqual([31, 32]);
    for (const change of [{ kind: "item-add", code: 33, name: "Läsk", priceOre: 1_500 },
      { kind: "void", cardNumber: "8123456", code: 31, punchedAt: "2026-10-24T19:14:00.000Z", reason: "Nej" }]) {
      expect((await changePartyAsAdmin(db, { ...functionary, request: { formatVersion: 1, requestId: randomUUID(), change } })).status).toBe("forbidden");
    }
    expect((await setPartyGuestAsAdmin(db, { ...functionary, request: { formatVersion: 1, cardNumber: "5", name: "Testa", club: null } })).status).toBe("ok");
    // En kod som redan är en vara går inte att lägga till igen.
    const admin = await raceAuth(db, raceId, "ADMIN");
    expect((await changePartyAsAdmin(db, { ...admin, request: { formatVersion: 1, requestId: randomUUID(),
      change: { kind: "item-add", code: 31, name: "Öl igen", priceOre: 1 } } })).status).toBe("conflict");
  });

  it("publika sidan: namn när festen visar namn (förval), annars anonymt; aldrig belopp eller bricka", async () => {
    const { raceId, admin, change } = await party();
    const device = randomUUID();
    await ingestDeviceBatch(db, raceId, readout(device, 1, "8123456", [[31, "2026-10-24T19:14:00.000Z"]], { startPunchedAt: "2026-10-24T16:00:00.000Z" }));
    await setPartyGuestAsAdmin(db, { ...admin, request: { formatVersion: 1, cardNumber: "8123456", name: "Festa Påhittsson", club: null } });
    const named = await readPublicParty(db, raceId);
    // Steg 41: bara visningsnamnet (förvalt förnamn + efternamnets första bokstav), aldrig fullt namn.
    expect(named).toMatchObject({ showNames: true, soldCount: 1, checkedInCount: 1, guests: [{ name: "Festa P", purchaseCount: 1 }],
      firstArrival: { name: "Festa P" } });
    expect(JSON.stringify(named)).not.toMatch(/8123456|Ore|raceId|itemId|Påhittsson/);
    await setPartyGuestAsAdmin(db, { ...admin, request: { formatVersion: 1, cardNumber: "8123456", name: "Festa Påhittsson", club: null,
      displayName: "  Festis  " } });
    const nick = await readPublicParty(db, raceId);
    expect(nick?.guests).toEqual([{ name: "Festis", purchaseCount: 1 }]);
    expect(JSON.stringify(nick)).not.toContain("Påhittsson");
    await change({ kind: "settings", startsAt, showPublicNames: false, doublePunchSeconds: 5 });
    const anonymous = await readPublicParty(db, raceId);
    expect(anonymous?.guests).toBeUndefined();
    expect(JSON.stringify(anonymous)).not.toContain("Festa");
    expect(anonymous?.recent).toEqual([{ at: "2026-10-24T19:14:00.000Z", itemName: "Öl" }]);
  });
});


describe("steg 42: kvällens sträcktider på den publika sidan", () => {
  it("rätt händelser i tidsordning, bara köp som räknas, och inget läcker i något namnläge", async () => {
    const { raceId, admin, change } = await party();
    const device = randomUUID();
    // Före festens start (räknas inte), dubbelstämpling inom 5 s (ett köp), ett köp som ångras, mål.
    await ingestDeviceBatch(db, raceId, readout(device, 1, "8123456", [[31, "2026-10-24T14:00:00.000Z"], [31, "2026-10-24T19:14:00.000Z"],
      [31, "2026-10-24T19:14:03.000Z"], [32, "2026-10-24T19:32:30.000Z"], [31, "2026-10-24T20:00:00.000Z"]],
    { startPunchedAt: "2026-10-24T16:00:00.000Z", finishPunchedAt: "2026-10-24T21:47:00.000Z" }));
    await ingestDeviceBatch(db, raceId, readout(device, 2, "2100200", [[32, "2026-10-24T19:20:00.000Z"]]));
    await change({ kind: "void", cardNumber: "8123456", code: 31, punchedAt: "2026-10-24T20:00:00.000Z", reason: "Fel enhet" });
    await setPartyGuestAsAdmin(db, { ...admin, request: { formatVersion: 1, cardNumber: "8123456", name: "Festa Påhittsson", club: "Påhittade OK",
      displayName: "Festis" } });
    await setPartyGuestAsAdmin(db, { ...admin, request: { formatVersion: 1, cardNumber: "2100200", name: "Gästa Tvåsson", club: null } });

    const named = await readPublicParty(db, raceId);
    expect(named?.splits).toEqual([
      { guestNumber: 1, name: "Festis", purchaseCount: 2, totalSeconds: 5 * 3_600 + 47 * 60, checkIn: { at: "2026-10-24T16:00:00.000Z" },
        purchases: [{ at: "2026-10-24T19:14:00.000Z", sinceSeconds: 3 * 3_600 + 14 * 60, itemName: "Öl" },
          { at: "2026-10-24T19:32:30.000Z", sinceSeconds: 18 * 60 + 30, itemName: "Drink" }],
        checkout: { at: "2026-10-24T21:47:00.000Z", sinceSeconds: 2 * 3_600 + 14 * 60 + 30 } },
      { guestNumber: 2, name: "Gästa T", purchaseCount: 1, totalSeconds: 0, purchases: [{ at: "2026-10-24T19:20:00.000Z", itemName: "Drink" }] }]);
    const leaks = /8123456|2100200|Påhittsson|Tvåsson|Påhittade|Ore|cardNumber|raceId|itemId|"40|"60|[0-9a-f]{8}-[0-9a-f]{4}/;
    expect(JSON.stringify(named).replace(/\/api\/public\/parties\/[^"]+/, "")).not.toMatch(leaks);

    await change({ kind: "settings", startsAt, showPublicNames: false, doublePunchSeconds: 5 });
    const anonymous = await readPublicParty(db, raceId);
    expect(anonymous?.splits.map(row => [row.guestNumber, row.name, row.purchaseCount])).toEqual([[1, undefined, 2], [2, undefined, 1]]);
    expect(JSON.stringify(anonymous).replace(/\/api\/public\/parties\/[^"]+/, "")).not.toMatch(leaks);
    expect(JSON.stringify(anonymous)).not.toMatch(/Festis|Gästa|Festa/);
  });

  it("steg 44: övningsstationens köp räknas inte i summeringen, på fest-sidan eller som in- och utcheckning", async () => {
    const { raceId, admin } = await party();
    const device = randomUUID();
    await ingestDeviceBatch(db, raceId, readout(device, 1, "8123456", [[31, "2026-10-24T19:14:00.000Z"]],
      { finishPunchedAt: "2026-10-24T21:00:00.000Z" }, true));
    await ingestDeviceBatch(db, raceId, readout(device, 2, "8765432", [[32, "2026-10-24T19:20:00.000Z"]]));
    const value = await state(admin);
    expect(value.guests.map(guest => [guest.cardNumber, guest.purchaseCount])).toEqual([["8765432", 1]]);
    expect([value.purchaseCount, value.totalOre]).toEqual([1, 6_000]);
    const stored = await db.select({ card: schema.cardReadouts.cardNumber, simulated: schema.cardReadouts.simulated })
      .from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, raceId));
    expect(stored.sort((left, right) => left.card.localeCompare(right.card))).toEqual([{ card: "8123456", simulated: true },
      { card: "8765432", simulated: false }]);
  });

  it("steg 44: ta bort utcheckning (bardisken och mål) och incheckning, med auditpost; en senare målstämpling räknas", async () => {
    const { raceId, admin, change } = await party();
    const device = randomUUID();
    await ingestDeviceBatch(db, raceId, readout(device, 1, "8123456", [[31, "2026-10-24T19:14:00.000Z"]],
      { startPunchedAt: "2026-10-24T16:00:00.000Z", finishPunchedAt: "2026-10-24T21:00:00.000Z" }));
    expect((await registerPartyDeskEventAsAdmin(db, { ...admin, request: { formatVersion: 1, deviceId: device, localSequence: 1,
      cardNumber: "8123456", kind: "CHECK_OUT", at: "2026-10-24T20:00:00.000Z" } })).status).toBe("ok");
    expect((await state(admin)).guests[0]?.checkout).toEqual({ at: "2026-10-24T20:00:00.000Z", source: "DESK" });
    const requestId = randomUUID();
    const remove = { formatVersion: 1, requestId, change: { kind: "presence-remove", cardNumber: "8123456", presence: "CHECK_OUT" } };
    const removed = await changePartyAsAdmin(db, { ...admin, request: remove });
    if (removed.status !== "ok") throw new Error(removed.status);
    expect(removed.response.guests[0]?.checkout).toBeUndefined();
    expect(removed.response.guests[0]?.checkoutRemovedAt).toBeDefined();
    // Samma begäran igen: samma läge och ingen ny rad.
    expect((await changePartyAsAdmin(db, { ...admin, request: remove })).status).toBe("ok");
    expect(await db.select().from(schema.partyPresenceVoids).where(eq(schema.partyPresenceVoids.raceId, raceId))).toHaveLength(1);
    // Samma bricka läses ut igen med samma målstämpling: fortfarande inte utcheckad.
    await ingestDeviceBatch(db, raceId, readout(device, 2, "8123456", [[31, "2026-10-24T19:14:00.000Z"]],
      { startPunchedAt: "2026-10-24T16:00:00.000Z", finishPunchedAt: "2026-10-24T21:00:00.000Z" }));
    expect((await state(admin)).guests[0]).toMatchObject({ purchaseCount: 1, checkIn: { source: "START" } });
    expect((await state(admin)).guests[0]?.checkout).toBeUndefined();
    // Incheckningen (startstämplingen) tas bort.
    expect((await change({ kind: "presence-remove", cardNumber: "8123456", presence: "CHECK_IN" })).status).toBe("ok");
    expect((await state(admin)).guests[0]?.checkIn).toBeUndefined();
    // En senare målstämpling (efter borttagningen) räknas igen.
    await ingestDeviceBatch(db, raceId, readout(device, 3, "8123456", [[31, "2026-10-24T19:14:00.000Z"]],
      { finishPunchedAt: "2099-10-24T23:00:00.000Z" }));
    expect((await state(admin)).guests[0]?.checkout).toEqual({ at: "2099-10-24T23:00:00.000Z", source: "FINISH" });
    const audits = await db.select({ action: schema.auditEvents.action }).from(schema.auditEvents).where(eq(schema.auditEvents.raceId, raceId));
    expect(audits.map(row => row.action)).toEqual(expect.arrayContaining(["PARTY_CHECKOUT_REMOVED", "PARTY_CHECK_IN_REMOVED"]));
    // Funktionären tar inte bort in- eller utcheckningar (som ångra köp).
    const functionary = await raceAuth(db, raceId, "FUNCTIONARY");
    expect((await changePartyAsAdmin(db, { ...functionary, request: { ...remove, requestId: randomUUID() } })).status).toBe("forbidden");
  });
});
