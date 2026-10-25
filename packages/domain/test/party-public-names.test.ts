import { describe, expect, it } from "vitest";
import { PARTY_SHOW_PUBLIC_NAMES_DEFAULT, partyLedger, partyPublicStats, partyShowsPublicNames, type PartyItem } from "../src";

/** Steg 46: namn på den publika fest-sidan är av tills admin slår på det; en sparad inställning gäller. */
const startsAt = "2026-10-24T15:00:00.000Z";
const items: PartyItem[] = [{ id: "beer", code: 31, name: "Öl", hidden: false, prices: [{ priceOre: 4_000, validFrom: startsAt }] }];

describe("fest: namn på den publika sidan", () => {
  it("är av utan sparad inställning och följer en sparad inställning", () => {
    expect(PARTY_SHOW_PUBLIC_NAMES_DEFAULT).toBe(false);
    expect(partyShowsPublicNames(undefined)).toBe(false);
    expect(partyShowsPublicNames({ showPublicNames: true })).toBe(true);
    expect(partyShowsPublicNames({ showPublicNames: false })).toBe(false);
  });

  it("förvalet visar varken visningsnamn eller fullt namn, bara antal och klockslag", () => {
    const ledger = partyLedger({ startsAt, items,
      readouts: [{ cardNumber: "8123456", readAt: "2026-10-24T19:20:00.000Z", punches: [{ code: 31, punchedAt: "2026-10-24T19:14:00.000Z" }] }],
      guests: [{ cardNumber: "8123456", name: "Påhitta Festsson", displayName: "Hitta" }] });
    const stats = partyPublicStats(ledger, { showNames: partyShowsPublicNames(undefined) });
    expect(stats.soldCount).toBe(1);
    expect(stats.recent).toEqual([{ at: "2026-10-24T19:14:00.000Z", itemName: "Öl" }]);
    expect(JSON.stringify(stats)).not.toMatch(/Hitta|Påhitta|Festsson|8123456/);
    expect(JSON.stringify(partyPublicStats(ledger, { showNames: true }))).toContain("Hitta");
  });
});
