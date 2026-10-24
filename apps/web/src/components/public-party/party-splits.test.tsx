import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { publicPartySplitRowSchema, type PublicPartySplitRow } from "@o-tid/contracts";
import { PartySplits, splitMarkColor } from "./party-splits";

/** Steg 42: kvällens sträcktider som besökaren ser dem. Påhittade visningsnamn. */
const clock = (value: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit",
  hourCycle: "h23" }).format(new Date(value));
const rows: PublicPartySplitRow[] = [
  { guestNumber: 2, name: "Festis", purchaseCount: 2, totalSeconds: 6 * 3_600 + 46 * 60, checkIn: { at: "2026-10-24T15:01:00.000Z" },
    purchases: [{ at: "2026-10-24T19:14:00.000Z", sinceSeconds: 15_180, itemName: "Margarita", group: "Drink" },
      { at: "2026-10-24T19:32:30.000Z", sinceSeconds: 1_110, itemName: "Öl" }],
    checkout: { at: "2026-10-24T21:47:00.000Z", sinceSeconds: 8_070 } },
  { guestNumber: 1, purchaseCount: 1, totalSeconds: 0, purchases: [{ at: "2026-10-24T19:20:00.000Z", itemName: "Vin" }] }];

describe("kvällens sträcktider", () => {
  it("klockslag och vara, sträcktid, mål och totalt; Gäst N utan namn", () => {
    rows.forEach(row => publicPartySplitRowSchema.parse(row));
    const html = renderToStaticMarkup(<PartySplits rows={rows} showNames clock={clock} />);
    expect(html).toContain("21:14 <strong>Margarita</strong>");
    expect(html).toContain("+18:30");
    expect(html).toContain("Mål 23:47");
    expect(html).toContain("6:46:00");
    expect(html).toContain("Köp 2");
    expect(html).toContain("Gäst 1");
    expect(html.indexOf("Festis")).toBeLessThan(html.indexOf("Gäst 1"));
    const anonymous = renderToStaticMarkup(<PartySplits rows={rows.map(row => { const copy = { ...row }; delete copy.name; return copy; })} showNames={false} clock={clock} />);
    expect(anonymous).toContain("Gäst 2");
    expect(anonymous).not.toContain("Festis");
    expect(anonymous).toContain("Namnen visas inte");
    expect(splitMarkColor("Drink")).toBe(splitMarkColor("Drink"));
  });
});
