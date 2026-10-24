import { describe, expect, it } from "vitest";
import {
  formatPartyKronor, partyCardCapacity, partyLedger, partyMemoryWarning, partyPriceAt, partyPurchasesCsv, partyPurchasesOnCard,
  partySummaryCsv, type PartyItem, type PartyReadout
} from "../src";

const startsAt = "2026-10-24T15:00:00.000Z"; // 17:00 svensk tid
const items: PartyItem[] = [
  { id: "beer", code: 31, name: "Öl 40 kr", hidden: false, prices: [{ priceOre: 4_000, validFrom: "2026-10-24T10:00:00.000Z" }] },
  { id: "drink", code: 32, name: "Drink 60 kr", hidden: false, prices: [
    { priceOre: 6_000, validFrom: "2026-10-24T10:00:00.000Z" }, { priceOre: 7_000, validFrom: "2026-10-24T20:00:00.000Z" }] }
];
const read = (cardNumber: string, readAt: string, punches: [number, string][], finishPunchedAt?: string): PartyReadout => ({
  cardNumber, readAt, ...(finishPunchedAt ? { finishPunchedAt } : {}), punches: punches.map(([code, punchedAt]) => ({ code, punchedAt }))
});

describe("fest: köp ur brickans stämplingar", () => {
  it("räknar bara varukoder efter festens start, en gång per stämpling", () => {
    const card = read("8123456", "2026-10-24T19:20:00.000Z", [
      [31, "2026-10-24T14:00:00.000Z"], // före festen
      [31, "2026-10-24T19:14:00.000Z"], [31, "2026-10-24T19:14:00.000Z"], // samma stämpling två gånger
      [45, "2026-10-24T19:15:00.000Z"], // inte en vara
      [32, "2026-10-24T19:16:00.000Z"]
    ]);
    const rows = partyPurchasesOnCard(card, items, startsAt);
    expect(rows.map(row => [row.code, row.priceOre])).toEqual([[31, 4_000], [32, 6_000]]);
    expect(partyPurchasesOnCard(card, items, undefined)).toEqual([]);
  });

  it("samma stämpling som läses ut flera gånger blir ett köp; ny stämpling ger nytt köp", () => {
    const first = read("8123456", "2026-10-24T19:20:00.000Z", [[31, "2026-10-24T19:14:00.000Z"]]);
    const again = read("8123456", "2026-10-24T19:20:04.000Z", [[31, "2026-10-24T19:14:00.000Z"]]);
    const later = read("8123456", "2026-10-24T20:30:00.000Z", [[31, "2026-10-24T19:14:00.000Z"], [31, "2026-10-24T20:29:00.000Z"]]);
    const ledger = partyLedger({ startsAt, items, readouts: [first, again, later] });
    expect(ledger.purchaseCount).toBe(2);
    expect(ledger.totalOre).toBe(8_000);
    expect(ledger.purchases[0]!.firstReadAt).toBe("2026-10-24T19:20:00.000Z");
  });

  it("samma kod flera gånger är flera köp; dubbelstämpling inom 5 s är ett; före start räknas inte", () => {
    const card = read("8123456", "2026-10-24T19:20:00.000Z", [
      [31, "2026-10-24T14:59:59.000Z"], [31, "2026-10-24T19:00:00.000Z"], [31, "2026-10-24T19:00:02.000Z"], [31, "2026-10-24T19:10:00.000Z"]]);
    const rows = partyPurchasesOnCard(card, items, startsAt);
    expect(rows.map(row => row.punchedAt)).toEqual(["2026-10-24T19:00:00.000Z", "2026-10-24T19:10:00.000Z"]);
    expect(partyLedger({ startsAt, items, readouts: [card, { ...card, readAt: "2026-10-24T19:30:00.000Z" }] }).purchaseCount).toBe(2);
    expect(partyPurchasesOnCard(card, items, startsAt, 1).length).toBe(3);
  });

  it("priset är det som gällde när gästen stämplade", () => {
    expect(partyPriceAt(items[1]!, "2026-10-24T19:59:59.000Z")).toBe(6_000);
    expect(partyPriceAt(items[1]!, "2026-10-24T20:00:00.000Z")).toBe(7_000);
    expect(partyPriceAt(items[1]!, "2026-10-24T09:00:00.000Z")).toBe(6_000);
  });

  it("summa per person, ångrade köp räknas inte, namn ur gästlistan", () => {
    const ledger = partyLedger({ startsAt, items,
      readouts: [read("8123456", "2026-10-24T19:20:00.000Z", [[31, "2026-10-24T19:14:00.000Z"], [32, "2026-10-24T19:15:00.000Z"]]),
        read("2100200", "2026-10-24T19:30:00.000Z", [[31, "2026-10-24T19:25:00.000Z"]])],
      voids: [{ cardNumber: "8123456", code: 31, punchedAt: "2026-10-24T19:14:00.000Z", reason: "Fel enhet", voidedAt: "2026-10-24T19:40:00.000Z" }],
      guests: [{ cardNumber: "8123456", name: "Testa Festsson", club: "Påhittade OK" }] });
    expect(ledger.guests.map(guest => [guest.cardNumber, guest.name, guest.purchaseCount, guest.totalOre]))
      .toEqual([["8123456", "Testa Festsson", 1, 6_000], ["2100200", undefined, 1, 4_000]]);
    expect(ledger.totalOre).toBe(10_000);
    expect(ledger.purchases.find(row => row.code === 31 && row.cardNumber === "8123456")?.voided?.reason).toBe("Fel enhet");
  });

  it("målstämpling efter start checkar ut; köp efter den märks", () => {
    const ledger = partyLedger({ startsAt, items, readouts: [read("8123456", "2026-10-24T21:50:00.000Z",
      [[31, "2026-10-24T19:14:00.000Z"], [32, "2026-10-24T21:48:00.000Z"]], "2026-10-24T21:47:00.000Z")] });
    expect(ledger.guests[0]!.checkout).toEqual({ at: "2026-10-24T21:47:00.000Z", source: "FINISH" });
    expect(ledger.purchases.map(row => row.afterCheckout)).toEqual([false, true]);
    expect(ledger.totalOre).toBe(4_000 + 7_000);
  });

  it("målstämpling före festen checkar inte ut; bardiskens utcheckning gör det, den tidigaste gäller", () => {
    const old = partyLedger({ startsAt, items, readouts: [read("8123456", "2026-10-24T19:00:00.000Z", [], "2026-10-24T11:00:00.000Z")] });
    expect(old.guests).toEqual([]);
    const both = partyLedger({ startsAt, items, readouts: [read("8123456", "2026-10-24T22:10:00.000Z", [], "2026-10-24T22:05:00.000Z")],
      deskEvents: [{ cardNumber: "8123456", kind: "CHECK_OUT", at: "2026-10-24T21:00:00.000Z" }] });
    expect(both.guests[0]!.checkout).toEqual({ at: "2026-10-24T21:00:00.000Z", source: "DESK" });
  });

  it("startstämpling efter start och bardisken checkar in; clear räknas inte", () => {
    const start = { ...read("8123456", "2026-10-24T16:20:00.000Z", []), startPunchedAt: "2026-10-24T16:12:00.000Z" };
    expect(partyLedger({ startsAt, items, readouts: [start] }).guests[0]!.checkIn).toEqual({ at: "2026-10-24T16:12:00.000Z", source: "START" });
    const early = { ...read("8123456", "2026-10-24T16:20:00.000Z", []), startPunchedAt: "2026-10-24T09:00:00.000Z" };
    const desk = partyLedger({ startsAt, items, readouts: [early],
      deskEvents: [{ cardNumber: "8123456", kind: "CHECK_IN", at: "2026-10-24T16:30:00.000Z" }] });
    expect(desk.guests[0]!.checkIn).toEqual({ at: "2026-10-24T16:30:00.000Z", source: "DESK" });
    expect(desk.guests[0]!.checkout).toBeUndefined();
  });

  it("varnar när SI5/SI8 eller SI9 snart är full", () => {
    expect(partyCardCapacity("123456")).toBe(30);
    expect(partyCardCapacity("2100200")).toBe(30);
    expect(partyCardCapacity("1100200")).toBe(50);
    expect(partyCardCapacity("8123456")).toBeUndefined();
    expect(partyCardCapacity("8123456", "SI9")).toBe(50);
    expect(partyMemoryWarning({ punches: 25, capacity: 30 })).toBe(true);
    expect(partyMemoryWarning({ punches: 24, capacity: 30 })).toBe(false);
  });
});

