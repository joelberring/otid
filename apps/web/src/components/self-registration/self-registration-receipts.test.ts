import { describe, expect, it } from "vitest";
import { readReceipts, receiptKey, rememberReceipt } from "./self-registration-receipts";

function memory() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, values };
}

describe("självregistreringens kvitto i webbläsaren", () => {
  it("minns kvittot per tävling", () => {
    const store = memory();
    rememberReceipt("r1", { name: "Fia Gran", className: "Lång", cardNumber: "9000001" }, store);
    expect(readReceipts("r1", store)).toEqual([{ name: "Fia Gran", className: "Lång", cardNumber: "9000001" }]);
    expect(readReceipts("r2", store)).toEqual([]);
  });

  it("samma bricka ersätter det tidigare kvittot; flera brickor står kvar", () => {
    const store = memory();
    rememberReceipt("r1", { name: "Fia Gran", className: "Lång", cardNumber: "9000001" }, store);
    rememberReceipt("r1", { name: "Bo Gran", className: "Kort", cardNumber: "9000002" }, store);
    const rows = rememberReceipt("r1", { name: "Fia Gran", className: "Kort", cardNumber: "9000001" }, store);
    expect(rows.map(row => `${row.name} ${row.className}`)).toEqual(["Bo Gran Kort", "Fia Gran Kort"]);
  });

  it("trasigt eller blockerat minne ger inget kvitto och inget fel", () => {
    const store = memory();
    store.values.set(receiptKey("r1"), "{inte json");
    expect(readReceipts("r1", store)).toEqual([]);
    const blocked = { getItem: () => { throw new Error("blockerad"); }, setItem: () => { throw new Error("blockerad"); } };
    expect(readReceipts("r1", blocked)).toEqual([]);
    expect(rememberReceipt("r1", { name: "A", className: "B", cardNumber: "1" }, blocked)).toHaveLength(1);
  });
});
