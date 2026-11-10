import { describe, expect, it } from "vitest";
import { swedishToday } from "../src";

/** Översynen 2026-11-10, D1: "i dag" är datumet i Sverige, inte UTC-datumet. */
describe("swedishToday", () => {
  it("är nästa dag mellan midnatt och 01:00 svensk vintertid, när UTC fortfarande är gårdagen", () => {
    expect(swedishToday(new Date("2026-11-09T23:30:00Z"))).toBe("2026-11-10");
    expect(swedishToday(new Date("2026-11-10T00:30:00Z"))).toBe("2026-11-10");
  });

  it("följer sommartiden: 22:30 UTC i juli är redan nästa dag i Sverige", () => {
    expect(swedishToday(new Date("2026-07-14T21:59:00Z"))).toBe("2026-07-14");
    expect(swedishToday(new Date("2026-07-14T22:00:00Z"))).toBe("2026-07-15");
  });
});