describe("fest: CSV", () => {
  const ledger = partyLedger({ startsAt, items,
    readouts: [read("8123456", "2026-10-24T19:20:00.000Z", [[31, "2026-10-24T19:14:00.000Z"]], "2026-10-24T21:47:00.000Z")],
    guests: [{ cardNumber: "8123456", name: "Åsa \"Ölet\" Öberg", club: "Påhittade OK; Väst" }] });

  it("summering: BOM, semikolon, kronor med decimalkomma, utcheckning med tid och källa", () => {
    const text = partySummaryCsv(ledger, "Europe/Stockholm");
    expect(text.startsWith("﻿")).toBe(true);
    expect(text.slice(1).split("\r\n")).toEqual([
      "Namn;Klubb;Bricka;Antal köp;Summa kr;Incheckad;Utcheckad;Utcheckad via",
      "\"Åsa \"\"Ölet\"\" Öberg\";\"Påhittade OK; Väst\";8123456;1;40,00;;2026-10-24 23:47:00;Mål",
      ""
    ]);
  });

  it("alla köp: en rad per köp", () => {
    const lines = partyPurchasesCsv(ledger, "Europe/Stockholm").slice(1).split("\r\n");
    expect(lines[0]).toBe("Tid;Bricka;Namn;Klubb;Vara;Kod;Pris kr;Efter utcheckning;Ångrad;Orsak");
    expect(lines[1]).toBe("2026-10-24 21:14:00;8123456;\"Åsa \"\"Ölet\"\" Öberg\";\"Påhittade OK; Väst\";Öl 40 kr;31;40,00;;;");
  });

  it("formler i fält oskadliggörs och kronor formateras", () => {
    const evil = partyLedger({ startsAt, items, readouts: [], guests: [{ cardNumber: "5", name: "=SUMMA(A1)" }] });
    expect(partySummaryCsv(evil, "Europe/Stockholm")).toContain("'=SUMMA(A1)");
    expect(formatPartyKronor(4_050)).toBe("40,50");
    expect(formatPartyKronor(5)).toBe("0,05");
  });
});

