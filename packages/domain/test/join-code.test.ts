import { describe, expect, it } from "vitest";
import { normalizeJoinCode, RACE_SHORT_CODE_PATTERN } from "../src";

/** Översynen av startsidan 2026-11-17: det som skrivs eller klistras in i "Har du en kod?". */
describe("koden i Har du en kod?", () => {
  it("tar tävlingens korta kod med versaler och blanksteg", () => {
    expect(normalizeJoinCode("abc234")).toEqual({ kind: "race", code: "abc234" });
    expect(normalizeJoinCode("  ABC234 ")).toEqual({ kind: "race", code: "abc234" });
    expect(normalizeJoinCode("abc 234")).toEqual({ kind: "race", code: "abc234" });
    expect(normalizeJoinCode("ＡＢＣ２３４")).toEqual({ kind: "race", code: "abc234" });
    expect(normalizeJoinCode("abc234.")).toEqual({ kind: "race", code: "abc234" });
  });

  it("tar gruppens kod, också med telefonens tankstreck", () => {
    expect(normalizeJoinCode("Ungdom-k7m2pq9x")).toEqual({ kind: "group", code: "ungdom-k7m2pq9x" });
    expect(normalizeJoinCode("ungdom–k7m2pq9x")).toEqual({ kind: "group", code: "ungdom-k7m2pq9x" });
  });

  it("tar koden ur en hel adress, med eller utan schema, och bryr sig inte om värden", () => {
    expect(normalizeJoinCode("https://otid.berring.se/t/abc234")).toEqual({ kind: "race", code: "abc234" });
    expect(normalizeJoinCode("HTTPS://OTID.BERRING.SE/T/ABC234/")).toEqual({ kind: "race", code: "abc234" });
    expect(normalizeJoinCode("otid.berring.se/g/ungdom-xyz")).toEqual({ kind: "group", code: "ungdom-xyz" });
    expect(normalizeJoinCode("https://otid.berring.se/fest/abc234/qr?x=1#topp")).toEqual({ kind: "race", code: "abc234" });
    expect(normalizeJoinCode("https://otid.berring.se/t/abc234/live")).toEqual({ kind: "race", code: "abc234" });
    expect(normalizeJoinCode("/t/abc234")).toEqual({ kind: "race", code: "abc234" });
    expect(normalizeJoinCode("t/abc234")).toEqual({ kind: "race", code: "abc234" });
    expect(normalizeJoinCode("http://localhost:3000/g/klubben-abcdefgh")).toEqual({ kind: "group", code: "klubben-abcdefgh" });
  });

  it("följer adressens sort: /t/ är en tävling och /g/ en grupp", () => {
    expect(normalizeJoinCode("otid.berring.se/t/ungdom-xyz")).toBeUndefined();
    expect(normalizeJoinCode("otid.berring.se/g/abc234")).toEqual({ kind: "group", code: "abc234" });
  });

  it("ger inget för det som inte kan vara en kod", () => {
    for (const input of ["", "   ", "-", "ab", "https://otid.berring.se/", "https://otid.berring.se/om", "https://otid.berring.se/t/",
      "otid.berring.se/constructor/x", "abc_234", "a".repeat(41), "-abc234-x"]) {
      expect(normalizeJoinCode(input), input).toBeUndefined();
    }
  });

  it("tävlingens kod har inga lätt förväxlade tecken", () => {
    expect(RACE_SHORT_CODE_PATTERN.test("abc234")).toBe(true);
    for (const code of ["abc230", "abc231", "abci34", "abcl34", "abco34", "abc23", "abc2345"]) {
      expect(RACE_SHORT_CODE_PATTERN.test(code), code).toBe(false);
    }
  });
});
