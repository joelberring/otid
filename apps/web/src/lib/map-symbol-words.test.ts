import { describe, expect, it } from "vitest";
import { symbolWordMatches } from "./map-symbol-words";

describe("vardagsord i symbolsökningen", () => {
  it("surdrag hittar 309 och kvartersmark 520, också med decimal", () => {
    expect(symbolWordMatches("309", "surdrag")).toBe(true);
    expect(symbolWordMatches("520", "kvarters")).toBe(true);
    expect(symbolWordMatches("308", "surdrag")).toBe(false);
    expect(symbolWordMatches("301.1", "sjö")).toBe(true);
  });
});