describe("fest: färger med kontrast", () => {
  it("text blir mörk eller ljus efter bakgrunden och grön mörkas till AA", async () => {
    const { contrastRatio, readableTextOn, textColorOn } = await import("../src");
    expect(readableTextOn("#ae1917")).toBe("#ffffff");
    expect(readableTextOn("#62c83a")).toBe("#1a1a1a");
    expect(readableTextOn("#faf4bd")).toBe("#1a1a1a");
    expect(contrastRatio("#62c83a", "#ffffff")).toBeLessThan(4.5);
    const green = textColorOn("#62c83a", "#ffffff");
    expect(contrastRatio(green, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(textColorOn("#62c83a", "#faf4bd"), "#faf4bd")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#2e7d18", "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("fest: publik statistik", () => {
  it("utan namn: anonymt; med namn: namn men aldrig belopp eller bricka", async () => {
    const { partyPublicStats } = await import("../src");
    const ledger = partyLedger({ startsAt, items, readouts: [
      { ...read("8123456", "2026-10-24T19:20:00.000Z", [[31, "2026-10-24T19:14:00.000Z"], [31, "2026-10-24T19:20:00.000Z"], [32, "2026-10-24T19:50:00.000Z"]],
        "2026-10-24T21:47:00.000Z"), startPunchedAt: "2026-10-24T16:01:00.000Z" }],
      guests: [{ cardNumber: "8123456", name: "Testa Festsson" }] });
    const anonymous = partyPublicStats(ledger, { showNames: false });
    expect(anonymous).toMatchObject({ soldCount: 3, guestCount: 1, checkedInCount: 1, checkedOutCount: 1,
      items: [{ name: "Öl 40 kr", count: 2 }, { name: "Drink 60 kr", count: 1 }], averageSecondsBetween: 1_080 });
    expect(anonymous.quarters.map(row => row.count)).toEqual([1, 1, 0, 1]);
    expect(anonymous.peak).toBe(0);
    expect(JSON.stringify(anonymous)).not.toMatch(/Testa|8123456|Ore|ore/);
    expect(anonymous.firstFinish).toEqual({ at: "2026-10-24T21:47:00.000Z" });
    const named = partyPublicStats(ledger, { showNames: true });
    expect(named.guests).toEqual([{ name: "Testa Festsson", purchaseCount: 3 }]);
    expect(named.recent[0]).toEqual({ at: "2026-10-24T19:50:00.000Z", itemName: "Drink 60 kr", name: "Testa Festsson" });
    expect(JSON.stringify(named)).not.toMatch(/8123456|totalOre|priceOre/);
  });
});
